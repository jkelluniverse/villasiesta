// The three recurring jobs, callable from the CLI scripts (scripts/*.ts) or the
// secret-protected /api/cron endpoint. Each returns a small summary and never
// throws for per-booking failures — a bad row must not stall the rest.

import { BookingStatus, CommsType } from '@prisma/client';
import { prisma } from './db';
import { createSquarePayment, createPaymentLink, toCents } from './square';
import { sendEmail, sendTemplate, notifyEmails } from './email';
import { paidConfirmation, ownerPaymentAlert } from './emails';
import { toEmailBooking } from './email-data';
import { buildArrivalEmail, arrivalReady } from './arrival';
import { syncAirbnb } from './airbnb-sync';
import { logComms } from './comms';
import { addDays, toKey, todayKey } from './dates';

const CARD_MARKUP = 1.03;
const MANUAL_CUTOFF_DAYS = 7;    // stop auto-retrying at check-in − 7
const ARRIVAL_LEAD_DAYS = 3;     // arrival email 3 days before check-in
const SLUG = 'villa-siesta';

async function alertOwner(bookingId: string, msg: string) {
  const to = notifyEmails();
  if (to.length) await sendEmail({ to, subject: `⚠ Balance sweep — booking ${bookingId}`, text: msg });
}

/** Charge due SPLIT balances on the stored card; manual splits get a reminder. */
export async function runBalanceSweep(): Promise<{ due: number; charged: number; reminded: number; failed: number }> {
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
  const out = { due: due.length, charged: 0, reminded: 0, failed: 0 };

  for (const b of due) {
    try {
      const ci = toKey(b.checkIn);
      const balance = b.balanceAmount ?? 0;
      if (!balance) {
        await alertOwner(b.id, 'Missing balance amount — collect manually.');
        out.failed++;
        continue;
      }
      // Manual split (no card on file): remind the guest to send the transfer —
      // unless there's an ACH mandate covering the second debit, which is the
      // OWNER's action (originate at the bank), not the guest's.
      if (!b.squareCardId || !b.squareCustomerId) {
        const achAuth = await prisma.achAuthorization.findFirst({
          where: { bookingId: b.id, status: { in: ['authorized', 'originated', 'settled'] } },
          orderBy: { consentAt: 'desc' },
        });
        if (achAuth) {
          const alreadyAch = await prisma.commsLog.findFirst({
            where: { clientId: b.clientId, type: CommsType.EMAIL, detail: 'ach-balance-originate', sentAt: b.balanceDueDate ? { gte: b.balanceDueDate } : undefined },
          });
          if (!alreadyAch) {
            await sendEmail({
              to: b.client.email, replyTo: notifyEmails()[0],
              subject: `Balance debit coming up — Villa Siesta ${b.reference}`,
              text: `Hi ${b.client.firstName},\n\nPer your ACH authorization, the remaining balance of ${b.property.currency}${balance.toLocaleString()} for your stay ${ci} → ${toKey(b.checkOut)} will be debited from your account ending ••••${achAuth.accountLast4} in the next few days. No action needed.\n\n— Villa Siesta`,
            });
            await logComms(b.clientId, CommsType.EMAIL, 'ach-balance-originate');
            await alertOwner(b.id, `ACH split balance ${b.property.currency}${balance.toLocaleString()} due (${b.reference}) — originate the second debit from ${achAuth.bankName} ••••${achAuth.accountLast4}, then record it (Bank debit).`);
            out.reminded++;
            console.log(`[sweep] ${b.id}: ACH balance origination prompted`);
          }
          continue;
        }
        const already = await prisma.commsLog.findFirst({
          where: { clientId: b.clientId, type: CommsType.EMAIL, detail: 'manual-balance-reminder', sentAt: b.balanceDueDate ? { gte: b.balanceDueDate } : undefined },
        });
        if (!already) {
          await sendEmail({
            to: b.client.email, replyTo: notifyEmails()[0],
            subject: `Balance due — Villa Siesta ${b.reference}`,
            text: [
              `Hi ${b.client.firstName},`, '',
              `The remaining balance of ${b.property.currency}${balance.toLocaleString()} for your stay ${ci} → ${toKey(b.checkOut)} is now due.`,
              `Please send it the same way you sent your deposit, and include this in the memo:`,
              `  Villa Siesta ${b.reference} — ${b.client.lastName}`, '',
              `We'll confirm as soon as it arrives.`, '', '— Villa Siesta',
            ].join('\n'),
          });
          await logComms(b.clientId, CommsType.EMAIL, 'manual-balance-reminder');
          await alertOwner(b.id, `Manual balance ${b.property.currency}${balance.toLocaleString()} due (${b.reference}) — guest reminded to send the transfer.`);
          out.reminded++;
          console.log(`[sweep] ${b.id}: manual balance reminder sent`);
        }
        continue;
      }

      const charge = Math.round(balance * CARD_MARKUP * 100) / 100;   // stored card (+3%)
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
        out.charged++;
        console.log(`[sweep] ${b.id}: balance charged (${charge})`);
      } else {
        out.failed++;
        console.error(`[sweep] ${b.id}: balance charge failed — ${res.error}`);
        const link = await createPaymentLink({
          name: `${b.property.name} — balance for ${ci}`,
          amountCents: toCents(charge),
          idempotencyKey: `bk_${b.id}_balancelink_${today}`,
        });
        if (link.orderId) await prisma.booking.update({ where: { id: b.id }, data: { squareOrderId: link.orderId } });
        await sendEmail({
          to: b.client.email, replyTo: notifyEmails()[0],
          subject: 'Action needed: balance payment — Villa Siesta',
          text: `Hi ${b.client.firstName},\n\nWe couldn't charge your card on file for the remaining balance (${b.property.currency}${charge.toLocaleString()}) of your stay ${ci} → ${toKey(b.checkOut)}.\n\nPlease pay here:\n${link.url || '(link unavailable — reply to this email)'}\n\n— Villa Siesta`,
        });
        const cutoff = addDays(ci, -MANUAL_CUTOFF_DAYS);
        if (today >= cutoff) await alertOwner(b.id, `Balance still unpaid at check-in − ${MANUAL_CUTOFF_DAYS} days. Auto-retry stopped — follow up manually.`);
        else await alertOwner(b.id, `Balance charge declined (${res.error}). Guest emailed a pay link; will retry daily.`);
      }
    } catch (e) {
      out.failed++;
      console.error(`[sweep] ${b.id}: unexpected`, e);
    }
  }
  return out;
}

