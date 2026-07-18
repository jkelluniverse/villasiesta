// Client-safe half of the Instant ACH lane: validation + the exact
// authorization language. No node imports — bundled into the finalize form so
// the rendered text and the server-stored authText come from the SAME code.

/** ABA routing checksum: 3·(d1+d4+d7) + 7·(d2+d5+d8) + 1·(d3+d6+d9) ≡ 0 (mod 10). */
export function validRoutingNumber(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = routing.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

export function validAccountNumber(account: string): boolean {
  return /^\d{4,17}$/.test(account);
}

export const ACH_ENTITY = 'Villa Siesta / Property Investment Group Services, Inc.';
export const ACH_DESCRIPTOR = 'Property Investment Group Services, Inc.';
export const ACH_REVOKE_PHONE = '330-495-7821';

const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const niceDay = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };

/**
 * The exact ACH authorization text (checkbox 1). ONE builder shared by the
 * client render and the server record so they can never drift — spec check #2.
 */
export function buildAchAuthText(input: {
  amount: number;          // first (or only) debit, dollars
  onOrAfter: string;       // yyyy-mm-dd
  balanceAmount?: number | null;
  balanceDate?: string | null;   // yyyy-mm-dd
}): string {
  const split = input.balanceAmount != null && input.balanceDate;
  const first = `I authorize ${ACH_ENTITY} to initiate a one-time ACH debit from the bank account above for ${usd(input.amount)} on or after ${niceDay(input.onOrAfter)}`;
  const second = split ? `, and a second debit of ${usd(input.balanceAmount!)} on or about ${niceDay(input.balanceDate!)}` : '';
  return `${first}${second}. I understand I may revoke this authorization by contacting ${ACH_REVOKE_PHONE} before the debit is initiated.`;
}

/** Checkbox 2 — accuracy + returned-payment fee. */
export function buildAchFeeText(nsfFee: number): string {
  return `I confirm the account information above is correct, and I acknowledge that a ${usd(nsfFee)} returned-payment fee applies to any ACH payment that fails or is returned for insufficient funds.`;
}
