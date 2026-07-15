import { prisma } from './db';
import { BookingStatus, BlockSource, PaymentMethod, PaymentPlan } from '@prisma/client';
import { loadPropertyPricing, computeQuote } from './pricing';
import { assertRangeAvailable } from './availability';
import { addDays, nightsBetween, parseKey, toKey, todayKey } from './dates';
import { createSquarePayment, createSquareCustomer, createCardOnFile, toCents } from './square';
import { sendEmail, notifyEmails } from './email';

const SPLIT_MIN_DAYS_OUT = 90;   // 50/50 split only when check-in is > 90 days away
const BALANCE_LEAD_DAYS = 14;    // balance auto-charged at check-in − 14 days
const CARD_MARKUP = 1.03;        // +3% service charge, applied at charge time (card only)

export function splitEligible(checkInKey: string): boolean {
  return nightsBetween(todayKey(), checkInKey) > SPLIT_MIN_DAYS_OUT;
}

/** Round to whole cents-safe dollars. */
const money2 = (n: number) => Math.round(n * 100) / 100;

export type FinalizeInput = {
  bookingId: string;
  method: 'ach' | 'card';
  plan: 'full' | 'split';
  sourceId?: string;          // Web Payments SDK token (absent in mock mode)
  verificationToken?: string; // verifyBuyer token — required to store a card (split)
};

export type FinalizeResult = { ok: boolean; status?: BookingStatus; pendingAch?: boolean; mock?: boolean; error?: string };

