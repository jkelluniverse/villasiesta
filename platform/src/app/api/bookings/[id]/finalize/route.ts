import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { finalizeBooking } from '@/lib/finalize';

export const dynamic = 'force-dynamic';

const Input = z.object({
  method: z.enum(['ach', 'card']),
  plan: z.enum(['full', 'split']).default('full'),
  oneTimeToken: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  const parsed = Input.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const result = await finalizeBooking({ bookingId: params.id, ...parsed.data });
  if (!result.ok) {
    const known = result.error === 'dates_unavailable' || result.error === 'not_finalizable' || result.error === 'not_found';
    const code = result.error === 'dates_unavailable' ? 409 : result.error === 'not_finalizable' ? 400 : 402;
    // In sandbox, pass the raw Forte error back so integration issues are visible.
    const detail = process.env.FORTE_ENV === 'sandbox' && !known ? result.error : undefined;
    return NextResponse.json({ error: known ? result.error : 'payment_failed', message: paymentMessage(result.error), detail }, { status: code });
  }
  return NextResponse.json({ ok: true, status: result.status, mock: result.mock });
}

function paymentMessage(err?: string): string {
  if (err === 'dates_unavailable') return 'Those dates were just taken. Please contact the owner.';
  if (err === 'charge_declined') return 'Your payment was declined. Please try another method.';
  if (err === 'not_finalizable') return 'This booking is not ready to finalize.';
  return 'We could not process that payment. Please try again.';
}
