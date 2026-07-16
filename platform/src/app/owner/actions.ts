'use server';
import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertRangeAvailable } from '@/lib/availability';
import { addDays, parseKey, toKey } from '@/lib/dates';
import { sendEmail, sendTemplate, notifyEmails } from '@/lib/email';
import { approvedFinalize, declined, paidConfirmation, depositReceipt, ownerPaymentAlert } from '@/lib/emails';
import { toEmailBooking } from '@/lib/email-data';
import { buildArrivalEmail, arrivalReady } from '@/lib/arrival';
import { recordManualPayment } from '@/lib/manual';
import { logComms } from '@/lib/comms';
import { splitEligible } from '@/lib/finalize';
import { createPaymentLink, toCents } from '@/lib/square';
import { DEFAULT_SLUG } from '@/lib/property';
import { BookingStatus, CommsType, PaymentMethod } from '@prisma/client';

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

    await sendTemplate(booking.client.email, approvedFinalize(toEmailBooking(booking, booking.client)), notifyEmails()[0]);
    await logComms(booking.clientId, CommsType.EMAIL, 'approved-finalize');

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

    // Remember the order so the webhook can reconcile this booking to PAID when
    // the guest pays the link (link payments carry order_id, not reference_id).
    if (link.orderId) await prisma.booking.update({ where: { id: b.id }, data: { squareOrderId: link.orderId } });

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
    await sendTemplate(b.client.email, declined(toEmailBooking(b, b.client)), notifyEmails()[0]);
    await logComms(b.clientId, CommsType.EMAIL, 'declined');
    revalidatePath('/owner');
    revalidatePath('/owner/bookings');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type RecordManualInput = {
  bookingId: string; method: PaymentMethod; amount: number;
  receivedAt: string; memo?: string; note?: string;
};

