import { prisma } from './db';
import { BookingStatus } from '@prisma/client';
import { getPaymentDetails, type PaymentDetails } from './square';
import { displayStatus, planLabel, type StatusTone } from './bookingStatus';
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
  state: 'paid' | 'scheduled' | 'pending' | 'failed';
  when: string | null;           // date paid or scheduled (yyyy-mm-dd)
  method: string | null;         // CARD / ACH etc.
  live: PaymentDetails | null;   // live Square record; .ok=false means the lookup FAILED
};

export type PaymentSummary = { paid: number; total: number; remaining: number; complete: boolean; failed: boolean };
export type Banner = { tone: StatusTone; text: string };
export type ActivityEntry = { at: string; type: string; detail: string | null };

export type BookingDetail = {
  id: string;
  currency: string;
  propertyName: string;
  status: BookingStatus;
  statusLabel: string;
  planLabel: string;
  banner: Banner;
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
  summary: PaymentSummary;
  payments: PaymentRecord[];
  activity: ActivityEntry[];
};

const bMoney = (cur: string, n: number) => cur + Math.round(n).toLocaleString();
const bDay = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

export async function getBookingDetail(id: string): Promise<BookingDetail | null> {
  const b = await prisma.booking.findUnique({
    where: { id },
    include: { client: true, property: true },
  });
  if (!b) return null;

  const cur = b.property.currency;
  const split = b.paymentPlan === 'SPLIT';
  const paid = paidOf(b);
  const remaining = Math.max(0, Math.round(b.total) - Math.round(paid));

  // Activity log for this guest (comms) — most recent first.
  const comms = await prisma.commsLog.findMany({
    where: { clientId: b.clientId },
    orderBy: { sentAt: 'desc' },
    take: 40,
  });
  const lastBill = comms.find((c) => c.type === 'BILL');

  // ---- Payment records, derived from live status ----
  // The deposit/full payment id (if any) is stored; pull it live from Square for
  // the real amount + processing fee + card. A record only "fails to load" when
  // we HAVE an id but Square can't answer — never claim "nothing charged" then.
  const payments: PaymentRecord[] = [];
  const charged = b.status === 'PAID' || b.status === 'PARTIALLY_PAID';

  let primaryWhen = toKey(b.updatedAt);
  if (charged) {
    let live: PaymentDetails | null = null;
    if (b.squarePaymentId) {
      live = await getPaymentDetails(b.squarePaymentId);
      if (live.ok && live.createdAt) primaryWhen = toKey(live.createdAt);
    }
    payments.push({
      label: split ? 'Deposit' : 'Paid in full',
      amount: Math.round(split ? (b.depositAmount ?? b.total / 2) : b.total),
      state: 'paid',
      when: primaryWhen,
      method: b.paymentMethod,
      live,
    });
  }
  if (split) {
    const balanceDue = b.balanceDueDate ? toKey(b.balanceDueDate) : null;
    const failed = !b.balancePaid && !!balanceDue && balanceDue < todayKey();
    payments.push({
      label: 'Balance',
      amount: Math.round(b.balanceAmount ?? b.total / 2),
      state: b.balancePaid ? 'paid' : failed ? 'failed' : 'scheduled',
      when: balanceDue,
      method: b.paymentMethod,
      live: null,
    });
  }

  const summary: PaymentSummary = {
    paid: Math.round(paid), total: Math.round(b.total), remaining,
    complete: b.status === 'PAID',
    failed: split && !b.balancePaid && !!b.balanceDueDate && toKey(b.balanceDueDate) < todayKey(),
  };

  return {
    id: b.id,
    currency: cur,
    propertyName: b.property.name,
    status: b.status,
    statusLabel: displayStatus(b).label,
    planLabel: planLabel(b.paymentPlan),
    banner: buildBanner(b, cur, { paid, remaining, split, lastBillAt: lastBill?.sentAt ?? null, paidWhen: primaryWhen }),
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
    summary,
    payments,
    activity: comms.map((c) => ({ at: c.sentAt.toISOString(), type: c.type, detail: c.detail })),
  };
}

// One sentence that answers "where does this stand" — same tone as the pill.
function buildBanner(
  b: { status: BookingStatus; total: number; depositAmount: number | null; balanceAmount: number | null; balanceDueDate: Date | null; balancePaid: boolean; createdAt: Date },
  cur: string,
  ctx: { paid: number; remaining: number; split: boolean; lastBillAt: Date | null; paidWhen: string },
): Banner {
  const ds = displayStatus(b);
  const m = (n: number) => bMoney(cur, n);
  if (b.status === 'PAID') {
    return { tone: 'jade', text: `Booked & paid — ${m(b.total)} received${ctx.split ? '' : ` ${bDay(ctx.paidWhen)}`}.` };
  }
  if (b.status === 'PARTIALLY_PAID') {
    const bal = Math.round(b.balanceAmount ?? b.total / 2);
    const due = b.balanceDueDate ? toKey(b.balanceDueDate) : null;
    if (due && due < todayKey() && !b.balancePaid)
      return { tone: 'plum', text: `Deposit paid — ${m(ctx.paid)} received · balance ${m(bal)} did not clear on ${bDay(due)}, retry needed.` };
    return { tone: 'plum', text: `Deposit paid — ${m(ctx.paid)} received · balance ${m(bal)} auto-charges${due ? ` ${bDay(due)}` : ''}.` };
  }
  if (b.status === 'APPROVED') {
    return { tone: 'sapphire', text: `Approved — awaiting payment${ctx.lastBillAt ? ` · link sent ${bDay(toKey(ctx.lastBillAt))}` : ''}.` };
  }
  if (b.status === 'REQUESTED') {
    return { tone: 'topaz', text: `Request — needs review · received ${bDay(toKey(b.createdAt))}.` };
  }
  return { tone: 'muted', text: `${ds.label}.` };
}
