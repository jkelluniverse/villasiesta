import { NextRequest, NextResponse } from 'next/server';
import { runBalanceSweepAllTenants, runArrivalSweepAllTenants, runCalendarSweepAllTenants } from '@/lib/sweeps';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;   // sweeps send emails/charge cards — give them room

// External-cron entry point. Protected by CRON_SECRET (Railway env var):
//   GET /api/cron/all?key=<CRON_SECRET>        — run everything (safe: all idempotent)
//   GET /api/cron/balance?key=...              — charge due split balances
//   GET /api/cron/arrival?key=...              — pre-arrival emails
//   GET /api/cron/calendar?key=...             — expire holds + Airbnb sync
// The secret is also accepted as `Authorization: Bearer <CRON_SECRET>`.
export async function GET(req: NextRequest, { params }: { params: { job: string } }) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return NextResponse.json({ error: 'cron_disabled', message: 'Set CRON_SECRET to enable the cron endpoint.' }, { status: 503 });

  const given = req.nextUrl.searchParams.get('key')
    || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const job = params.job;
  const startedAt = new Date().toISOString();
  try {
    if (job === 'balance') return NextResponse.json({ ok: true, job, startedAt, result: await runBalanceSweepAllTenants() });
    if (job === 'arrival') return NextResponse.json({ ok: true, job, startedAt, result: await runArrivalSweepAllTenants() });
    if (job === 'calendar') return NextResponse.json({ ok: true, job, startedAt, result: await runCalendarSweepAllTenants() });
    if (job === 'all') {
      // Order matters: settle money first, then holds/sync, then arrival emails.
      const balance = await runBalanceSweepAllTenants();
      const calendar = await runCalendarSweepAllTenants();
      const arrival = await runArrivalSweepAllTenants();
      return NextResponse.json({ ok: true, job, startedAt, result: { balance, calendar, arrival } });
    }
    return NextResponse.json({ error: 'unknown_job', available: ['all', 'balance', 'arrival', 'calendar'] }, { status: 404 });
  } catch (e) {
    console.error(`[cron:${job}] failed`, e);
    return NextResponse.json({ ok: false, job, error: (e as Error).message }, { status: 500 });
  }
}
