// Pure pricing math — no server/prisma imports, safe to use in client components.
import { eachNight, nightsBetween, parseKey } from './dates';

export type Fees = {
  cleaning: number; pet: number; extraGuest: number; extraGuestAfter: number;
  taxPercent: number; cardPercent: number;
};

export type CustomRule = { start: string; end: string; type: 'CUSTOM' | 'MIN_NIGHTS'; value: number };

export type PropertyPricing = {
  currency: string;
  minNights: number;
  maxNights: number;
  seasonal: Record<number, number>;
  custom: CustomRule[];
  fees: Fees;
  rateRangeLabel: string;
};

export function nightlyRate(dayKey: string, seasonal: Record<number, number>, custom: CustomRule[]): number {
  for (const c of custom) if (c.type === 'CUSTOM' && dayKey >= c.start && dayKey < c.end) return c.value;
  const month = parseKey(dayKey).getUTCMonth() + 1;
  return seasonal[month] ?? 0;
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
};

export type QuoteInput = { checkIn: string; checkOut: string; guests: number; pet?: boolean; method?: 'ach' | 'card' };

export function computeQuote(p: PropertyPricing, input: QuoteInput): Quote {
  const nights = nightsBetween(input.checkIn, input.checkOut);
  const base: Quote = {
    ok: false, nights, subtotal: 0, cleaning: 0, pet: 0, extraGuest: 0, tax: 0, cardFee: 0,
    total: 0, lines: [], currency: p.currency, minNights: p.minNights,
  };
  if (!input.checkIn || !input.checkOut || nights <= 0) return { ...base, error: 'Select valid dates.' };

  const minN = minNightsFor(input.checkIn, p.minNights, p.custom);
  base.minNights = minN;
  if (nights < minN) return { ...base, error: `Minimum stay is ${minN} nights.` };
  if (nights > p.maxNights) return { ...base, error: `For stays over ${p.maxNights} nights, contact the owner.` };

  let subtotal = 0;
  for (const day of eachNight(input.checkIn, input.checkOut)) subtotal += nightlyRate(day, p.seasonal, p.custom);
  const avg = Math.round(subtotal / nights);

  const lines: QuoteLine[] = [{ label: `${avg} avg × ${nights} nights`, amount: subtotal }];
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
  return { ...base, ok: true, subtotal, cleaning, pet, extraGuest, tax, cardFee, total, lines };
}
