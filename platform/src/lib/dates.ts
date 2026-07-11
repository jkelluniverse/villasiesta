// All dates are handled as UTC calendar days ('yyyy-mm-dd'), checkout-exclusive,
// to avoid timezone drift between the browser, the server, and Postgres @db.Date.

export function toKey(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** Parse 'yyyy-mm-dd' to a UTC-midnight Date (safe for @db.Date columns). */
export function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(key: string, n: number): string {
  const d = parseKey(key);
  d.setUTCDate(d.getUTCDate() + n);
  return toKey(d);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((parseKey(checkOut).getTime() - parseKey(checkIn).getTime()) / 86400000);
}

export function todayKey(): string {
  return toKey(new Date());
}

/** Two [start,end) ranges overlap iff aStart < bEnd && aEnd > bStart. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function eachNight(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  let d = checkIn;
  while (d < checkOut) { out.push(d); d = addDays(d, 1); }
  return out;
}
