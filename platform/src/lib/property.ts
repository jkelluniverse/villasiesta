import { prisma } from './db';

export const DEFAULT_SLUG = 'villa-siesta';

export async function getPropertyId(slug: string): Promise<string | null> {
  const p = await prisma.property.findUnique({ where: { slug }, select: { id: true } });
  return p?.id ?? null;
}
