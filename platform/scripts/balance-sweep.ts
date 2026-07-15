// Daily balance sweep for SPLIT bookings — run via Railway cron: `npm run sweep`.
// Charges the stored card-on-file for the 50% balance when balanceDueDate arrives.
// On decline: emails the guest a fresh Square payment link + alerts the owner,
// and retries daily until check-in − 7 days, then flags for manual follow-up
// (the booking stays PARTIALLY_PAID, which keeps it in the attention queue).

import { PrismaClient, BookingStatus, CommsType } from '@prisma/client';
import { createSquarePayment, createPaymentLink, toCents } from '../src/lib/square';
import { sendEmail, sendTemplate, notifyEmails } from '../src/lib/email';
import { paidConfirmation, ownerPaymentAlert } from '../src/lib/emails';
import { toEmailBooking } from '../src/lib/email-data';
import { logComms } from '../src/lib/comms';
import { addDays, toKey, todayKey } from '../src/lib/dates';

const prisma = new PrismaClient();
const CARD_MARKUP = 1.03;
const MANUAL_CUTOFF_DAYS = 7;   // stop auto-retrying at check-in − 7

async function main() {
  const today = todayKey();
  const due = await prisma.booking.findMany({
    where: {
      paymentPlan: 'SPLIT',
      balancePaid: false,
      status: BookingStatus.PARTIALLY_PAID,
      balanceDueDate: { lte: new Date() },
    },
    include: { client: true, property: true },
  });
  console.log(`[sweep] ${due.length} balance(s) due as of ${today}`);

  for (const b of due) {
    const ci = toKey(b.checkIn);
    const balance = b.balanceAmount ?? 0;
    if (!balance || !b.squareCardId || !b.squareCustomerId) {
      console.error(`[sweep] ${b.id}: missing balance/card/customer — flagging owner`);
      await alertOwner(b.id, 'Missing card on file or balance amount — collect manually.');
      continue;
    }

    const charge = Math.round(balance * CARD_MARKUP * 100) / 100;   // balance always runs on the stored card (+3%)
    const res = await createSquarePayment({
      sourceId: b.squareCardId,
      customerId: b.squareCustomerId,
      amountCents: toCents(charge),
      idempotencyKey: `bk_${b.id}_balance`,
      referenceId: `${b.id}-balance`,
      note: 'Villa Siesta — balance (50%)',
    });

    if (res.ok && (res.status === 'COMPLETED' || res.mock)) {
      const money2 = (n: number) => Math.round(n * 100) / 100;
      await prisma.booking.update({
        where: { id: b.id },
        data: { balancePaid: true, status: BookingStatus.PAID, cardFee: money2((b.cardFee || 0) + (charge - balance)), total: money2((b.total || 0) + (charge - balance)) },
      });
      const eb = toEmailBooking(b, b.client);
      const owners = notifyEmails();
      await sendTemplate(b.client.email, paidConfirmation(eb), owners[0]);
      await logComms(b.clientId, CommsType.EMAIL, 'balance-paid-confirmation');
      if (owners.length) await sendTemplate(owners, ownerPaymentAlert({ ...eb, lastName: b.client.lastName }, 'balance'), b.client.email);
      console.log(`[sweep] ${b.id}: balance charged (${charge})`);
    } else {
      console.error(`[sweep] ${b.id}: balance charge failed — ${res.error}`);
      const link = await createPaymentLink({
        name: `${b.property.name} — balance for ${ci}`,
        amountCents: toCents(charge),
        idempotencyKey: `bk_${b.id}_balancelink_${today}`,
      });
      await sendEmail({
        to: b.client.email, replyTo: notifyEmails()[0],
        subject: 'Action needed: balance payment — Villa Siesta',
        text: `Hi ${b.client.firstName},\n\nWe couldn't charge your card on file for the remaining balance (${b.property.currency}${charge.toLocaleString()}) of your stay ${ci} → ${toKey(b.checkOut)}.\n\nPlease pay here:\n${link.url || '(link unavailable — reply to this email)'}\n\n— Villa Siesta`,
      });
      const cutoff = addDays(ci, -MANUAL_CUTOFF_DAYS);
      if (today >= cutoff) await alertOwner(b.id, `Balance still unpaid at check-in − ${MANUAL_CUTOFF_DAYS} days. Auto-retry stopped — follow up manually.`);
      else await alertOwner(b.id, `Balance charge declined (${res.error}). Guest emailed a pay link; will retry daily.`);
    }
  }
}

async function alertOwner(bookingId: string, msg: string) {
  const to = notifyEmails();
  if (to.length) await sendEmail({ to, subject: `⚠ Balance sweep — booking ${bookingId}`, text: msg });
}

main()
  .catch((e) => { console.error('[sweep] fatal', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
