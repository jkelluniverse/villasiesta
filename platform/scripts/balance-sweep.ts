// Daily balance sweep — CLI entry (`npm run sweep`). Logic lives in
// src/lib/sweeps.ts and is shared with the /api/cron endpoint.

import { prisma } from '../src/lib/db';
import { runBalanceSweep } from '../src/lib/sweeps';

runBalanceSweep()
  .then((r) => console.log('[sweep] done', JSON.stringify(r)))
  .catch((e) => { console.error('[sweep] fatal', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
