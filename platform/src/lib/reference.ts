import { randomInt } from 'crypto';
import { prisma } from './db';

// Public, memo-safe booking reference: "VS-" + 4 chars from a 31-char alphabet
// with no 0/O/1/I/L — survives handwriting and phone memos. ~923k combinations.
// References are GLOBALLY unique (across tenants), so the availability check
// runs on the raw client; the DB unique constraint is the final backstop.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function newReference(): string {
  let s = 'VS-';
  for (let i = 0; i < 4; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** Generate a reference not already taken (retry on the rare collision). */
export async function newUniqueReference(_db?: unknown): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const ref = newReference();
    const clash = await prisma.booking.findUnique({ where: { reference: ref }, select: { id: true } });
    if (!clash) return ref;
  }
  throw new Error('reference_generation_failed');
}
