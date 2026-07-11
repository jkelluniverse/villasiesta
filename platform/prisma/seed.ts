import { PrismaClient, PricingType, FeeType, Role } from '@prisma/client';
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
  const property = await prisma.property.upsert({
    where: { slug: SLUG },
    update: {},
    create: {
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

  // Photos — reset to the manifest so re-seeding stays in sync
  await prisma.photo.deleteMany({ where: { propertyId: property.id } });
  await prisma.photo.createMany({
    data: photos.map((p) => ({
      propertyId: property.id,
      url: p.file,
      label: p.label,
      sublabel: p.sublabel || null,
      sortOrder: p.sortOrder,
    })),
  });

  // Seasonal pricing rules (one per month)
  await prisma.pricingRule.deleteMany({ where: { propertyId: property.id, type: PricingType.SEASONAL } });
  await prisma.pricingRule.createMany({
    data: Object.entries(SEASONAL).map(([month, value]) => ({
      propertyId: property.id,
      type: PricingType.SEASONAL,
      month: Number(month),
      value,
    })),
  });

  // Fees
  await prisma.fee.deleteMany({ where: { propertyId: property.id } });
  await prisma.fee.createMany({
    data: [
      { propertyId: property.id, type: FeeType.CLEANING, amount: 300 },
      { propertyId: property.id, type: FeeType.PET, amount: 250 },
      { propertyId: property.id, type: FeeType.EXTRA_GUEST, amount: 100, threshold: 6 },
      { propertyId: property.id, type: FeeType.TAX_PERCENT, amount: 0 },
      { propertyId: property.id, type: FeeType.CARD_FEE_PERCENT, amount: 3 },
    ],
  });

  // Owner user (password/login wired in the Auth phase)
  const ownerEmail = (process.env.OWNER_EMAIL || 'jacob@nicecityhomes.com').trim();
  await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: { email: ownerEmail, name: 'Jacob', role: Role.OWNER },
  });

  console.log(`Seeded property "${property.name}" with ${photos.length} photos, 12 seasonal rates, 5 fees.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
