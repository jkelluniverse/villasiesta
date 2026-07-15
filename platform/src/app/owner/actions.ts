'use server';
import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertRangeAvailable } from '@/lib/availability';
import { addDays, parseKey, toKey } from '@/lib/dates';
import { sendEmail, notifyEmails } from '@/lib/email';
import { splitEligible } from '@/lib/finalize';
import { createPaymentLink, toCents } from '@/lib/square';
import { BookingStatus, CommsType } from '@prisma/client';

const HOLD_HOURS = 48;
const BALANCE_LEAD_DAYS = 14;

async function requireOwner() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'OWNER') throw new Error('forbidden');
  return session;
}

export type ActionResult = { ok: boolean; error?: string };

export async function approveBooking(bookingId: string): Promise<ActionResult> {
  try {
    await requireOwner();
    const booking = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.findUnique({ where: { id: bookingId }, include: { client: true, property: true } });
      if (!b) throw new Error('not_found');
      if (b.status !== BookingStatus.REQUESTED) throw new Error('not_pending');
      // Re-verify the range is still free before consuming the hold.
      await assertRangeAvailable(tx, b.propertyId, toKey(b.checkIn), toKey(b.checkOut));
      const hold = new Date(Date.now() + HOLD_HOURS * 3600_000);
      // Persist the 50/50 offer at approval (check-in > 90 days out): deposit,
      // balance, and due date, so the finalize page never trusts client math.
      const ci = toKey(b.checkIn);
      const offerSplit = splitEligible(ci);
      const deposit = offerSplit ? Math.round((b.total / 2) * 100) / 100 : null;
      return tx.booking.update({
        where: { id: b.id },
        data: {
          status: BookingStatus.APPROVED, holdExpiresAt: hold,
          depositAmount: deposit,
          balanceAmount: offerSplit && deposit != null ? Math.round((b.total - deposit) * 100) / 100 : null,
          balanceDueDate: offerSplit ? parseKey(addDays(ci, -BALANCE_LEAD_DAYS)) : null,
        },
        include: { client: true, property: true },
      });
    });

    const appUrl = process.env.APP_URL || '';
    await sendEmail({
      to: booking.client.email,
      replyTo: notifyEmails()[0],
      subject: `Approved — finalize your stay at ${booking.property.name}`,
      text: [
        `Hi ${booking.client.firstName},`, '',
        `Good news — your dates at ${booking.property.name} are approved!`,
        `${toKey(booking.checkIn)} → ${toKey(booking.checkOut)} · ${booking.nights} nights`,
        `Total: ${booking.property.currency}${Math.round(booking.total).toLocaleString()}`, '',
        `Finalize and pay to secure your reservation${appUrl ? `:\n${appUrl}/booking/${booking.id}/finalize` : '.'}`,
        `Pay by bank transfer (no fee) or card (+3%). Your dates are held for ${HOLD_HOURS} hours.`, '', '— Villa Siesta',
      ].join('\n'),
    });

    revalidatePath('/owner');
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false, error: msg === 'DATES_UNAVAILABLE' ? 'Those dates now conflict with another booking.' : msg };
  }
}

/** One-click "Send bill": Square payment link for the outstanding amount, emailed + logged. */
export async function sendBill(bookingId: string): Promise<ActionResult> {
  try {
    await requireOwner();
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { client: true, property: true } });
    if (!b) return { ok: false, error: 'not_found' };

    const outstanding = b.status === 'PARTIALLY_PAID' && b.balanceAmount ? b.balanceAmount : b.total;
    const link = await createPaymentLink({
      name: `${b.property.name} — ${toKey(b.checkIn)} → ${toKey(b.checkOut)}`,
      amountCents: toCents(outstanding),
      idempotencyKey: `bk_${b.id}_bill_${Date.now()}`,
    });
    if (!link.ok || !link.url) return { ok: false, error: link.error || 'link_failed' };

    await sendEmail({
      to: b.client.email, replyTo: notifyEmails()[0],
      subject: `Your payment link — ${b.property.name}`,
      text: [
        `Hi ${b.client.firstName},`, '',
        `Here's your secure payment link for ${b.property.name} (${toKey(b.checkIn)} → ${toKey(b.checkOut)}):`,
        link.url, '',
        `Amount due: ${b.property.currency}${Math.round(outstanding).toLocaleString()}`,
        '', '— Villa Siesta',
      ].join('\n'),
    });
    await prisma.commsLog.create({ data: { clientId: b.clientId, type: CommsType.BILL, detail: `Square link ${link.url} for ${outstanding}` } });
    revalidatePath('/owner');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function declineBooking(bookingId: string): Promise<ActionResult> {
  try {
    await requireOwner();
    const b = await prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED },
      include: { client: true, property: true },
    });
    await sendEmail({
      to: b.client.email,
      replyTo: notifyEmails()[0],
      subject: `About your request — ${b.property.name}`,
      text: [
        `Hi ${b.client.firstName},`, '',
        `Thank you for your interest in ${b.property.name}. Unfortunately we can't confirm`,
        `${toKey(b.checkIn)} → ${toKey(b.checkOut)} at this time.`, '',
        `If your dates are flexible, reply and we'll help you find an open week.`, '', '— Villa Siesta',
      ].join('\n'),
    });
    revalidatePath('/owner');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
