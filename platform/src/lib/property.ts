import { db } from './dal';

// Legacy constant — kept for CLI scripts and single-tenant fallbacks. Tenant
// resolution (lib/tenant.ts) decides which tenant a request belongs to; the
// slug identifies a property WITHIN that tenant.
export const DEFAULT_SLUG = 'villa-siesta';

/** A property id within the current tenant (by slug, else the tenant's first). */
export async function getPropertyId(slug?: string): Promise<string | null> {
  const p = await db().property.findFirst({
    where: slug ? { slug } : {},
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return p?.id ?? null;
}
