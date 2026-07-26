// 7-night compliance stays — pure planning logic, shared by the booking
// widget (client, using its blocked-date set) and the API (server, using
// isRangeAvailable). The property's minimum is 7 nights; a guest wanting 5 or
// 6 books a genuine 7-night reservation at a special rate: the full span is
// blocked here and on Airbnb, and the unused nights are complimentary.

import { addDays, nightsBetween } from './dates';

export const FULL_MIN_NIGHTS = 7;
export const COMP_MIN_NIGHTS = 5;

export type CompSide = 'after' | 'before';

export type StayPlan =
  | {
      ok: true;
      checkIn: string; checkOut: string;         // the full reservation (blocked everywhere)
      stayCheckIn: string; stayCheckOut: string; // the nights the guest will use
      compNights: number;
      side: CompSide | null;                     // which side carries the free nights
      canFlip: boolean;                          // the other side would also work
    }
  | { ok: false; error: string; suggestion?: string };

export type IsFree = (startKey: string, endKey: string) => boolean;

/**
 * Turn a selected [checkIn, checkOut) into a bookable reservation.
 * ≥7 selected nights pass through unchanged; 5–6 get extended to a full week
 * on the requested side (falling back to the other). If neither side is clear,
 * suggest the first date from which a full open week exists.
 */
export function planCompStay(input: {
  checkIn: string; checkOut: string;
  side?: CompSide;
  isFree: IsFree;
  todayKey: string;
}): StayPlan {
  const { checkIn, checkOut, isFree } = input;
  const nights = nightsBetween(checkIn, checkOut);
  if (nights <= 0) return { ok: false, error: 'Select valid dates.' };

  if (nights >= FULL_MIN_NIGHTS) {
    if (!isFree(checkIn, checkOut)) return { ok: false, error: 'Those dates are no longer available.' };
    return { ok: true, checkIn, checkOut, stayCheckIn: checkIn, stayCheckOut: checkOut, compNights: 0, side: null, canFlip: false };
  }
  if (nights < COMP_MIN_NIGHTS) {
    return { ok: false, error: `Minimum stay is ${FULL_MIN_NIGHTS} nights (special ${COMP_MIN_NIGHTS}–6 night reservations available).` };
  }

  const ext = FULL_MIN_NIGHTS - nights;
  const afterSpan = { checkIn, checkOut: addDays(checkOut, ext) };
  const beforeSpan = { checkIn: addDays(checkIn, -ext), checkOut };
  const afterOk = isFree(afterSpan.checkIn, afterSpan.checkOut);
  const beforeOk = beforeSpan.checkIn >= input.todayKey && isFree(beforeSpan.checkIn, beforeSpan.checkOut);

  const preferred: CompSide = input.side ?? 'after';
  const pick: CompSide | null =
    preferred === 'after' ? (afterOk ? 'after' : beforeOk ? 'before' : null)
                          : (beforeOk ? 'before' : afterOk ? 'after' : null);

  if (pick) {
    const span = pick === 'after' ? afterSpan : beforeSpan;
    return {
      ok: true,
      checkIn: span.checkIn, checkOut: span.checkOut,
      stayCheckIn: checkIn, stayCheckOut: checkOut,
      compNights: ext, side: pick,
      canFlip: afterOk && beforeOk,
    };
  }

  // Neither side completes a free-and-clear week — find the next full week.
  let suggestion: string | undefined;
  for (let i = -ext; i <= 45; i++) {
    const s = addDays(checkIn, i);
    if (s < input.todayKey) continue;
    if (isFree(s, addDays(s, FULL_MIN_NIGHTS))) { suggestion = s; break; }
  }
  return {
    ok: false,
    error: `These dates can’t accommodate a ${nights}-night stay${suggestion ? ` — the full week is available starting ${suggestion}` : ''}.`,
    suggestion,
  };
}
