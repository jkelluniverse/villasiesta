import Link from 'next/link';
import SignOutButton from './SignOutButton';

const TABS = [
  { key: 'dashboard', label: 'Dashboard', short: 'Home', ico: '🏠', href: '/owner' },
  { key: 'bookings', label: 'Bookings', short: 'Bookings', ico: '📋', href: '/owner/bookings' },
  { key: 'calendar', label: 'Calendar', short: 'Calendar', ico: '📅', href: '/owner/calendar' },
  { key: 'ledger', label: 'Ledger', short: 'Ledger', ico: '💵', href: '/owner/ledger' },
  { key: 'settings', label: 'Settings', short: 'Settings', ico: '⚙️', href: '/owner/settings' },
];

export default function OwnerBar({ active, right }: { active: string; right?: React.ReactNode }) {
  return (
    <>
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

      {/* app-style bottom navigation — phones only (see owner.css) */}
      <nav className="op-tabbar" aria-label="Portal sections">
        {TABS.map((t) => (
          <Link key={t.key} href={t.href} className={`op-tab${active === t.key ? ' on' : ''}`} aria-current={active === t.key ? 'page' : undefined}>
            <span className="ico" aria-hidden>{t.ico}</span>
            {t.short}
          </Link>
        ))}
      </nav>
    </>
  );
}
