import { getServerSession } from 'next-auth';
import { tenantIdFromHeaders } from '@/lib/tenant';
import { withTenant } from '@/lib/dal';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { DEFAULT_SLUG } from '@/lib/property';
import { getCalendarMonth, currentMonthKey } from '@/lib/calendar';
import OwnerBar from '../OwnerBar';
import CalendarGrid from './CalendarGrid';

export const dynamic = 'force-dynamic';

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default async function CalendarPage({ searchParams }: { searchParams: { m?: string } }) {
  return withTenant(await tenantIdFromHeaders(), async () => {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/owner/login');
  const isOwner = session.user.role === 'OWNER';

  const cal = await getCalendarMonth(DEFAULT_SLUG, searchParams.m || currentMonthKey());
  if (!cal) return <div className="op-wrap">Property not found. Run the seed.</div>;

  return (
    <>
      <OwnerBar active="calendar" />
      <div className="op-wrap">
        <div className="cal-head">
          <h1 style={{ margin: 0 }}>Calendar</h1>
          <div className="cal-nav">
            <Link className="op-iconbtn" href={`/owner/calendar?m=${cal.prev}`} aria-label="Previous month">‹</Link>
            <span className="cal-month num">{cal.monthLabel}</span>
            <Link className="op-iconbtn" href={`/owner/calendar?m=${cal.next}`} aria-label="Next month">›</Link>
            <Link className="op-view" href="/owner/calendar" style={{ marginLeft: 4 }}>Today</Link>
          </div>
          <div className="op-note num">{cal.counts.booked} booked · {cal.counts.blocked} blocked · {cal.counts.open} open</div>
          <div className="cal-sync">
            {cal.sync.configured ? (
              cal.sync.status === 'healthy'
                ? <>Airbnb import: <span className="ok">healthy</span>{cal.sync.ranAt ? ` · ${timeAgo(cal.sync.ranAt)}` : ''}</>
                : cal.sync.status === 'error'
                  ? <>Airbnb import: <span className="bad">error</span> — {cal.sync.message || 'see logs'}</>
                  : <>Airbnb import: waiting for first sync</>
            ) : (
              <>Airbnb sync not connected — <Link href="/owner/settings" style={{ color: 'var(--sapphire)' }}>set up in Settings</Link></>
            )}
          </div>
        </div>

        <div className="op-card" style={{ marginTop: 18 }}>
          <CalendarGrid cal={cal} isOwner={isOwner} />
        </div>
      </div>
    </>
  );
});
}
