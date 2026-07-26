// Pure pricing math — no server/prisma imports, safe to use in client components.
import { eachNight, nightsBetween, parseKey } from './dates';

export type Fees = {
  cleaning: number; pet: number; extraGuest: number; extraGuestAfter: number;
  taxPercent: number; cardPercent: number;
};

export type CustomRule = { start: string; end: string; type: 'CUSTOM' | 'MIN_NIGHTS'; value: number; upliftExempt?: boolean };

export type PropertyPricing = {
  currency: string;
  minNights: number;
  maxNights: number;
  seasonal: Record<number, number>;
  custom: CustomRule[];
  fees: Fees;
  rateRangeLabel: string;
  upliftPct: number;      // direct-rate uplift: advertised = base × (1 + pct/100)
  airbnbFeePct: number;   // assumed Airbnb guest service fee, for the savings estimate
};

/** BASE nightly (what's stored on the rate calendar). */
export function nightlyRate(dayKey: string, seasonal: Record<number, number>, custom: CustomRule[]): number {
  for (const c of custom) if (c.type === 'CUSTOM' && dayKey >= c.start && dayKey < c.end) return c.value;
  const month = parseKey(dayKey).getUTCMonth() + 1;
  return seasonal[month] ?? 0;
}

/** ADVERTISED nightly — what guests are quoted. Base rates carry the direct-rate
 * uplift; a CUSTOM override marked upliftExempt is advertised as-is. */
export function advertisedNightly(dayKey: string, p: Pick<PropertyPricing, 'seasonal' | 'custom' | 'upliftPct'>): number {
  for (const c of p.custom) {
    if (c.type === 'CUSTOM' && dayKey >= c.start && dayKey < c.end) {
      return c.upliftExempt ? c.value : Math.round(c.value * (1 + (p.upliftPct || 0) / 100));
    }
  }
  const month = parseKey(dayKey).getUTCMonth() + 1;
  const base = p.seasonal[month] ?? 0;
  return Math.round(base * (1 + (p.upliftPct || 0) / 100));
}

export function minNightsFor(checkInKey: string, propertyMin: number, custom: CustomRule[]): number {
  let min = propertyMin;
  for (const c of custom) if (c.type === 'MIN_NIGHTS' && checkInKey >= c.start && checkInKey < c.end) min = Math.max(min, c.value);
  return min;
}

export type QuoteLine = { label: string; amount: number };
export type Quote = {
  ok: boolean; error?: string; nights: number;
  subtotal: number; cleaning: number; pet: number; extraGuest: number; tax: number; cardFee: number;
  total: number; lines: QuoteLine[]; currency: string; minNights: number;
  airbnbEstimate?: number | null;   // ~what the same dates would run on Airbnb (labeled "estimated")
  savings?: number | null;          // airbnbEstimate − direct total, when positive
};

export type QuoteInput = {
  checkIn: string; checkOut: string; guests: number; pet?: boolean; method?: 'ach' | 'card';
  compNights?: number;   // 7-night compliance stay: guest pays these selected nights; the rest are complimentary
};

export function computeQuote(p: PropertyPricing, input: QuoteInput): Quote {
  const nights = nightsBetween(input.checkIn, input.checkOut);
  const base: Quote = {
    ok: false, nights, subtotal: 0, cleaning: 0, pet: 0, extraGuest: 0, tax: 0, cardFee: 0,
    total: 0, lines: [], currency: p.currency, minNights: p.minNights,
  };
  if (!input.checkIn || !input.checkOut || nights <= 0) return { ...base, error: 'Select valid dates.' };

  const minN = minNightsFor(input.checkIn, p.minNights, p.custom);
  base.minNights = minN;
  // A comp-stay quote prices the SELECTED nights (5–6) of a full-week reservation.
  const compOk = (input.compNights ?? 0) > 0 && minN <= 7 && nights >= 5;
  if (nights < minN && !compOk) return { ...base, error: `Minimum stay is ${minN} nights.` };
  if (nights > p.maxNights) return { ...base, error: `For stays over ${p.maxNights} nights, contact the owner.` };

  let subtotal = 0;
  let baseSubtotal = 0;   // at base (non-uplifted) rates — feeds the Airbnb comparison
  for (const day of eachNight(input.checkIn, input.checkOut)) {
    subtotal += advertisedNightly(day, p);
    baseSubtotal += nightlyRate(day, p.seasonal, p.custom);
  }
  const avg = Math.round(subtotal / nights);

  const lines: QuoteLine[] = [{ label: `${avg} avg × ${nights} nights`, amount: subtotal }];
  if (compOk) lines.push({ label: `Complimentary nights (${input.compNights}) — included`, amount: 0 });
  let total = subtotal;

  const cleaning = p.fees.cleaning;
  if (cleaning) { lines.push({ label: 'Cleaning fee', amount: cleaning }); total += cleaning; }

  let pet = 0;
  if (input.pet && p.fees.pet > 0) { pet = p.fees.pet; lines.push({ label: 'Pet fee', amount: pet }); total += pet; }

  let extraGuest = 0;
  if (p.fees.extraGuest > 0 && input.guests > p.fees.extraGuestAfter) {
    const extra = input.guests - p.fees.extraGuestAfter;
    extraGuest = extra * p.fees.extraGuest;
    lines.push({ label: `Extra guest (${extra} × ${p.fees.extraGuest})`, amount: extraGuest });
    total += extraGuest;
  }

  let tax = 0;
  if (p.fees.taxPercent > 0) { tax = Math.round(total * p.fees.taxPercent) / 100; lines.push({ label: `Tax (${p.fees.taxPercent}%)`, amount: tax }); total += tax; }

  let cardFee = 0;
  if (input.method === 'card' && p.fees.cardPercent > 0) {
    cardFee = Math.round(total * p.fees.cardPercent) / 100;
    lines.push({ label: `Card processing (${p.fees.cardPercent}%)`, amount: cardFee });
    total += cardFee;
  }

  total = Math.round(total);

  // Airbnb comparison: same dates at BASE rates + fees, plus the assumed guest
  // service fee, rounded to the nearest $10. Shown only when the guest saves.
  let airbnbEstimate: number | null = null;
  let savings: number | null = null;
  if (p.airbnbFeePct > 0) {
    const est = Math.round(((baseSubtotal + cleaning + pet) * (1 + p.airbnbFeePct / 100)) / 10) * 10;
    const save = est - total;
    if (save > 0) { airbnbEstimate = est; savings = save; }
  }

  return { ...base, ok: true, subtotal, cleaning, pet, extraGuest, tax, cardFee, total, lines, airbnbEstimate, savings };
}
