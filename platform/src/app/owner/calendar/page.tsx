import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { DEFAULT_SLUG } from '@/lib/property';
import { getCalendarMonth, currentMonthKey } from '@/lib/calendar';
import OwnerBar from '../OwnerBar';
import CalendarGrid from './CalendarGrid';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({ searchParams }: { searchParams: { m?: string } }) {
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
        </div>

        <div className="op-card" style={{ marginTop: 18 }}>
          <CalendarGrid cal={cal} isOwner={isOwner} />
        </div>
      </div>
    </>
  );
}
