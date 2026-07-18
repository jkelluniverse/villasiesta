'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { revealAchDetails, markAchReturned, type RevealedAch } from '../actions';
import type { AchInfo } from '@/lib/owner-bookings';

const STATUS_LABEL: Record<string, string> = {
  authorized: 'Authorized — originate the debit',
  originated: 'Originated — awaiting settlement',
  settled: 'Settled',
  returned: 'Returned / NSF',
  voided: 'Voided',
};

export default function AchPanel({ bookingId, ach, isOwner }: { bookingId: string; ach: AchInfo; isOwner: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [revealed, setRevealed] = useState<RevealedAch | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [err, setErr] = useState('');

  const reveal = () => {
    setErr('');
    start(async () => {
      const res = await revealAchDetails(bookingId);
      if (res.ok) setRevealed(res);
      else setErr(res.error || 'Could not reveal.');
    });
  };

  const returned = () => {
    if (!window.confirm('Mark this ACH debit returned/NSF? The returned-payment fee is added and the guest is emailed.')) return;
    setErr('');
    start(async () => {
      const res = await markAchReturned(bookingId);
      if (res.ok) router.refresh();
      else setErr(res.error || 'Could not mark returned.');
    });
  };

  const active = ach.status === 'authorized' || ach.status === 'originated';

  return (
    <div className="bd-card">
      <h2>Bank debit (Instant ACH)</h2>
      <div className="bd-line"><span className="k">Status</span><span className="v">{STATUS_LABEL[ach.status] || ach.status}</span></div>
      <div className="bd-line"><span className="k">Account holder</span><span className="v">{ach.nameOnAccount}</span></div>
      <div className="bd-line"><span className="k">Bank</span><span className="v">{ach.bankName} ••••{ach.accountLast4}</span></div>
      <div className="bd-line"><span className="k">Routing</span><span className="v num">•••••{ach.routingLast4}</span></div>
      <div className="bd-line"><span className="k">Authorized</span><span className="v num">{new Date(ach.consentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div>

      {revealed ? (
        <div className="bd-pay" style={{ marginTop: 12 }}>
          <div className="row"><span className="muted">Routing</span><b className="num">{revealed.routing}</b></div>
          <div className="row"><span className="muted">Account</span><b className="num">{revealed.account}</b></div>
          <div className="row"><span className="muted">Type</span><span>{revealed.type}</span></div>
          <div className="row"><span className="muted" style={{ fontSize: '.76rem' }}>This view was logged. Originate the debit, then Record manual payment (Bank debit).</span></div>
        </div>
      ) : null}

      {isOwner ? (
        <div className="bd-actions" style={{ marginTop: 14 }}>
          {!revealed && !ach.purged && active ? (
            <button className="op-btn op-btn-primary" disabled={pending} onClick={reveal}>{pending ? '…' : 'Reveal for origination'}</button>
          ) : null}
          {ach.purged ? <span className="op-note">Bank details purged (settled &gt; 30 days).</span> : null}
          {active || ach.status === 'settled' ? (
            <button className="op-btn op-btn-danger" disabled={pending} onClick={returned}>Mark returned / NSF</button>
          ) : null}
          <button className="op-btn op-btn-ghost" onClick={() => setShowAuth((s) => !s)}>{showAuth ? 'Hide' : 'View'} authorization</button>
        </div>
      ) : null}
      {showAuth ? <div className="op-note" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{ach.authText}</div> : null}
      {err ? <div className="op-note" style={{ color: 'var(--garnet)', marginTop: 8 }}>{err}</div> : null}
    </div>
  );
}
