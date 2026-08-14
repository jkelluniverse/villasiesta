// The DAL (spec §1.1): ALL tenant-scoped queries go through db(), which runs
// under a tenant context (AsyncLocalStorage) and injects the tenant filter on
// every operation. Raw `prisma` from './db' is allowed only for platform-scope
// models (User, Tenant, Domain, TenantUser) and explicitly allowlisted files —
// scripts/check-tenancy.mjs enforces this at build time.

import { AsyncLocalStorage } from 'node:async_hooks';
import { prisma } from './db';

// Every model that carries tenantId. Platform-scope models (User, Tenant,
// Domain, TenantUser) are intentionally absent — the DAL passes them through.
const TENANT_MODELS = new Set([
  'Property', 'Photo', 'PricingRule', 'Fee', 'Client', 'Booking',
  'CalendarBlock', 'SyncLog', 'CommsLog', 'ManualPayment', 'AchAuthorization',
  'Branding', 'SiteContent', 'SquareAccount', 'PlanFee', 'PlatformInvoice',
]);

const als = new AsyncLocalStorage<{ tenantId: string }>();

/** Run fn with a tenant context; everything inside sees db() scoped to it. */
export function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return als.run({ tenantId }, fn);
}

/** The current tenant id — throws outside a tenant context (fail closed). */
export function tid(): string {
  const s = als.getStore();
  if (!s) throw new Error('tenant_context_missing — wrap the entrypoint in withTenant()');
  return s.tenantId;
}

export function inTenantContext(): boolean {
  return !!als.getStore();
}

type AnyArgs = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
};

function lcFirst(s: string): string { return s[0].toLowerCase() + s.slice(1); }

function makeClient(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const a = args as AnyArgs;

          switch (operation) {
            // Filterable reads + bulk writes: AND the tenant in.
            case 'findMany': case 'findFirst': case 'findFirstOrThrow':
            case 'count': case 'aggregate': case 'groupBy':
            case 'updateMany': case 'deleteMany': {
              a.where = { AND: [{ tenantId }, a.where ?? {}] };
              return query(a);
            }
            // Creates: stamp the tenant (overrides anything the caller passed).
            case 'create': {
              a.data = { ...(a.data as Record<string, unknown>), tenantId };
              return query(a);
            }
            case 'createMany': {
              const rows = Array.isArray(a.data) ? a.data : [a.data];
              a.data = rows.map((d) => ({ ...(d as Record<string, unknown>), tenantId }));
              return query(a);
            }
            // Unique reads: run, then verify ownership.
            case 'findUnique': case 'findUniqueOrThrow': {
              const res = (await query(a)) as { tenantId?: string } | null;
              if (res && res.tenantId !== undefined && res.tenantId !== tenantId) {
                if (operation === 'findUniqueOrThrow') throw new Error('not_found');
                return null;
              }
              return res;
            }
            // Unique mutations: verify the target row belongs to this tenant first.
            case 'update': case 'delete': case 'upsert': {
              const delegate = (prisma as unknown as Record<string, { findUnique: (q: unknown) => Promise<{ tenantId?: string } | null> }>)[lcFirst(model)];
              const existing = await delegate.findUnique({ where: a.where, select: { tenantId: true } }).catch(() => null);
              if (existing && existing.tenantId !== tenantId) throw new Error('cross_tenant_denied');
              if (operation === 'upsert' && a.create) a.create = { ...a.create, tenantId };
              return query(a);
            }
            default:
              return query(a);
          }
        },
      },
    },
  });
}

type TenantClient = ReturnType<typeof makeClient>;
const clients = new Map<string, TenantClient>();

/** The tenant-scoped Prisma client for the current context. */
export function db(): TenantClient {
  const t = tid();
  let c = clients.get(t);
  if (!c) { c = makeClient(t); clients.set(t, c); }
  return c;
}
