import { NextRequest, NextResponse } from 'next/server';
import { WebhooksHelper } from 'square';
import { prisma } from '@/lib/db';
import { BookingStatus, BlockSource } from '@prisma/client';
import { parseKey, toKey } from '@/lib/dates';
import { sendEmail, sendTemplate, notifyEmails } from '@/lib/email';
import { depositReceipt, paidConfirmation, ownerPaymentAlert } from '@/lib/emails';
import { toEmailBooking } from '@/lib/email-data';
import { logComms } from '@/lib/comms';
import { CommsType } from '@prisma/client';

export const dynamic = 'force-dynamic';

// Square webhooks are the source of truth for payment state — this is what
// flips PENDING ACH payments to PAID/PARTIALLY_PAID days later, and what
// un-completes an ACH that gets returned. Idempotent by design: a webhook
// arriving after a synchronous update is a no-op.
export async function POST(req: NextRequest) {
  const raw = await req.text();   // RAW body — required for signature verification
  const signature = req.headers.get('x-square-hmacsha256-signature') || '';
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';
  const notificationUrl = `${process.env.APP_URL || ''}/api/square/webhook`;

  if (key) {
    const valid = await WebhooksHelper.verifySignature({ requestBody: raw, signatureHeader: signature, signatureKey: key, notificationUrl });
    if (!valid) return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
  } else {
    console.warn('[square:webhook] SQUARE_WEBHOOK_SIGNATURE_KEY not set — skipping verification');
  }

  let evt: { type?: string; data?: { object?: { payment?: { id?: string; status?: string; reference_id?: string; referenceId?: string } } } } = {};
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ ok: true, note: 'unparseable' }); }

  const payment = evt.data?.object?.payment;
  if (!payment || !evt.type?.startsWith('payment.')) return NextResponse.json({ ok: true, note: 'ignored' });

  const ref = payment.reference_id || payment.referenceId || '';
  const kind = ref.endsWith('-deposit') ? 'deposit' : ref.endsWith('-balance') ? 'balance' : 'full';
  const bookingId = ref.replace(/-(deposit|balance)$/, '');
  const booking = bookingId
    ? await prisma.booking.findUnique({ where: { id: bookingId }, include: { block: true, client: true } })
    : await prisma.booking.findFirst({ where: { squarePaymentId: payment.id }, include: { block: true, client: true } });
  if (!booking) return NextResponse.json({ ok: true, note: 'no matching booking' });

  const status = payment.status || '';
  console.log(`[square:webhook] ${evt.type} payment=${payment.id} status=${status} ref=${ref} booking=${booking.id}`);

  if (status === 'COMPLETED') {
    const target = kind === 'balance' ? BookingStatus.PAID
      : booking.paymentPlan === 'SPLIT' && kind === 'deposit' ? BookingStatus.PARTIALLY_PAID : BookingStatus.PAID;
    // A real transition happened here (vs. a webhook echoing a synchronous update)?
    const transitioned = kind === 'balance' ? !booking.balancePaid : (booking.status !== BookingStatus.PAID && booking.status !== target);

    await prisma.$transaction(async (tx) => {
      if (kind === 'balance') {
        if (!booking.balancePaid) await tx.booking.update({ where: { id: booking.id }, data: { balancePaid: true, status: BookingStatus.PAID } });
      } else if (transitioned) {
        await tx.booking.update({ where: { id: booking.id }, data: { status: target, balancePaid: target === BookingStatus.PAID, holdExpiresAt: null } });
      }
      if (!booking.block) {
        await tx.calendarBlock.create({
          data: { propertyId: booking.propertyId, startDate: parseKey(toKey(booking.checkIn)), endDate: parseKey(toKey(booking.checkOut)), source: BlockSource.BOOKING, bookingId: booking.id, summary: 'Booked (direct)' },
        });
      }
    });

    // Email only when this webhook is what confirmed the payment (async ACH clearing).
    if (transitioned) {
      const eb = toEmailBooking(booking, booking.client);
      const owners = notifyEmails();
      if (kind === 'balance') {
        if (owners.length) await sendTemplate(owners, ownerPaymentAlert({ ...eb, lastName: booking.client.lastName }, 'balance'), booking.client.email);
      } else if (target === BookingStatus.PARTIALLY_PAID) {
        await sendTemplate(booking.client.email, depositReceipt(eb), owners[0]);
        await logComms(booking.clientId, CommsType.EMAIL, 'deposit-receipt');
        if (owners.length) await sendTemplate(owners, ownerPaymentAlert({ ...eb, lastName: booking.client.lastName }, 'deposit'), booking.client.email);
      } else {
        await sendTemplate(booking.client.email, paidConfirmation(eb), owners[0]);
        await logComms(booking.clientId, CommsType.EMAIL, 'paid-confirmation');
        if (owners.length) await sendTemplate(owners, ownerPaymentAlert({ ...eb, lastName: booking.client.lastName }, 'full'), booking.client.email);
      }
    }
  } else if ((status === 'FAILED' || status === 'CANCELED') && kind !== 'balance') {
    // An ACH deposit/full payment failed or was returned: release the dates.
    await prisma.$transaction(async (tx) => {
      if (booking.block) await tx.calendarBlock.delete({ where: { bookingId: booking.id } });
      await tx.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.APPROVED, balancePaid: false } });
    });
    await sendEmail({
      to: booking.client.email, replyTo: notifyEmails()[0],
      subject: 'Payment issue — Villa Siesta',
      text: `Hi ${booking.client.firstName},\n\nYour bank payment for Villa Siesta did not go through, so your reservation isn't confirmed yet. Please try again from your booking page${process.env.APP_URL ? `:\n${process.env.APP_URL}/booking/${booking.id}/finalize` : '.'}\n\n— Villa Siesta`,
    });
    if (notifyEmails().length) {
      await sendEmail({ to: notifyEmails(), subject: `⚠ Payment failed — booking ${booking.id}`, text: `An ACH payment ${payment.id} (${ref}) failed/was returned. Dates released; guest emailed.` });
    }
  }

  return NextResponse.json({ ok: true });
}
