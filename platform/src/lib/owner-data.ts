import { prisma } from './db';
import { BookingStatus } from '@prisma/client';
import { getBlockedRanges } from './availability';
import { addDays, toKey, todayKey } from './dates';

export type Metric = { netThisMonth: number; netDeltaPct: number | null; prevMonthLabel: string; occupancyPct: number; ytdNet: number; nextPayout: { amount: number; date: string } | null };
export type AttentionItem = {
  bookingId: string; type: 'request' | 'payment' | 'balance_failed' | 'conflict';
  status: BookingStatus;
  name: string; email: string; phone: string | null; dates: string; nights: number; total: number; guests: number; message?: string | null;
};
export type Arrival = { bookingId: string; status: BookingStatus; name: string; checkIn: string; checkOut: string; nights: number; phone: string | null; email: string };
export type Dashboard = {
  currency: string; ownerName: string; month: string;
  metric: Metric; attention: AttentionItem[]; occupancy30: { date: string; booked: boolean }[]; arrivals: Arrival[];
  emptyState: string | null;
};

// Owner net for a booking: gross(total) − processing(card) − cleaning(passthrough) − tax(remitted).
function netOf(b: { total: number; cleaningFee: number; taxAmount: number; cardFee: number }): number {
  return Math.round(b.total - b.cleaningFee - b.taxAmount - b.cardFee);
}

const monthLabel = (d: Date) => d.toLocaleString('en-US', { month: 'short' });

export async function getDashboard(slug: string): Promise<Dashboard | null> {
  const property = await prisma.property.findUnique({ where: { slug }, select: { id: true, currency: true } });
  if (!property) return null;

  const [bookings, ranges, owner] = await Promise.all([
    prisma.booking.findMany({
      where: { propertyId: property.id },
      include: { client: true },
      orderBy: { checkIn: 'asc' },
    }),
    getBlockedRanges(property.id),
    prisma.user.findFirst({ where: { role: 'OWNER' }, select: { name: true } }),
  ]);

  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const consuming = bookings.filter((b) => b.status === BookingStatus.APPROVED || b.status === BookingStatus.PAID || b.status === BookingStatus.PARTIALLY_PAID);

  const ledgerForMonth = (yy: number, mm: number) =>
    consuming.filter((b) => { const d = b.checkIn; return d.getUTCFullYear() === yy && d.getUTCMonth() === mm; })
      .reduce((sum, b) => sum + netOf(b), 0);

  const netThisMonth = ledgerForMonth(y, m);
  const prevDate = new Date(Date.UTC(y, m - 1, 1));
  const prevNet = ledgerForMonth(prevDate.getUTCFullYear(), prevDate.getUTCMonth());
  const netDeltaPct = prevNet > 0 ? Math.round(((netThisMonth - prevNet) / prevNet) * 100) : null;

  let ytdNet = 0;
  for (let mm = 0; mm <= m; mm++) ytdNet += ledgerForMonth(y, mm);

  // occupancy this month (booked nights / days)
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const isBlocked = (key: string) => ranges.some((r) => key >= r.start && key < r.end);
  let bookedNights = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (isBlocked(key)) bookedNights++;
  }
  const occupancyPct = Math.round((bookedNights / daysInMonth) * 100);

  const today = todayKey();
  const upcoming = consuming.filter((b) => toKey(b.checkOut) > today).sort((a, b) => (toKey(a.checkIn) < toKey(b.checkIn) ? -1 : 1));
  const nextPayout = upcoming.length ? { amount: netOf(upcoming[0]), date: toKey(upcoming[0].checkIn) } : null;

  // Queue holds ONLY actionable items, re-derived from live status every load.
  // PAID (and PARTIALLY_PAID that's still on schedule) never appear here.
  const attention: AttentionItem[] = [];
  bookings.forEach((b) => {
    const nm = `${b.client.firstName} ${b.client.lastName}`.trim();
    const dates = `${toKey(b.checkIn)} → ${toKey(b.checkOut)}`;
    const base = { bookingId: b.id, status: b.status, name: nm, email: b.client.email, phone: b.client.phone, dates, nights: b.nights, total: Math.round(b.total), guests: b.guests };
    if (b.status === BookingStatus.REQUESTED)
      attention.push({ ...base, type: 'request', message: b.message });
    else if (b.status === BookingStatus.APPROVED)
      attention.push({ ...base, type: 'payment' });
    else if (b.status === BookingStatus.PARTIALLY_PAID && !b.balancePaid && b.balanceDueDate && toKey(b.balanceDueDate) < today)
      // Deposit paid, balance charge was due and hasn't cleared → needs a retry.
      attention.push({ ...base, type: 'balance_failed' });
  });
  const order = { request: 0, conflict: 1, balance_failed: 2, payment: 3 };
  attention.sort((a, b) => order[a.type] - order[b.type]);

  const occupancy30 = Array.from({ length: 30 }, (_, i) => {
    const key = addDays(today, i);
    return { date: key, booked: isBlocked(key) };
  });

  const arrivals: Arrival[] = consuming.filter((b) => toKey(b.checkIn) >= today).slice(0, 6).map((b) => ({
    bookingId: b.id, status: b.status, name: `${b.client.firstName} ${b.client.lastName}`.trim(),
    checkIn: toKey(b.checkIn), checkOut: toKey(b.checkOut), nights: b.nights, phone: b.client.phone, email: b.client.email,
  }));

  const emptyState = attention.length === 0
    ? (arrivals.length ? `You're all caught up. Next arrival is ${arrivals[0].checkIn}.` : "You're all caught up.")
    : null;

  return {
    currency: property.currency, ownerName: owner?.name || 'there',
    month: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    metric: { netThisMonth, netDeltaPct, prevMonthLabel: monthLabel(prevDate), occupancyPct, ytdNet, nextPayout },
    attention, occupancy30, arrivals, emptyState,
  };
}
