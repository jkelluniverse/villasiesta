// Daily arrival-email sweep — CLI entry (`npm run arrival-sweep`). Logic lives
// in src/lib/sweeps.ts and is shared with the /api/cron endpoint.

import { prisma } from '../src/lib/db';
import { runArrivalSweep } from '../src/lib/sweeps';

runArrivalSweep()
  .then((r) => console.log('[arrival-sweep] done', JSON.stringify(r)))
  .catch((e) => { console.error('[arrival-sweep] fatal', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
