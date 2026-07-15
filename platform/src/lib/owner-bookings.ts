import { prisma } from './db';
import { BookingStatus } from '@prisma/client';
import { getPaymentDetails, type PaymentDetails } from './square';
import { toKey, todayKey } from './dates';

// ------------------------------------------------------------------ list
export type BookingRow = {
  id: string;
  guestName: string;
  email: string;
  phone: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  total: number;
  status: BookingStatus;
  paidAmount: number;
  paidPct: number;          // 0–100, for the payment-progress bar
  balanceDueDate: string | null;
  createdAt: string;
};

/** What's been collected so far, for the progress column. */
function paidOf(b: { status: BookingStatus; total: number; depositAmount: number | null; balancePaid: boolean }): number {
  if (b.status === BookingStatus.PAID) return b.total;
  if (b.status === BookingStatus.PARTIALLY_PAID) return b.balancePaid ? b.total : (b.depositAmount ?? b.total / 2);
  return 0;
}

export async function listBookings(slug: string): Promise<BookingRow[]> {
  const property = await prisma.property.findUnique({ where: { slug }, select: { id: true } });
  if (!property) return [];
  const bookings = await prisma.booking.findMany({
    where: { propertyId: property.id },
    include: { client: true },
    orderBy: { checkIn: 'desc' },
  });
  return bookings.map((b) => {
    const paidAmount = paidOf(b);
    return {
      id: b.id,
      guestName: `${b.client.firstName} ${b.client.lastName}`.trim(),
      email: b.client.email,
      phone: b.client.phone,
      checkIn: toKey(b.checkIn),
      checkOut: toKey(b.checkOut),
      nights: b.nights,
      guests: b.guests,
      total: Math.round(b.total),
      status: b.status,
      paidAmount: Math.round(paidAmount),
      paidPct: b.total > 0 ? Math.min(100, Math.round((paidAmount / b.total) * 100)) : 0,
      balanceDueDate: b.balanceDueDate ? toKey(b.balanceDueDate) : null,
      createdAt: b.createdAt.toISOString(),
    };
  });
}

export type BookingTab = 'upcoming' | 'requests' | 'past' | 'all';

const CONSUMING: BookingStatus[] = [BookingStatus.APPROVED, BookingStatus.PARTIALLY_PAID, BookingStatus.PAID];

export function filterBookings(rows: BookingRow[], tab: BookingTab, q: string): BookingRow[] {
  const today = todayKey();
  const term = q.trim().toLowerCase();
  let out = rows;
  if (tab === 'requests') out = out.filter((r) => r.status === 'REQUESTED');
  else if (tab === 'upcoming') out = out.filter((r) => CONSUMING.includes(r.status) && r.checkOut > today);
  else if (tab === 'past') out = out.filter((r) => r.checkOut <= today || r.status === 'CANCELLED' || r.status === 'EXPIRED');
  if (term) out = out.filter((r) => r.guestName.toLowerCase().includes(term) || r.email.toLowerCase().includes(term));
  // upcoming reads best soonest-first; the rest newest-first.
  return tab === 'upcoming' ? [...out].sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1)) : out;
}

// ---------------------------------------------------------------- detail
export type PaymentRecord = {
  label: string;                 // "Deposit", "Balance", "Paid in full"
  amount: number;                // what we intended to collect (dollars)
  state: 'paid' | 'scheduled' | 'pending';
  when: string | null;           // date paid or scheduled (yyyy-mm-dd)
  live?: PaymentDetails | null;  // live Square record (fee, card, receipt) when we have an id
};

export type ActivityEntry = { at: string; type: string; detail: string | null };

export type BookingDetail = {
  id: string;
  currency: string;
  propertyName: string;
  status: BookingStatus;
  guestName: string;
  firstName: string;
  email: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  message: string | null;
  paymentMethod: string | null;
  paymentPlan: string;
  subtotal: number;
  cleaningFee: number;
  petFee: number;
  taxAmount: number;
  cardFee: number;
  total: number;
  balanceDueDate: string | null;
  holdExpiresAt: string | null;
  createdAt: string;
  payments: PaymentRecord[];
  activity: ActivityEntry[];
};

export async function getBookingDetail(id: string): Promise<BookingDetail | null> {
  const b = await prisma.booking.findUnique({
    where: { id },
    include: { client: true, property: true },
  });
  if (!b) return null;

  // Activity log for this guest (comms) — most recent first.
  const comms = await prisma.commsLog.findMany({
    where: { clientId: b.clientId },
    orderBy: { sentAt: 'desc' },
    take: 40,
  });

  // Payment records. The deposit/full payment id is stored; pull it live from
  // Square for the real amount + processing fee + card. The balance (split) is
  // charged later by the sweep and its id isn't persisted, so it's derived.
  const payments: PaymentRecord[] = [];
  const split = b.paymentPlan === 'SPLIT';
  if (b.squarePaymentId && b.status !== 'REQUESTED') {
    const live = await getPaymentDetails(b.squarePaymentId);
    payments.push({
      label: split ? 'Deposit' : 'Paid in full',
      amount: Math.round(split ? (b.depositAmount ?? b.total / 2) : b.total),
      state: 'paid',
      when: toKey(b.updatedAt),
      live: live.ok ? live : null,
    });
  }
  if (split) {
    payments.push({
      label: 'Balance',
      amount: Math.round(b.balanceAmount ?? b.total / 2),
      state: b.balancePaid ? 'paid' : 'scheduled',
      when: b.balanceDueDate ? toKey(b.balanceDueDate) : null,
      live: null,
    });
  }

  return {
    id: b.id,
    currency: b.property.currency,
    propertyName: b.property.name,
    status: b.status,
    guestName: `${b.client.firstName} ${b.client.lastName}`.trim(),
    firstName: b.client.firstName,
    email: b.client.email,
    phone: b.client.phone,
    address: b.client.address,
    notes: b.client.notes,
    checkIn: toKey(b.checkIn),
    checkOut: toKey(b.checkOut),
    nights: b.nights,
    guests: b.guests,
    message: b.message,
    paymentMethod: b.paymentMethod,
    paymentPlan: b.paymentPlan,
    subtotal: b.subtotal,
    cleaningFee: b.cleaningFee,
    petFee: b.petFee,
    taxAmount: b.taxAmount,
    cardFee: b.cardFee,
    total: b.total,
    balanceDueDate: b.balanceDueDate ? toKey(b.balanceDueDate) : null,
    holdExpiresAt: b.holdExpiresAt ? b.holdExpiresAt.toISOString() : null,
    createdAt: b.createdAt.toISOString(),
    payments,
    activity: comms.map((c) => ({ at: c.sentAt.toISOString(), type: c.type, detail: c.detail })),
  };
}
