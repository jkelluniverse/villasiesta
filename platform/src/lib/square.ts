// Square payment layer (replaces the retired Forte module).
// Server-side only. Card/bank data never touches our server — the Web Payments
// SDK tokenizes client-side and hands us a one-time sourceId. Money is integer
// cents (BigInt) everywhere in Square; convert exactly once, here.
// MOCK mode when SQUARE_ACCESS_TOKEN is absent, so the finalize → paid →
// calendar-lock loop stays testable in local dev.

import { SquareClient, SquareEnvironment } from 'square';

export function squareConfigured(): boolean {
  return !!process.env.SQUARE_ACCESS_TOKEN;
}

export function squareEnvironment(): 'sandbox' | 'production' {
  return process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
}

let _client: SquareClient | null = null;
export function square(): SquareClient {
  if (!_client) {
    _client = new SquareClient({
      token: process.env.SQUARE_ACCESS_TOKEN!,
      environment: squareEnvironment() === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
    });
  }
  return _client;
}

/** Dollars (float) → integer cents. The ONLY place we convert money. */
export function toCents(dollars: number): bigint {
  return BigInt(Math.round(dollars * 100));
}

const locationId = () => process.env.SQUARE_LOCATION_ID || '';

export type PaymentResult = {
  ok: boolean; mock: boolean;
  paymentId?: string;
  status?: string;           // COMPLETED | PENDING | FAILED ...
  error?: string;
};

export async function createSquarePayment(input: {
  sourceId: string;
  amountCents: bigint;
  idempotencyKey: string;
  referenceId: string;       // bookingId / bookingId-deposit / bookingId-balance
  note?: string;
  customerId?: string;
}): Promise<PaymentResult> {
  if (!squareConfigured()) {
    console.warn(`[square:MOCK] simulating payment of ${input.amountCents}¢ (${input.referenceId})`);
    return { ok: true, mock: true, paymentId: `mock_pay_${Date.now()}`, status: 'COMPLETED' };
  }
  try {
    const res = await square().payments.create({
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      amountMoney: { amount: input.amountCents, currency: 'USD' },
      locationId: locationId(),
      referenceId: input.referenceId,
      note: input.note,
      customerId: input.customerId,
      autocomplete: true,
    });
    const p = res.payment;
    console.log(`[square] payment ${p?.id} status=${p?.status} ref=${input.referenceId} amount=${input.amountCents}`);
    if (!p?.id) return { ok: false, mock: false, error: 'no_payment_returned' };
    if (p.status === 'FAILED' || p.status === 'CANCELED') return { ok: false, mock: false, paymentId: p.id, status: p.status, error: `payment_${p.status?.toLowerCase()}` };
    return { ok: true, mock: false, paymentId: p.id, status: p.status ?? 'PENDING' };
  } catch (e) {
    const msg = squareErrorMessage(e);
    console.error('[square] payment failed:', msg);
    return { ok: false, mock: false, error: msg };
  }
}

export async function createSquareCustomer(input: { firstName: string; lastName: string; email: string; idempotencyKey: string }): Promise<{ ok: boolean; mock: boolean; customerId?: string; error?: string }> {
  if (!squareConfigured()) return { ok: true, mock: true, customerId: `mock_cust_${Date.now()}` };
  try {
    const res = await square().customers.create({
      idempotencyKey: input.idempotencyKey,
      givenName: input.firstName, familyName: input.lastName, emailAddress: input.email,
    });
    return { ok: true, mock: false, customerId: res.customer?.id };
  } catch (e) {
    return { ok: false, mock: false, error: squareErrorMessage(e) };
  }
}

/** Store a card on file for the scheduled balance. Requires verificationToken (verifyBuyer). */
export async function createCardOnFile(input: { sourceId: string; verificationToken?: string; customerId: string; idempotencyKey: string }): Promise<{ ok: boolean; mock: boolean; cardId?: string; error?: string }> {
  if (!squareConfigured()) return { ok: true, mock: true, cardId: `mock_card_${Date.now()}` };
  try {
    const res = await square().cards.create({
      idempotencyKey: input.idempotencyKey,
      sourceId: input.sourceId,
      verificationToken: input.verificationToken,
      card: { customerId: input.customerId },
    });
    return { ok: true, mock: false, cardId: res.card?.id };
  } catch (e) {
    return { ok: false, mock: false, error: squareErrorMessage(e) };
  }
}

/** Owner "Send bill": a hosted Square payment link for an arbitrary amount.
 * Returns the link's orderId so the booking can be reconciled when the guest
 * pays — payment-link payments carry no reference_id, only order_id. */
export async function createPaymentLink(input: { name: string; amountCents: bigint; idempotencyKey: string }): Promise<{ ok: boolean; mock: boolean; url?: string; orderId?: string; error?: string }> {
  if (!squareConfigured()) return { ok: true, mock: true, url: `https://example.com/mock-pay-link`, orderId: `mock_order_${Date.now()}` };
  try {
    const res = await square().checkout.paymentLinks.create({
      idempotencyKey: input.idempotencyKey,
      quickPay: { name: input.name, priceMoney: { amount: input.amountCents, currency: 'USD' }, locationId: locationId() },
    });
    return { ok: true, mock: false, url: res.paymentLink?.url, orderId: res.paymentLink?.orderId };
  } catch (e) {
    return { ok: false, mock: false, error: squareErrorMessage(e) };
  }
}

export type PaymentDetails = {
  ok: boolean; mock: boolean;
  id?: string; status?: string;
  amount?: number;          // dollars actually charged
  processingFee?: number;   // dollars Square kept
  cardBrand?: string; last4?: string;
  createdAt?: string; receiptUrl?: string;
  error?: string;
};

/** Live payment record for the owner money panel: amount, Square processing fee, card. */
export async function getPaymentDetails(paymentId: string): Promise<PaymentDetails> {
  if (!squareConfigured() || paymentId.startsWith('mock_')) {
    return { ok: true, mock: true, id: paymentId, status: 'COMPLETED' };
  }
  try {
    const res = await square().payments.get({ paymentId });
    const p = res.payment;
    if (!p?.id) return { ok: false, mock: false, error: 'not_found' };
    const centsToDollars = (c?: bigint | number | null) => (c == null ? undefined : Number(c) / 100);
    const fee = (p.processingFee ?? []).reduce((s, f) => s + Number(f.amountMoney?.amount ?? 0), 0);
    const card = p.cardDetails?.card;
    return {
      ok: true, mock: false, id: p.id, status: p.status ?? undefined,
      amount: centsToDollars(p.amountMoney?.amount),
      processingFee: fee ? fee / 100 : undefined,
      cardBrand: card?.cardBrand ?? undefined, last4: card?.last4 ?? undefined,
      createdAt: p.createdAt ?? undefined, receiptUrl: p.receiptUrl ?? undefined,
    };
  } catch (e) {
    return { ok: false, mock: false, error: squareErrorMessage(e) };
  }
}

export function squareErrorMessage(e: unknown): string {
  const errors = (e as { errors?: { code?: string; detail?: string; category?: string }[] })?.errors;
  if (Array.isArray(errors) && errors.length) {
    return errors.map((x) => x.detail || x.code).filter(Boolean).join('; ');
  }
  return (e as Error)?.message || 'square_error';
}
