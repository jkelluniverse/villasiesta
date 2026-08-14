import { db, tid } from './dal';
import { PricingType } from '@prisma/client';
import { parseKey, toKey } from './dates';

// Owner rate overrides from the calendar. A CUSTOM rule prices [start, end)
// per night; quote-core's nightlyRate() already prefers CUSTOM over seasonal,
// so anything set here flows into guest quotes immediately.

/**
 * Set (price != null) or clear (price == null) the nightly override on
 * [startKey, endKey). Overlapping CUSTOM rules are split so the untouched
 * parts of their ranges keep their old price.
 */
export async function applyCustomRate(propertyId: string, startKey: string, endKey: string, price: number | null): Promise<void> {
  const start = parseKey(startKey);
  const end = parseKey(endKey);

  await db().$transaction(async (tx) => {
    const overlapping = await tx.pricingRule.findMany({
      where: {
        propertyId,
        type: PricingType.CUSTOM,
        startDate: { lt: end },
        endDate: { gt: start },
      },
    });

    for (const r of overlapping) {
      await tx.pricingRule.delete({ where: { id: r.id } });
      // Keep the pieces of the old rule that fall outside the edited range.
      if (r.startDate! < start) {
        await tx.pricingRule.create({
          data: { tenantId: tid(), propertyId, type: PricingType.CUSTOM, startDate: r.startDate, endDate: start, value: r.value, note: r.note },
        });
      }
      if (r.endDate! > end) {
        await tx.pricingRule.create({
          data: { tenantId: tid(), propertyId, type: PricingType.CUSTOM, startDate: end, endDate: r.endDate, value: r.value, note: r.note },
        });
      }
    }

    if (price != null) {
      await tx.pricingRule.create({
        data: { tenantId: tid(), propertyId, type: PricingType.CUSTOM, startDate: start, endDate: end, value: Math.round(price), note: `set from calendar ${toKey(new Date())}` },
      });
    }
  });
}