/** Owner records a received transfer-app payment; runs settlement + emails. */
export async function recordManualPaymentAction(input: RecordManualInput): Promise<ActionResult> {
  try {
    const session = await requireOwner();
    const recorder = await prisma.user.findUnique({ where: { email: (session.user?.email || '').toLowerCase() }, select: { id: true } });
    const res = await recordManualPayment({
      bookingId: input.bookingId, method: input.method, amount: input.amount,
      receivedAt: parseKey(input.receivedAt), memo: input.memo, note: input.note,
      recordedBy: recorder?.id || 'owner',
    });
    if (!res.ok) return { ok: false, error: res.error };

    // Settlement emails mirror the Square path.
    const b = await prisma.booking.findUnique({ where: { id: input.bookingId }, include: { client: true } });
    if (b) {
      const eb = toEmailBooking(b, b.client);
      const owners = notifyEmails();
      if (res.status === BookingStatus.PAID) {
        await sendTemplate(b.client.email, paidConfirmation(eb), owners[0]);
        await logComms(b.clientId, CommsType.EMAIL, 'paid-confirmation (manual)');
        if (owners.length) await sendTemplate(owners, ownerPaymentAlert({ ...eb, lastName: b.client.lastName }, 'full'), b.client.email);
      } else if (res.status === BookingStatus.PARTIALLY_PAID) {
        await sendTemplate(b.client.email, depositReceipt(eb), owners[0]);
        await logComms(b.clientId, CommsType.EMAIL, 'deposit-receipt (manual)');
        if (owners.length) await sendTemplate(owners, ownerPaymentAlert({ ...eb, lastName: b.client.lastName }, 'deposit'), b.client.email);
      }
    }
    revalidatePath('/owner');
    revalidatePath('/owner/bookings');
    revalidatePath(`/owner/bookings/${input.bookingId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Manual reconcile: mark an approved/partial booking as fully paid (payment
 * collected off-platform, or a Square link that never reconciled). Locks dates. */
export async function markPaid(bookingId: string): Promise<ActionResult> {
  try {
    await requireOwner();
    await prisma.$transaction(async (tx) => {
      const b = await tx.booking.findUnique({ where: { id: bookingId }, include: { block: true } });
      if (!b) throw new Error('not_found');
      if (b.status === BookingStatus.PAID) return;
      if (b.status !== BookingStatus.APPROVED && b.status !== BookingStatus.PARTIALLY_PAID) throw new Error('not_payable');
      await tx.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.PAID, balancePaid: true, holdExpiresAt: null } });
      if (!b.block) {
        await tx.calendarBlock.create({
          data: { propertyId: b.propertyId, startDate: parseKey(toKey(b.checkIn)), endDate: parseKey(toKey(b.checkOut)), source: 'BOOKING', bookingId: b.id, summary: 'Booked (direct)' },
        });
      }
    });
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { clientId: true } });
    if (b) await logComms(b.clientId, CommsType.BILL, 'marked paid (manual reconcile)');
    revalidatePath('/owner');
    revalidatePath('/owner/bookings');
    revalidatePath(`/owner/bookings/${bookingId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Owner-initiated cancellation of an approved/paid booking: releases the dates. */
export async function cancelBooking(bookingId: string): Promise<ActionResult> {
  try {
    await requireOwner();
    await prisma.$transaction(async (tx) => {
      const b = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!b) throw new Error('not_found');
      if (b.status === BookingStatus.CANCELLED || b.status === BookingStatus.EXPIRED) return;
      await tx.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.CANCELLED, holdExpiresAt: null } });
      // Release the held dates so the calendar reopens.
      await tx.calendarBlock.deleteMany({ where: { bookingId } });
    });
    await logComms((await prisma.booking.findUnique({ where: { id: bookingId }, select: { clientId: true } }))!.clientId, CommsType.EMAIL, 'cancelled-by-owner');
    revalidatePath('/owner');
    revalidatePath('/owner/bookings');
    revalidatePath(`/owner/bookings/${bookingId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** One-click pre-arrival email (door code, Wi-Fi, directions, rules). */
export async function sendArrivalEmail(bookingId: string): Promise<ActionResult> {
  try {
    await requireOwner();
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { client: true, property: true } });
    if (!b) return { ok: false, error: 'not_found' };
    if (b.status !== BookingStatus.PAID && b.status !== BookingStatus.PARTIALLY_PAID)
      return { ok: false, error: 'Arrival info is only for confirmed (paid) stays.' };
    if (!arrivalReady(b.property))
      return { ok: false, error: 'Add the address, door code and Wi-Fi under Settings → Arrival info first.' };

    await sendTemplate(b.client.email, buildArrivalEmail(b, b.client, b.property), notifyEmails()[0]);
    await prisma.booking.update({ where: { id: bookingId }, data: { arrivalSent: true } });
    await logComms(b.clientId, CommsType.EMAIL, 'arrival-info');
    revalidatePath(`/owner/bookings/${bookingId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type ArrivalInfoInput = {
  address: string; doorCode: string; wifiName: string; wifiPassword: string;
  parkingNotes: string; arrivalNotes: string; houseRules: string; autoArrival: boolean;
};

/** Save the property's arrival info (Settings editor). houseRules is newline-separated. */
export async function saveArrivalInfo(input: ArrivalInfoInput): Promise<ActionResult> {
  try {
    await requireOwner();
    const rules = input.houseRules.split('\n').map((r) => r.trim()).filter(Boolean);
    await prisma.property.update({
      where: { slug: DEFAULT_SLUG },
      data: {
        address: input.address.trim() || null,
        doorCode: input.doorCode.trim() || null,
        wifiName: input.wifiName.trim() || null,
        wifiPassword: input.wifiPassword.trim() || null,
        parkingNotes: input.parkingNotes.trim() || null,
        arrivalNotes: input.arrivalNotes.trim() || null,
        houseRules: rules,
        autoArrival: input.autoArrival,
      },
    });
    revalidatePath('/owner/settings');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
