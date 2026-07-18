'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { approveBooking, declineBooking, sendBill } from './actions';
import StatusPill from './StatusPill';
import type { AttentionItem } from '@/lib/owner-data';

const money = (c: string, n: number) => c + Math.round(n).toLocaleString();
const telHref = (p?: string | null) => (p ? `tel:${p.replace(/[^0-9+]/g, '')}` : undefined);
const smsHref = (p?: string | null) => (p ? `sms:${p.replace(/[^0-9+]/g, '')}` : undefined);

export default function AttentionRow({ item, currency, isOwner }: { item: AttentionItem; currency: string; isOwner: boolean }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const act = (fn: (id: string) => Promise<{ ok: boolean; error?: string }>, label: string) =>
    start(async () => {
      setErr('');
      const res = await fn(item.bookingId);
      if (res.ok) setDone(label);
      else setErr(res.error || 'Failed');
    });

  const title =
    item.type === 'request' ? `Request · ${item.name}` :
    item.type === 'payment' ? `Awaiting payment · ${item.name}` :
    item.type === 'balance_failed' ? `Balance failed · ${item.name}` :
    item.type === 'manual_claim' ? `${item.unverified ? 'Unverified — ' : ''}Payment claimed · ${item.name}` :
    item.type === 'manual_balance' ? `Manual balance due · ${item.name}` :
    item.type === 'ach_originate' ? `ACH to originate · ${item.name}` :
    `Conflict · ${item.name}`;

  const dot =
    item.type === 'balance_failed' || item.type === 'manual_claim' ? 'conflict' :
    item.type === 'manual_balance' ? 'payment' :
    item.type === 'ach_originate' ? 'request' : item.type;

  return (
    <div className="op-row">
      <span className={`op-dot dot-${dot}`} />
      <div className="main">
        <div className="title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {title}<StatusPill status={item.status} />
        </div>
        <div className="meta num">{item.dates} · {item.nights} nt · {item.guests} guests · {money(currency, item.total)}{item.app ? ` · via ${item.app}` : ''}{item.type === 'manual_balance' && item.dueDate ? ` · due ${item.dueDate}` : ''}{item.message ? ` · “${item.message}”` : ''}</div>
        {err ? <div className="meta" style={{ color: 'var(--garnet)' }}>{err}</div> : null}
      </div>
      <div className="acts">
        <Link className="op-view" href={`/owner/bookings/${item.bookingId}`}><span className="full">View booking</span><span className="short">View</span></Link>
        <a className="op-iconbtn" href={`mailto:${item.email}`} title="Email guest" aria-label="Email guest">✉</a>
        {item.phone ? <a className="op-iconbtn" href={telHref(item.phone)} title="Call guest" aria-label="Call guest">☎</a> : null}
        {item.phone ? <a className="op-iconbtn" href={smsHref(item.phone)} title="Text guest" aria-label="Text guest">💬</a> : null}
        {done ? (
          <span className="op-role">{done}</span>
        ) : item.type === 'request' && isOwner ? (
          <>
            <button className="op-btn op-btn-primary" disabled={pending} onClick={() => act(approveBooking, 'Approved')}>{pending ? '…' : 'Approve'}</button>
            <button className="op-btn op-btn-danger" disabled={pending} onClick={() => act(declineBooking, 'Declined')}>Decline</button>
          </>
        ) : item.type === 'ach_originate' ? (
          isOwner
            ? <Link className="op-btn op-btn-primary" href={`/owner/bookings/${item.bookingId}`}>Originate &amp; record →</Link>
            : <span className="op-role">Awaiting owner</span>
        ) : item.type === 'manual_claim' ? (
          isOwner
            ? <Link className="op-btn op-btn-primary" href={`/owner/bookings/${item.bookingId}`}>Verify &amp; record →</Link>
            : <span className="op-role">Awaiting owner</span>
        ) : item.type === 'manual_balance' ? (
          <span className="op-role">Reminder emailed</span>
        ) : (item.type === 'payment' || item.type === 'balance_failed') && isOwner ? (
          <button className="op-btn op-btn-primary" disabled={pending} onClick={() => act(sendBill, 'Link sent')}>{pending ? '…' : item.type === 'balance_failed' ? 'Retry — send link' : 'Send payment link'}</button>
        ) : (item.type === 'payment' || item.type === 'balance_failed') ? (
          <span className="op-role">Awaiting payment</span>
        ) : null}
      </div>
    </div>
  );
}
