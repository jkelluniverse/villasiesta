// CSG Forte REST client (API v3). Charges run server-side; card data never
// touches our server (Forte.js tokenizes on the client and returns a one-time
// token). When Forte credentials are absent we fall back to MOCK mode so the
// finalize → PAID → calendar-lock loop is testable before the account is wired.

type Method = 'ach' | 'card';

export type SaleInput = {
  amountDollars: number;
  method: Method;
  oneTimeToken?: string;   // from Forte.js (client tokenization)
  paymethodToken?: string; // stored mth_ token (for scheduled balance)
  saveToken?: boolean;     // ask Forte to return a reusable paymethod token
  billing?: { firstName?: string; lastName?: string; email?: string };
  orderNumber?: string;
};

export type SaleResult = {
  ok: boolean;
  mock: boolean;
  transactionId?: string;   // trn_...
  paymethodToken?: string;  // mth_... (when saveToken)
  error?: string;
};

export function forteConfigured(): boolean {
  return !!(process.env.FORTE_API_ACCESS_ID && process.env.FORTE_API_SECURE_KEY &&
    process.env.FORTE_ORGANIZATION_ID && process.env.FORTE_LOCATION_ID);
}

function baseUrl(): string {
  return (process.env.FORTE_ENV || 'sandbox') === 'live'
    ? 'https://api.forte.net/api/v3'
    : 'https://sandbox.forte.net/api/v3';
}

function authHeaders(): Record<string, string> {
  const id = process.env.FORTE_API_ACCESS_ID as string;
  const key = process.env.FORTE_API_SECURE_KEY as string;
  const basic = Buffer.from(`${id}:${key}`).toString('base64');
  return {
    Authorization: `Basic ${basic}`,
    'X-Forte-Auth-Organization-Id': process.env.FORTE_ORGANIZATION_ID as string,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export async function createSale(input: SaleInput): Promise<SaleResult> {
  // MOCK: no creds → simulate a successful charge (clearly flagged in logs).
  if (!forteConfigured()) {
    console.warn(`[forte:MOCK] simulating ${input.method} sale of $${input.amountDollars.toFixed(2)} (no Forte credentials set)`);
    return { ok: true, mock: true, transactionId: `mock_trn_${Date.now()}`, paymethodToken: input.saveToken ? `mock_mth_${Date.now()}` : undefined };
  }

  const org = process.env.FORTE_ORGANIZATION_ID as string;
  const loc = process.env.FORTE_LOCATION_ID as string;
  const body: Record<string, unknown> = {
    action: 'sale',
    authorization_amount: Number(input.amountDollars.toFixed(2)),
    order_number: input.orderNumber,
  };
  if (input.paymethodToken) body.paymethod_token = input.paymethodToken;
  else if (input.oneTimeToken) body.onetime_token = input.oneTimeToken;
  if (input.saveToken) body.save_token = true;
  if (input.billing) {
    body.billing_address = {
      first_name: input.billing.firstName, last_name: input.billing.lastName,
      email: input.billing.email,
    };
  }

  try {
    const res = await fetch(`${baseUrl()}/organizations/${org}/locations/${loc}/transactions`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    // Forte returns response_desc "APPROVED" and a transaction_id on success.
    const approved = res.ok && (data?.response?.response_code === 'A01' || /approved/i.test(data?.response?.response_desc || ''));
    if (!approved) {
      return { ok: false, mock: false, error: data?.response?.response_desc || `Forte error ${res.status}` };
    }
    return { ok: true, mock: false, transactionId: data.transaction_id, paymethodToken: data.paymethod_token };
  } catch (e) {
    return { ok: false, mock: false, error: (e as Error).message };
  }
}

// Schedule the SPLIT balance charge on the stored token (Forte Schedule).
export async function createBalanceSchedule(params: { paymethodToken: string; amountDollars: number; startDate: string; orderNumber?: string }): Promise<{ ok: boolean; mock: boolean; scheduleId?: string; error?: string }> {
  if (!forteConfigured()) {
    console.warn(`[forte:MOCK] scheduling balance $${params.amountDollars.toFixed(2)} for ${params.startDate}`);
    return { ok: true, mock: true, scheduleId: `mock_sch_${Date.now()}` };
  }
  const org = process.env.FORTE_ORGANIZATION_ID as string;
  const loc = process.env.FORTE_LOCATION_ID as string;
  try {
    const res = await fetch(`${baseUrl()}/organizations/${org}/locations/${loc}/schedules`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({
        action: 'sale', paymethod_token: params.paymethodToken,
        schedule_amount: Number(params.amountDollars.toFixed(2)),
        frequency: 'one_time', start_date: params.startDate, order_number: params.orderNumber, status: 'active',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.schedule_id) return { ok: false, mock: false, error: data?.response?.response_desc || `Forte schedule error ${res.status}` };
    return { ok: true, mock: false, scheduleId: data.schedule_id };
  } catch (e) {
    return { ok: false, mock: false, error: (e as Error).message };
  }
}
