import Link from 'next/link';
import SignOutButton from './SignOutButton';

const TABS = [
  { key: 'dashboard', label: 'Dashboard', href: '/owner' },
  { key: 'bookings', label: 'Bookings', href: '/owner/bookings' },
  { key: 'calendar', label: 'Calendar', href: '/owner/calendar' },
  { key: 'ledger', label: 'Ledger', href: '/owner/ledger' },
  { key: 'settings', label: 'Settings', href: '/owner/settings' },
];

export default function OwnerBar({ active, right }: { active: string; right?: React.ReactNode }) {
  return (
    <div className="op-bar">
      <div className="brand"><span className="vsq">VS</span> Villa Siesta</div>
      <nav className="op-nav">
        {TABS.map((t) => (
          <Link key={t.key} href={t.href} className={`op-navlink${active === t.key ? ' on' : ''}`}>{t.label}</Link>
        ))}
      </nav>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {right}
        <SignOutButton />
      </div>
    </div>
  );
}
