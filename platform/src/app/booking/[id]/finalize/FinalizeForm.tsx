'use client';
import { useEffect, useState } from 'react';

type Method = 'ach' | 'card' | 'zelle' | 'cashapp' | 'venmo' | 'chime';
const MANUAL: Method[] = ['zelle', 'cashapp', 'venmo', 'chime'];
const money = (c: string, n: number) => c + Math.round(n).toLocaleString();

declare global { interface Window { forte?: { createToken: (o: Record<string, unknown>) => { success: (cb: (r: { onetime_token?: string; token?: string }) => void) => { error: (cb: (e: unknown) => void) => void } } } } }

export default function FinalizeForm(props: {
  bookingId: string; currency: string; achTotal: number; cardTotal: number;
  splitEligible: boolean; forteConfigured: boolean; forteLoginId: string; forteEnv: string;
}) {
  const { currency: cur } = props;
  const [method, setMethod] = useState<Method>('ach');
  const [plan, setPlan] = useState<'full' | 'split'>('full');
  const [card, setCard] = useState({ number: '', exp: '', cvv: '', routing: '', account: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [forteReady, setForteReady] = useState(false);

  // Load Forte.js only when configured (client-side tokenization; card data never hits our server).
  useEffect(() => {
    if (!props.forteLoginId) return;
    const src = props.forteEnv === 'live' ? 'https://api.forte.net/js/forte.min.js' : 'https://sandbox.forte.net/js/forte.min.js';
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => setForteReady(true);
    document.body.appendChild(s);
    return () => { s.remove(); };
  }, [props.forteLoginId, props.forteEnv]);

  const isManual = MANUAL.includes(method);
  const total = method === 'card' ? props.cardTotal : props.achTotal;
  const showTotal = plan === 'split' ? Math.round(total / 2) : total;

  async function post(oneTimeToken?: string) {
    const res = await fetch(`/api/bookings/${props.bookingId}/finalize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: method === 'card' ? 'card' : 'ach', plan, oneTimeToken }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.message || 'Payment failed.'); setBusy(false); return; }
    window.location.href = `/booking/${props.bookingId}`;
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    // Forte.js tokenization path (when configured + loaded)
    if (props.forteLoginId && window.forte && forteReady) {
      try {
        const payload: Record<string, unknown> = { api_login_id: props.forteLoginId };
        if (method === 'card') {
          const [m, y] = card.exp.split('/');
          Object.assign(payload, { card_type: 'visa', account_number: card.number.replace(/\s/g, ''), expire_month: Number(m), expire_year: Number(y?.length === 2 ? '20' + y : y), cvv: card.cvv });
        } else {
          Object.assign(payload, { account_number: card.account, routing_number: card.routing, account_type: 'checking' });
        }
        window.forte.createToken(payload)
          .success((r) => post(r.onetime_token || r.token))
          .error(() => { setErr('Card could not be verified. Check the details and try again.'); setBusy(false); });
        return;
      } catch { setErr('Payment could not start.'); setBusy(false); return; }
    }
    // Mock/dev path (no Forte creds): charge is simulated server-side.
    await post(undefined);
  }

  const methodLabel: Record<Method, string> = { ach: 'Bank transfer (e-Check)', card: 'Credit / Debit card', zelle: 'Zelle', cashapp: 'Cash App', venmo: 'Venmo', chime: 'Chime' };

  return (
    <form onSubmit={pay}>
      <h3 className="fin-h">How you&apos;ll pay</h3>

      <div className="pay-methods">
        {(['ach', 'card'] as Method[]).map((m) => (
          <label key={m} className={`pay-opt${method === m ? ' on' : ''}`}>
            <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} />
            <span>{methodLabel[m]}</span>
            <em>{m === 'ach' ? 'no fee' : '+3%'}</em>
          </label>
        ))}
        {MANUAL.map((m) => (
          <label key={m} className={`pay-opt${method === m ? ' on' : ''}`}>
            <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} />
            <span>{methodLabel[m]}</span><em>no fee</em>
          </label>
        ))}
      </div>

      {props.splitEligible && !isManual ? (
        <div className="pay-plan">
          <label className={plan === 'full' ? 'on' : ''}><input type="radio" checked={plan === 'full'} onChange={() => setPlan('full')} /> Pay in full · {money(cur, total)}</label>
          <label className={plan === 'split' ? 'on' : ''}><input type="radio" checked={plan === 'split'} onChange={() => setPlan('split')} /> 50% now ({money(cur, Math.round(total / 2))}), rest before check-in</label>
        </div>
      ) : null}

      {isManual ? (
        <div className="pay-manual">
          <p>Send <b>{money(cur, total)}</b> via <b>{methodLabel[method]}</b> to the owner, then reply to your approval email so we can confirm. Your dates are held until then.</p>
        </div>
      ) : (
        <>
          {method === 'card' ? (
            <div className="pay-fields">
              <div className="field"><label>Card number</label><input inputMode="numeric" value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} placeholder="4111 1111 1111 1111" /></div>
              <div className="two">
                <div className="field"><label>Expiry (MM/YY)</label><input value={card.exp} onChange={(e) => setCard({ ...card, exp: e.target.value })} placeholder="09/28" /></div>
                <div className="field"><label>CVV</label><input inputMode="numeric" value={card.cvv} onChange={(e) => setCard({ ...card, cvv: e.target.value })} placeholder="123" /></div>
              </div>
            </div>
          ) : (
            <div className="pay-fields">
              <div className="field"><label>Routing number</label><input inputMode="numeric" value={card.routing} onChange={(e) => setCard({ ...card, routing: e.target.value })} /></div>
              <div className="field"><label>Account number</label><input inputMode="numeric" value={card.account} onChange={(e) => setCard({ ...card, account: e.target.value })} /></div>
            </div>
          )}
          {err ? <div className="formerr">{err}</div> : null}
          <button className="btn btn-navy" type="submit" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
            {busy ? 'Processing…' : `Pay ${money(cur, showTotal)} & confirm 🔒`}
          </button>
          {!props.forteConfigured ? <div className="pay-note">Test mode — no live payment processor connected yet. Clicking pay simulates a successful charge.</div> : null}
        </>
      )}
    </form>
  );
}
