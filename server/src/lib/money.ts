/**
 * Money is always handled as integer minor units (cents) to avoid floating point errors.
 * Clients send amounts as decimal strings ("125.50"), which are parsed exactly.
 */
const AMOUNT_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

export function parseAmountToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) return null;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
