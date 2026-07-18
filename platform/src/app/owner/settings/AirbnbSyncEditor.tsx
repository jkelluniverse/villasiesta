'use client';
import { useState, useTransition } from 'react';
import { saveAirbnbIcal } from '../actions';

export default function AirbnbSyncEditor({ initial }: { initial: string }) {
  const [url, setUrl] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const save = () => {
    setMsg(''); setErr('');
    start(async () => {
      const res = await saveAirbnbIcal(url);
      if (res.ok) setMsg('Saved — synced hourly.');
      else setErr(res.error || 'Could not save.');
    });
  };

  return (
    <div className="ae">
      <label>Airbnb iCal export URL</label>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.airbnb.com/calendar/ical/…ics" />
      <div className="op-note" style={{ marginTop: 8 }}>
        Airbnb → Calendar → Availability → Connect another website → Copy the export link.
        Airbnb reservations then appear as blocked dates here; leave empty to disable.
      </div>
      <div className="bd-actions" style={{ marginTop: 14, alignItems: 'center' }}>
        <button className="op-btn op-btn-primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save sync link'}</button>
        {msg ? <span className="op-note" style={{ color: 'var(--jade)' }}>{msg}</span> : null}
        {err ? <span className="op-note" style={{ color: 'var(--garnet)' }}>{err}</span> : null}
      </div>
    </div>
  );
}
