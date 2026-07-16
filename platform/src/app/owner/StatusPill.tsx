import { displayStatus } from '@/lib/bookingStatus';
import type { BookingStatus } from '@prisma/client';

/** The single status pill used on every surface. Pure — safe in server or client trees. */
export default function StatusPill({ status, className = '' }: { status: BookingStatus; className?: string }) {
  const s = displayStatus({ status });
  return <span className={`pill ${s.tone}${className ? ` ${className}` : ''}`}>{s.label}</span>;
}
