import type { CommsType } from '@prisma/client';
import { db, tid } from './dal';

/** Fire-and-forget CommsLog write; never let logging break the calling flow. */
export async function logComms(clientId: string, type: CommsType, detail: string): Promise<void> {
  try { await db().commsLog.create({ data: { tenantId: tid(), clientId, type, detail } }); }
  catch (e) { console.error('[commslog]', e); }
}
