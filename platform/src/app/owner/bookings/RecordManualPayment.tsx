'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordManualPaymentAction } from '../actions';

const METHODS = [
  { value: 'ZELLE', label: 'Zelle' },
  { value: 'ACH_DIRECT', label: 'Bank debit (ACH)' },
] as const;

const todayKey = () => new Date().toISOString().slice(0, 10);

export default function RecordManualPayment(props: {
  bookingId: string; reference: string; currency: string; total: number; outstanding: number;
  highlight: boolean; claimedApp: string | null; defaultMethod?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');

  const [method, setMethod] = useState<string>(props.defaultMethod || 'ZELLE');
  const [amount, setAmount] = useState<string>(String(Math.round(props.outstanding)));
  const [receivedAt, setReceivedAt] = useState<string>(todayKey());
  const [memo, setMemo] = useState('');
  const [note, setNote] = useState('');

  const submit = () => {
    setErr('');
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setErr('Enter the amount received.'); return; }
    start(async () => {
      const res = await recordManualPaymentAction({ bookingId: props.bookingId, method: method as never, amount: amt, receivedAt, memo: memo.trim() || undefined, note: note.trim() || undefined });
      if (res.ok) { setOpen(false); router.refresh(); }
      else setErr(res.error || 'Could not record the payment.');
    });
  };

  return (
    <>
      <button className={`op-btn ${props.highlight ? 'op-btn-primary' : 'op-btn-ghost'}`} onClick={() => setOpen(true)} style={{ width: '100%' }}>
        Record manual payment{props.claimedApp ? ` (${props.claimedApp})` : ''}
      </button>

      {open ? (
        <div className="mp-overlay" onClick={() => !pending && setOpen(false)}>
          <div className="mp-modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 4 }}>Record manual payment</h2>
            <div className="op-note num" style={{ marginBottom: 14 }}>{props.reference} · total {props.currency}{Math.round(props.total).toLocaleString()}</div>

            <div className="ae">
              <div className="ae-two">
                <div>
                  <label>Method</label>
                  <select value={method} onChange={(e) => setMethod(e.target.value)}>
                    {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label>Amount ({props.currency})</label>
                  <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
              </div>
              <label>Date received</label>
              <input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
              <label>Memo as received (paste what the app shows)</label>
              <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={`Villa Siesta ${props.reference} — Miller`} />
              <label>Internal note (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. confirmed in Cash App activity" />
            </div>

            {err ? <div className="op-note" style={{ color: 'var(--garnet)' }}>{err}</div> : null}
            <div className="bd-actions" style={{ marginTop: 16 }}>
              <button className="op-btn op-btn-primary" disabled={pending} onClick={submit}>{pending ? 'Recording…' : 'Record payment'}</button>
              <button className="op-btn op-btn-ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
            </div>
            <div className="op-note" style={{ marginTop: 10 }}>Recording runs the same settlement as a card payment: full amount confirms the booking; a 50% deposit on a split marks it partially paid and schedules a balance reminder.</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
