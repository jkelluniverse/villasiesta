import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { DEFAULT_SLUG } from '@/lib/property';
import { listBookings, filterBookings, type BookingTab, type BookingRow } from '@/lib/owner-bookings';
import OwnerBar from '../OwnerBar';

export const dynamic = 'force-dynamic';

const CUR = '$';
const money = (n: number) => CUR + Math.round(n).toLocaleString();
const niceRange = (a: string, b: string) => {
  const fmt = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  return `${fmt(a)} → ${fmt(b)}`;
};
const statusLabel = (s: string) => s.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const TABS: { key: BookingTab; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'requests', label: 'Requests' },
  { key: 'past', label: 'Past' },
  { key: 'all', label: 'All' },
];

export default async function BookingsPage({ searchParams }: { searchParams: { tab?: string; q?: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/owner/login');

  const tab = (TABS.find((t) => t.key === searchParams.tab)?.key ?? 'upcoming') as BookingTab;
  const q = (searchParams.q ?? '').trim();

  const all = await listBookings(DEFAULT_SLUG);
  const rows = filterBookings(all, tab, q);

  const href = (t: BookingTab) => `/owner/bookings?tab=${t}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  return (
    <>
      <OwnerBar active="bookings" />
      <div className="op-wrap">
        <h1>Bookings</h1>

        <div className="bk-tabs">
          {TABS.map((t) => (
            <Link key={t.key} href={href(t.key)} className={`bk-tab${tab === t.key ? ' on' : ''}`}>{t.label}</Link>
          ))}
          <form className="bk-search" action="/owner/bookings" method="get">
            <input type="hidden" name="tab" value={tab} />
            <input name="q" defaultValue={q} placeholder="Search guest or email…" aria-label="Search bookings" />
          </form>
        </div>

        <div className="bk-list">
          {rows.length ? rows.map((r) => <Row key={r.id} r={r} />) : (
            <div className="bk-empty">{q ? `No bookings match “${q}”.` : 'No bookings here yet.'}</div>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ r }: { r: BookingRow }) {
  const pillCls = r.status.toLowerCase();
  const progress =
    r.status === 'PAID' ? 'Paid in full' :
    r.status === 'PARTIALLY_PAID' ? `${money(r.paidAmount)} of ${money(r.total)}` :
    r.status === 'APPROVED' ? 'Awaiting payment' :
    r.status === 'REQUESTED' ? 'Not charged' :
    statusLabel(r.status);

  return (
    <Link href={`/owner/bookings/${r.id}`} className="bk-row">
      <div className="who">{r.guestName || r.email}<small>{r.guests} guest{r.guests === 1 ? '' : 's'}</small></div>
      <div className="sub num">{niceRange(r.checkIn, r.checkOut)}<br /><span style={{ color: 'var(--ink3)' }}>{r.nights} nt</span></div>
      <div className="sub num">{money(r.total)}</div>
      <div><span className={`pill ${pillCls}`}>{statusLabel(r.status)}</span></div>
      <div className="amt"><small>{progress}</small></div>
    </Link>
  );
}
