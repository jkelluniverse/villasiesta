import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { claimManualPayment, appLabel, MANUAL_METHODS } from '@/lib/manual';
import { sendTemplate, notifyEmails } from '@/lib/email';
import { ownerManualClaim } from '@/lib/emails';
import { toEmailBooking } from '@/lib/email-data';
import { logComms } from '@/lib/comms';
import { CommsType, PaymentMethod } from '@prisma/client';

export const dynamic = 'force-dynamic';

const Input = z.object({
  method: z.enum(['ZELLE', 'CASHAPP', 'VENMO', 'CHIME']),
  amount: z.coerce.number().positive(),
});

// Guest pressed "I've sent it" on the finalize page. Records the claim, holds
// (does not lock) the dates, and alerts the owner + dad to verify. Nothing is
// marked paid — that only happens when the owner records the payment.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  const parsed = Input.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const method = parsed.data.method as PaymentMethod;
  if (!MANUAL_METHODS.includes(method)) return NextResponse.json({ error: 'invalid_method' }, { status: 400 });

  const claim = await claimManualPayment(params.id, method);
  if (!claim.ok) return NextResponse.json({ error: claim.error, message: 'This booking can’t accept a payment claim right now.' }, { status: 409 });

  const b = await prisma.booking.findUnique({ where: { id: params.id }, include: { client: true } });
  if (b) {
    const owners = notifyEmails();
    if (owners.length) {
      const eb = { ...toEmailBooking(b, b.client), lastName: b.client.lastName };
      await sendTemplate(owners, ownerManualClaim(eb, { app: appLabel(method), amount: parsed.data.amount }), b.client.email);
    }
    await logComms(b.clientId, CommsType.BILL, `claimed ${appLabel(method)} payment — awaiting owner verification`);
  }

  return NextResponse.json({ ok: true });
}
