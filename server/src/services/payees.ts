import type { Db } from '../db/connection.js';
import { notFound } from '../lib/errors.js';
import { maskAccountNumber } from './accounts.js';

export interface Payee {
  id: string;
  name: string;
  bankName: string;
  accountNumberMasked: string;
}

interface PayeeRow {
  id: string;
  name: string;
  bank_name: string;
  account_number: string;
}

const toPayee = (r: PayeeRow): Payee => ({
  id: r.id,
  name: r.name,
  bankName: r.bank_name,
  accountNumberMasked: maskAccountNumber(r.account_number),
});

export function listPayees(db: Db, customerId: string): Payee[] {
  const rows = db
    .prepare('SELECT id, name, bank_name, account_number FROM payees WHERE customer_id = ? ORDER BY name')
    .all(customerId) as PayeeRow[];
  return rows.map(toPayee);
}

export function getOwnedPayee(db: Db, customerId: string, payeeId: string): Payee {
  const row = db
    .prepare('SELECT id, name, bank_name, account_number FROM payees WHERE id = ? AND customer_id = ?')
    .get(payeeId, customerId) as PayeeRow | undefined;
  if (!row) throw notFound('Payee');
  return toPayee(row);
}
