import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { computeQuote, loadPropertyPricing } from '@/lib/pricing';
import { assertRangeAvailable } from '@/lib/availability';
import { parseKey } from '@/lib/dates';
import { sendEmail, notifyEmails } from '@/lib/email';
import { DEFAULT_SLUG } from '@/lib/property';

export const dynamic = 'force-dynamic';

const BookingInput = z.object({
  slug: z.string().default(DEFAULT_SLUG),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().default(''),
  guests: z.coerce.number().int().min(1).max(20),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pet: z.coerce.boolean().optional().default(false),
  message: z.string().optional().default(''),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }

  const parsed = BookingInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;

  const loaded = await loadPropertyPricing(input.slug);
  if (!loaded) return NextResponse.json({ error: 'property_not_found' }, { status: 404 });

  // Always price server-side (never trust a client-sent total).
  const quote = computeQuote(loaded.pricing, {
    checkIn: input.checkIn, checkOut: input.checkOut, guests: input.guests, pet: input.pet, method: 'ach',
  });
  if (!quote.ok) return NextResponse.json({ error: 'invalid_dates', message: quote.error }, { status: 400 });

  try {
    const booking = await prisma.$transaction(async (tx) => {
      // Atomic double-booking guard: re-verify inside the transaction.
      await assertRangeAvailable(tx, loaded.propertyId, input.checkIn, input.checkOut);

      const client = await tx.client.upsert({
        where: { email: input.email.toLowerCase() },
        update: { firstName: input.firstName, lastName: input.lastName, phone: input.phone || undefined },
        create: { email: input.email.toLowerCase(), firstName: input.firstName, lastName: input.lastName, phone: input.phone || null },
      });

      return tx.booking.create({
        data: {
          propertyId: loaded.propertyId,
          clientId: client.id,
          checkIn: parseKey(input.checkIn),
          checkOut: parseKey(input.checkOut),
          nights: quote.nights,
          guests: input.guests,
          subtotal: quote.subtotal,
          cleaningFee: quote.cleaning,
          petFee: quote.pet,
          taxAmount: quote.tax,
          cardFee: 0,
          total: quote.total,
          message: input.message || null,
        },
      });
    });

    // Fire notifications after the row is safely committed.
    await sendBookingEmails(input, quote.total, quote.currency, booking.id);

    return NextResponse.json({ ok: true, bookingId: booking.id });
  } catch (e) {
    if ((e as { code?: string }).code === 'DATES_UNAVAILABLE') {
      return NextResponse.json({ error: 'dates_unavailable', message: 'Those dates were just taken. Please pick another range.' }, { status: 409 });
    }
    console.error('[bookings] create failed', e);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

async function sendBookingEmails(
  input: z.infer<typeof BookingInput>, total: number, currency: string, bookingId: string,
) {
  const appUrl = process.env.APP_URL || '';
  const dates = `${input.checkIn} → ${input.checkOut}`;
  const owners = notifyEmails();

  if (owners.length) {
    await sendEmail({
      to: owners,
      replyTo: input.email,
      subject: `New booking request — ${input.firstName} ${input.lastName} — ${dates}`,
      text: [
        'New booking request for Villa Siesta',
        '', `Guest:  ${input.firstName} ${input.lastName}`, `Email:  ${input.email}`,
        `Phone:  ${input.phone || '—'}`, `Guests: ${input.guests}${input.pet ? ' (+ pet)' : ''}`,
        `Dates:  ${dates}`, `Est. total: ${currency}${total.toLocaleString()}`,
        input.message ? `\nMessage: ${input.message}` : '',
        '', `Review it: ${appUrl}/owner`,
      ].join('\n'),
    });
  }

  await sendEmail({
    to: input.email,
    replyTo: owners[0],
    subject: 'We received your request — Villa Siesta',
    text: [
      `Hi ${input.firstName},`, '',
      `Thanks for your request to book Villa Siesta for ${dates}.`,
      `Estimated total: ${currency}${total.toLocaleString()}. Nothing has been charged.`, '',
      'The owner will review within 24–48 hours and email you a secure link to',
      'finalize and pay if your reservation is approved.', '',
      appUrl ? `Track your request: ${appUrl}/booking/${bookingId}` : '',
      '', '— Villa Siesta',
    ].join('\n'),
  });
}
