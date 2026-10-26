export const formatMoney = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

/** Splits $1,234.56 into ["$1,234", ".56"] so cents can be set smaller. */
export const splitMoney = (cents: number, currency = 'USD') => {
  const s = formatMoney(cents, currency);
  const i = s.lastIndexOf('.');
  return i === -1 ? [s, ''] : [s.slice(0, i), s.slice(i)];
};

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Mirrors the server rule: positive, at most two decimals. Returns cents or null. */
export function parseAmount(input: string): number | null {
  const t = input.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  const [whole = '0', frac = ''] = t.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
