// Hourly calendar sweep — run via Railway cron: `npm run calendar-sweep`.
// 1. Expire stale APPROVED holds (holdExpiresAt passed, nothing paid, no
//    pending manual claim) → EXPIRED + release any block + email the guest.
// 2. Pull the Airbnb iCal feed (if configured) into AIRBNB calendar blocks.

import { PrismaClient, BookingStatus, CommsType } from '@prisma/client';
import { syncAirbnb } from '../src/lib/airbnb-sync';
import { sendEmail, notifyEmails } from '../src/lib/email';
import { logComms } from '../src/lib/comms';
import { toKey } from '../src/lib/dates';

const prisma = new PrismaClient();
const SLUG = 'villa-siesta';

async function expireHolds() {
  const now = new Date();
  const stale = await prisma.booking.findMany({
    where: {
      status: BookingStatus.APPROVED,
      holdExpiresAt: { lt: now },
      manualClaimAt: null,          // a claimed Zelle payment keeps the hold for verification
    },
    include: { client: true, property: true },
  });
  console.log(`[cal-sweep] ${stale.length} stale hold(s)`);

  for (const b of stale) {
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id: b.id }, data: { status: BookingStatus.EXPIRED } });
      await tx.calendarBlock.deleteMany({ where: { bookingId: b.id } });
    });
    await sendEmail({
      to: b.client.email, replyTo: notifyEmails()[0],
      subject: `Your hold expired — Villa Siesta ${b.reference}`,
      text: [
        `Hi ${b.client.firstName},`, '',
        `The payment window for your approved stay ${toKey(b.checkIn)} → ${toKey(b.checkOut)} has passed, so the hold on those dates was released.`,
        `If you'd still like to come, just reply to this email or submit the dates again — if they're open, we'll gladly re-approve.`,
        '', '— Villa Siesta',
      ].join('\n'),
    });
    await logComms(b.clientId, CommsType.EMAIL, `hold-expired (${b.reference})`);
    console.log(`[cal-sweep] expired ${b.reference} (${b.id}) — dates released`);
  }
}

async function main() {
  await expireHolds();
  const sync = await syncAirbnb(SLUG);
  if (sync.ok) console.log(`[cal-sweep] airbnb sync: ${sync.imported ?? 0} imported (${sync.removed ?? 0} replaced)`);
  else console.error(`[cal-sweep] airbnb sync failed: ${sync.error}`);
}

main()
  .catch((e) => { console.error('[cal-sweep] fatal', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
