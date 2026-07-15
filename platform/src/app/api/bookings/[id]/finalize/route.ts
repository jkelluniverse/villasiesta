import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { finalizeBooking } from '@/lib/finalize';
import { squareEnvironment, squareConfigured } from '@/lib/square';

export const dynamic = 'force-dynamic';

const Input = z.object({
  method: z.enum(['ach', 'card']),
  plan: z.enum(['full', 'split']).default('full'),
  sourceId: z.string().optional(),          // Web Payments SDK token
  verificationToken: z.string().optional(), // verifyBuyer (required to store a card)
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  const parsed = Input.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  // A real token is required whenever Square is live (mock mode may omit it).
  if (squareConfigured() && !parsed.data.sourceId) {
    return NextResponse.json({ error: 'missing_source', message: 'The secure payment form did not produce a token. Refresh and try again.' }, { status: 400 });
  }

  const result = await finalizeBooking({ bookingId: params.id, ...parsed.data });
  if (!result.ok) {
    const known = ['dates_unavailable', 'not_finalizable', 'not_found', 'split_not_available', 'split_requires_card'];
    const isKnown = known.includes(result.error || '');
    const code = result.error === 'dates_unavailable' ? 409 : isKnown ? 400 : 402;
    // In sandbox, surface the raw processor error so integration issues are visible.
    const detail = squareEnvironment() === 'sandbox' && !isKnown ? result.error : undefined;
    return NextResponse.json({ error: isKnown ? result.error : 'payment_failed', message: paymentMessage(result.error), detail }, { status: code });
  }
  return NextResponse.json({ ok: true, status: result.status, pendingAch: result.pendingAch, mock: result.mock });
}

function paymentMessage(err?: string): string {
  if (err === 'dates_unavailable') return 'Those dates were just taken. Please contact the owner.';
  if (err === 'not_finalizable') return 'This booking is not ready to finalize.';
  if (err === 'split_not_available') return 'The 50/50 plan is only available more than 90 days before check-in.';
  if (err === 'split_requires_card') return 'The 50/50 plan runs on a card — please pay the deposit by card.';
  if (err === 'card_on_file_failed') return 'Your deposit went through, but we could not save your card for the balance. Please contact the owner.';
  return 'We could not process that payment. Please try again.';
}
