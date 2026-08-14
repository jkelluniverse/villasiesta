// Daily arrival-email sweep — CLI entry (`npm run arrival-sweep`). Logic lives
// in src/lib/sweeps.ts and is shared with the /api/cron endpoint.

import { prisma } from '../src/lib/db';
import { runArrivalSweepAllTenants } from '../src/lib/sweeps';

runArrivalSweepAllTenants()
  .then((r) => console.log('[arrival-sweep] done', JSON.stringify(r)))
  .catch((e) => { console.error('[arrival-sweep] fatal', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
