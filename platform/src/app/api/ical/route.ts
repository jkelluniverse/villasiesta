import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantId } from '@/lib/tenant';
import { withTenant, db } from '@/lib/dal';
import { BlockSource, BookingStatus } from '@prisma/client';
import { toKey } from '@/lib/dates';
import { DEFAULT_SLUG } from '@/lib/property';

export const dynamic = 'force-dynamic';

// iCal EXPORT — the other half of two-way Airbnb sync. Give this URL to
// Airbnb (Calendar → Availability → Connect another website → Import) so
// direct bookings and owner blocks block the Airbnb calendar.
// Dates only — no guest names/amounts ever leave this feed. AIRBNB-sourced
// blocks are excluded (they came FROM Airbnb; echoing them back would loop).
// If ICAL_EXPORT_TOKEN is set, the URL must carry ?token=<value>.
export async function GET(req: NextRequest) {
  return withTenant(await resolveTenantId(req.headers.get('host')), async () => {
  const required = process.env.ICAL_EXPORT_TOKEN || '';
  if (required && req.nextUrl.searchParams.get('token') !== required) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const property = await db().property.findFirst({ where: { slug: DEFAULT_SLUG }, select: { id: true, name: true } });
  if (!property) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const now = new Date();
  const [bookings, blocks] = await Promise.all([
    db().booking.findMany({
      where: {
        propertyId: property.id,
        checkOut: { gt: now },
        OR: [
          { status: BookingStatus.PAID },
          { status: BookingStatus.PARTIALLY_PAID },
          { status: BookingStatus.APPROVED, OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
        ],
      },
      select: { id: true, checkIn: true, checkOut: true },
    }),
    db().calendarBlock.findMany({
      where: { propertyId: property.id, source: BlockSource.OWNER, endDate: { gt: now } },
      select: { id: true, startDate: true, endDate: true },
    }),
  ]);

  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = (d: Date) => toKey(d).replace(/-/g, '');
  const event = (uid: string, start: Date, end: Date, summary: string) => [
    'BEGIN:VEVENT',
    `UID:${uid}@villasiestasarasota.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${day(start)}`,
    `DTEND;VALUE=DATE:${day(end)}`,
    `SUMMARY:${summary}`,
    'END:VEVENT',
  ];

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Villa Siesta//Direct bookings//EN',
    'CALSCALE:GREGORIAN',
    ...bookings.flatMap((b) => event(`bk-${b.id}`, b.checkIn, b.checkOut, 'Reserved (Villa Siesta direct)')),
    ...blocks.flatMap((b) => event(`bl-${b.id}`, b.startDate, b.endDate, 'Not available')),
    'END:VCALENDAR',
  ];

  return new NextResponse(lines.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
});
}
