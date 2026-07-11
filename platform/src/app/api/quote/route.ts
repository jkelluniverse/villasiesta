import { NextRequest, NextResponse } from 'next/server';
import { computeQuote, loadPropertyPricing } from '@/lib/pricing';
import { DEFAULT_SLUG } from '@/lib/property';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const slug = q.get('slug') || DEFAULT_SLUG;
  const loaded = await loadPropertyPricing(slug);
  if (!loaded) return NextResponse.json({ error: 'property_not_found' }, { status: 404 });

  const checkIn = q.get('checkIn') || '';
  const checkOut = q.get('checkOut') || '';

  // No dates → return the pricing model so the widget can render the "from" rate + calendar.
  if (!checkIn || !checkOut) {
    return NextResponse.json({ pricing: loaded.pricing });
  }

  const quote = computeQuote(loaded.pricing, {
    checkIn,
    checkOut,
    guests: Number(q.get('guests') || 2),
    pet: q.get('pet') === '1' || q.get('pet') === 'true',
    method: (q.get('method') as 'ach' | 'card') || 'ach',
  });
  return NextResponse.json({ quote, pricing: loaded.pricing });
}
