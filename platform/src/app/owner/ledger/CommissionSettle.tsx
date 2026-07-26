'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { settleCommissionMonth } from '../actions';

export default function CommissionSettle({ monthKey, commission, settled, currency, isOwner }: {
  monthKey: string; commission: number; settled: number; currency: string; isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  if (!commission) return null;

  const allSettled = settled >= commission - 0.01;
  const toggle = () => {
    setErr('');
    start(async () => {
      const res = await settleCommissionMonth(monthKey, !allSettled);
      if (res.ok) router.refresh();
      else setErr(res.error || 'Failed');
    });
  };

  return (
    <span className="lg-comm num">
      Commission {currency}{Math.round(commission).toLocaleString()}
      {allSettled ? <span className="lg-comm-state ok">settled ✓</span> : <span className="lg-comm-state due">payable</span>}
      {isOwner ? (
        <button className="op-btn op-btn-ghost lg-comm-btn" disabled={pending} onClick={toggle}>
          {pending ? '…' : allSettled ? 'Mark unsettled' : 'Mark settled'}
        </button>
      ) : null}
      {err ? <span style={{ color: 'var(--garnet)' }}> {err}</span> : null}
    </span>
  );
}
