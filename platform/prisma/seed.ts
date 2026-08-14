import { PrismaClient, PricingType, FeeType, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import photos from './photos.json';

const prisma = new PrismaClient();

const SLUG = 'villa-siesta';

// Seasonal nightly rates by month (Sarasota seasons).
// Peak winter/spring (Dec–Apr) 380 · shoulder (May/Oct/Nov) 320 · low summer (Jun–Sep) 275.
const SEASONAL: Record<number, number> = {
  1: 380, 2: 380, 3: 380, 4: 380, 5: 320, 6: 275,
  7: 275, 8: 275, 9: 275, 10: 320, 11: 320, 12: 380,
};

async function main() {
  // Tenant #1 — Villa Siesta (multi-tenant foundation; id matches the
  // backfill migration so fresh and migrated databases align).
  const tenant = await prisma.tenant.upsert({
    where: { slug: SLUG },
    update: {},
    create: { id: 'tnt_villa_siesta', slug: SLUG, name: 'Villa Siesta', status: 'ACTIVE' },
  });
  for (const [id, hostname, isPrimary] of [
    ['dom_vs_primary', 'villasiestasarasota.com', true],
    ['dom_vs_www', 'www.villasiestasarasota.com', false],
  ] as const) {
    await prisma.domain.upsert({ where: { hostname }, update: {}, create: { id, tenantId: tenant.id, hostname, isPrimary } });
  }

  const property = await prisma.property.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: SLUG } },
    update: {},
    create: {
      tenantId: tenant.id,
      slug: SLUG,
      name: 'Villa Siesta',
      location: 'Downtown Sarasota, Florida',
      bedrooms: 3,
      bathrooms: 2.5,
      sleeps: 6,
      description:
        'A brand-new private-pool home in downtown Sarasota — three bedrooms, ' +
        'two and a half baths, sleeps six. Walkable to downtown and a short drive ' +
        'to St. Armands, Lido, and the Siesta Key beaches. Book direct and skip the fees.',
      minNights: 7,
      maxNights: 20,
      checkinTime: '4:00 PM',
      checkoutTime: '10:00 AM',
      cancellation: 'Flexible',
      bookingMode: 'request',
      currency: '$',
      airbnbIcalUrl: process.env.AIRBNB_ICAL_URL || null,
    },
  });

  // Idempotent: only seed reference data the first time, so re-running on every
  // deploy never wipes owner edits (prices/fees changed later in the portal).

  if ((await prisma.photo.count({ where: { propertyId: property.id } })) === 0) {
    await prisma.photo.createMany({
      data: photos.map((p) => ({
        tenantId: tenant.id, propertyId: property.id, url: p.file, label: p.label, sublabel: p.sublabel || null, sortOrder: p.sortOrder,
      })),
    });
  }

  if ((await prisma.pricingRule.count({ where: { propertyId: property.id, type: PricingType.SEASONAL } })) === 0) {
    await prisma.pricingRule.createMany({
      data: Object.entries(SEASONAL).map(([month, value]) => ({
        tenantId: tenant.id, propertyId: property.id, type: PricingType.SEASONAL, month: Number(month), value,
      })),
    });
  }

  if ((await prisma.fee.count({ where: { propertyId: property.id } })) === 0) {
    await prisma.fee.createMany({
      data: [
        { tenantId: tenant.id, propertyId: property.id, type: FeeType.CLEANING, amount: 300 },
        { tenantId: tenant.id, propertyId: property.id, type: FeeType.PET, amount: 250 },
        { tenantId: tenant.id, propertyId: property.id, type: FeeType.EXTRA_GUEST, amount: 100, threshold: 6 },
        { tenantId: tenant.id, propertyId: property.id, type: FeeType.TAX_PERCENT, amount: 0 },
        { tenantId: tenant.id, propertyId: property.id, type: FeeType.CARD_FEE_PERCENT, amount: 3 },
      ],
    });
  }

  // Owner user + login. Set OWNER_PASSWORD in the env to control the portal password.
  const ownerEmail = (process.env.OWNER_EMAIL || 'jacob@nicecityhomes.com').trim().toLowerCase();
  const ownerPassword = process.env.OWNER_PASSWORD || 'changeme-owner';
  const ownerHash = await bcrypt.hash(ownerPassword, 10);
  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: { passwordHash: ownerHash, role: Role.OWNER },
    create: { email: ownerEmail, name: 'Jacob', role: Role.OWNER, passwordHash: ownerHash },
  });
  await prisma.tenantUser.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: owner.id } },
    update: { role: Role.OWNER },
    create: { tenantId: tenant.id, userId: owner.id, role: Role.OWNER },
  });

  // Optional read-only viewer (dad). Set DAD_EMAIL + DAD_PASSWORD to enable.
  const dadEmail = (process.env.DAD_EMAIL || '').trim().toLowerCase();
  if (dadEmail && process.env.DAD_PASSWORD) {
    const dadHash = await bcrypt.hash(process.env.DAD_PASSWORD, 10);
    const dad = await prisma.user.upsert({
      where: { email: dadEmail },
      update: { passwordHash: dadHash, role: Role.VIEWER },
      create: { email: dadEmail, name: 'Dad', role: Role.VIEWER, passwordHash: dadHash },
    });
    await prisma.tenantUser.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: dad.id } },
      update: { role: Role.VIEWER },
      create: { tenantId: tenant.id, userId: dad.id, role: Role.VIEWER },
    });
  }

  console.log(`Seeded property "${property.name}" with ${photos.length} photos, 12 seasonal rates, 5 fees.`);
  console.log(`Owner login: ${ownerEmail} / (OWNER_PASSWORD env${process.env.OWNER_PASSWORD ? '' : ' — default "changeme-owner"'})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
