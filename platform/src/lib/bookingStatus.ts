// The ONE place booking status becomes human-facing. Every surface — dashboard
// queue, upcoming arrivals, bookings list, detail header/banner, reservation
// card — must derive its pill and wording from here, keyed off the booking's
// `status` state-machine field (never from paymentPlan / balancePaid, which are
// orthogonal and were the source of the "Approved + Paid in full + Nothing
// charged" contradiction).

import type { BookingStatus } from '@prisma/client';

export type StatusKey = 'REQUESTED' | 'APPROVED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED' | 'EXPIRED';
export type StatusTone = 'topaz' | 'sapphire' | 'plum' | 'jade' | 'muted';
export type DisplayStatus = { key: StatusKey; label: string; tone: StatusTone };

const MAP: Record<StatusKey, { label: string; tone: StatusTone }> = {
  REQUESTED:      { label: 'Request — needs review',          tone: 'topaz' },
  APPROVED:       { label: 'Approved — awaiting payment',     tone: 'sapphire' },
  PARTIALLY_PAID: { label: 'Deposit paid — balance scheduled', tone: 'plum' },
  PAID:           { label: 'Booked & paid',                   tone: 'jade' },
  CANCELLED:      { label: 'Cancelled',                       tone: 'muted' },
  EXPIRED:        { label: 'Expired',                         tone: 'muted' },
};

export function displayStatus(b: { status: BookingStatus }): DisplayStatus {
  const key = b.status as StatusKey;
  const m = MAP[key] ?? MAP.REQUESTED;
  return { key, label: m.label, tone: m.tone };
}

/** Human wording for the payment PLAN — deliberately distinct from payment STATE. */
export function planLabel(plan: string): string {
  return plan === 'SPLIT' ? '50 / 50 split' : 'Pay in full';
}
