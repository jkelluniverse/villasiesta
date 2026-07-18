import { prisma } from './db';
import { BlockSource, BookingStatus } from '@prisma/client';
import { displayStatus } from './bookingStatus';
import { addDays, eachNight, parseKey, toKey, todayKey } from './dates';

export type DayOcc = 'open' | 'booking' | 'owner' | 'airbnb';

export type DayCell = {
  key: string;          // yyyy-mm-dd
  day: number;          // day-of-month
  inMonth: boolean;
  today: boolean;
  occ: DayOcc;
  isStart: boolean;     // first night of the segment (where the label sits)
  bookingId?: string;
  reference?: string;
  guest?: string;
  tone?: string;        // status tone for bookings
  blockId?: string;
  label?: string;       // block summary
};

export type CalendarMonth = {
  monthKey: string;     // yyyy-mm
  monthLabel: string;   // "September 2027"
  prev: string;
  next: string;
  weekdayLabels: string[];
  weeks: DayCell[][];
  currency: string;
  counts: { booked: number; blocked: number; open: number };
};

const monthKeyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
export function currentMonthKey(): string { return todayKey().slice(0, 7); }

function normalizeMonth(monthKey: string): { year: number; month0: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey || '');
  const now = new Date();
  if (!m) return { year: now.getUTCFullYear(), month0: now.getUTCMonth() };
  return { year: Number(m[1]), month0: Number(m[2]) - 1 };
}

export async function getCalendarMonth(slug: string, monthKey: string): Promise<CalendarMonth | null> {
  const property = await prisma.property.findUnique({ where: { slug }, select: { id: true, currency: true } });
  if (!property) return null;

  const { year, month0 } = normalizeMonth(monthKey);
  const firstOfMonth = new Date(Date.UTC(year, month0, 1));
  const key = monthKeyOf(firstOfMonth);
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

  // Monday-start grid: leading blanks from the weekday of the 1st.
  const firstWeekday = firstOfMonth.getUTCDay();           // 0=Sun..6=Sat
  const lead = (firstWeekday + 6) % 7;                     // Mon=0
  const gridStart = addDays(toKey(firstOfMonth), -lead);
  const totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;

  const rangeStart = parseKey(gridStart);
  const rangeEnd = parseKey(addDays(gridStart, totalCells));   // exclusive

  const now = new Date();
  const [bookings, blocks] = await Promise.all([
    prisma.booking.findMany({
      where: {
        propertyId: property.id,
        checkIn: { lt: rangeEnd },
        checkOut: { gt: rangeStart },
        OR: [
          { status: BookingStatus.PAID },
          { status: BookingStatus.PARTIALLY_PAID },
          { status: BookingStatus.APPROVED, OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
        ],
      },
      include: { client: true },
    }),
    prisma.calendarBlock.findMany({
      where: {
        propertyId: property.id,
        source: { in: [BlockSource.OWNER, BlockSource.AIRBNB] },
        startDate: { lt: rangeEnd },
        endDate: { gt: rangeStart },
      },
    }),
  ]);

  // Per-day occupancy map (booking wins over block if they somehow overlap).
  const map = new Map<string, DayCell>();
  for (const b of blocks) {
    const start = toKey(b.startDate);
    for (const d of eachNight(start, toKey(b.endDate))) {
      map.set(d, {
        key: d, day: 0, inMonth: false, today: false,
        occ: b.source === BlockSource.AIRBNB ? 'airbnb' : 'owner',
        isStart: d === start, blockId: b.id, label: b.summary || (b.source === BlockSource.AIRBNB ? 'Airbnb' : 'Blocked'),
      });
    }
  }
  for (const b of bookings) {
    const start = toKey(b.checkIn);
    const tone = displayStatus(b).tone;
    for (const d of eachNight(start, toKey(b.checkOut))) {
      map.set(d, {
        key: d, day: 0, inMonth: false, today: false,
        occ: 'booking', isStart: d === start,
        bookingId: b.id, reference: b.reference, guest: `${b.client.firstName} ${b.client.lastName}`.trim(), tone,
      });
    }
  }

  const today = todayKey();
  const counts = { booked: 0, blocked: 0, open: 0 };
  const cells: DayCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const k = addDays(gridStart, i);
    const [, , dd] = k.split('-');
    const inMonth = k.slice(0, 7) === key;
    const hit = map.get(k);
    const cell: DayCell = hit
      ? { ...hit, day: Number(dd), inMonth, today: k === today }
      : { key: k, day: Number(dd), inMonth, today: k === today, occ: 'open', isStart: false };
    if (inMonth) {
      if (cell.occ === 'booking') counts.booked++;
      else if (cell.occ === 'open') counts.open++;
      else counts.blocked++;
    }
    cells.push(cell);
  }

  const weeks: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return {
    monthKey: key,
    monthLabel: firstOfMonth.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    prev: monthKeyOf(new Date(Date.UTC(year, month0 - 1, 1))),
    next: monthKeyOf(new Date(Date.UTC(year, month0 + 1, 1))),
    weekdayLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    weeks,
    currency: property.currency,
    counts,
  };
}
