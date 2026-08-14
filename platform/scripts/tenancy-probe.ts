// Cross-tenant isolation probe (spec §8): creates a throwaway tenant B with a
// property + booking, then verifies from tenant A's context that B's rows are
// invisible and untouchable through the DAL. Exits 1 on any leak.
// Run: npx tsx scripts/tenancy-probe.ts

import { prisma } from '../src/lib/db';
import { db, withTenant } from '../src/lib/dal';

const A_SLUG = process.env.DEFAULT_TENANT_SLUG || 'villa-siesta';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  const tenantA = await prisma.tenant.findUniqueOrThrow({ where: { slug: A_SLUG } });
  const tenantB = await prisma.tenant.create({ data: { slug: `probe-${Math.random().toString(36).slice(2, 8)}`, name: 'Probe Tenant B' } });

  const propB = await prisma.property.create({
    data: {
      tenantId: tenantB.id, slug: 'probe-house', name: 'Probe House', location: 'Nowhere',
      bedrooms: 1, bathrooms: 1, sleeps: 2, description: 'probe',
    },
  });
  const clientB = await prisma.client.create({
    data: { tenantId: tenantB.id, email: 'probe-guest@example.com', firstName: 'Probe', lastName: 'Guest' },
  });
  const bookingB = await prisma.booking.create({
    data: {
      tenantId: tenantB.id, reference: 'ZZ-PROB', propertyId: propB.id, clientId: clientB.id,
      checkIn: new Date('2030-01-01'), checkOut: new Date('2030-01-08'), nights: 7, guests: 2,
      subtotal: 700, total: 700,
    },
  });

  try {
    await withTenant(tenantA.id, async () => {
      // Reads
      const props = await db().property.findMany({ select: { tenantId: true } });
      check('findMany never returns tenant B rows', props.every((p) => p.tenantId === tenantA.id), `${props.length} rows, all tenant A`);

      const direct = await db().booking.findUnique({ where: { id: bookingB.id } });
      check("findUnique on B's booking id returns null", direct === null);

      const byRef = await db().booking.findUnique({ where: { reference: 'ZZ-PROB' } });
      check("findUnique on B's reference returns null", byRef === null);

      const count = await db().booking.count({ where: { reference: 'ZZ-PROB' } });
      check("count can't see B's booking", count === 0);

      // Unique mutations
      let denied = false;
      try { await db().booking.update({ where: { id: bookingB.id }, data: { guests: 99 } }); }
      catch (e) { denied = (e as Error).message === 'cross_tenant_denied'; }
      check("update on B's booking is denied", denied);

      denied = false;
      try { await db().property.delete({ where: { id: propB.id } }); }
      catch (e) { denied = (e as Error).message === 'cross_tenant_denied'; }
      check("delete on B's property is denied", denied);

      // Bulk mutations silently scope to A
      const upd = await db().booking.updateMany({ where: { reference: 'ZZ-PROB' }, data: { guests: 99 } });
      check("updateMany can't reach B's rows", upd.count === 0);

      // Creates stamp tenant A even if the caller lies
      const stamped = await db().client.create({
        data: { tenantId: tenantB.id, email: 'probe-liar@example.com', firstName: 'Liar', lastName: 'Probe' } as never,
      });
      check('create overrides a forged tenantId with the context tenant', (stamped as { tenantId: string }).tenantId === tenantA.id);
      await prisma.client.delete({ where: { id: (stamped as { id: string }).id } });
    });

    const untouched = await prisma.booking.findUniqueOrThrow({ where: { id: bookingB.id } });
    check("tenant B's booking is unmodified", untouched.guests === 2);
  } finally {
    await prisma.tenant.delete({ where: { id: tenantB.id } });   // cascades B's rows
  }

  console.log(failures ? `\n✗ ${failures} isolation failure(s)` : '\n✓ Cross-tenant isolation holds.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
