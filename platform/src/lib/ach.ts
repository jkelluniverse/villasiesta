// Instant ACH — SERVER half: AES-256-GCM encryption of bank details.
// Validation + authorization language live in ach-shared.ts (client-safe).
// Square never sees these numbers: the owner originates the debit at the bank
// and settlement is recorded through the manual-reconciliation flow.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export * from './ach-shared';

// Key from ACH_ENC_KEY (32 bytes, base64). Ciphertext format:
// base64(iv).base64(tag).base64(data) — self-contained, no extra columns.
function key(): Buffer {
  const raw = process.env.ACH_ENC_KEY || '';
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('ACH_ENC_KEY missing or not 32 bytes base64 — generate with: openssl rand -base64 32');
  return buf;
}

export function achConfigured(): boolean {
  try { key(); return true; } catch { return false; }
}

export type BankDetails = { routing: string; account: string; type: 'checking' | 'savings' };

export function encryptBankDetails(details: BankDetails): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(details), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${data.toString('base64')}`;
}

export function decryptBankDetails(blob: string): BankDetails {
  const [iv, tag, data] = blob.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(plain) as BankDetails;
}
