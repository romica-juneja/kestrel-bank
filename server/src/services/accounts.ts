import type { Db } from '../db/connection.js';
import { notFound } from '../lib/errors.js';

export interface Account {
  id: string;
  type: 'checking' | 'savings';
  name: string;
  accountNumberMasked: string;
  currency: string;
  balanceCents: number;
}

interface AccountRow {
  id: string;
  type: 'checking' | 'savings';
  name: string;
  account_number: string;
  currency: string;
  balance_cents: number;
}

export const maskAccountNumber = (n: string) => `•••• ${n.replace(/\s/g, '').slice(-4)}`;

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  type: r.type,
  name: r.name,
  accountNumberMasked: maskAccountNumber(r.account_number),
  currency: r.currency,
  balanceCents: r.balance_cents,
});

export function listAccounts(db: Db, customerId: string): Account[] {
  const rows = db
    .prepare(
      `SELECT id, type, name, account_number, currency, balance_cents FROM accounts
       WHERE customer_id = ? ORDER BY CASE type WHEN 'checking' THEN 0 ELSE 1 END, name`,
    )
    .all(customerId) as AccountRow[];
  return rows.map(toAccount);
}

/**
 * Loads an account only if it belongs to the customer. Accounts owned by someone else are
 * reported as "not found" so the API does not reveal which account ids exist.
 */
export function getOwnedAccount(db: Db, customerId: string, accountId: string): Account {
  const row = db
    .prepare(
      'SELECT id, type, name, account_number, currency, balance_cents FROM accounts WHERE id = ? AND customer_id = ?',
    )
    .get(accountId, customerId) as AccountRow | undefined;
  if (!row) throw notFound('Account');
  return toAccount(row);
}
