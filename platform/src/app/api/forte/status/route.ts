import { NextResponse } from 'next/server';
import { forteConfigured } from '@/lib/forte';

export const dynamic = 'force-dynamic';

// Safe diagnostic: reports WHICH Forte vars are present (booleans only — never
// their values) so you can confirm the names match after setting them in Railway.
export async function GET() {
  const present = {
    FORTE_API_ACCESS_ID: !!process.env.FORTE_API_ACCESS_ID,
    FORTE_API_SECURE_KEY: !!process.env.FORTE_API_SECURE_KEY,
    FORTE_ORGANIZATION_ID: !!process.env.FORTE_ORGANIZATION_ID,
    FORTE_LOCATION_ID: !!process.env.FORTE_LOCATION_ID,
    FORTE_ENV: process.env.FORTE_ENV || '(unset)',
    NEXT_PUBLIC_FORTE_API_LOGIN_ID: !!process.env.NEXT_PUBLIC_FORTE_API_LOGIN_ID,
  };
  return NextResponse.json({
    configured: forteConfigured(),
    mode: forteConfigured() ? 'LIVE (real Forte charges)' : 'MOCK (simulated charges)',
    present,
  });
}
