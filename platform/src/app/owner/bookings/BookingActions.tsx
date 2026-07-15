'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approveBooking, declineBooking, cancelBooking, sendBill, sendArrivalEmail } from '../actions';
import type { ActionResult } from '../actions';

type Fn = (id: string) => Promise<ActionResult>;
type Btn = { label: string; fn: Fn; kind: 'primary' | 'ghost' | 'danger'; confirm?: string; done: string };

export default function BookingActions({ id, status, isOwner }: { id: string; status: string; isOwner: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  if (!isOwner) return <div className="op-note">Read-only access — actions are disabled.</div>;

  const run = (b: Btn) => {
    if (b.confirm && !window.confirm(b.confirm)) return;
    setErr(''); setMsg('');
    start(async () => {
      const res = await b.fn(id);
      if (res.ok) { setMsg(b.done); router.refresh(); }
      else setErr(res.error || 'Something went wrong.');
    });
  };

  const buttons: Btn[] = [];
  if (status === 'REQUESTED') {
    buttons.push({ label: 'Approve', fn: approveBooking, kind: 'primary', done: 'Approved — guest emailed to finalize.' });
    buttons.push({ label: 'Decline', fn: declineBooking, kind: 'danger', confirm: 'Decline this request? The guest is emailed.', done: 'Declined.' });
  } else if (status === 'APPROVED') {
    buttons.push({ label: 'Send payment link', fn: sendBill, kind: 'primary', done: 'Payment link sent.' });
    buttons.push({ label: 'Cancel', fn: cancelBooking, kind: 'danger', confirm: 'Cancel this booking and release the dates?', done: 'Cancelled — dates released.' });
  } else if (status === 'PARTIALLY_PAID') {
    buttons.push({ label: 'Send arrival email', fn: sendArrivalEmail, kind: 'primary', done: 'Arrival details sent.' });
    buttons.push({ label: 'Send payment link', fn: sendBill, kind: 'ghost', done: 'Payment link sent.' });
    buttons.push({ label: 'Cancel', fn: cancelBooking, kind: 'danger', confirm: 'Cancel this booking and release the dates?', done: 'Cancelled — dates released.' });
  } else if (status === 'PAID') {
    buttons.push({ label: 'Send arrival email', fn: sendArrivalEmail, kind: 'primary', done: 'Arrival details sent.' });
    buttons.push({ label: 'Cancel', fn: cancelBooking, kind: 'danger', confirm: 'Cancel this booking and release the dates?', done: 'Cancelled — dates released.' });
  }

  if (!buttons.length) return <div className="op-note">No actions for a {status.replace('_', ' ').toLowerCase()} booking.</div>;

  return (
    <div>
      <div className="bd-actions">
        {buttons.map((b) => (
          <button
            key={b.label}
            className={`op-btn op-btn-${b.kind}`}
            disabled={pending}
            onClick={() => run(b)}
          >{pending ? '…' : b.label}</button>
        ))}
      </div>
      {msg ? <div className="op-note" style={{ color: 'var(--jade)' }}>{msg}</div> : null}
      {err ? <div className="op-note" style={{ color: 'var(--garnet)' }}>{err}</div> : null}
    </div>
  );
}
