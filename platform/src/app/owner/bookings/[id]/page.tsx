import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { getBookingDetail, type PaymentRecord, type ActivityEntry } from '@/lib/owner-bookings';
import OwnerBar from '../../OwnerBar';
import StatusPill from '../../StatusPill';
import BookingActions from '../BookingActions';
import RecordManualPayment from '../RecordManualPayment';
import AdjustPriceModal from '../AdjustPriceModal';
import AchPanel from '../AchPanel';

export const dynamic = 'force-dynamic';

const telHref = (p?: string | null) => (p ? `tel:${p.replace(/[^0-9+]/g, '')}` : undefined);
const smsHref = (p?: string | null) => (p ? `sms:${p.replace(/[^0-9+]/g, '')}` : undefined);
const niceDay = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); };
const niceDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default async function BookingDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/owner/login');
  const isOwner = session.user.role === 'OWNER';

  const b = await getBookingDetail(params.id);
  if (!b) notFound();

  const cur = b.currency;
  const money = (n: number) => cur + Math.round(n).toLocaleString();

  return (
    <>
      <OwnerBar active="bookings" />
      <div className="op-wrap">
        <Link href="/owner/bookings" className="bd-back">← Bookings</Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>{b.guestName}</h1>
          <span className="bd-ref num">{b.reference}</span>
          <StatusPill status={b.status} />
        </div>
        <div className="op-note num" style={{ marginTop: 4 }}>
          {niceDay(b.checkIn)} → {niceDay(b.checkOut)} · {b.nights} nt · {b.guests} guest{b.guests === 1 ? '' : 's'}
        </div>

        {/* status banner — one sentence: where does this stand */}
        <div className={`bd-banner ${b.banner.tone}`}>{b.banner.text}</div>

        {b.manualClaimApp ? (
          <div className="bd-banner topaz" style={{ marginTop: 10 }}>
            Guest says they sent payment by {b.manualClaimApp}{b.manualClaimAt ? ` on ${niceDate(b.manualClaimAt)}` : ''} — verify receipt, then Record manual payment below.
          </div>
        ) : null}

        <div className="bd-grid">
          {/* left column */}
          <div style={{ display: 'grid', gap: 20 }}>
            <div className="bd-card">
              <h2>Payments</h2>
              {/* summary FIRST */}
              <div className="bd-line total"><span className="k">{b.summary.complete ? 'Paid in full' : 'Paid so far'}</span><span className="v num">{money(b.summary.paid)} of {money(b.summary.total)}</span></div>
              {!b.summary.complete ? (
                <div className="bd-line"><span className="k">{b.summary.failed ? 'Balance to retry' : 'Balance remaining'}</span><span className="v num" style={b.summary.failed ? { color: 'var(--garnet)' } : undefined}>{money(b.summary.remaining)}</span></div>
              ) : null}

              {b.payments.length ? b.payments.map((p, i) => <PaymentBlock key={i} p={p} money={money} />) : (
                <div className="op-note" style={{ marginTop: 12 }}>Nothing charged yet — this booking is {b.statusLabel.toLowerCase()}.</div>
              )}

              <div style={{ marginTop: 16 }}>
                <div className="op-label" style={{ marginBottom: 8 }}>Price breakdown</div>
                <div className="bd-line"><span className="k">Nightly subtotal{b.priceCustom ? ' (owner-set)' : ''}</span><span className="v num">{money(b.subtotal)}</span></div>
                {b.discount ? <div className="bd-line"><span className="k">Discount</span><span className="v num" style={{ color: 'var(--jade)' }}>−{money(b.discount)}</span></div> : null}
                {b.cleaningFee ? <div className="bd-line"><span className="k">Cleaning</span><span className="v num">{money(b.cleaningFee)}</span></div> : null}
                {b.petFee ? <div className="bd-line"><span className="k">Pet fee</span><span className="v num">{money(b.petFee)}</span></div> : null}
                {b.taxAmount ? <div className="bd-line"><span className="k">Tax</span><span className="v num">{money(b.taxAmount)}</span></div> : null}
                {b.cardFee ? <div className="bd-line"><span className="k">Card service (+3%)</span><span className="v num">{money(b.cardFee)}</span></div> : null}
                <div className="bd-line total"><span className="k">Total</span><span className="v num">{money(b.total)}</span></div>
              </div>
            </div>

            <div className="bd-card">
              <h2>Activity</h2>
              {b.activity.length ? (
                <ul className="bd-log">
                  {b.activity.map((a, i) => <ActivityItem key={i} a={a} />)}
                </ul>
              ) : <div className="op-note">No activity logged yet.</div>}
            </div>
          </div>

          {/* right column */}
          <div style={{ display: 'grid', gap: 20 }}>
            <div className="bd-card">
              <h2>Actions</h2>
              <BookingActions id={b.id} status={b.status} isOwner={isOwner} />
              {isOwner && (b.status === 'REQUESTED' || b.status === 'APPROVED') ? (
                <div style={{ marginTop: 10 }}>
                  <AdjustPriceModal
                    bookingId={b.id} reference={b.reference} currency={cur}
                    nights={b.nights} subtotal={b.subtotal} discount={b.discount}
                    cleaningFee={b.cleaningFee} petFee={b.petFee} taxPercent={b.taxPercent} total={b.total}
                  />
                </div>
              ) : null}
              {isOwner && b.status !== 'CANCELLED' && b.status !== 'EXPIRED' ? (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
                  <RecordManualPayment
                    bookingId={b.id}
                    reference={b.reference}
                    currency={cur}
                    total={b.total}
                    outstanding={b.summary.remaining || b.total}
                    highlight={!!b.manualClaimApp || (!!b.ach && ['authorized', 'originated'].includes(b.ach.status))}
                    claimedApp={b.manualClaimApp}
                    defaultMethod={b.ach && ['authorized', 'originated'].includes(b.ach.status) ? 'ACH_DIRECT' : undefined}
                  />
                </div>
              ) : null}
            </div>

            {b.ach ? <AchPanel bookingId={b.id} ach={b.ach} isOwner={isOwner} /> : null}

            <div className="bd-card">
              <h2>Guest</h2>
              <div className="bd-line"><span className="k">Email</span><span className="v">{b.email}</span></div>
              <div className="bd-line"><span className="k">Phone</span><span className="v num">{b.phone || '—'}</span></div>
              {b.address ? <div className="bd-line"><span className="k">Address</span><span className="v">{b.address}</span></div> : null}
              <div className="bd-contact-actions">
                <a className="op-iconbtn" href={`mailto:${b.email}`} title="Email guest" aria-label="Email guest">✉</a>
                {b.phone ? <a className="op-iconbtn" href={telHref(b.phone)} title="Call guest" aria-label="Call guest">☎</a> : null}
                {b.phone ? <a className="op-iconbtn" href={smsHref(b.phone)} title="Text guest" aria-label="Text guest">💬</a> : null}
              </div>
              {b.message ? <div className="bd-pay" style={{ marginTop: 14 }}><span className="muted">Guest note</span><div style={{ marginTop: 4 }}>“{b.message}”</div></div> : null}
            </div>

            <div className="bd-card">
              <h2>Reservation</h2>
              <div className="bd-line"><span className="k">Status</span><span className="v">{b.statusLabel}</span></div>
              <div className="bd-line"><span className="k">Payment plan</span><span className="v">{b.planLabel}</span></div>
              <div className="bd-line"><span className="k">Method</span><span className="v">{b.paymentMethod || '—'}</span></div>
              {b.balanceDueDate ? <div className="bd-line"><span className="k">Balance date</span><span className="v num">{niceDay(b.balanceDueDate)}</span></div> : null}
              <div className="bd-line"><span className="k">Requested</span><span className="v num">{niceDate(b.createdAt)}</span></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function PaymentBlock({ p, money }: { p: PaymentRecord; money: (n: number) => string }) {
  const state = p.state === 'paid' ? 'Paid' : p.state === 'scheduled' ? 'Scheduled' : p.state === 'failed' ? 'Failed — retry' : 'Pending';
  const lookupFailed = !!p.live && !p.live.ok;
  return (
    <div className="bd-pay">
      <div className="row"><b>{p.label}</b><span className="num">{money(p.amount)}</span></div>
      <div className="row">
        <span className="muted" style={p.state === 'failed' ? { color: 'var(--garnet)' } : undefined}>{state}{p.when ? ` · ${p.when}` : ''}{p.method ? ` · ${p.method}` : ''}</span>
        {p.live?.last4 ? <span className="muted num">{p.live.cardBrand} ····{p.live.last4}</span> : null}
      </div>
      {lookupFailed ? (
        <div className="row"><span className="muted" style={{ color: 'var(--garnet)' }}>Couldn’t load the live payment record from Square.</span></div>
      ) : null}
      {p.live?.id && p.live.ok && !p.live.mock ? (
        <div className="row"><span className="muted">Square payment</span><span className="muted num" style={{ fontSize: '.76rem' }}>{p.live.id}{p.live.status ? ` · ${p.live.status}` : ''}</span></div>
      ) : null}
      {p.live?.processingFee != null ? (
        <div className="row"><span className="muted">Processing fee</span><span className="muted num">−{money(p.live.processingFee)}</span></div>
      ) : null}
      {p.live?.receiptUrl ? (
        <div className="row"><a href={p.live.receiptUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--sapphire)', fontSize: '.82rem' }}>Square receipt ↗</a></div>
      ) : null}
      {p.memo ? (
        <div className="row"><span className="muted">Memo</span><span className="muted" style={{ textAlign: 'right' }}>“{p.memo}”</span></div>
      ) : null}
    </div>
  );
}

function ActivityItem({ a }: { a: ActivityEntry }) {
  const label: Record<string, string> = {
    EMAIL: 'Email', SMS: 'Text', CALL: 'Call', BILL: 'Payment link',
  };
  return (
    <li>
      <span className="when num">{niceDate(a.at)}</span>
      <span className="what"><b>{label[a.type] || a.type}</b>{a.detail ? ` · ${a.detail}` : ''}</span>
    </li>
  );
}
