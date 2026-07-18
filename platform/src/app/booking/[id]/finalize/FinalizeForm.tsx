'use client';
import { useEffect, useRef, useState } from 'react';
import InstantAchForm from './InstantAchForm';

type Method = 'instant' | 'ach' | 'card' | 'zelle';
const MANUAL: Method[] = ['zelle'];
const money = (c: string, n: number) => c + Math.round(n).toLocaleString();

// method (lowercase UI) -> PaymentMethod enum
const ENUM: Record<string, string> = { zelle: 'ZELLE' };

type TransferApp = { key: string; label: string; handle: string; sub?: string };

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
  bookingId: string; reference: string; lastName: string;
  currency: string; baseTotal: number; cardTotal: number; achTotal: number; cardPct: number; achPct: number;
  splitEligible: boolean; guestName: string; squareConfigured: boolean; squareEnv: string;
  appId: string; locationId: string;
  transferApps: TransferApp[]; hostName: string; hostPhone: string;
  todayKey: string; balanceDueKey: string; nsfFee: number; instantAchEnabled: boolean;
}) {
  const { currency: cur } = props;
  const [method, setMethod] = useState<Method>(props.instantAchEnabled ? 'instant' : 'ach');
  const [plan, setPlan] = useState<'full' | 'split'>('full');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [achDone, setAchDone] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const paymentsRef = useRef<SqPayments | null>(null);
  const cardRef = useRef<SqCard | null>(null);
  const cardAttached = useRef(false);

  const useSquare = props.squareConfigured && !!props.appId && !!props.locationId;

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
  const total = method === 'card' ? props.cardTotal : (method === 'ach' || method === 'instant') ? props.achTotal : props.baseTotal;
  const showSplit = props.splitEligible && method === 'card';   // Square split runs on a card
  const effectivePlan = showSplit ? plan : 'full';
  const showTotal = effectivePlan === 'split' ? Math.round(total / 2) : total;

  const memo = `Villa Siesta ${props.reference} — ${props.lastName}`;
  const app = props.transferApps.find((a) => a.key === ENUM[method]);

  async function copyMemo() {
    try { await navigator.clipboard.writeText(memo); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* clipboard blocked — the text is visible to select manually */ }
  }

  async function claim() {
    setErr(''); setBusy(true);
    try {
      const res = await fetch(`/api/bookings/${props.bookingId}/claim-manual`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: ENUM[method], amount: total }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.message || 'Could not record that. Please reply to your approval email.'); setBusy(false); return; }
      setClaimed(app?.label || methodLabel[method]);
    } catch {
      setErr('Network error — please reply to your approval email so we can confirm.');
    }
    setBusy(false);
  }

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

  async function pay() {
    setErr(''); setBusy(true);

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

  const methodLabel: Record<Method, string> = { instant: '⚡ Instant ACH — enter your bank details', ach: 'ACH via Plaid (bank login)', card: 'Credit / Debit card', zelle: 'Zelle' };

  if (claimed) {
    return (
      <div className="pay-manual" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>⏳</div>
        <h3 className="fin-h" style={{ marginBottom: 6 }}>Thanks — we&apos;ll confirm receipt within 1 business day.</h3>
        <p>Your dates are held while we verify your <b>{claimed}</b> payment. Reservation <b>{props.reference}</b>. Watch your email — we&apos;ll send confirmation once it lands.</p>
      </div>
    );
  }

  if (achDone) {
    return (
      <div className="pay-manual" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>⚡</div>
        <h3 className="fin-h" style={{ marginBottom: 6 }}>Authorization received — your dates are held.</h3>
        <p>We&apos;ll email you when the payment posts (1–3 business days). Reservation <b>{props.reference}</b>.</p>
      </div>
    );
  }

  const pickable: Method[] = [...(props.instantAchEnabled ? (['instant'] as Method[]) : []), 'ach', 'card', ...MANUAL];

  return (
    <div>
      <h3 className="fin-h">How you&apos;ll pay</h3>

      <div className="pay-methods">
        {pickable.map((m) => (
          <label key={m} className={`pay-opt${method === m ? ' on' : ''}`}>
            <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} />
            <span>{methodLabel[m]}</span>
            <em>{m === 'card' ? `+${props.cardPct}%` : m === 'zelle' ? 'no fee' : `+${props.achPct}%`}</em>
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

      {method === 'instant' ? (
        <InstantAchForm
          bookingId={props.bookingId}
          currency={cur}
          achTotal={props.achTotal}
          splitEligible={props.splitEligible}
          todayKey={props.todayKey}
          balanceDueKey={props.balanceDueKey}
          nsfFee={props.nsfFee}
          onDone={() => setAchDone(true)}
        />
      ) : isManual ? (
        <div className="pay-manual pay-transfer">
          <p style={{ marginBottom: 12 }}>Send <b>{money(cur, total)}</b> to the owner via <b>{app?.label}</b>:</p>
          <div className="tf-dest">
            <span className="tf-app">{app?.label}</span>
            <span className="tf-handle">{app?.handle}{app?.sub ? <em> · {app.sub}</em> : null}</span>
          </div>
          <p className="tf-reassure">All accounts are under <b>{props.hostName}</b>, {props.hostPhone}.</p>

          <div className="tf-memo">
            <div className="tf-memo-label">⚠️ Include this in the payment memo / note — exactly:</div>
            <button type="button" className="tf-chip" onClick={copyMemo} title="Copy to clipboard">
              <span className="tf-chip-text">{memo}</span>
              <span className="tf-chip-copy">{copied ? 'Copied ✓' : 'Copy'}</span>
            </button>
            <div className="tf-memo-help">Payments without your reservation number and last name can&apos;t be matched automatically and may delay your confirmation.</div>
          </div>

          {err ? <div className="formerr">{err}</div> : null}
          <button type="button" className="btn btn-navy" style={{ width: '100%', marginTop: 6 }} disabled={busy} onClick={claim}>
            {busy ? 'One moment…' : `I've sent ${money(cur, total)} by ${app?.label}`}
          </button>
          <div className="pay-note">Don&apos;t mark this until you&apos;ve actually sent it — the owner verifies every transfer before confirming.</div>
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
          <button className="btn btn-navy" type="button" onClick={pay} disabled={busy} style={{ width: '100%', marginTop: 8 }}>
            {busy ? 'Processing…' : `Pay ${money(cur, showTotal)} & confirm 🔒`}
          </button>
          {!props.squareConfigured ? <div className="pay-note">Test mode — no live payment processor connected yet. Clicking pay simulates a successful charge.</div> : null}
        </>
      )}
    </div>
  );
}
