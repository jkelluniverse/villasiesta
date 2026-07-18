'use client';
import { useMemo, useState } from 'react';
import { validRoutingNumber, validAccountNumber, buildAchAuthText, buildAchFeeText, ACH_DESCRIPTOR } from '@/lib/ach-shared';

const money = (c: string, n: number) => c + Math.round(n).toLocaleString();

export default function InstantAchForm(props: {
  bookingId: string;
  currency: string;
  achTotal: number;          // total incl. +1% ACH fee
  splitEligible: boolean;
  todayKey: string;          // first debit "on or after"
  balanceDueKey: string;     // check-in − 14d (split's second debit)
  nsfFee: number;
  onDone: () => void;
}) {
  const cur = props.currency;
  const [plan, setPlan] = useState<'full' | 'split'>('full');
  const [name, setName] = useState('');
  const [bank, setBank] = useState('');
  const [routing, setRouting] = useState('');
  const [account, setAccount] = useState('');
  const [account2, setAccount2] = useState('');
  const [acctType, setAcctType] = useState<'checking' | 'savings'>('checking');
  const [authAgree, setAuthAgree] = useState(false);
  const [feeAgree, setFeeAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const useSplit = props.splitEligible && plan === 'split';
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const debitNow = useSplit ? round2(props.achTotal / 2) : props.achTotal;
  const balance = useSplit ? round2(props.achTotal - debitNow) : null;

  // The EXACT authorization language — same builder the server stores.
  const authText = useMemo(
    () => buildAchAuthText({ amount: debitNow, onOrAfter: props.todayKey, balanceAmount: balance, balanceDate: useSplit ? props.balanceDueKey : null }),
    [debitNow, balance, useSplit, props.todayKey, props.balanceDueKey],
  );
  const feeText = useMemo(() => buildAchFeeText(props.nsfFee), [props.nsfFee]);

  const routingBad = touched.routing && !validRoutingNumber(routing);
  const accountBad = touched.account && !validAccountNumber(account);
  const confirmBad = touched.account2 && account2.length > 0 && account !== account2;

  const valid =
    name.trim().length >= 2 && bank.trim().length >= 2 &&
    validRoutingNumber(routing) && validAccountNumber(account) && account === account2 &&
    authAgree && feeAgree;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setErr(''); setBusy(true);
    try {
      const res = await fetch(`/api/bookings/${props.bookingId}/ach-authorize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: useSplit ? 'split' : 'full',
          nameOnAccount: name.trim(), bankName: bank.trim(),
          routing, account, accountConfirm: account2, accountType: acctType,
          authAgree, feeAgree,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.message || 'Something went wrong — please try again.'); setBusy(false); return; }
      props.onDone();
    } catch {
      setErr('Network error — please try again.');
      setBusy(false);
    }
  }

  const digits = (v: string) => v.replace(/\D/g, '');

  return (
    <form onSubmit={submit} className="iach" autoComplete="off">
      {props.splitEligible ? (
        <div className="pay-plan">
          <label className={plan === 'full' ? 'on' : ''}><input type="radio" checked={plan === 'full'} onChange={() => setPlan('full')} /> Pay in full · {money(cur, props.achTotal)}</label>
          <label className={plan === 'split' ? 'on' : ''}><input type="radio" checked={plan === 'split'} onChange={() => setPlan('split')} /> 50% now ({money(cur, round2(props.achTotal / 2))}), 50% debited 14 days before check-in</label>
        </div>
      ) : null}

      <div className="iach-grid">
        <div className="full">
          <label>Name on account</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required />
        </div>
        <div className="full">
          <label>Bank name</label>
          <input value={bank} onChange={(e) => setBank(e.target.value)} autoComplete="off" required />
        </div>
        <div>
          <label>Routing number</label>
          <input inputMode="numeric" maxLength={9} value={routing} autoComplete="off"
            onChange={(e) => setRouting(digits(e.target.value))} onBlur={() => setTouched((t) => ({ ...t, routing: true }))} required />
          {routingBad ? <div className="iach-err">That routing number doesn&apos;t look right — check the diagram below.</div> : null}
        </div>
        <div>
          <label>Account type</label>
          <select value={acctType} onChange={(e) => setAcctType(e.target.value as 'checking' | 'savings')}>
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
          </select>
        </div>
        <div>
          <label>Account number</label>
          <input inputMode="numeric" maxLength={17} value={account} autoComplete="off"
            onChange={(e) => setAccount(digits(e.target.value))} onBlur={() => setTouched((t) => ({ ...t, account: true }))} required />
          {accountBad ? <div className="iach-err">Account numbers are 4–17 digits.</div> : null}
        </div>
        <div>
          <label>Confirm account number</label>
          <input inputMode="numeric" maxLength={17} value={account2} autoComplete="off"
            onChange={(e) => setAccount2(digits(e.target.value))} onBlur={() => setTouched((t) => ({ ...t, account2: true }))} required />
          {confirmBad ? <div className="iach-err">The account numbers don&apos;t match.</div> : null}
        </div>
      </div>

      {/* check diagram — where to find routing ① / account ② / bank ③ */}
      { }
      <img src="/check-diagram.svg" alt="Diagram of a check: the routing number is the first 9 digits at the bottom left, the account number follows it, and the bank name is printed on the check." className="iach-check" />

      <label className="iach-consent">
        <input type="checkbox" checked={authAgree} onChange={(e) => setAuthAgree(e.target.checked)} />
        <span>{authText}</span>
      </label>
      <label className="iach-consent">
        <input type="checkbox" checked={feeAgree} onChange={(e) => setFeeAgree(e.target.checked)} />
        <span>{feeText}</span>
      </label>

      <div className="iach-notice">
        ACH payments take <b>1–3 business days</b> to post — typically within 24 hours. Your dates are held as soon as you submit.
        <br />The charge on your bank statement will appear as <b>{ACH_DESCRIPTOR}</b>.
      </div>

      {err ? <div className="formerr">{err}</div> : null}
      <button className="btn btn-navy" type="submit" disabled={!valid || busy} style={{ width: '100%', marginTop: 10 }}>
        {busy ? 'Submitting…' : `Authorize payment of ${money(cur, debitNow)}`}
      </button>
    </form>
  );
}