export async function finalizeBooking(input: FinalizeInput): Promise<FinalizeResult> {
  const booking = await prisma.booking.findUnique({ where: { id: input.bookingId }, include: { client: true, property: true } });
  if (!booking) return { ok: false, error: 'not_found' };
  if (booking.status === BookingStatus.PAID || booking.status === BookingStatus.PARTIALLY_PAID)
    return { ok: true, status: booking.status };
  if (booking.status !== BookingStatus.APPROVED) return { ok: false, error: 'not_finalizable' };

  const loaded = await loadPropertyPricing(booking.property.slug);
  if (!loaded) return { ok: false, error: 'pricing_unavailable' };

  const ci = toKey(booking.checkIn), co = toKey(booking.checkOut);

  // Server-side money. Base = no-fee total; card multiplies at charge time (§0/§3).
  const baseQuote = computeQuote(loaded.pricing, { checkIn: ci, checkOut: co, guests: booking.guests, pet: booking.petFee > 0, method: 'ach' });
  if (!baseQuote.ok) return { ok: false, error: baseQuote.error };
  const baseTotal = baseQuote.total;

  const useSplit = input.plan === 'split';
  if (useSplit && !splitEligible(ci)) return { ok: false, error: 'split_not_available' };
  if (useSplit && input.method !== 'card') return { ok: false, error: 'split_requires_card' };

  const depositBase = useSplit ? money2(baseTotal / 2) : baseTotal;
  const balanceBase = useSplit ? money2(baseTotal - depositBase) : 0;
  const balanceDueDate = useSplit ? addDays(ci, -BALANCE_LEAD_DAYS) : null;

  const isCard = input.method === 'card';
  const chargeNow = money2(depositBase * (isCard ? CARD_MARKUP : 1));
  const cardFeeNow = money2(chargeNow - depositBase);

  // ---- Charge (deterministic idempotency keys: retries can never double-charge) ----
  let customerId: string | undefined;
  if (useSplit) {
    const cust = await createSquareCustomer({
      firstName: booking.client.firstName, lastName: booking.client.lastName, email: booking.client.email,
      idempotencyKey: `bk_${booking.id}_cust`,
    });
    if (!cust.ok || !cust.customerId) return { ok: false, error: cust.error || 'customer_failed' };
    customerId = cust.customerId;
  }

  const payment = await createSquarePayment({
    sourceId: input.sourceId || 'MOCK',
    amountCents: toCents(chargeNow),
    idempotencyKey: useSplit ? `bk_${booking.id}_deposit` : `bk_${booking.id}_full`,
    referenceId: useSplit ? `${booking.id}-deposit` : booking.id,
    note: useSplit ? 'Villa Siesta — 50% deposit' : 'Villa Siesta — paid in full',
    customerId,
  });
  if (!payment.ok) return { ok: false, error: payment.error || 'charge_failed' };

  // Card on file for the scheduled balance (split only).
  let cardId: string | undefined;
  if (useSplit && customerId) {
    const card = await createCardOnFile({
      sourceId: input.sourceId || 'MOCK', verificationToken: input.verificationToken,
      customerId, idempotencyKey: `bk_${booking.id}_card`,
    });
    if (!card.ok || !card.cardId) {
      // Deposit went through but the card couldn't be stored — surface clearly.
      console.error('[finalize] deposit charged but card-on-file failed:', card.error);
      return { ok: false, error: card.error || 'card_on_file_failed' };
    }
    cardId = card.cardId;
  }

  // ACH completes asynchronously (3–5 business days): PENDING = dates held,
  // the webhook flips the status when Square completes it. Never PAID at create.
  const achPending = !isCard && payment.status !== 'COMPLETED';
  const newStatus = achPending
    ? BookingStatus.APPROVED
    : useSplit ? BookingStatus.PARTIALLY_PAID : BookingStatus.PAID;

  try {
    await prisma.$transaction(async (tx) => {
      // Final double-booking guard at the moment of payment (self-excluded).
      await assertRangeAvailable(tx, booking.propertyId, ci, co, booking.id);
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: newStatus,
          paymentMethod: isCard ? PaymentMethod.CARD : PaymentMethod.ACH,
          paymentPlan: useSplit ? PaymentPlan.SPLIT : PaymentPlan.FULL,
          // total/cardFee reflect what's charged so far; the balance sweep adds
          // the balance's +3% when it actually charges the card.
          cardFee: cardFeeNow,
          total: money2(baseTotal + cardFeeNow),
          depositAmount: useSplit ? depositBase : null,
          balanceAmount: useSplit ? balanceBase : null,
          balanceDueDate: balanceDueDate ? parseKey(balanceDueDate) : null,
          balancePaid: !useSplit && !achPending,
          squarePaymentId: payment.paymentId,
          squareCustomerId: customerId || null,
          squareCardId: cardId || null,
          holdExpiresAt: null,
        },
      });
      // Lock the dates (idempotent on bookingId). ACH-pending also locks — dates held.
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
    charged: chargeNow, split: useSplit, balance: balanceBase, balanceDue: balanceDueDate,
    achPending, mock: !!payment.mock,
  });

  return { ok: true, status: newStatus, pendingAch: achPending, mock: payment.mock };
}

async function sendReceipt(email: string, cur: string, r: {
  name: string; dates: string; nights: number; charged: number;
  split: boolean; balance: number; balanceDue: string | null; achPending: boolean; mock: boolean;
}) {
  const fmt = (n: number) => cur + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const lines = [
    `Hi ${r.name},`, '',
    r.achPending
      ? `Your bank payment of ${fmt(r.charged)} is processing (bank transfers take a few business days). Your dates are held — we'll confirm the moment it clears.`
      : `You're confirmed at Villa Siesta — thank you!`,
    `${r.dates} · ${r.nights} nights`, '',
    r.split
      ? `Deposit: ${fmt(r.charged)} (50%). The remaining ${fmt(r.balance)} will be charged automatically to your card on ${r.balanceDue}.`
      : r.achPending ? '' : `Paid in full: ${fmt(r.charged)}.`,
    '', r.achPending ? '' : 'Your exact address and check-in details are on their way.', '', '— Villa Siesta',
  ];
  if (r.mock) lines.unshift('[TEST/MOCK PAYMENT — Square not yet configured]', '');
  await sendEmail({ to: email, replyTo: notifyEmails()[0], subject: r.achPending ? 'Payment processing — Villa Siesta' : 'Your reservation is confirmed — Villa Siesta', text: lines.filter((l) => l !== '').join('\n') });
}
