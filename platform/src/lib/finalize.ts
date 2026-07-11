import { prisma } from './db';
import { BookingStatus, BlockSource, PaymentMethod, PaymentPlan } from '@prisma/client';
import { loadPropertyPricing, computeQuote } from './pricing';
import { assertRangeAvailable } from './availability';
import { addDays, nightsBetween, parseKey, toKey, todayKey } from './dates';
import { createSale, createBalanceSchedule } from './forte';
import { sendEmail, notifyEmails } from './email';

const SPLIT_MIN_DAYS_OUT = 90;   // 50/50 split only when check-in is > 90 days away
const BALANCE_LEAD_DAYS = 14;    // balance charged at check-in − 14 days

export function splitEligible(checkInKey: string): boolean {
  return nightsBetween(todayKey(), checkInKey) > SPLIT_MIN_DAYS_OUT;
}

export type FinalizeInput = {
  bookingId: string;
  method: 'ach' | 'card';
  plan: 'full' | 'split';
  oneTimeToken?: string;   // Forte.js token (ignored in mock mode)
};

export type FinalizeResult = { ok: boolean; status?: BookingStatus; mock?: boolean; error?: string };

export async function finalizeBooking(input: FinalizeInput): Promise<FinalizeResult> {
  const booking = await prisma.booking.findUnique({ where: { id: input.bookingId }, include: { client: true, property: true } });
  if (!booking) return { ok: false, error: 'not_found' };
  if (booking.status === BookingStatus.PAID) return { ok: true, status: BookingStatus.PAID };
  if (booking.status !== BookingStatus.APPROVED && booking.status !== BookingStatus.PARTIALLY_PAID)
    return { ok: false, error: 'not_finalizable' };

  const loaded = await loadPropertyPricing(booking.property.slug);
  if (!loaded) return { ok: false, error: 'pricing_unavailable' };

  const ci = toKey(booking.checkIn), co = toKey(booking.checkOut);
  const quote = computeQuote(loaded.pricing, { checkIn: ci, checkOut: co, guests: booking.guests, pet: booking.petFee > 0, method: input.method });
  if (!quote.ok) return { ok: false, error: quote.error };

  const useSplit = input.plan === 'split' && splitEligible(ci);
  const deposit = useSplit ? Math.round(quote.total / 2) : quote.total;
  const balance = useSplit ? quote.total - deposit : 0;
  const balanceDueDate = useSplit ? addDays(ci, -BALANCE_LEAD_DAYS) : null;

  // Charge (deposit for split, full otherwise). Mock mode auto-approves.
  const sale = await createSale({
    amountDollars: deposit, method: input.method, oneTimeToken: input.oneTimeToken, saveToken: useSplit,
    billing: { firstName: booking.client.firstName, lastName: booking.client.lastName, email: booking.client.email },
    orderNumber: booking.id,
  });
  if (!sale.ok) return { ok: false, error: sale.error || 'charge_declined' };

  // Schedule the balance for split plans (best-effort; cron can also cover this).
  let scheduleId: string | undefined;
  if (useSplit && sale.paymethodToken && balanceDueDate) {
    const sched = await createBalanceSchedule({ paymethodToken: sale.paymethodToken, amountDollars: balance, startDate: balanceDueDate, orderNumber: booking.id });
    scheduleId = sched.scheduleId;
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Final double-booking guard at the moment of payment (exclude this booking's own hold).
      await assertRangeAvailable(tx, booking.propertyId, ci, co, booking.id);
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: useSplit ? BookingStatus.PARTIALLY_PAID : BookingStatus.PAID,
          paymentMethod: input.method === 'card' ? PaymentMethod.CARD : PaymentMethod.ACH,
          paymentPlan: useSplit ? PaymentPlan.SPLIT : PaymentPlan.FULL,
          cardFee: quote.cardFee, total: quote.total,
          depositAmount: useSplit ? deposit : null,
          balanceAmount: useSplit ? balance : null,
          balanceDueDate: balanceDueDate ? parseKey(balanceDueDate) : null,
          balancePaid: !useSplit,
          forteTransactionId: sale.transactionId,
          fortePaymethodToken: sale.paymethodToken || null,
          forteScheduleId: scheduleId || null,
          holdExpiresAt: null,
        },
      });
      // Lock the dates with a BOOKING calendar block (idempotent on bookingId).
      const existing = await tx.calendarBlock.findUnique({ where: { bookingId: booking.id } });
      if (!existing) {
        await tx.calendarBlock.create({
          data: { propertyId: booking.propertyId, startDate: parseKey(ci), endDate: parseKey(co), source: BlockSource.BOOKING, bookingId: booking.id, summary: 'Booked (direct)' },
        });
      }
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'DATES_UNAVAILABLE') return { ok: false, error: 'dates_unavailable' };
    console.error('[finalize] commit failed', e);
    return { ok: false, error: 'server_error' };
  }

  await sendReceipt(booking.client.email, booking.property.currency, {
    name: booking.client.firstName, dates: `${ci} → ${co}`, nights: booking.nights,
    charged: deposit, total: quote.total, split: useSplit, balance, balanceDue: balanceDueDate, mock: sale.mock,
  });

  return { ok: true, status: useSplit ? BookingStatus.PARTIALLY_PAID : BookingStatus.PAID, mock: sale.mock };
}

async function sendReceipt(email: string, cur: string, r: { name: string; dates: string; nights: number; charged: number; total: number; split: boolean; balance: number; balanceDue: string | null; mock: boolean }) {
  const lines = [
    `Hi ${r.name},`, '',
    `You're confirmed at Villa Siesta — thank you!`,
    `${r.dates} · ${r.nights} nights`, '',
    r.split
      ? `Deposit paid: ${cur}${r.charged.toLocaleString()} (50%). Balance ${cur}${r.balance.toLocaleString()} scheduled for ${r.balanceDue}.`
      : `Paid in full: ${cur}${r.total.toLocaleString()}.`,
    '', 'Your exact address and check-in details are on their way.', '', '— Villa Siesta',
  ];
  if (r.mock) lines.unshift('[TEST/MOCK PAYMENT — Forte not yet configured]', '');
  await sendEmail({ to: email, replyTo: notifyEmails()[0], subject: 'Your reservation is confirmed — Villa Siesta', text: lines.join('\n') });
}
