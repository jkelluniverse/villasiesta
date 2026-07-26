import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { BookingStatus, PaymentPlan, CommsType } from '@prisma/client';
import {
  achConfigured, encryptBankDetails, validRoutingNumber, validAccountNumber,
  buildAchAuthText, buildAchFeeText,
} from '@/lib/ach';
import { loadPropertyPricing } from '@/lib/pricing';
import { chargeForBooking } from '@/lib/booking-pricing';
import { splitEligible } from '@/lib/finalize';
import { addDays, parseKey, toKey, todayKey } from '@/lib/dates';
import { sendTemplate, notifyEmails } from '@/lib/email';
import { ownerAchAuthorization } from '@/lib/emails';
import { toEmailBooking } from '@/lib/email-data';
import { logComms } from '@/lib/comms';

export const dynamic = 'force-dynamic';

const ACH_MARKUP = 1.01;         // +1% processing fee (same as the Plaid ACH lane)
const BALANCE_LEAD_DAYS = 14;
const HOLD_DAYS = 5;             // dates held while the debit posts (1–3 business days)
const money2 = (n: number) => Math.round(n * 100) / 100;

const Input = z.object({
  plan: z.enum(['full', 'split']).default('full'),
  nameOnAccount: z.string().trim().min(2).max(120),
  bankName: z.string().trim().min(2).max(120),
  routing: z.string().trim(),
  account: z.string().trim(),
  accountConfirm: z.string().trim(),
  accountType: z.enum(['checking', 'savings']),
  authAgree: z.literal(true),
  feeAgree: z.literal(true),
});

// Instant ACH authorization: store the encrypted mandate, hold the dates, and
// alert the owner to originate the debit at the bank. NOTHING is charged here
// and Square is never called — see lib/ach.ts.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!achConfigured()) return NextResponse.json({ error: 'ach_disabled', message: 'Direct bank payment isn’t available right now — choose another method.' }, { status: 503 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  const parsed = Input.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input', message: 'Please complete every field and both authorizations.' }, { status: 400 });
  const input = parsed.data;

  // Server-side re-validation (never trust the client's checks).
  if (!validRoutingNumber(input.routing))
    return NextResponse.json({ error: 'bad_routing', message: 'That routing number doesn’t look right — check the diagram below.' }, { status: 400 });
  if (!validAccountNumber(input.account))
    return NextResponse.json({ error: 'bad_account', message: 'Account numbers are 4–17 digits.' }, { status: 400 });
  if (input.account !== input.accountConfirm)
    return NextResponse.json({ error: 'account_mismatch', message: 'The account numbers don’t match.' }, { status: 400 });

  const booking = await prisma.booking.findUnique({ where: { id: params.id }, include: { client: true, property: true } });
  if (!booking) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (booking.status !== BookingStatus.APPROVED)
    return NextResponse.json({ error: 'not_finalizable', message: 'This booking isn’t awaiting payment.' }, { status: 409 });

  // Money server-side via the single resolver (owner-set price / comp-stay
  // nights / fresh quote), mirroring finalize: base (no-fee) total, ACH +1%.
  const ci = toKey(booking.checkIn);
  const loaded = booking.priceCustom ? null : await loadPropertyPricing(booking.property.slug);
  const charge = chargeForBooking(booking, loaded?.pricing ?? null);
  if (!charge.ok) return NextResponse.json({ error: charge.error }, { status: 400 });
  const baseTotal = charge.baseTotal;

  const useSplit = input.plan === 'split';
  if (useSplit && !splitEligible(ci))
    return NextResponse.json({ error: 'split_not_available', message: 'The 50/50 plan isn’t available for these dates.' }, { status: 400 });

  const achTotal = money2(baseTotal * ACH_MARKUP);
  const feeNow = money2(achTotal - baseTotal);
  const deposit = useSplit ? money2(achTotal / 2) : achTotal;
  const balance = useSplit ? money2(achTotal - deposit) : null;
  const balanceDueKey = useSplit ? addDays(ci, -BALANCE_LEAD_DAYS) : null;

  // The EXACT language the guest ticked — same builder the form rendered with.
  const authText = buildAchAuthText({ amount: deposit, onOrAfter: todayKey(), balanceAmount: balance, balanceDate: balanceDueKey });
  const feeText = buildAchFeeText(booking.property.nsfFee);

  const ipAddress = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const userAgent = (req.headers.get('user-agent') || 'unknown').slice(0, 400);

  await prisma.$transaction(async (tx) => {
    await tx.achAuthorization.create({
      data: {
        bookingId: booking.id,
        nameOnAccount: input.nameOnAccount,
        bankName: input.bankName,
        routingLast4: input.routing.slice(-4),
        accountLast4: input.account.slice(-4),
        encBlob: encryptBankDetails({ routing: input.routing, account: input.account, type: input.accountType }),
        authText: `${authText}\n---\n${feeText}`,
        ipAddress, userAgent,
      },
    });
    // Booking money mirrors what will be debited; status stays APPROVED until
    // the owner records settlement. Dates held via the extended hold (the
    // availability check treats a live-hold APPROVED booking as consuming).
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        cardFee: feeNow,
        total: money2(baseTotal + feeNow),
        paymentPlan: useSplit ? PaymentPlan.SPLIT : PaymentPlan.FULL,
        depositAmount: useSplit ? money2(baseTotal / 2) : null,
        balanceAmount: useSplit ? money2(baseTotal - baseTotal / 2) : null,
        balanceDueDate: balanceDueKey ? parseKey(balanceDueKey) : null,
        holdExpiresAt: new Date(Date.now() + HOLD_DAYS * 864e5),
      },
    });
  });

  const owners = notifyEmails();
  if (owners.length) {
    const eb = { ...toEmailBooking(booking, booking.client), lastName: booking.client.lastName, total: money2(baseTotal + feeNow) };
    await sendTemplate(owners, ownerAchAuthorization(eb, {
      amount: deposit, bankName: input.bankName, accountLast4: input.account.slice(-4),
      split: useSplit, balance: balance ?? undefined, balanceDate: balanceDueKey ?? undefined,
    }), booking.client.email);
  }
  await logComms(booking.clientId, CommsType.BILL, `ACH authorization received (${input.bankName} ••••${input.account.slice(-4)}) — awaiting origination`);

  return NextResponse.json({ ok: true });
}
