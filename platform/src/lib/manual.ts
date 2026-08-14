import { db, tid } from './dal';
import { BookingStatus, BlockSource, PaymentMethod, PaymentPlan, CommsType } from '@prisma/client';
import { parseKey, toKey, addDays } from './dates';
import { logComms } from './comms';

// ─────────────────────────────────────────────────────────────────────────────
// Transfer-app destinations. Zelle only — routed by the owner's name + phone.
// ─────────────────────────────────────────────────────────────────────────────
export const HOST_NAME = process.env.HOST_NAME || 'Jacob Kell';
export const HOST_PHONE = process.env.HOST_PHONE || '330-495-7821';

export type TransferApp = { key: Extract<PaymentMethod, 'CASHAPP' | 'VENMO' | 'ZELLE' | 'CHIME'>; label: string; handle: string; sub?: string };

export const TRANSFER_APPS: TransferApp[] = [
  { key: 'ZELLE', label: 'Zelle', handle: HOST_NAME, sub: HOST_PHONE },
];

export const MANUAL_METHODS: PaymentMethod[] = ['ZELLE'];
export function isManualMethod(m: PaymentMethod | null | undefined): boolean {
  return !!m && MANUAL_METHODS.includes(m);
}

const METHOD_LABELS: Record<string, string> = {
  ACH: 'ACH', ACH_DIRECT: 'Bank debit', CARD: 'Card',
  ZELLE: 'Zelle', CASHAPP: 'Cash App', VENMO: 'Venmo', CHIME: 'Chime',
};
export function appLabel(m: PaymentMethod): string {
  return METHOD_LABELS[m] ?? m;
}

const BALANCE_LEAD_DAYS = 14;
const CLAIM_HOLD_DAYS = 2;
const money2 = (n: number) => Math.round(n * 100) / 100;

export type ManualSettlement = { ok: boolean; status?: BookingStatus; error?: string };

/**
 * Record a manual payment and run the same settlement logic a Square webhook
 * would: enough to cover the total → PAID (+ CalendarBlock + paidConfirmation);
 * a SPLIT deposit → PARTIALLY_PAID (no auto-balance is possible — the balance
 * sweep will email a reminder at the due date instead of charging a card).
 */
export async function recordManualPayment(input: {
  bookingId: string; method: PaymentMethod; amount: number; receivedAt: Date;
  memo?: string; note?: string; recordedBy: string;
}): Promise<ManualSettlement> {
  const b = await db().booking.findUnique({ where: { id: input.bookingId }, include: { block: true } });
  if (!b) return { ok: false, error: 'not_found' };
  if (b.status === BookingStatus.CANCELLED || b.status === BookingStatus.EXPIRED) return { ok: false, error: 'booking_closed' };

  const priorManual = await db().manualPayment.aggregate({ where: { bookingId: b.id }, _sum: { amount: true } });
  const totalManual = money2((priorManual._sum.amount ?? 0) + input.amount);
  const covered = totalManual + 0.5 >= b.total;                 // ≥ total (cents-fuzzy) → paid in full
  const split = b.paymentPlan === PaymentPlan.SPLIT;
  const half = money2(b.total / 2);
  const coversDeposit = totalManual + 0.5 >= half;

  const ci = toKey(b.checkIn);
  let nextStatus: BookingStatus = b.status;

  await db().$transaction(async (tx) => {
    await tx.manualPayment.create({
      data: {
        tenantId: tid(),
        bookingId: b.id, method: input.method, amount: money2(input.amount),
        receivedAt: input.receivedAt, memo: input.memo || null, note: input.note || null, recordedBy: input.recordedBy,
      },
    });

    if (covered) {
      nextStatus = BookingStatus.PAID;
      await tx.booking.update({
        where: { id: b.id },
        data: { status: BookingStatus.PAID, balancePaid: true, paymentMethod: input.method, holdExpiresAt: null, manualClaimApp: null, manualClaimAt: null },
      });
    } else if (split && coversDeposit) {
      nextStatus = BookingStatus.PARTIALLY_PAID;
      await tx.booking.update({
        where: { id: b.id },
        data: {
          status: BookingStatus.PARTIALLY_PAID, paymentMethod: input.method, paymentPlan: PaymentPlan.SPLIT,
          depositAmount: b.depositAmount ?? half, balanceAmount: b.balanceAmount ?? money2(b.total - half),
          balanceDueDate: b.balanceDueDate ?? parseKey(addDays(ci, -BALANCE_LEAD_DAYS)),
          holdExpiresAt: null, manualClaimApp: null, manualClaimAt: null,
        },
      });
    } else {
      // Under-payment: keep the paper trail, clear the "claimed" flag, leave status.
      await tx.booking.update({ where: { id: b.id }, data: { manualClaimApp: null, manualClaimAt: null } });
    }

    // Lock the dates once anything is actually paid.
    if ((covered || (split && coversDeposit)) && !b.block) {
      await tx.calendarBlock.create({
        data: { tenantId: tid(), propertyId: b.propertyId, startDate: parseKey(toKey(b.checkIn)), endDate: parseKey(toKey(b.checkOut)), source: BlockSource.BOOKING, bookingId: b.id, summary: 'Booked (direct)' },
      });
    }
  });

  await logComms(b.clientId, CommsType.BILL, `manual ${appLabel(input.method)} $${money2(input.amount)} recorded${input.memo ? ` · memo "${input.memo}"` : ''}`);
  return { ok: true, status: nextStatus };
}

/** Guest pressed "I've sent it": record the claim, hold (not lock) the dates. */
export async function claimManualPayment(bookingId: string, method: PaymentMethod): Promise<{ ok: boolean; error?: string }> {
  const b = await db().booking.findUnique({ where: { id: bookingId } });
  if (!b) return { ok: false, error: 'not_found' };
  if (b.status !== BookingStatus.APPROVED && b.status !== BookingStatus.PARTIALLY_PAID) return { ok: false, error: 'not_claimable' };
  // Extend the hold by 2 days so it doesn't expire while we verify — but do NOT
  // lock the calendar; only the owner recording the payment does that.
  const hold = new Date(Date.now() + CLAIM_HOLD_DAYS * 864e5);
  await db().booking.update({ where: { id: bookingId }, data: { manualClaimApp: method, manualClaimAt: new Date(), holdExpiresAt: hold } });
  return { ok: true };
}
