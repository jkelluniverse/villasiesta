import { prisma } from './db';
import type { CommsType } from '@prisma/client';

/** Fire-and-forget CommsLog write; never let logging break the calling flow. */
export async function logComms(clientId: string, type: CommsType, detail: string): Promise<void> {
  try { await prisma.commsLog.create({ data: { clientId, type, detail } }); }
  catch (e) { console.error('[commslog]', e); }
}
