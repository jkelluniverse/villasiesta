import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { DEFAULT_SLUG } from '@/lib/property';
import { getLedger, ledgerToCsv } from '@/lib/ledger';

export const dynamic = 'force-dynamic';

/** Download a year's ledger as CSV (opens in Excel/Sheets). Session-gated. */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const year = Number(req.nextUrl.searchParams.get('year')) || undefined;
  const ledger = await getLedger(DEFAULT_SLUG, year);
  if (!ledger) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return new NextResponse(ledgerToCsv(ledger), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="villa-siesta-ledger-${ledger.year}.csv"`,
    },
  });
}
