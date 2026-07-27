'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { blockDates, unblockDates, setNightlyRate, clearNightlyRate } from '../actions';
import type { CalendarMonth, DayCell } from '@/lib/calendar';

const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
};

export default function CalendarGrid({ cal, isOwner }: { cal: CalendarMonth; isOwner: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<{ a: string; b: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState('');
  const [price, setPrice] = useState('');
  const [mode, setMode] = useState<'block' | 'price'>('price');
  const [err, setErr] = useState('');
  const [confirmBlock, setConfirmBlock] = useState<DayCell | null>(null);

  const range = useMemo(() => {
    if (!sel) return null;
    const [lo, hi] = sel.a <= sel.b ? [sel.a, sel.b] : [sel.b, sel.a];
    return { start: lo, end: addDays(hi, 1) };   // checkout-exclusive
  }, [sel]);

  const inSel = (k: string) => !!range && k >= range.start && k < range.end;

  const onDown = (c: DayCell) => {
    setErr('');
    if (!isOwner) return;
    if (c.occ === 'booking') { router.push(`/owner/bookings/${c.bookingId}`); return; }
    if (c.occ === 'owner') { setConfirmBlock(c); setSel(null); return; }
    if (c.occ === 'airbnb') { setErr('Airbnb-synced dates are managed on Airbnb.'); return; }
    setConfirmBlock(null);
    // Touch-friendly: a second tap after a single-day selection completes the
    // range (no drag needed on phones). Tapping earlier restarts the selection.
    if (sel && sel.a === sel.b && c.key > sel.a) { setSel({ a: sel.a, b: c.key }); return; }
    setSel({ a: c.key, b: c.key });
    setDragging(true);
  };
  const onEnter = (c: DayCell) => {
    if (!dragging || !sel || c.occ !== 'open') return;
    setSel({ a: sel.a, b: c.key });
  };
  const onUp = () => setDragging(false);

  const applyBlock = () => {
    if (!range) return;
    setErr('');
    start(async () => {
      const res = await blockDates(range.start, range.end, note);
      if (res.ok) { setSel(null); setNote(''); router.refresh(); }
      else setErr(res.error || 'Could not block those dates.');
    });
  };

  const applyPrice = () => {
    if (!range) return;
    const p = parseFloat(price);
    if (!p) { setErr('Enter a nightly price.'); return; }
    setErr('');
    start(async () => {
      const res = await setNightlyRate(range.start, range.end, p);
      if (res.ok) { setSel(null); setPrice(''); router.refresh(); }
      else setErr(res.error || 'Could not set the price.');
    });
  };

  const applyClearPrice = () => {
    if (!range) return;
    setErr('');
    start(async () => {
      const res = await clearNightlyRate(range.start, range.end);
      if (res.ok) { setSel(null); setPrice(''); router.refresh(); }
      else setErr(res.error || 'Could not reset those nights.');
    });
  };

  const applyUnblock = (blockId: string) => {
    setErr('');
    start(async () => {
      const res = await unblockDates(blockId);
      if (res.ok) { setConfirmBlock(null); router.refresh(); }
      else setErr(res.error || 'Could not remove that block.');
    });
  };

  const nights = range ? Math.round((Date.parse(range.end) - Date.parse(range.start)) / 864e5) : 0;

  return (
    <div onMouseUp={onUp} onMouseLeave={onUp}>
      <div className="cal-grid" role="grid" aria-label={cal.monthLabel}>
        {cal.weekdayLabels.map((w) => <div key={w} className="cal-wd">{w}</div>)}
        {cal.weeks.flat().map((c) => (
          <div
            key={c.key}
            role="gridcell"
            className={[
              'cal-day',
              c.inMonth ? '' : 'dim',
              c.today ? 'today' : '',
              c.occ !== 'open' ? `occ-${c.occ}` : '',
              c.occ === 'booking' && c.tone ? `tone-${c.tone}` : '',
              inSel(c.key) ? 'sel' : '',
              c.isStart ? 'seg-start' : '',
            ].filter(Boolean).join(' ')}
            title={
              c.occ === 'booking' ? `${c.reference} · ${c.guest}` :
              c.occ === 'owner' ? (c.label || 'Blocked by owner') :
              c.occ === 'airbnb' ? (c.label || 'Airbnb') : c.key
            }
            onMouseDown={() => onDown(c)}
            onMouseEnter={() => onEnter(c)}
          >
            <span className="num d">{c.day}</span>
            {c.isStart && c.occ === 'booking' ? <span className="cal-tag">{c.reference}</span> : null}
            {c.isStart && c.occ !== 'booking' && c.occ !== 'open' ? <span className="cal-tag">{c.occ === 'airbnb' ? 'Airbnb' : 'Blocked'}</span> : null}
            {c.occ === 'open' && c.inMonth && c.rate ? <span className={`cal-rate num${c.customRate ? ' custom' : ''}`}>${c.rate}</span> : null}
          </div>
        ))}
      </div>

      <div className="cal-legend">
        <span><i className="lg booking" /> Booked (click to open)</span>
        <span><i className="lg owner" /> Owner block (click to remove)</span>
        <span><i className="lg airbnb" /> Airbnb</span>
        <span><i className="lg open" /> Open{isOwner ? ' (drag to price or block)' : ''}</span>
        <span><b style={{ color: 'var(--plum)' }}>$—</b> custom price</span>
      </div>

      {err ? <div className="op-note" style={{ color: 'var(--garnet)', marginTop: 10 }}>{err}</div> : null}

      {isOwner && range ? (
        <div className="cal-bar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <b className="num">{range.start} → {range.end}</b>
            <span className="op-note">{nights} night{nights === 1 ? '' : 's'}</span>
            <div className="cal-modes">
              <button type="button" className={`cal-mode${mode === 'price' ? ' on' : ''}`} onClick={() => setMode('price')}>Price</button>
              <button type="button" className={`cal-mode${mode === 'block' ? ' on' : ''}`} onClick={() => setMode('block')}>Block</button>
            </div>
          </div>
          {mode === 'price' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="cal-note" style={{ maxWidth: 160, flex: 'none' }}
                inputMode="numeric" placeholder="Nightly price ($)"
                value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ''))}
              />
              <button className="op-btn op-btn-primary" disabled={pending} onClick={applyPrice}>{pending ? '…' : 'Set price'}</button>
              <button className="op-btn op-btn-ghost" disabled={pending} onClick={applyClearPrice} title="Remove custom prices — nights fall back to seasonal rates">Reset to seasonal</button>
              <button className="op-btn op-btn-ghost" disabled={pending} onClick={() => { setSel(null); setPrice(''); }}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="cal-note"
                placeholder="Note (optional) — e.g. family visit"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button className="op-btn op-btn-primary" disabled={pending} onClick={applyBlock}>{pending ? '…' : 'Block dates'}</button>
              <button className="op-btn op-btn-ghost" disabled={pending} onClick={() => { setSel(null); setNote(''); }}>Cancel</button>
            </div>
          )}
        </div>
      ) : null}

      {isOwner && confirmBlock ? (
        <div className="cal-bar">
          <div><b>{confirmBlock.label || 'Blocked by owner'}</b><span className="op-note num" style={{ marginLeft: 8 }}>{confirmBlock.key}</span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="op-btn op-btn-danger" disabled={pending} onClick={() => applyUnblock(confirmBlock.blockId!)}>{pending ? '…' : 'Remove block'}</button>
            <button className="op-btn op-btn-ghost" disabled={pending} onClick={() => setConfirmBlock(null)}>Keep</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
