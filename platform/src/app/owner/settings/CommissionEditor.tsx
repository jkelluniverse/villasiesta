'use client';
import { useState, useTransition } from 'react';
import { saveCommissionSettings } from '../actions';

export default function CommissionEditor({ initial }: { initial: { commissionPercent: number; directRateUplift: number; airbnbFeePct: number } }) {
  const [commission, setCommission] = useState(String(initial.commissionPercent));
  const [uplift, setUplift] = useState(String(initial.directRateUplift));
  const [airbnbFee, setAirbnbFee] = useState(String(initial.airbnbFeePct));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const digits = (v: string) => v.replace(/[^0-9.]/g, '');
  const save = () => {
    setMsg(''); setErr('');
    start(async () => {
      const res = await saveCommissionSettings({
        commissionPercent: parseFloat(commission) || 0,
        directRateUplift: parseFloat(uplift) || 0,
        airbnbFeePct: parseFloat(airbnbFee) || 0,
      });
      if (res.ok) setMsg('Saved — applies to new quotes only.');
      else setErr(res.error || 'Could not save.');
    });
  };

  return (
    <div className="ae">
      <div className="ae-two">
        <div>
          <label>Management commission (%)</label>
          <input inputMode="decimal" value={commission} onChange={(e) => setCommission(digits(e.target.value))} />
        </div>
        <div>
          <label>Direct-rate uplift (%)</label>
          <input inputMode="decimal" value={uplift} onChange={(e) => setUplift(digits(e.target.value))} />
        </div>
      </div>
      <label>Airbnb guest-fee estimate (%) — for the savings comparison</label>
      <input inputMode="decimal" value={airbnbFee} onChange={(e) => setAirbnbFee(digits(e.target.value))} style={{ maxWidth: 140 }} />
      <div className="op-note" style={{ marginTop: 10 }}>
        The uplift is added to your base calendar rates to produce the advertised direct rate
        (it funds the commission while keeping guests visibly cheaper than Airbnb; at 0 you absorb
        the commission). The commission is never shown to guests anywhere. Changes affect future
        quotes only — existing bookings keep their snapshots.
      </div>
      <div className="bd-actions" style={{ marginTop: 14, alignItems: 'center' }}>
        <button className="op-btn op-btn-primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save'}</button>
        {msg ? <span className="op-note" style={{ color: 'var(--jade)' }}>{msg}</span> : null}
        {err ? <span className="op-note" style={{ color: 'var(--garnet)' }}>{err}</span> : null}
      </div>
    </div>
  );
}
