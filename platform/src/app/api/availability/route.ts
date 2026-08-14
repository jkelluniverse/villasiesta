import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantId } from '@/lib/tenant';
import { withTenant } from '@/lib/dal';
import { getBlockedRanges } from '@/lib/availability';
import { getPropertyId, DEFAULT_SLUG } from '@/lib/property';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withTenant(await resolveTenantId(req.headers.get('host')), async () => {
  const slug = req.nextUrl.searchParams.get('slug') || DEFAULT_SLUG;
  const propertyId = await getPropertyId(slug);
  if (!propertyId) return NextResponse.json({ error: 'property_not_found' }, { status: 404 });
  const blocked = await getBlockedRanges(propertyId);
  return NextResponse.json({ blocked, updated: new Date().toISOString() });
});
}
