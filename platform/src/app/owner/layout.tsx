import './owner.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Owners Portal · Villa Siesta', robots: { index: false, follow: false } };

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <div className="op">{children}</div>;
}
