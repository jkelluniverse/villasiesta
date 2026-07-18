// Hourly calendar sweep — CLI entry (`npm run calendar-sweep`): expire stale
// holds + Airbnb iCal sync. Logic lives in src/lib/sweeps.ts and is shared
// with the /api/cron endpoint.

import { prisma } from '../src/lib/db';
import { runCalendarSweep } from '../src/lib/sweeps';

runCalendarSweep()
  .then((r) => console.log('[cal-sweep] done', JSON.stringify(r)))
  .catch((e) => { console.error('[cal-sweep] fatal', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
