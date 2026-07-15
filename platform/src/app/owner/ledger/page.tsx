import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import OwnerBar from '../OwnerBar';

export const dynamic = 'force-dynamic';

export default async function LedgerPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/owner/login');
  return (
    <>
      <OwnerBar active="ledger" />
      <div className="op-wrap">
        <h1>Ledger</h1>
        <div className="op-card"><div className="op-empty"><div className="big">📒</div>Payout &amp; net-income ledger is coming next.</div></div>
      </div>
    </>
  );
}
