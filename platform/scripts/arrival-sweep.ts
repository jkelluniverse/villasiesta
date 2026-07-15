// Daily arrival-email sweep — run via Railway cron: `npm run arrival-sweep`.
// Sends the branded pre-arrival email (door code, Wi-Fi, directions, rules)
// 3 days before check-in, for confirmed stays only. Idempotent: the booking's
// arrivalSent flag guards against re-sends. Auto-send is per-property (autoArrival,
// default ON) and can be turned off in Settings → Arrival info.

import { PrismaClient, BookingStatus, CommsType } from '@prisma/client';
import { sendTemplate, notifyEmails } from '../src/lib/email';
import { buildArrivalEmail, arrivalReady } from '../src/lib/arrival';
import { logComms } from '../src/lib/comms';
import { addDays, toKey, todayKey } from '../src/lib/dates';

const prisma = new PrismaClient();
const LEAD_DAYS = 3;   // send 3 days before check-in

async function main() {
  const target = addDays(todayKey(), LEAD_DAYS);   // check-ins exactly LEAD_DAYS out
  const due = await prisma.booking.findMany({
    where: {
      arrivalSent: false,
      status: { in: [BookingStatus.PAID, BookingStatus.PARTIALLY_PAID] },
      checkIn: { gte: new Date(`${todayKey()}T00:00:00Z`), lte: new Date(`${target}T23:59:59Z`) },
      property: { autoArrival: true },
    },
    include: { client: true, property: true },
  });
  console.log(`[arrival-sweep] ${due.length} arrival email(s) to send (through ${target})`);

  for (const b of due) {
    if (toKey(b.checkIn) > target) continue;          // safety: only up to LEAD_DAYS out
    if (!arrivalReady(b.property)) {
      console.warn(`[arrival-sweep] ${b.id}: property arrival info incomplete — skipping`);
      continue;
    }
    try {
      await sendTemplate(b.client.email, buildArrivalEmail(b, b.client, b.property), notifyEmails()[0]);
      await prisma.booking.update({ where: { id: b.id }, data: { arrivalSent: true } });
      await logComms(b.clientId, CommsType.EMAIL, 'arrival-info (auto)');
      console.log(`[arrival-sweep] ${b.id}: arrival email sent to ${b.client.email}`);
    } catch (e) {
      console.error(`[arrival-sweep] ${b.id}: send failed`, e);
    }
  }
}

main()
  .catch((e) => { console.error('[arrival-sweep] fatal', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
