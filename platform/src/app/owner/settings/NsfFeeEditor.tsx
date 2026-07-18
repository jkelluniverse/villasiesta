'use client';
import { useState, useTransition } from 'react';
import { saveNsfFee } from '../actions';

export default function NsfFeeEditor({ initial }: { initial: number }) {
  const [fee, setFee] = useState(String(initial));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const save = () => {
    setMsg(''); setErr('');
    start(async () => {
      const res = await saveNsfFee(parseFloat(fee));
      if (res.ok) setMsg('Saved.');
      else setErr(res.error || 'Could not save.');
    });
  };

  return (
    <div className="ae">
      <label>Returned-payment (NSF) fee — $</label>
      <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^0-9.]/g, ''))} style={{ maxWidth: 140 }} />
      <div className="op-note" style={{ marginTop: 8 }}>
        Charged when a bank (ACH) payment is returned for insufficient funds. ⚠ Many states cap
        returned-payment fees by statute — confirm the enforceable amount with your attorney.
        New authorizations use the value saved here; changing it does not affect fees already agreed to.
      </div>
      <div className="bd-actions" style={{ marginTop: 14, alignItems: 'center' }}>
        <button className="op-btn op-btn-primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save fee'}</button>
        {msg ? <span className="op-note" style={{ color: 'var(--jade)' }}>{msg}</span> : null}
        {err ? <span className="op-note" style={{ color: 'var(--garnet)' }}>{err}</span> : null}
      </div>
    </div>
  );
}
