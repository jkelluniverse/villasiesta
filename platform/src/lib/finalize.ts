import { prisma } from './db';
import { BookingStatus, BlockSource, PaymentMethod, PaymentPlan } from '@prisma/client';
import { loadPropertyPricing } from './pricing';
import { assertRangeAvailable } from './availability';
import { addDays, nightsBetween, parseKey, toKey, todayKey } from './dates';
import { createSquarePayment, createSquareCustomer, createCardOnFile, toCents } from './square';
import { chargeForBooking } from './booking-pricing';
import { sendEmail, sendTemplate, notifyEmails } from './email';
import { depositReceipt, paidConfirmation, ownerPaymentAlert } from './emails';
import { logComms } from './comms';
import { CommsType } from '@prisma/client';

const SPLIT_MIN_DAYS_OUT = 90;   // 50/50 split only when check-in is > 90 days away
const BALANCE_LEAD_DAYS = 14;    // balance auto-charged at check-in − 14 days
const CARD_MARKUP = 1.03;        // +3% processing fee (card)
const ACH_MARKUP = 1.01;         // +1% processing fee (bank transfer)

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

  const ci = toKey(booking.checkIn), co = toKey(booking.checkOut);

  // Server-side money via the single resolver (owner-set price / comp-stay
  // nights / fresh quote). Card/ACH markup applies at charge time.
  const loaded = booking.priceCustom ? null : await loadPropertyPricing(booking.property.slug);
  const charge = chargeForBooking(booking, loaded?.pricing ?? null);
  if (!charge.ok) return { ok: false, error: charge.error };
  const baseTotal = charge.baseTotal;

  const useSplit = input.plan === 'split';
  if (useSplit && !splitEligible(ci)) return { ok: false, error: 'split_not_available' };
  if (useSplit && input.method !== 'card') return { ok: false, error: 'split_requires_card' };

  const depositBase = useSplit ? money2(baseTotal / 2) : baseTotal;
  const balanceBase = useSplit ? money2(baseTotal - depositBase) : 0;
  const balanceDueDate = useSplit ? addDays(ci, -BALANCE_LEAD_DAYS) : null;

  const isCard = input.method === 'card';
  // Processing fee by rail: card +3%, ACH +1% (manual apps never reach finalize).
  const chargeNow = money2(depositBase * (isCard ? CARD_MARKUP : ACH_MARKUP));
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

  const eb = {
    id: booking.id, reference: booking.reference, firstName: booking.client.firstName, lastName: booking.client.lastName,
    checkIn: booking.checkIn, checkOut: booking.checkOut, nights: booking.nights, guests: booking.guests,
    total: money2(baseTotal + cardFeeNow),
    depositAmount: useSplit ? depositBase : null, balanceAmount: useSplit ? balanceBase : null,
    balanceDueDate: balanceDueDate ? parseKey(balanceDueDate) : null,
  };
  const owners = notifyEmails();

  if (achPending) {
    // No template for "processing" — a short branded-adjacent note; confirmation
    // follows from the webhook when Square completes the ACH.
    await sendEmail({
      to: booking.client.email, replyTo: owners[0],
      subject: 'Payment processing — Villa Siesta',
      text: `Hi ${booking.client.firstName},\n\nYour bank payment is processing (transfers take a few business days). Your dates ${ci} → ${co} are held — we'll confirm the moment it clears.\n\n— Villa Siesta`,
    });
  } else if (useSplit) {
    await sendTemplate(booking.client.email, depositReceipt(eb), owners[0]);
    await logComms(booking.clientId, CommsType.EMAIL, 'deposit-receipt');
    if (owners.length) await sendTemplate(owners, ownerPaymentAlert(eb, 'deposit'), booking.client.email);
  } else {
    await sendTemplate(booking.client.email, paidConfirmation(eb), owners[0]);
    await logComms(booking.clientId, CommsType.EMAIL, 'paid-confirmation');
    if (owners.length) await sendTemplate(owners, ownerPaymentAlert(eb, 'full'), booking.client.email);
  }

  return { ok: true, status: newStatus, pendingAch: achPending, mock: payment.mock };
}