/** Send the pre-arrival email 3 days before check-in for confirmed stays. */
export async function runArrivalSweep(): Promise<{ due: number; sent: number; skipped: number }> {
  const target = addDays(todayKey(), ARRIVAL_LEAD_DAYS);
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
  const out = { due: due.length, sent: 0, skipped: 0 };

  for (const b of due) {
    if (toKey(b.checkIn) > target) { out.skipped++; continue; }
    if (!arrivalReady(b.property)) {
      console.warn(`[arrival-sweep] ${b.id}: property arrival info incomplete — skipping`);
      out.skipped++;
      continue;
    }
    try {
      await sendTemplate(b.client.email, buildArrivalEmail(b, b.client, b.property), notifyEmails()[0]);
      await prisma.booking.update({ where: { id: b.id }, data: { arrivalSent: true } });
      await logComms(b.clientId, CommsType.EMAIL, 'arrival-info (auto)');
      out.sent++;
      console.log(`[arrival-sweep] ${b.id}: arrival email sent to ${b.client.email}`);
    } catch (e) {
      out.skipped++;
      console.error(`[arrival-sweep] ${b.id}: send failed`, e);
    }
  }
  return out;
}

/** Expire stale APPROVED holds + pull the Airbnb iCal feed + purge old bank data. */
export async function runCalendarSweep(): Promise<{ expired: number; purged: number; airbnb: { ok: boolean; imported?: number; error?: string } }> {
  const stale = await prisma.booking.findMany({
    where: {
      status: BookingStatus.APPROVED,
      holdExpiresAt: { lt: new Date() },
      manualClaimAt: null,          // a claimed Zelle payment keeps the hold for verification
      // An authorized ACH debit is the OWNER's action item — never auto-expire it.
      achAuthorizations: { none: { status: { in: ['authorized', 'originated'] } } },
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

  const sync = await syncAirbnb(SLUG);
  if (sync.ok) console.log(`[cal-sweep] airbnb sync: ${sync.imported ?? 0} imported`);
  else console.error(`[cal-sweep] airbnb sync failed: ${sync.error}`);

  // Bank-data hygiene: null encrypted routing/account 30 days after settlement
  // (the masked last4 + consent record stay for the audit trail).
  const purge = await prisma.achAuthorization.updateMany({
    where: { status: 'settled', settledAt: { lt: new Date(Date.now() - 30 * 864e5) }, encBlob: { not: '' } },
    data: { encBlob: '' },
  });
  if (purge.count) console.log(`[cal-sweep] purged bank details from ${purge.count} settled ACH authorization(s)`);

  return { expired: stale.length, purged: purge.count, airbnb: { ok: sync.ok, imported: sync.imported, error: sync.error } };
}
