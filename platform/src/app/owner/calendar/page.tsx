import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import OwnerBar from '../OwnerBar';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/owner/login');
  return (
    <>
      <OwnerBar active="calendar" />
      <div className="op-wrap">
        <h1>Calendar</h1>
        <div className="op-card"><div className="op-empty"><div className="big">🗓</div>Calendar timeline &amp; Airbnb sync are coming next.</div></div>
      </div>
    </>
  );
}
