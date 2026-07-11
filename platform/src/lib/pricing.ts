import { prisma } from './db';
import { FeeType, PricingType, type Prisma } from '@prisma/client';
import { toKey } from './dates';
import type { Fees, PropertyPricing } from './quote-core';

export * from './quote-core';

type RuleRow = Pick<Prisma.PricingRuleGetPayload<{}>, 'type' | 'month' | 'startDate' | 'endDate' | 'value'>;
type FeeRow = Pick<Prisma.FeeGetPayload<{}>, 'type' | 'amount' | 'threshold'>;

export function buildFees(feeRows: FeeRow[]): Fees {
  const get = (t: FeeType) => feeRows.find((f) => f.type === t);
  return {
    cleaning: get(FeeType.CLEANING)?.amount ?? 0,
    pet: get(FeeType.PET)?.amount ?? 0,
    extraGuest: get(FeeType.EXTRA_GUEST)?.amount ?? 0,
    extraGuestAfter: get(FeeType.EXTRA_GUEST)?.threshold ?? 6,
    taxPercent: get(FeeType.TAX_PERCENT)?.amount ?? 0,
    cardPercent: get(FeeType.CARD_FEE_PERCENT)?.amount ?? 3,
  };
}

export function seasonalMap(ruleRows: RuleRow[]): Record<number, number> {
  const map: Record<number, number> = {};
  ruleRows.filter((r) => r.type === PricingType.SEASONAL && r.month)
    .forEach((r) => { map[r.month as number] = r.value ?? 0; });
  return map;
}

/** Load a property's full pricing (seasonal + custom + fees) for quoting. */
export async function loadPropertyPricing(slug: string): Promise<{ propertyId: string; pricing: PropertyPricing } | null> {
  const property = await prisma.property.findUnique({
    where: { slug },
    include: { pricingRules: true, fees: true },
  });
  if (!property) return null;

  const seasonal = seasonalMap(property.pricingRules);
  const custom = property.pricingRules
    .filter((r) => (r.type === PricingType.CUSTOM || r.type === PricingType.MIN_NIGHTS) && r.startDate && r.endDate && r.value != null)
    .map((r) => ({
      start: toKey(r.startDate as Date),
      end: toKey(r.endDate as Date),
      type: r.type as 'CUSTOM' | 'MIN_NIGHTS',
      value: r.value as number,
    }));
  const rates = Object.values(seasonal).filter((n) => n > 0);
  const rateRangeLabel = rates.length ? `${property.currency}${Math.min(...rates)}–${property.currency}${Math.max(...rates)}` : '';

  return {
    propertyId: property.id,
    pricing: { currency: property.currency, minNights: property.minNights, maxNights: property.maxNights, seasonal, custom, fees: buildFees(property.fees), rateRangeLabel },
  };
}
