import type { Db } from '../db/connection.js';
import { getOwnedAccount } from './accounts.js';

export interface Transaction {
  id: number;
  postedAt: string;
  description: string;
  category: string;
  direction: 'debit' | 'credit';
  amountCents: number;
  balanceAfterCents: number;
  transferId: string | null;
}

export interface TransactionQuery {
  /** Inclusive, YYYY-MM-DD (UTC). */
  from?: string;
  /** Inclusive, YYYY-MM-DD (UTC). */
  to?: string;
  type?: 'debit' | 'credit';
  category?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export interface TransactionPage {
  items: Transaction[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface TransactionRow {
  id: number;
  posted_at: string;
  description: string;
  category: string;
  direction: 'debit' | 'credit';
  amount_cents: number;
  balance_after_cents: number;
  transfer_id: string | null;
}

const toTransaction = (r: TransactionRow): Transaction => ({
  id: r.id,
  postedAt: r.posted_at,
  description: r.description,
  category: r.category,
  direction: r.direction,
  amountCents: r.amount_cents,
  balanceAfterCents: r.balance_after_cents,
  transferId: r.transfer_id,
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const nextDay = (isoDate: string) => {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
};

/** Newest-first, filtered and paginated history for one of the customer's accounts. */
export function queryTransactions(db: Db, customerId: string, accountId: string, q: TransactionQuery): TransactionPage {
  getOwnedAccount(db, customerId, accountId); // ownership check, throws 404 otherwise

  const where = ['account_id = ?'];
  const params: (string | number)[] = [accountId];
  if (q.from) {
    where.push('posted_at >= ?');
    params.push(`${q.from}T00:00:00.000Z`);
  }
  if (q.to) {
    where.push('posted_at < ?');
    params.push(nextDay(q.to));
  }
  if (q.type) {
    where.push('direction = ?');
    params.push(q.type);
  }
  if (q.category) {
    where.push('category = ?');
    params.push(q.category);
  }
  if (q.search) {
    where.push("description LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(q.search)}%`);
  }
  const whereSql = where.join(' AND ');

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM transactions WHERE ${whereSql}`).get(...params) as {
    total: number;
  };
  const rows = db
    .prepare(
      `SELECT id, posted_at, description, category, direction, amount_cents, balance_after_cents, transfer_id
       FROM transactions WHERE ${whereSql}
       ORDER BY posted_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, q.pageSize, (q.page - 1) * q.pageSize) as TransactionRow[];

  return {
    items: rows.map(toTransaction),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

/** Sum of debits per category across the customer's accounts in [from, to). Read-only. */
export function spendingByCategory(db: Db, customerId: string, fromIso: string, toIso: string) {
  return db
    .prepare(
      `SELECT t.category AS category, SUM(t.amount_cents) AS totalCents, COUNT(*) AS count
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE a.customer_id = ? AND t.direction = 'debit' AND t.posted_at >= ? AND t.posted_at < ?
         AND t.category <> 'transfer'
       GROUP BY t.category ORDER BY totalCents DESC`,
    )
    .all(customerId, fromIso, toIso) as { category: string; totalCents: number; count: number }[];
}

/** Most recent transactions across all of the customer's accounts. Read-only. */
export function recentTransactions(db: Db, customerId: string, limit: number) {
  return db
    .prepare(
      `SELECT t.posted_at AS postedAt, t.description, t.category, t.direction, t.amount_cents AS amountCents,
              a.name AS accountName
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE a.customer_id = ?
       ORDER BY t.posted_at DESC, t.id DESC LIMIT ?`,
    )
    .all(customerId, limit) as {
    postedAt: string;
    description: string;
    category: string;
    direction: 'debit' | 'credit';
    amountCents: number;
    accountName: string;
  }[];
}
