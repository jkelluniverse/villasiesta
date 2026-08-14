// Owner-set booking money: custom nightly rates, discounts, manual bookings.
// Mirrors quote-core's math (tax on lodging − discount + cleaning + pet) so an
// adjusted booking prices exactly like a quoted one. Every path that charges a
// priceCustom booking must use its STORED money — never recompute from rules.

import { db } from './dal';
import { loadPropertyPricing, advertisedNightly } from './pricing';
import { eachNight } from './dates';

const money2 = (n: number) => Math.round(n * 100) / 100;

export type AdjustedMoney = { subtotal: number; discount: number; cleaningFee: number; petFee: number; taxAmount: number; total: number };

/** Recompute a booking's money from owner-set parts (base price — card/ACH fees are added at charge time). */
export function computeAdjusted(input: {
  subtotal: number; discount: number; cleaningFee: number; petFee: number; taxPercent: number;
}): AdjustedMoney {
  const subtotal = money2(Math.max(0, input.subtotal));
  const discount = money2(Math.min(Math.max(0, input.discount), subtotal));
  const taxable = money2(subtotal - discount + input.cleaningFee + input.petFee);
  const taxAmount = input.taxPercent > 0 ? money2((taxable * input.taxPercent) / 100) : 0;
  return { subtotal, discount, cleaningFee: input.cleaningFee, petFee: input.petFee, taxAmount, total: money2(taxable + taxAmount) };
}

/** The base amount a guest owes on a booking (no card/ACH fee) — stored money for
 * priceCustom bookings, otherwise the caller should quote from rules. */
export function storedBaseTotal(b: { subtotal: number; discount: number; cleaningFee: number; petFee: number; taxAmount: number }): number {
  return money2(b.subtotal - b.discount + b.cleaningFee + b.petFee + b.taxAmount);
}

/** Property numbers a manual booking / price adjust needs. */
export async function loadOwnerPricing(slug: string): Promise<{
  propertyId: string; currency: string; taxPercent: number; cleaning: number; commissionPercent: number;
  nightlyFor: (dayKeys: { checkIn: string; checkOut: string }) => number;
} | null> {
  const loaded = await loadPropertyPricing(slug);
  if (!loaded) return null;
  const { pricing } = loaded;
  const meta = await db().property.findUnique({ where: { id: loaded.propertyId }, select: { commissionPercent: true } });
  return {
    propertyId: loaded.propertyId,
    currency: pricing.currency,
    taxPercent: pricing.fees.taxPercent,
    cleaning: pricing.fees.cleaning,
    commissionPercent: meta?.commissionPercent ?? 0,
    // Owner-facing pricing uses the ADVERTISED (uplifted) rate — same as guests see.
    nightlyFor: ({ checkIn, checkOut }) => {
      let sum = 0;
      for (const day of eachNight(checkIn, checkOut)) sum += advertisedNightly(day, pricing);
      return sum;
    },
  };
}

/** Tax percent for a property (for the adjust modal's live preview). */
export async function taxPercentFor(propertyId: string): Promise<number> {
  const fee = await db().fee.findFirst({ where: { propertyId, type: 'TAX_PERCENT' } });
  return fee?.amount ?? 0;
}
