import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sendTemplate, notifyEmails } from '@/lib/email';
import * as T from '@/lib/emails';

export const dynamic = 'force-dynamic';

// Send any one branded template with sample data to NOTIFY_EMAILS, so each
// design can be eye-checked in real inboxes. OWNER-gated. Usage:
//   /api/test-email?template=arrivalInfo
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'OWNER') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const to = notifyEmails();
  if (!to.length) return NextResponse.json({ error: 'no NOTIFY_EMAILS set' }, { status: 400 });

  const name = req.nextUrl.searchParams.get('template') || '';
  const sample = {
    id: 'sample123', firstName: 'Taylor', lastName: 'Rivera', email: to[0], phone: '941-555-0142',
    message: 'Traveling with two kids — is the pool heated?',
    checkIn: new Date(Date.now() + 40 * 864e5), checkOut: new Date(Date.now() + 47 * 864e5),
    nights: 7, guests: 4, total: 2540, depositAmount: 1270, balanceAmount: 1270,
    balanceDueDate: new Date(Date.now() + 26 * 864e5),
  };
  const arrival = {
    address: '2567 Wood St, Sarasota, FL 34237', doorCode: '2468#', wifiName: 'VillaSiesta',
    wifiPassword: 'poolside2026', checkinTime: '4:00 PM', checkoutTime: '10:00 AM',
    rules: ['No smoking indoors', 'No parties/events', 'Quiet hours 10pm–8am', 'Pets welcome with pet fee'],
    hostPhone: '330-495-7821', parking: 'Two cars in the driveway', extraNotes: 'Pool towels are in the hall closet.',
  };

  const builders: Record<string, () => { subject: string; html: string; text: string }> = {
    requestReceived: () => T.requestReceived(sample),
    ownerNewRequest: () => T.ownerNewRequest(sample),
    approvedFinalize: () => T.approvedFinalize(sample),
    depositReceipt: () => T.depositReceipt(sample),
    paidConfirmation: () => T.paidConfirmation(sample),
    balanceReminder: () => T.balanceReminder(sample),
    arrivalInfo: () => T.arrivalInfo(sample, arrival),
    declined: () => T.declined(sample),
    ownerPaymentAlert: () => T.ownerPaymentAlert(sample, 'deposit'),
  };

  const build = builders[name];
  if (!build) return NextResponse.json({ error: 'unknown template', available: Object.keys(builders) }, { status: 400 });

  await sendTemplate(to, build());
  return NextResponse.json({ ok: true, sent: name, to });
}
