// What a booking actually costs at payment time — THE single resolver used by
// every payment path (finalize page, Square charge, Instant ACH). Three cases:
//   priceCustom   → the owner set the money; charge the STORED amounts.
//   compNights>0  → a 7-night compliance reservation; quote the STAY nights
//                   (the guest pays the nights they use; the rest are comped).
//   otherwise     → a fresh quote over the full span.

import type { Booking } from '@prisma/client';
import { computeQuote, type PropertyPricing, type Quote, type QuoteLine } from './quote-core';
import { storedBaseTotal } from './owner-pricing';
import { toKey } from './dates';

export type BookingCharge = { ok: boolean; error?: string; baseTotal: number; lines: QuoteLine[] };

export function chargeForBooking(
  b: Pick<Booking, 'checkIn' | 'checkOut' | 'stayCheckIn' | 'stayCheckOut' | 'compNights' | 'guests' | 'petFee' | 'priceCustom' | 'subtotal' | 'discount' | 'cleaningFee' | 'taxAmount' | 'nights'>,
  pricing: PropertyPricing | null,
): BookingCharge {
  if (b.priceCustom) {
    const lines: QuoteLine[] = [
      { label: `${Math.round(b.subtotal / Math.max(1, b.nights))} avg × ${b.nights} nights`, amount: b.subtotal },
      ...(b.discount > 0 ? [{ label: 'Discount', amount: -b.discount }] : []),
      ...(b.cleaningFee > 0 ? [{ label: 'Cleaning fee', amount: b.cleaningFee }] : []),
      ...(b.petFee > 0 ? [{ label: 'Pet fee', amount: b.petFee }] : []),
      ...(b.taxAmount > 0 ? [{ label: 'Tax', amount: b.taxAmount }] : []),
    ];
    return { ok: true, baseTotal: storedBaseTotal(b), lines };
  }

  if (!pricing) return { ok: false, error: 'pricing_unavailable', baseTotal: 0, lines: [] };

  // Comp stays price the selected (stay) nights; everything else the full span.
  const comp = (b.compNights ?? 0) > 0 && b.stayCheckIn && b.stayCheckOut;
  const q: Quote = computeQuote(pricing, {
    checkIn: toKey(comp ? b.stayCheckIn! : b.checkIn),
    checkOut: toKey(comp ? b.stayCheckOut! : b.checkOut),
    guests: b.guests,
    pet: b.petFee > 0,
    method: 'ach',
    compNights: comp ? b.compNights : 0,
  });
  if (!q.ok) return { ok: false, error: q.error, baseTotal: 0, lines: [] };
  return { ok: true, baseTotal: q.total, lines: q.lines };
}
