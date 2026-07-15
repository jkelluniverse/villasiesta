'use client';
import { useState, useTransition } from 'react';
import { saveArrivalInfo, type ArrivalInfoInput } from '../actions';

export default function ArrivalEditor({ initial }: { initial: ArrivalInfoInput }) {
  const [form, setForm] = useState<ArrivalInfoInput>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const set = <K extends keyof ArrivalInfoInput>(k: K, v: ArrivalInfoInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    setMsg(''); setErr('');
    start(async () => {
      const res = await saveArrivalInfo(form);
      if (res.ok) setMsg('Saved.');
      else setErr(res.error || 'Could not save.');
    });
  };

  return (
    <div className="ae">
      <label>Property address</label>
      <input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="2567 Wood St, Sarasota, FL 34237" />

      <div className="ae-two">
        <div><label>Door code</label><input value={form.doorCode} onChange={(e) => set('doorCode', e.target.value)} placeholder="2468#" /></div>
        <div><label>Parking</label><input value={form.parkingNotes} onChange={(e) => set('parkingNotes', e.target.value)} placeholder="Two cars in the driveway" /></div>
      </div>

      <div className="ae-two">
        <div><label>Wi-Fi network</label><input value={form.wifiName} onChange={(e) => set('wifiName', e.target.value)} placeholder="VillaSiesta" /></div>
        <div><label>Wi-Fi password</label><input value={form.wifiPassword} onChange={(e) => set('wifiPassword', e.target.value)} placeholder="poolside2026" /></div>
      </div>

      <label>House rules (one per line)</label>
      <textarea rows={4} value={form.houseRules} onChange={(e) => set('houseRules', e.target.value)} placeholder={'No smoking indoors\nQuiet hours 10pm–8am'} />

      <label>Extra arrival notes</label>
      <textarea rows={2} value={form.arrivalNotes} onChange={(e) => set('arrivalNotes', e.target.value)} placeholder="Pool towels are in the hall closet." />

      <label className="ae-check">
        <input type="checkbox" checked={form.autoArrival} onChange={(e) => set('autoArrival', e.target.checked)} />
        Automatically email arrival details 3 days before check-in
      </label>

      <div className="bd-actions" style={{ marginTop: 16, alignItems: 'center' }}>
        <button className="op-btn op-btn-primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save arrival info'}</button>
        {msg ? <span className="op-note" style={{ color: 'var(--jade)' }}>{msg}</span> : null}
        {err ? <span className="op-note" style={{ color: 'var(--garnet)' }}>{err}</span> : null}
      </div>
    </div>
  );
}
