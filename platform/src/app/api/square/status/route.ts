import { NextResponse } from 'next/server';
import { squareConfigured, squareEnvironment } from '@/lib/square';

export const dynamic = 'force-dynamic';

// Safe diagnostic: booleans only, never secret values.
export async function GET() {
  return NextResponse.json({
    configured: squareConfigured(),
    mode: squareConfigured() ? `LIVE (${squareEnvironment()} Square charges)` : 'MOCK (simulated charges)',
    present: {
      SQUARE_ACCESS_TOKEN: !!process.env.SQUARE_ACCESS_TOKEN,
      SQUARE_ENVIRONMENT: process.env.SQUARE_ENVIRONMENT || '(unset → sandbox)',
      SQUARE_LOCATION_ID: !!process.env.SQUARE_LOCATION_ID,
      SQUARE_WEBHOOK_SIGNATURE_KEY: !!process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
      NEXT_PUBLIC_SQUARE_APPLICATION_ID: !!process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID,
      NEXT_PUBLIC_SQUARE_LOCATION_ID: !!process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID,
    },
  });
}
