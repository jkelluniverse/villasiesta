import { prisma } from './db';
import { BlockSource, BookingStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { parseKey, toKey } from './dates';

export type BlockedRange = { start: string; end: string; source: 'booking' | 'owner' | 'airbnb' };

// A Prisma transaction client or the base client — both expose the model queries we use.
type Db = PrismaClient | Prisma.TransactionClient;

/** Bookings that hold dates: PAID/PARTIALLY_PAID always; APPROVED while the hold is live. */
function activeBookingWhere(propertyId: string, ci: Date, co: Date, excludeBookingId?: string): Prisma.BookingWhereInput {
  const now = new Date();
  return {
    propertyId,
    ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    checkIn: { lt: co },
    checkOut: { gt: ci },
    OR: [
      { status: BookingStatus.PAID },
      { status: BookingStatus.PARTIALLY_PAID },
      { status: BookingStatus.APPROVED, OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
    ],
  };
}

/**
 * True if [checkIn, checkOut) is free of any PAID/live-APPROVED booking and any
 * owner/airbnb calendar block. Pass a transaction client to make the check
 * part of an atomic write (the double-booking safeguard). `excludeBookingId`
 * skips the booking being finalized so its own hold doesn't count as a conflict.
 */
export async function isRangeAvailable(db: Db, propertyId: string, checkInKey: string, checkOutKey: string, excludeBookingId?: string): Promise<boolean> {
  if (!checkInKey || !checkOutKey || checkInKey >= checkOutKey) return false;
  const ci = parseKey(checkInKey);
  const co = parseKey(checkOutKey);

  const bookingClash = await db.booking.findFirst({ where: activeBookingWhere(propertyId, ci, co, excludeBookingId), select: { id: true } });
  if (bookingClash) return false;

  const blockClash = await db.calendarBlock.findFirst({
    where: {
      propertyId,
      startDate: { lt: co },
      endDate: { gt: ci },
      source: { in: [BlockSource.OWNER, BlockSource.AIRBNB] },
    },
    select: { id: true },
  });
  return !blockClash;
}

/** Throws if the range is taken — call inside a $transaction before consuming dates. */
export async function assertRangeAvailable(db: Db, propertyId: string, checkInKey: string, checkOutKey: string, excludeBookingId?: string): Promise<void> {
  const ok = await isRangeAvailable(db, propertyId, checkInKey, checkOutKey, excludeBookingId);
  if (!ok) {
    const err = new Error('DATES_UNAVAILABLE');
    (err as Error & { code?: string }).code = 'DATES_UNAVAILABLE';
    throw err;
  }
}

/** All blocked ranges for the public calendar (bookings + owner + airbnb). */
export async function getBlockedRanges(propertyId: string): Promise<BlockedRange[]> {
  const now = new Date();
  const [bookings, blocks] = await Promise.all([
    prisma.booking.findMany({
      where: {
        propertyId,
        OR: [
          { status: BookingStatus.PAID },
          { status: BookingStatus.PARTIALLY_PAID },
          { status: BookingStatus.APPROVED, OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
        ],
      },
      select: { checkIn: true, checkOut: true },
    }),
    prisma.calendarBlock.findMany({
      where: { propertyId, source: { in: [BlockSource.OWNER, BlockSource.AIRBNB] } },
      select: { startDate: true, endDate: true, source: true },
    }),
  ]);

  const out: BlockedRange[] = [];
  bookings.forEach((b) => out.push({ start: toKey(b.checkIn), end: toKey(b.checkOut), source: 'booking' }));
  blocks.forEach((b) => out.push({
    start: toKey(b.startDate), end: toKey(b.endDate),
    source: b.source === BlockSource.AIRBNB ? 'airbnb' : 'owner',
  }));
  return out;
}
