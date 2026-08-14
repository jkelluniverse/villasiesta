#!/usr/bin/env node
// Tenancy CI guard (spec §1.1): tenant-scoped code must go through the DAL —
// raw `prisma.` access is allowed only in the files below, each with a reason.
// Runs as `prebuild`, so a violation fails the deploy, not production.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ALLOW = new Map([
  ['src/lib/db.ts', 'the raw client itself'],
  ['src/lib/dal.ts', 'builds the tenant-scoped client'],
  ['src/lib/tenant.ts', 'host→tenant resolution (Domain/Tenant are platform-scope)'],
  ['src/lib/auth.ts', 'User is platform-scope'],
  ['src/lib/reference.ts', 'booking references are globally unique across tenants'],
  ['src/lib/sweeps.ts', 'tenant iterator (fleet loop) only'],
  ['src/app/owner/actions.ts', 'User/TenantUser membership checks only'],
  ['src/app/api/square/webhook/route.ts', 'pre-resolution booking match (events carry no host)'],
]);

const root = 'src';
const offenders = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) check(p);
  }
}

function check(path) {
  const rel = path.replace(/\\/g, '/');
  const src = readFileSync(path, 'utf8');
  const usesRaw = /\bprisma\.(?!\$disconnect)/.test(src) || /from '(@\/lib\/db|\.\.?\/db)'/.test(src);
  if (!usesRaw) return;
  if (ALLOW.has(rel)) return;
  offenders.push(rel);
}

walk(root);

if (offenders.length) {
  console.error('✗ Tenancy guard: raw prisma access outside the allowlist.');
  console.error('  Route these through db() from @/lib/dal (or add an allowlist entry WITH a reason):');
  for (const f of offenders) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ Tenancy guard: all tenant-scoped queries go through the DAL (${ALLOW.size} allowlisted platform-scope files).`);
