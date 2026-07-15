'use client';
import { useState, useTransition } from 'react';
import { approveBooking, declineBooking, sendBill } from './actions';
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
    item.type === 'payment' ? `Payment due · ${item.name}` :
    `Conflict · ${item.name}`;

  return (
    <div className="op-row">
      <span className={`op-dot dot-${item.type}`} />
      <div className="main">
        <div className="title">{title}</div>
        <div className="meta num">{item.dates} · {item.nights} nt · {item.guests} guests · {money(currency, item.total)}{item.message ? ` · “${item.message}”` : ''}</div>
        {err ? <div className="meta" style={{ color: 'var(--garnet)' }}>{err}</div> : null}
      </div>
      <div className="acts">
        <a className="op-iconbtn" href={`mailto:${item.email}`} title="Email guest">✉</a>
        {item.phone ? <a className="op-iconbtn" href={telHref(item.phone)} title="Call guest">☎</a> : null}
        {item.phone ? <a className="op-iconbtn" href={smsHref(item.phone)} title="Text guest">💬</a> : null}
        {done ? (
          <span className="op-role">{done}</span>
        ) : item.type === 'request' && isOwner ? (
          <>
            <button className="op-btn op-btn-primary" disabled={pending} onClick={() => act(approveBooking, 'Approved')}>{pending ? '…' : 'Approve'}</button>
            <button className="op-btn op-btn-danger" disabled={pending} onClick={() => act(declineBooking, 'Declined')}>Decline</button>
          </>
        ) : item.type === 'payment' && isOwner ? (
          <button className="op-btn op-btn-primary" disabled={pending} onClick={() => act(sendBill, 'Bill sent')}>{pending ? '…' : 'Send bill'}</button>
        ) : item.type === 'payment' ? (
          <span className="op-role">Awaiting payment</span>
        ) : null}
      </div>
    </div>
  );
}
