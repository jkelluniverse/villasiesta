import { prisma } from '@/lib/db';
import { toKey } from '@/lib/dates';
import { BookingStatus } from '@prisma/client';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const niceDate = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

type NodeState = 'done' | 'active' | 'future' | 'cancelled';

export default async function BookingStatusPage({ params }: { params: { id: string } }) {
  const b = await prisma.booking.findUnique({ where: { id: params.id }, include: { client: true, property: true } });
  if (!b) {
    return <main className="wrap" style={{ padding: '120px 0' }}><h1 className="lead">Booking not found</h1><p style={{ color: 'var(--muted)' }}>This link may be expired. <Link href="/">Return home →</Link></p></main>;
  }

  const cur = b.property.currency;
  const dates = `${niceDate(toKey(b.checkIn))} → ${niceDate(toKey(b.checkOut))}`;
  const cancelled = b.status === BookingStatus.CANCELLED || b.status === BookingStatus.EXPIRED;
  const paid = b.status === BookingStatus.PAID;
  const approved = b.status === BookingStatus.APPROVED;

  const s = (done: boolean, active: boolean): NodeState => (cancelled ? 'cancelled' : done ? 'done' : active ? 'active' : 'future');
  const nodes = [
    { title: 'Request submitted', sub: `${dates} · ${b.guests} guests`, state: s(true, false) },
    { title: 'Owner reviewing', sub: 'Typically within 24–48 hours', state: s(approved || paid, b.status === BookingStatus.REQUESTED) },
    { title: 'Approved', sub: approved ? 'Finalize below to secure' : "We'll email you to finalize", state: s(paid, approved) },
    { title: 'Secured', sub: 'Reservation confirmed', state: s(paid, false) },
  ];

  const badge = cancelled ? { cls: 'declined', text: '● Not available' } : paid ? { cls: 'secured', text: '● Secured' } : approved ? { cls: 'approved', text: '● Approved' } : { cls: 'awaiting', text: '● Awaiting review' };

  return (
    <main className="wrap" style={{ padding: '110px 0 80px' }}>
      <div className="tracker" style={{ boxShadow: 'var(--shadow)' }}>
        <div className={`badge ${badge.cls}`}>{badge.text}</div>
        <h3>{cancelled ? 'These dates aren’t available' : paid ? `You’re confirmed, ${b.client.firstName}!` : `Your request is in, ${b.client.firstName}.`}</h3>
        <p className="note">
          {cancelled ? 'Reply to our email if your dates are flexible — we’ll help you find an open week.'
            : paid ? 'Your reservation is secured. Check your email for details.'
            : <>We’ll email you the moment it’s approved — <b>nothing has been charged.</b> The owner responds within <b>24–48 hours</b>.</>}
        </p>
        <div className="timeline">
          {nodes.map((n, i) => (
            <div className={`tnode ${n.state === 'cancelled' ? 'future' : n.state}`} key={i}>
              <span className="dot" />
              <div><div className="tt">{n.title}</div><div className="ts">{n.sub}</div></div>
            </div>
          ))}
        </div>
        {approved ? (
          <div style={{ marginTop: 14 }}>
            <div className="quote" style={{ marginTop: 0 }}>
              <div className="r"><span>Total to secure</span><b className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', color: 'var(--navy)' }}>{cur}{Math.round(b.total).toLocaleString()}</b></div>
            </div>
            <Link href={`/booking/${b.id}/finalize`} className="btn btn-navy" style={{ width: '100%', marginTop: 14 }}>Finalize &amp; secure your stay →</Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}
