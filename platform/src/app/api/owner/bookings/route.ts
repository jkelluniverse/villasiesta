import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantId } from '@/lib/tenant';
import { withTenant } from '@/lib/dal';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { DEFAULT_SLUG } from '@/lib/property';
import { listBookings, filterBookings, type BookingTab } from '@/lib/owner-bookings';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withTenant(await resolveTenantId(req.headers.get('host')), async () => {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const tab = (req.nextUrl.searchParams.get('tab') || 'all') as BookingTab;
  const q = req.nextUrl.searchParams.get('q') || '';
  const all = await listBookings(DEFAULT_SLUG);
  const rows = filterBookings(all, tab, q);
  return NextResponse.json({ tab, q, count: rows.length, bookings: rows });
});
}
