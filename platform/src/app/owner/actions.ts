'use server';
import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertRangeAvailable } from '@/lib/availability';
import { toKey } from '@/lib/dates';
import { sendEmail, notifyEmails } from '@/lib/email';
import { BookingStatus } from '@prisma/client';

const HOLD_HOURS = 48;

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
      return tx.booking.update({
        where: { id: b.id },
        data: { status: BookingStatus.APPROVED, holdExpiresAt: hold },
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
        `Finalize and pay to secure your reservation${appUrl ? `:\n${appUrl}/booking/${booking.id}` : '.'}`,
        `This hold is held for ${HOLD_HOURS} hours.`, '', '— Villa Siesta',
      ].join('\n'),
    });

    revalidatePath('/owner');
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false, error: msg === 'DATES_UNAVAILABLE' ? 'Those dates now conflict with another booking.' : msg };
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
