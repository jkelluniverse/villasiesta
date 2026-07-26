'use client';
import { useEffect, useMemo, useState } from 'react';
import { computeQuote, advertisedNightly, type PropertyPricing } from '@/lib/quote-core';
import { planCompStay, type CompSide } from '@/lib/stay-core';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const money = (cur: string, n: number) => cur + Math.round(n).toLocaleString();
const niceDate = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

type Tracker = { bookingId: string; first: string; checkIn: string; checkOut: string };

export default function BookingWidget({ slug = 'villa-siesta' }: { slug?: string }) {
  const [pricing, setPricing] = useState<PropertyPricing | null>(null);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [side, setSide] = useState<CompSide>('after');
  const [guests, setGuests] = useState(2);
  const [pet, setPet] = useState(false);
  const [form, setForm] = useState({ first: '', last: '', email: '', phone: '', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [tracker, setTracker] = useState<Tracker | null>(null);

  const today = keyOf(now.getFullYear(), now.getMonth(), now.getDate());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [q, a] = await Promise.all([
          fetch(`/api/quote?slug=${slug}`).then((r) => r.json()),
          fetch(`/api/availability?slug=${slug}`).then((r) => r.json()),
        ]);
        if (!alive) return;
        if (q?.pricing) setPricing(q.pricing);
        const set = new Set<string>();
        (a?.blocked || []).forEach((r: { start: string; end: string }) => {
          let d = r.start; while (d < r.end) { set.add(d); const [yy, mm, dd] = d.split('-').map(Number); const nx = new Date(Date.UTC(yy, mm - 1, dd + 1)); d = nx.toISOString().slice(0, 10); }
        });
        setBlocked(set);
      } catch { /* keep empty; page still renders */ }
      finally { if (alive) setLoaded(true); }
    })();
    return () => { alive = false; };
  }, [slug]);

  // Plan the reservation: 5–6 night selections book as a genuine full-week
  // stay with the unused nights complimentary. The server re-plans on submit.
  const plan = useMemo(() => {
    if (!checkIn || !checkOut) return null;
    const isFree = (a: string, b: string) => {
      if (a >= b || a < today) return false;
      let d = a;
      while (d < b) {
        if (blocked.has(d)) return false;
        const [yy, mm, dd] = d.split('-').map(Number);
        d = new Date(Date.UTC(yy, mm - 1, dd + 1)).toISOString().slice(0, 10);
      }
      return true;
    };
    return planCompStay({ checkIn, checkOut, side, isFree, todayKey: today });
  }, [checkIn, checkOut, side, blocked, today]);

  const quote = useMemo(() => {
    if (!pricing || !plan) return null;
    if (!plan.ok) return { ok: false as const, error: plan.error };
    return computeQuote(pricing, { checkIn: plan.stayCheckIn, checkOut: plan.stayCheckOut, guests, pet, compNights: plan.compNights });
  }, [pricing, plan, guests, pet]);

  function hasBlockedBetween(a: string, b: string) {
    let d = a; const step = (k: string) => { const [yy, mm, dd] = k.split('-').map(Number); return new Date(Date.UTC(yy, mm - 1, dd + 1)).toISOString().slice(0, 10); };
    d = step(d);
    while (d < b) { if (blocked.has(d)) return true; d = step(d); }
    return false;
  }
  function pick(dayKey: string) {
    if (!checkIn || checkOut) { setCheckIn(dayKey); setCheckOut(null); }
    else if (dayKey > checkIn) { if (hasBlockedBetween(checkIn, dayKey)) { setCheckIn(dayKey); setCheckOut(null); } else setCheckOut(dayKey); }
    else { setCheckIn(dayKey); setCheckOut(null); }
  }

  function shiftMonth(delta: number) {
    setView((v) => { const d = new Date(v.y, v.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!checkIn || !checkOut) { setError('Please select your dates on the calendar.'); return; }
    setSubmitting(true); setError('');
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          firstName: form.first, lastName: form.last,      // API field names
          email: form.email, phone: form.phone, message: form.message,
          guests, pet, checkIn, checkOut, side,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Something went wrong — please try again.'); setSubmitting(false); return; }
      setTracker({ bookingId: data.bookingId, first: form.first, checkIn, checkOut });
    } catch { setError('Network error — please try again.'); setSubmitting(false); }
  }

  if (tracker) return <PendingTracker t={tracker} />;

  // Build calendar cells
  const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < first; i++) cells.push(<div key={`e${i}`} className="day empty" />);
  for (let d = 1; d <= days; d++) {
    const key = keyOf(view.y, view.m, d);
    const cls = ['day'];
    if (key < today) cls.push('past');
    else if (blocked.has(key)) cls.push('blocked');
    else {
      cls.push('avail');
      if (key === checkIn) cls.push('sel');
      if (key === checkOut) cls.push('sel', 'end');
      if (checkIn && checkOut && key > checkIn && key < checkOut) cls.push('range');
      // Complimentary nights of a full-week reservation — shown lighter.
      if (plan?.ok && plan.compNights > 0 && key >= plan.checkIn && key < plan.checkOut && !(key >= plan.stayCheckIn && key < plan.stayCheckOut)) cls.push('comp');
    }
    const clickable = cls.includes('avail');
    const rate = pricing && clickable ? advertisedNightly(key, pricing) : null;
    cells.push(
      <div key={key} className={cls.join(' ')} onClick={clickable ? () => pick(key) : undefined}>
        <span className="dnum tnum">{d}</span>
        {rate ? <span className="drate tnum">{money(pricing!.currency, rate)}</span> : null}
      </div>
    );
  }

  const cur = pricing?.currency || '$';
  const comp = plan?.ok && plan.compNights > 0 ? plan : null;
  const selNote = checkIn && checkOut
    ? comp
      ? `Reservation ${niceDate(comp.checkIn)} → ${niceDate(comp.checkOut)} (7 nights) · Your stay: ${niceDate(comp.stayCheckIn)} → ${niceDate(comp.stayCheckOut)}`
      : `${niceDate(checkIn)} → ${niceDate(checkOut)}`
    : checkIn ? `Check-in ${niceDate(checkIn)} — now pick a check-out` : 'No dates selected yet';

  return (
    <div className="book-grid">
      <div className="cal">
        <div className="cal-top">
          <button className="navbtn" aria-label="Previous month" disabled={view.y === now.getFullYear() && view.m <= now.getMonth()} onClick={() => shiftMonth(-1)}>‹</button>
          <h3>{MONTHS[view.m]} {view.y}</h3>
          <button className="navbtn" aria-label="Next month" onClick={() => shiftMonth(1)}>›</button>
        </div>
        <div className="dow">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <span key={d}>{d}</span>)}</div>
        <div className="grid7">{cells}</div>
        <div className="legend">
          <span><i style={{ background: 'var(--navy)' }} />Check-in / out</span>
          <span><i style={{ background: '#dce2f2' }} />Your stay</span>
          <span><i style={{ background: '#e4e8ed' }} />Unavailable</span>
        </div>
        <div className="minnote">{pricing ? `${pricing.minNights}-night minimum · 5–6 night stays available as special-rate 7-night reservations · rates vary by season (${pricing.rateRangeLabel}/night).` : (loaded ? '' : 'Loading availability…')}</div>

        {comp ? (
          <div className="comp-note">
            <b>7-night minimum stay.</b> Staying fewer nights? Your reservation is booked as a full 7-night stay at a special rate — the extra nights are yours, use them or not.
            {plan?.ok && plan.canFlip ? (
              <button type="button" className="comp-flip" onClick={() => setSide(side === 'after' ? 'before' : 'after')}>
                Move the free nights {plan.side === 'after' ? 'before check-in' : 'after your stay'} ↺
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="quote">
          {quote && 'lines' in quote && quote.ok ? (
            <>
              {quote.lines.map((l, k) => (
                <div className="r" key={k}><span>{l.label.replace(/^(\d)/, (m0) => cur + m0)}</span><span className="tnum">{l.amount === 0 ? `${cur}0` : money(cur, l.amount)}</span></div>
              ))}
              <div className="r total"><span>Estimated total</span><b className="tnum">{money(cur, quote.total)}</b></div>
              {quote.savings && quote.airbnbEstimate ? (
                <div className="save-chip">Estimated Airbnb total for these dates: ~{money(cur, quote.airbnbEstimate)} — <b>you save ~{money(cur, quote.savings)} booking direct.</b></div>
              ) : null}
              <div className="r hint">Confirmed by the owner — no charge yet.{pricing && pricing.fees.cardPercent > 0 ? ` Paying by card adds ${pricing.fees.cardPercent}%.` : ''}</div>
            </>
          ) : (
            <div className="r hint">{quote?.error || (checkIn ? 'Now choose your check-out date.' : 'Select your check-in date to see a price.')}</div>
          )}
        </div>
      </div>

      <form className="req" onSubmit={submit}>
        <h3>Request to book</h3>
        <p className="note">No charge here — the owner confirms your dates and sends payment details.</p>
        <div className="selected-note">{selNote}</div>
        <div className="two">
          <div className="field"><label>First name</label><input required value={form.first} onChange={(e) => setForm({ ...form, first: e.target.value })} /></div>
          <div className="field"><label>Last name</label><input required value={form.last} onChange={(e) => setForm({ ...form, last: e.target.value })} /></div>
        </div>
        <div className="field"><label>Email</label><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div className="two">
          <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="field"><label>Guests</label><input type="number" min={1} max={6} value={guests} onChange={(e) => setGuests(Math.max(1, Number(e.target.value) || 1))} /></div>
        </div>
        <label className="petline"><input type="checkbox" checked={pet} onChange={(e) => setPet(e.target.checked)} /><span>Traveling with a pet? <em>(pets welcome · pet fee applies)</em></span></label>
        <div className="field"><label>Anything we should know?</label><textarea rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></div>
        {error ? <div className="formerr">{error}</div> : null}
        <button type="submit" className="btn btn-navy" disabled={submitting}>{submitting ? 'Sending…' : 'Send booking request'}</button>
      </form>
    </div>
  );
}

function PendingTracker({ t }: { t: Tracker }) {
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const nodes = [
    { state: 'done', title: 'Request submitted', sub: `Just now · ${niceDate(t.checkIn)} → ${niceDate(t.checkOut)}` },
    { state: 'active', title: 'Owner reviewing', sub: 'Typically within 24–48 hours' },
    { state: 'future', title: 'Approved', sub: "We'll email you a secure link to finalize" },
    { state: 'future', title: 'Secured', sub: 'Pay · reservation confirmed' },
  ];
  return (
    <div className="tracker">
      <div className="badge awaiting">● Awaiting review</div>
      <h3>Your request is in{t.first ? `, ${t.first}` : ''}.</h3>
      <p className="note">We&apos;ve sent it to the owner. You&apos;ll get an email the moment it&apos;s approved — <b>nothing has been charged.</b> The owner responds within <b>24–48 hours</b> with payment instructions if your reservation can be approved.</p>
      <div className="timeline">
        {nodes.map((n, i) => (
          <div className={`tnode ${n.state}`} key={i}>
            <span className="dot" />
            <div><div className="tt">{n.title}</div><div className="ts">{n.sub}</div></div>
          </div>
        ))}
      </div>
      <a className="track-link" href={`${appUrl}/booking/${t.bookingId}`}>View your request status →</a>
    </div>
  );
}
