import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { getDashboard } from '@/lib/owner-data';
import { DEFAULT_SLUG } from '@/lib/property';
import AttentionRow from './AttentionRow';
import SignOutButton from './SignOutButton';

export const dynamic = 'force-dynamic';

const money = (c: string, n: number) => c + Math.round(n).toLocaleString();
const niceDay = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

export default async function OwnerDashboard() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/owner/login');
  const isOwner = session.user.role === 'OWNER';

  const dash = await getDashboard(DEFAULT_SLUG);
  if (!dash) return <div className="op-wrap">Property not found. Run the seed.</div>;

  const cur = dash.currency;
  const m = dash.metric;

  return (
    <>
      <div className="op-bar">
        <div className="brand"><span className="vsq">VS</span> Villa Siesta · Owners</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="muted">{dash.month}</span>
          {!isOwner ? <span className="op-role">Read-only</span> : null}
          <SignOutButton />
        </div>
      </div>

      <div className="op-wrap">
        <h1>Good day, {dash.ownerName}</h1>

        <div className="op-metrics">
          <div className="op-card">
            <div className="op-label">Net · this month</div>
            <div className="op-figure num">{money(cur, m.netThisMonth)}</div>
            <div className="op-sub">{m.netDeltaPct == null ? '—' : <span className={m.netDeltaPct >= 0 ? 'op-up' : 'op-down'}>{m.netDeltaPct >= 0 ? '▲' : '▼'} {Math.abs(m.netDeltaPct)}% vs {m.prevMonthLabel}</span>}</div>
          </div>
          <div className="op-card">
            <div className="op-label">Occupancy</div>
            <div className="op-figure num">{m.occupancyPct}%</div>
            <div className="op-bar-mini"><i style={{ width: `${m.occupancyPct}%` }} /></div>
          </div>
          <div className="op-card">
            <div className="op-label">YTD net</div>
            <div className="op-figure num">{money(cur, m.ytdNet)}</div>
            <div className="op-sub">this year to date</div>
          </div>
          <div className="op-card">
            <div className="op-label">Next payout</div>
            <div className="op-figure num">{m.nextPayout ? money(cur, m.nextPayout.amount) : '—'}</div>
            <div className="op-sub">{m.nextPayout ? `${niceDay(m.nextPayout.date)} · on arrival` : 'no upcoming stays'}</div>
          </div>
        </div>

        <div className="op-section">
          <div className="op-attention">
            <div className="head">
              <h2>Needs your attention</h2>
              {dash.attention.length ? <span className="op-count num">{dash.attention.length}</span> : null}
            </div>
            {dash.attention.length ? (
              dash.attention.map((it) => <AttentionRow key={it.bookingId} item={it} currency={cur} isOwner={isOwner} />)
            ) : (
              <div className="op-empty"><div className="big">✓</div>{dash.emptyState}</div>
            )}
          </div>
        </div>

        <div className="op-lower">
          <div className="op-card">
            <div className="op-label">Occupancy · next 30 nights</div>
            <div className="op-strip">
              {dash.occupancy30.map((d) => <i key={d.date} className={d.booked ? 'on' : ''} title={`${d.date}${d.booked ? ' · booked' : ''}`} />)}
            </div>
            <div className="op-note">Sapphire = booked · light = open</div>
          </div>
          <div className="op-card">
            <div className="op-label">Upcoming arrivals</div>
            <div style={{ marginTop: 10 }}>
              {dash.arrivals.length ? dash.arrivals.map((a) => (
                <div className="op-arr" key={a.bookingId}>
                  <span className="who">{a.name || a.email}</span>
                  <span className="when num">{niceDay(a.checkIn)} · {a.nights} nt</span>
                </div>
              )) : <div className="op-note">No upcoming arrivals yet.</div>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
