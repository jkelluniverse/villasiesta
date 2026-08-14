import { db, tid } from './dal';
import { BlockSource } from '@prisma/client';
import { addDays, parseKey, toKey } from './dates';

// Airbnb iCal sync: pull each property's export feed and mirror its events as
// AIRBNB calendar blocks. Full-replace per sync (the feed is the source of
// truth for Airbnb-side reservations), never touching OWNER/BOOKING blocks.
// Runs under a tenant context; syncs every property with a feed configured.

export type SyncResult = { ok: boolean; imported?: number; removed?: number; error?: string };

/** Minimal iCal VEVENT parser — DTSTART/DTEND (DATE or DATE-TIME) + SUMMARY. */
export function parseIcs(ics: string): { start: string; end: string; summary: string }[] {
  const out: { start: string; end: string; summary: string }[] = [];
  // Unfold continuation lines (RFC 5545 §3.1) and normalize newlines.
  const unfolded = ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const get = (name: string) => {
      const m = new RegExp(`^${name}[^:\\n]*:(.+)$`, 'mi').exec(body);
      return m ? m[1].trim() : '';
    };
    const toDay = (v: string) => {
      const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    };
    const start = toDay(get('DTSTART'));
    let end = toDay(get('DTEND'));
    if (!start) continue;
    if (!end) end = addDays(start, 1);          // zero-length safety
    if (end <= start) end = addDays(start, 1);
    out.push({ start, end, summary: get('SUMMARY') || 'Airbnb' });
  }
  return out;
}

/** Sync every feed-configured property of the CURRENT tenant. */
export async function syncAirbnb(): Promise<SyncResult> {
  const properties = await db().property.findMany({
    where: { airbnbIcalUrl: { not: null } },
    select: { id: true, airbnbIcalUrl: true },
  });
  if (!properties.length) return { ok: true, imported: 0, removed: 0 };   // nothing configured — no-op

  let imported = 0, removed = 0;
  for (const property of properties) {
    let events: { start: string; end: string; summary: string }[];
    try {
      const res = await fetch(property.airbnbIcalUrl!, { headers: { 'User-Agent': 'SiestaEngine/1.0' } });
      if (!res.ok) throw new Error(`feed responded ${res.status}`);
      events = parseIcs(await res.text());
    } catch (e) {
      const msg = (e as Error).message || 'fetch_failed';
      await db().syncLog.create({ data: { tenantId: tid(), propertyId: property.id, status: 'error', message: msg } });
      return { ok: false, error: msg };
    }

    // Ignore past events; keep the calendar forward-looking.
    const today = toKey(new Date());
    const future = events.filter((e) => e.end > today);

    const r = await db().$transaction(async (tx) => {
      const del = await tx.calendarBlock.deleteMany({ where: { propertyId: property.id, source: BlockSource.AIRBNB } });
      for (const e of future) {
        await tx.calendarBlock.create({
          data: { tenantId: tid(), propertyId: property.id, startDate: parseKey(e.start), endDate: parseKey(e.end), source: BlockSource.AIRBNB, summary: e.summary },
        });
      }
      return del.count;
    });
    removed += r;
    imported += future.length;
    await db().syncLog.create({ data: { tenantId: tid(), propertyId: property.id, status: 'healthy', message: `${future.length} event(s) imported` } });
  }

  return { ok: true, imported, removed };
}
