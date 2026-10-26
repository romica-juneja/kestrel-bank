import { splitMoney } from '../lib/format';

/** Balance figure with the cents set smaller, so the whole-dollar amount reads first. */
export function Money({ cents, currency = 'USD', className = '' }: { cents: number; currency?: string; className?: string }) {
  const [whole, fraction] = splitMoney(cents, currency);
  return (
    <span className={`money ${className}`}>
      {whole}
      <span className="money-cents">{fraction}</span>
    </span>
  );
}

/** Signed amount for a ledger line: −$12.00 for debits, +$12.00 for credits. */
export function SignedAmount({ cents, direction }: { cents: number; direction: 'debit' | 'credit' }) {
  const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  return (
    <span className={`amount amount-${direction}`}>
      <span className="visually-hidden">{direction === 'debit' ? 'Debit' : 'Credit'} </span>
      <span aria-hidden="true">{direction === 'debit' ? '−' : '+'}</span>
      {formatted}
    </span>
  );
}
