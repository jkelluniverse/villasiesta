import { getServerSession } from 'next-auth';
import { tenantIdFromHeaders } from '@/lib/tenant';
import { withTenant } from '@/lib/dal';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { DEFAULT_SLUG } from '@/lib/property';
import { getLedger, type LedgerMonth, type LedgerTotals } from '@/lib/ledger';
import OwnerBar from '../OwnerBar';
import StatusPill from '../StatusPill';
import CommissionSettle from './CommissionSettle';

export const dynamic = 'force-dynamic';

const niceRange = (a: string, b: string) => {
  const fmt = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  return `${fmt(a)} → ${fmt(b)}`;
};

export default async function LedgerPage({ searchParams }: { searchParams: { y?: string } }) {
  return withTenant(await tenantIdFromHeaders(), async () => {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/owner/login');
  const isOwner = session.user.role === 'OWNER';

  const ledger = await getLedger(DEFAULT_SLUG, searchParams.y ? Number(searchParams.y) : undefined);
  if (!ledger) return <div className="op-wrap">Property not found. Run the seed.</div>;

  const cur = ledger.currency;
  const money = (n: number) => cur + Math.round(n).toLocaleString();

  return (
    <>
      <OwnerBar active="ledger" />
      <div className="op-wrap">
        <div className="cal-head">
          <h1 style={{ margin: 0 }}>Ledger</h1>
          {ledger.years.length > 1 ? (
            <div className="bk-tabs" style={{ margin: 0 }}>
              {ledger.years.map((y) => (
                <Link key={y} href={`/owner/ledger?y=${y}`} className={`bk-tab${y === ledger.year ? ' on' : ''}`}>{y}</Link>
              ))}
            </div>
          ) : <span className="op-note num">{ledger.year}</span>}
          {ledger.ytd.count ? (
            <a className="op-view" href={`/api/owner/ledger?year=${ledger.year}`} style={{ marginLeft: 'auto' }}>Export CSV</a>
          ) : null}
        </div>

        {/* year summary */}
        <div className="op-metrics" style={{ marginTop: 18 }}>
          <div className="op-card">
            <div className="op-label">{ledger.year} net</div>
            <div className="op-figure num">{money(ledger.ytd.net)}</div>
            <div className="op-sub">{ledger.ytd.count} stay{ledger.ytd.count === 1 ? '' : 's'}</div>
          </div>
          <div className="op-card">
            <div className="op-label">Gross</div>
            <div className="op-figure num">{money(ledger.ytd.gross)}</div>
            <div className="op-sub">collected so far: {money(ledger.ytd.collected)}</div>
          </div>
          <div className="op-card">
            <div className="op-label">Tax to remit</div>
            <div className="op-figure num">{money(ledger.ytd.tax)}</div>
            <div className="op-sub">FL + Sarasota tourist/sales</div>
          </div>
          <div className="op-card">
            <div className="op-label">Commission earned</div>
            <div className="op-figure num">{money(ledger.ytd.commission)}</div>
            <div className="op-sub num">{money(ledger.ytd.commissionSettled)} settled · {money(ledger.ytd.commission - ledger.ytd.commissionSettled)} payable</div>
          </div>
        </div>

        {ledger.months.length ? ledger.months.map((m) => <MonthTable key={m.key} m={m} money={money} cur={cur} isOwner={isOwner} />) : (
          <div className="op-card" style={{ marginTop: 20 }}>
            <div className="op-empty"><div className="big">📒</div>No paid stays in {ledger.year} yet — revenue appears here once a booking is paid.</div>
          </div>
        )}

        <div className="op-note" style={{ marginTop: 16 }}>
          Owner net = gross − processing fees − tax (remitted) − management commission. Cleaning stays inside gross (you pay the cleaner). Grouped by check-in month.
        </div>
      </div>
    </>
  );
});
}

function MonthTable({ m, money, cur, isOwner }: { m: LedgerMonth; money: (n: number) => string; cur: string; isOwner: boolean }) {
  return (
    <div className="op-card lg-card" style={{ marginTop: 20 }}>
      <div className="lg-month">
        <h2>{m.label}</h2>
        <span className="op-note num">{m.totals.count} stay{m.totals.count === 1 ? '' : 's'}</span>
        <span style={{ marginLeft: 'auto' }}>
          <CommissionSettle monthKey={m.key} commission={m.totals.commission} settled={m.totals.commissionSettled} currency={cur} isOwner={isOwner} />
        </span>
      </div>
      <div className="lg-scroll">
        <table className="lg-table num">
          <thead>
            <tr><th className="t">Guest</th><th className="t">Dates</th><th className="t">Status</th><th>Gross</th><th>Fees</th><th>Tax</th><th>Commission</th><th>Net</th></tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={r.id}>
                <td className="t"><Link href={`/owner/bookings/${r.id}`} className="lg-guest">{r.guestName}<small>{r.reference}</small></Link></td>
                <td className="t">{niceRange(r.checkIn, r.checkOut)} · {r.nights}nt</td>
                <td className="t"><StatusPill status={r.status} /></td>
                <td>{money(r.gross)}</td>
                <td className="dim">−{money(r.processing)}</td>
                <td className="dim">−{money(r.tax)}</td>
                <td className="dim">−{money(r.commission)}{r.commission > 0 ? <span className={`lg-dot ${r.commissionSettled ? 'ok' : 'due'}`} title={r.commissionSettled ? 'settled' : 'payable'} /> : null}</td>
                <td className="net">{money(r.net)}</td>
              </tr>
            ))}
            <tr className="total">
              <td className="t" colSpan={3}>Month total</td>
              <td>{money(m.totals.gross)}</td>
              <td className="dim">−{money(m.totals.processing)}</td>
              <td className="dim">−{money(m.totals.tax)}</td>
              <td className="dim">−{money(m.totals.commission)}</td>
              <td className="net">{money(m.totals.net)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
