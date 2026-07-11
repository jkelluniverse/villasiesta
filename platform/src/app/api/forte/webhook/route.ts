import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { BookingStatus, BlockSource } from '@prisma/client';
import { parseKey, toKey } from '@/lib/dates';

export const dynamic = 'force-dynamic';

// Forte webhooks are the source of truth for settled payments. finalizeBooking()
// already sets PAID synchronously on an approved sale, so this handler is
// idempotent: it confirms PAID and ensures the calendar block exists.
export async function POST(req: NextRequest) {
  let evt: Record<string, unknown> = {};
  try { evt = await req.json(); } catch { /* Forte may send form-encoded; tolerate */ }

  // Match the booking by order_number (we send booking.id) or transaction_id.
  const orderNumber = String((evt.order_number as string) || (evt as { data?: { order_number?: string } })?.data?.order_number || '');
  const txId = String((evt.transaction_id as string) || (evt as { data?: { transaction_id?: string } })?.data?.transaction_id || '');

  const booking = await prisma.booking.findFirst({
    where: { OR: [orderNumber ? { id: orderNumber } : {}, txId ? { forteTransactionId: txId } : {}].filter((o) => Object.keys(o).length) as object[] },
    include: { block: true },
  });
  if (!booking) return NextResponse.json({ ok: true, note: 'no matching booking' });

  const isBalance = booking.paymentPlan === 'SPLIT' && booking.balancePaid === false && (evt.event_type as string || '').includes('schedule');

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data: isBalance
        ? { balancePaid: true, status: BookingStatus.PAID }
        : { status: booking.paymentPlan === 'SPLIT' ? BookingStatus.PARTIALLY_PAID : BookingStatus.PAID, holdExpiresAt: null },
    });
    if (!booking.block) {
      await tx.calendarBlock.create({
        data: { propertyId: booking.propertyId, startDate: parseKey(toKey(booking.checkIn)), endDate: parseKey(toKey(booking.checkOut)), source: BlockSource.BOOKING, bookingId: booking.id, summary: 'Booked (direct)' },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
