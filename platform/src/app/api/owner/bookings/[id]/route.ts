import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getBookingDetail } from '@/lib/owner-bookings';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const booking = await getBookingDetail(params.id);
  if (!booking) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ booking });
}
