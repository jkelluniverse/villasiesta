'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { adjustBookingPrice } from '../actions';

const money2 = (n: number) => Math.round(n * 100) / 100;

export default function AdjustPriceModal(props: {
  bookingId: string; reference: string; currency: string;
  nights: number; subtotal: number; discount: number; cleaningFee: number; petFee: number; taxPercent: number; total: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  const [nightly, setNightly] = useState(String(Math.round(props.subtotal / props.nights)));
  const [discount, setDiscount] = useState(props.discount ? String(Math.round(props.discount)) : '');

  const cur = props.currency;
  const fmt = (n: number) => cur + Math.round(n).toLocaleString();

  // Live preview — the same math the server runs (tax on lodging − discount + fees).
  const preview = useMemo(() => {
    const n = parseFloat(nightly) || 0;
    const d = Math.min(parseFloat(discount) || 0, n * props.nights);
    const subtotal = money2(n * props.nights);
    const taxable = money2(subtotal - d + props.cleaningFee + props.petFee);
    const tax = props.taxPercent > 0 ? money2((taxable * props.taxPercent) / 100) : 0;
    return { subtotal, discount: d, tax, total: money2(taxable + tax) };
  }, [nightly, discount, props.nights, props.cleaningFee, props.petFee, props.taxPercent]);

  const submit = () => {
    setErr('');
    start(async () => {
      const res = await adjustBookingPrice({ bookingId: props.bookingId, nightly: parseFloat(nightly) || 0, discount: parseFloat(discount) || 0 });
      if (res.ok) { setOpen(false); router.refresh(); }
      else setErr(res.error || 'Could not adjust the price.');
    });
  };

  return (
    <>
      <button className="op-btn op-btn-ghost" onClick={() => setOpen(true)} style={{ width: '100%' }}>Adjust price</button>
      {open ? (
        <div className="mp-overlay" onClick={() => !pending && setOpen(false)}>
          <div className="mp-modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 4 }}>Adjust price</h2>
            <div className="op-note num" style={{ marginBottom: 14 }}>{props.reference} · currently {fmt(props.total)} · price locks in once the guest pays</div>

            <div className="ae">
              <div className="ae-two">
                <div>
                  <label>Nightly rate ({cur}/night)</label>
                  <input inputMode="decimal" value={nightly} onChange={(e) => setNightly(e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
                <div>
                  <label>Discount ({cur} off stay)</label>
                  <input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" />
                </div>
              </div>
            </div>

            <div className="bd-pay" style={{ marginTop: 16 }}>
              <div className="row"><span className="muted">{cur}{Math.round((parseFloat(nightly) || 0))} × {props.nights} nights</span><span className="num">{fmt(preview.subtotal)}</span></div>
              {preview.discount > 0 ? <div className="row"><span className="muted">Discount</span><span className="num" style={{ color: 'var(--jade)' }}>−{fmt(preview.discount)}</span></div> : null}
              {props.cleaningFee ? <div className="row"><span className="muted">Cleaning</span><span className="num">{fmt(props.cleaningFee)}</span></div> : null}
              {props.petFee ? <div className="row"><span className="muted">Pet fee</span><span className="num">{fmt(props.petFee)}</span></div> : null}
              {preview.tax > 0 ? <div className="row"><span className="muted">Tax ({props.taxPercent}%)</span><span className="num">{fmt(preview.tax)}</span></div> : null}
              <div className="row" style={{ fontWeight: 700 }}><span>New total</span><span className="num">{fmt(preview.total)}</span></div>
            </div>

            {err ? <div className="op-note" style={{ color: 'var(--garnet)', marginTop: 10 }}>{err}</div> : null}
            <div className="bd-actions" style={{ marginTop: 16 }}>
              <button className="op-btn op-btn-primary" disabled={pending} onClick={submit}>{pending ? 'Saving…' : `Set price · ${fmt(preview.total)}`}</button>
              <button className="op-btn op-btn-ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
            </div>
            <div className="op-note" style={{ marginTop: 10 }}>The guest pays this amount on their finalize page (plus the card/bank processing fee for their chosen method). Card and bank fees still apply on top.</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
