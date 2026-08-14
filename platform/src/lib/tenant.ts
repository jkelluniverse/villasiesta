// Tenant resolution — by Host header (spec §1.3).
// Priority: exact Domain row → {slug}.<PLATFORM_DOMAIN> wildcard → default
// tenant (preserves single-tenant behavior for localhost/unknown hosts until
// the platform marketing site exists).

import { headers } from 'next/headers';
import { prisma } from './db';

const PLATFORM_DOMAIN = (process.env.PLATFORM_DOMAIN || 'siestaengine.com').toLowerCase();
const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'villa-siesta';

type CacheHit = { tenantId: string; exp: number };
const cache = new Map<string, CacheHit>();
const TTL_MS = 60_000;

function normalizeHost(raw: string | null | undefined): string {
  return (raw || '').split(':')[0].trim().toLowerCase();
}

/** Host → tenantId. Throws if nothing resolves (misconfigured deployment). */
export async function resolveTenantId(hostRaw: string | null | undefined): Promise<string> {
  const host = normalizeHost(hostRaw);
  const hit = cache.get(host);
  if (hit && hit.exp > Date.now()) return hit.tenantId;

  let tenantId: string | null = null;

  if (host) {
    const dom = await prisma.domain.findUnique({ where: { hostname: host }, select: { tenantId: true } });
    if (dom) tenantId = dom.tenantId;
    if (!tenantId && host.endsWith(`.${PLATFORM_DOMAIN}`)) {
      const slug = host.slice(0, -(PLATFORM_DOMAIN.length + 1)).split('.').pop() || '';
      const t = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
      if (t) tenantId = t.id;
    }
  }

  if (!tenantId) {
    const t = await prisma.tenant.findUnique({ where: { slug: DEFAULT_TENANT_SLUG }, select: { id: true } });
    if (!t) throw new Error(`default tenant "${DEFAULT_TENANT_SLUG}" missing — run the seed`);
    tenantId = t.id;
  }

  cache.set(host, { tenantId, exp: Date.now() + TTL_MS });
  return tenantId;
}

/** For server components / server actions: tenant from the request's Host. */
export async function tenantIdFromHeaders(): Promise<string> {
  return resolveTenantId(headers().get('host'));
}
