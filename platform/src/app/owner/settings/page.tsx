import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { DEFAULT_SLUG } from '@/lib/property';
import OwnerBar from '../OwnerBar';
import ArrivalEditor from './ArrivalEditor';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/owner/login');
  const isOwner = session.user.role === 'OWNER';

  const p = await prisma.property.findUnique({
    where: { slug: DEFAULT_SLUG },
    select: {
      address: true, doorCode: true, wifiName: true, wifiPassword: true,
      parkingNotes: true, arrivalNotes: true, houseRules: true, autoArrival: true,
      checkinTime: true, checkoutTime: true,
    },
  });

  return (
    <>
      <OwnerBar active="settings" />
      <div className="op-wrap">
        <h1>Settings</h1>
        <div className="bd-card" style={{ maxWidth: 640 }}>
          <h2>Arrival info</h2>
          <div className="op-note" style={{ marginBottom: 16 }}>
            Used by the one-click arrival email and the automatic pre-arrival send
            ({p?.checkinTime} check-in · {p?.checkoutTime} check-out).
          </div>
          {isOwner ? (
            <ArrivalEditor
              initial={{
                address: p?.address ?? '', doorCode: p?.doorCode ?? '', wifiName: p?.wifiName ?? '',
                wifiPassword: p?.wifiPassword ?? '', parkingNotes: p?.parkingNotes ?? '',
                arrivalNotes: p?.arrivalNotes ?? '', houseRules: (p?.houseRules ?? []).join('\n'),
                autoArrival: p?.autoArrival ?? true,
              }}
            />
          ) : (
            <div className="op-note">Read-only access — only the owner can edit arrival info.</div>
          )}
        </div>
      </div>
    </>
  );
}
