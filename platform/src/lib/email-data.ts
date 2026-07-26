import type { Booking, Client } from '@prisma/client';

/** Shape the branded email templates (lib/emails.ts) expect, from DB rows. */
export function toEmailBooking(b: Booking, c: Client) {
  return {
    id: b.id,
    reference: b.reference,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone ?? undefined,
    message: b.message ?? undefined,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: b.nights,
    guests: b.guests,
    total: b.total,
    depositAmount: b.depositAmount,
    balanceAmount: b.balanceAmount,
    balanceDueDate: b.balanceDueDate,
    stayCheckOut: b.stayCheckOut,
    compNights: b.compNights,
  };
}
