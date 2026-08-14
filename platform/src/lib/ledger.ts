import { BookingStatus } from '@prisma/client';
import { db, tid } from './dal';
import { toKey } from './dates';

// The money view. Revenue rows are stays with money actually in motion —
// PAID and PARTIALLY_PAID — grouped by CHECK-IN month (the "payout on
// arrival" convention the dashboard already uses).
//
// Distribution waterfall per booking:
//   Gross booking revenue → − processing fees → − tax collected (remitted)
//   → − management commission (snapshot) → Owner net.
// Cleaning stays inside gross (the owner pays the cleaner); it's still broken
// out as a column for that accounting.

export type LedgerRow = {
  id: string;
  reference: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: BookingStatus;
  gross: number;
  cleaning: number;      // informational (inside gross)
  tax: number;
  processing: number;
  commission: number;
  commissionSettled: boolean;
  net: number;
  collected: number;     // what's actually been received so far
};

export type LedgerTotals = { gross: number; cleaning: number; tax: number; processing: number; commission: number; commissionSettled: number; net: number; collected: number; count: number };

export type LedgerMonth = { key: string; label: string; rows: LedgerRow[]; totals: LedgerTotals };

export type Ledger = {
  currency: string;
  year: number;
  years: number[];       // every year with at least one revenue row
  months: LedgerMonth[]; // newest first, only months with rows
  ytd: LedgerTotals;
};

const money2 = (n: number) => Math.round(n * 100) / 100;

export function netOf(b: { total: number; taxAmount: number; cardFee: number; commissionAmount: number }): number {
  return money2(b.total - b.cardFee - b.taxAmount - b.commissionAmount);
}

function collectedOf(b: { status: BookingStatus; total: number; depositAmount: number | null; balancePaid: boolean }): number {
  if (b.status === BookingStatus.PAID) return b.total;
  if (b.status === BookingStatus.PARTIALLY_PAID) return b.balancePaid ? b.total : (b.depositAmount ?? b.total / 2);
  return 0;
}

const zero = (): LedgerTotals => ({ gross: 0, cleaning: 0, tax: 0, processing: 0, commission: 0, commissionSettled: 0, net: 0, collected: 0, count: 0 });

function add(t: LedgerTotals, r: LedgerRow): void {
  t.gross = money2(t.gross + r.gross);
  t.cleaning = money2(t.cleaning + r.cleaning);
  t.tax = money2(t.tax + r.tax);
  t.processing = money2(t.processing + r.processing);
  t.commission = money2(t.commission + r.commission);
  if (r.commissionSettled) t.commissionSettled = money2(t.commissionSettled + r.commission);
  t.net = money2(t.net + r.net);
  t.collected = money2(t.collected + r.collected);
  t.count += 1;
}

export async function getLedger(slug: string, year?: number): Promise<Ledger | null> {
  const property = await db().property.findFirst({ where: { slug }, select: { id: true, currency: true } });
  if (!property) return null;

  const bookings = await db().booking.findMany({
    where: { propertyId: property.id, status: { in: [BookingStatus.PAID, BookingStatus.PARTIALLY_PAID] } },
    include: { client: true },
    orderBy: { checkIn: 'desc' },
  });

  const rows: LedgerRow[] = bookings.map((b) => ({
    id: b.id,
    reference: b.reference,
    guestName: `${b.client.firstName} ${b.client.lastName}`.trim(),
    checkIn: toKey(b.checkIn),
    checkOut: toKey(b.checkOut),
    nights: b.nights,
    status: b.status,
    gross: money2(b.total),
    cleaning: money2(b.cleaningFee),
    tax: money2(b.taxAmount),
    processing: money2(b.cardFee),
    commission: money2(b.commissionAmount),
    commissionSettled: b.commissionSettled,
    net: netOf(b),
    collected: money2(collectedOf(b)),
  }));

  const years = Array.from(new Set(rows.map((r) => Number(r.checkIn.slice(0, 4))))).sort((a, b) => b - a);
  const activeYear = year && years.includes(year) ? year : (years[0] ?? new Date().getUTCFullYear());

  const inYear = rows.filter((r) => Number(r.checkIn.slice(0, 4)) === activeYear);
  const byMonth = new Map<string, LedgerRow[]>();
  for (const r of inYear) {
    const key = r.checkIn.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(r);
  }

  const months: LedgerMonth[] = Array.from(byMonth.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, mrows]) => {
      const totals = zero();
      mrows.forEach((r) => add(totals, r));
      const [y, m] = key.split('-').map(Number);
      return { key, label: new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), rows: mrows, totals };
    });

  const ytd = zero();
  inYear.forEach((r) => add(ytd, r));

  return { currency: property.currency, year: activeYear, years, months, ytd };
}

/** CSV of a year's ledger — one row per booking + month subtotal rows. */
export function ledgerToCsv(ledger: Ledger): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const row = (label: string, r: { count?: number } & Omit<LedgerRow, 'id' | 'reference' | 'guestName' | 'checkIn' | 'checkOut' | 'nights' | 'status' | 'commissionSettled'>, extra: string[] = ['', '', '', '', '', '']) =>
    [label, ...extra, r.gross.toFixed(2), r.cleaning.toFixed(2), r.tax.toFixed(2), r.processing.toFixed(2), r.commission.toFixed(2), r.net.toFixed(2), r.collected.toFixed(2)].join(',');
  const lines = ['Month,Reference,Guest,Check-in,Check-out,Nights,Status,Gross,Cleaning,Tax,Processing,Commission,Net,Collected'];
  for (const m of ledger.months) {
    for (const r of m.rows) {
      lines.push(row(m.label, r, [r.reference, esc(r.guestName), r.checkIn, r.checkOut, String(r.nights), r.status]));
    }
    lines.push(row(`${m.label} total`, m.totals, ['', '', '', '', String(m.totals.count), '']));
  }
  lines.push(row(`${ledger.year} total`, ledger.ytd, ['', '', '', '', String(ledger.ytd.count), '']));
  return lines.join('\r\n') + '\r\n';
}
