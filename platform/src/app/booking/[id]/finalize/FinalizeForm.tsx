'use client';
import { useEffect, useRef, useState } from 'react';

type Method = 'ach' | 'card' | 'zelle' | 'cashapp' | 'venmo' | 'chime';
const MANUAL: Method[] = ['zelle', 'cashapp', 'venmo', 'chime'];
const money = (c: string, n: number) => c + Math.round(n).toLocaleString();

// Minimal Web Payments SDK surface we use.
type SqTokenResult = { status: string; token?: string; errors?: { message?: string }[] };
type SqCard = { attach: (sel: string) => Promise<void>; tokenize: () => Promise<SqTokenResult>; destroy?: () => Promise<void> };
type SqAch = { tokenize: (o: { accountHolderName: string; intent?: string; total?: { amount: number; currencyCode: string } }) => Promise<SqTokenResult> };
type SqPayments = {
  card: () => Promise<SqCard>;
  ach: () => Promise<SqAch>;
  verifyBuyer: (token: string, details: Record<string, unknown>) => Promise<{ token?: string } | null>;
};
declare global { interface Window { Square?: { payments: (appId: string, locationId: string) => SqPayments } } }

export default function FinalizeForm(props: {
  bookingId: string; currency: string; baseTotal: number; cardTotal: number; cardPct: number;
  splitEligible: boolean; guestName: string; squareConfigured: boolean; squareEnv: string;
  appId: string; locationId: string;
}) {
  const { currency: cur } = props;
  const [method, setMethod] = useState<Method>('ach');
  const [plan, setPlan] = useState<'full' | 'split'>('full');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [sdkReady, setSdkReady] = useState(false);
  const paymentsRef = useRef<SqPayments | null>(null);
  const cardRef = useRef<SqCard | null>(null);
  const cardAttached = useRef(false);

  const useSquare = props.squareConfigured && !!props.appId && !!props.locationId;

  // Load the Web Payments SDK and init payments once.
  useEffect(() => {
    if (!useSquare) return;
    const src = props.squareEnv === 'production' ? 'https://web.squarecdn.com/v1/square.js' : 'https://sandbox.web.squarecdn.com/v1/square.js';
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = async () => {
      try {
        paymentsRef.current = window.Square!.payments(props.appId, props.locationId);
        setSdkReady(true);
      } catch (e) {
        console.error('[square-sdk] init failed', e);
        setErr('Could not start the secure payment form. Refresh and try again.');
      }
    };
    s.onerror = () => setErr('Could not load the secure payment library. Refresh and try again.');
    document.body.appendChild(s);
  }, [useSquare, props.appId, props.locationId, props.squareEnv]);

  // Attach the card element whenever the card method is selected.
  useEffect(() => {
    (async () => {
      if (!useSquare || !sdkReady || method !== 'card' || cardAttached.current) return;
      try {
        cardRef.current = await paymentsRef.current!.card();
        await cardRef.current.attach('#sq-card');
        cardAttached.current = true;
      } catch (e) {
        console.error('[square-sdk] card attach failed', e);
        setErr('Could not display the card form. Refresh and try again.');
      }
    })();
  }, [useSquare, sdkReady, method]);

  const isManual = MANUAL.includes(method);
  const total = method === 'card' ? props.cardTotal : props.baseTotal;
  const showSplit = props.splitEligible && method === 'card';   // split runs on a card
  const effectivePlan = showSplit ? plan : 'full';
  const showTotal = effectivePlan === 'split' ? Math.round(total / 2) : total;

  async function post(sourceId?: string, verificationToken?: string) {
    const res = await fetch(`/api/bookings/${props.bookingId}/finalize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: method === 'card' ? 'card' : 'ach', plan: effectivePlan, sourceId, verificationToken }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr((data.message || 'Payment failed.') + (data.detail ? ` [${data.detail}]` : ''));
      setBusy(false); return;
    }
    window.location.href = `/booking/${props.bookingId}`;
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);

    // Mock/dev path — Square not configured: simulate server-side.
    if (!useSquare) { await post(undefined); return; }
    if (!sdkReady || !paymentsRef.current) { setErr('The secure payment form is still loading — try again in a moment.'); setBusy(false); return; }

    try {
      let tokenRes: SqTokenResult;
      if (method === 'card') {
        if (!cardRef.current) { setErr('Card form not ready — try again in a moment.'); setBusy(false); return; }
        tokenRes = await cardRef.current.tokenize();
      } else {
        setNotice('Opening your bank connection…');
        const ach = await paymentsRef.current.ach();
        tokenRes = await ach.tokenize({
          accountHolderName: props.guestName || 'Guest',
          intent: 'CHARGE',
          total: { amount: Math.round(showTotal * 100), currencyCode: 'USD' },
        });
        setNotice('');
      }
      if (tokenRes.status !== 'OK' || !tokenRes.token) {
        const detail = tokenRes.errors?.map((x) => x.message).filter(Boolean).join('; ');
        setErr(detail ? `Payment details could not be verified: ${detail}` : 'Payment was cancelled or could not be verified.');
        setBusy(false); return;
      }

      // Split needs buyer verification so the card can be stored for the balance.
      let verificationToken: string | undefined;
      if (effectivePlan === 'split' && method === 'card') {
        const [givenName, ...rest] = (props.guestName || 'Guest').split(' ');
        const v = await paymentsRef.current.verifyBuyer(tokenRes.token, {
          amount: String(showTotal.toFixed(2)),
          currencyCode: 'USD',
          intent: 'STORE',
          billingContact: { givenName, familyName: rest.join(' ') || undefined },
        });
        verificationToken = v?.token;
      }

      await post(tokenRes.token, verificationToken);
    } catch (ex) {
      console.error('[square-sdk] pay failed', ex);
      setErr('Payment could not start — ' + ((ex as Error)?.message || 'unknown error'));
      setBusy(false);
    }
  }

  const methodLabel: Record<Method, string> = { ach: 'Bank transfer (ACH)', card: 'Credit / Debit card', zelle: 'Zelle', cashapp: 'Cash App', venmo: 'Venmo', chime: 'Chime' };

  return (
    <form onSubmit={pay}>
      <h3 className="fin-h">How you&apos;ll pay</h3>

      <div className="pay-methods">
        {(['ach', 'card'] as Method[]).map((m) => (
          <label key={m} className={`pay-opt${method === m ? ' on' : ''}`}>
            <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} />
            <span>{methodLabel[m]}</span>
            <em>{m === 'ach' ? 'no fee' : `+${props.cardPct}%`}</em>
          </label>
        ))}
        {MANUAL.map((m) => (
          <label key={m} className={`pay-opt${method === m ? ' on' : ''}`}>
            <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} />
            <span>{methodLabel[m]}</span><em>no fee</em>
          </label>
        ))}
      </div>

      {showSplit ? (
        <div className="pay-plan">
          <label className={plan === 'full' ? 'on' : ''}><input type="radio" checked={plan === 'full'} onChange={() => setPlan('full')} /> Pay in full · {money(cur, total)}</label>
          <label className={plan === 'split' ? 'on' : ''}><input type="radio" checked={plan === 'split'} onChange={() => setPlan('split')} /> 50% now ({money(cur, Math.round(total / 2))}), 50% auto-charged 14 days before check-in</label>
        </div>
      ) : props.splitEligible && method === 'ach' ? (
        <div className="pay-note" style={{ textAlign: 'left', marginBottom: 12 }}>The 50/50 payment plan runs on a card — choose Credit/Debit to split your payment.</div>
      ) : null}

      {isManual ? (
        <div className="pay-manual">
          <p>Send <b>{money(cur, total)}</b> via <b>{methodLabel[method]}</b> to the owner, then reply to your approval email so we can confirm. Your dates are held until then.</p>
        </div>
      ) : (
        <>
          {method === 'card' && useSquare ? (
            <div className="pay-fields"><div id="sq-card" style={{ minHeight: 92 }} /></div>
          ) : null}
          {method === 'ach' && useSquare ? (
            <div className="pay-manual" style={{ marginBottom: 12 }}>
              <p>You&apos;ll securely connect your bank in a pop-up (powered by Square + Plaid). Bank payments take a few business days to clear — your dates are held the moment you submit.</p>
            </div>
          ) : null}
          {notice ? <div className="pay-note" style={{ textAlign: 'left' }}>{notice}</div> : null}
          {err ? <div className="formerr">{err}</div> : null}
          <button className="btn btn-navy" type="submit" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
            {busy ? 'Processing…' : `Pay ${money(cur, showTotal)} & confirm 🔒`}
          </button>
          {!props.squareConfigured ? <div className="pay-note">Test mode — no live payment processor connected yet. Clicking pay simulates a successful charge.</div> : null}
        </>
      )}
    </form>
  );
}
