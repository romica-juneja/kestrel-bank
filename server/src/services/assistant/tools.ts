import type { Db } from '../../db/connection.js';
import { formatCents } from '../../lib/money.js';
import { listAccounts } from '../accounts.js';
import { recentTransactions, spendingByCategory } from '../transactions.js';

/**
 * The assistant's only way to see data. Every tool is read-only and is bound to the signed-in
 * customer's id on the server, so neither the model nor the user can choose whose data is read,
 * and no tool can move money or change anything.
 */
export const CATEGORIES = ['groceries', 'dining', 'transport', 'utilities', 'entertainment', 'shopping', 'housing'] as const;
export type Period = 'this_month' | 'last_month' | 'last_30_days';

export function periodRange(period: Period, now: Date): { from: Date; to: Date; label: string } {
  const startOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  switch (period) {
    case 'last_month':
      return { from: startOfMonth(y, m - 1), to: startOfMonth(y, m), label: 'last month' };
    case 'last_30_days':
      return { from: new Date(now.getTime() - 30 * 86_400_000), to: now, label: 'in the last 30 days' };
    default:
      return { from: startOfMonth(y, m), to: new Date(now.getTime() + 1), label: 'this month' };
  }
}

export function createReadOnlyTools(db: Db, customerId: string, now: Date) {
  return {
    getAccounts() {
      return listAccounts(db, customerId).map((a) => ({
        name: a.name,
        type: a.type,
        number: a.accountNumberMasked,
        balance: formatCents(a.balanceCents, a.currency),
        balanceCents: a.balanceCents,
      }));
    },

    getRecentTransactions(limit: number) {
      const safeLimit = Math.min(Math.max(Math.trunc(limit) || 5, 1), 20);
      return recentTransactions(db, customerId, safeLimit).map((t) => ({
        date: t.postedAt.slice(0, 10),
        account: t.accountName,
        description: t.description,
        category: t.category,
        type: t.direction,
        amount: formatCents(t.amountCents),
      }));
    },

    getSpending(period: Period, category?: string) {
      const range = periodRange(period, now);
      const rows = spendingByCategory(db, customerId, range.from.toISOString(), range.to.toISOString());
      const filtered = category ? rows.filter((r) => r.category === category) : rows;
      return {
        period: range.label,
        from: range.from.toISOString().slice(0, 10),
        categories: filtered.map((r) => ({ category: r.category, total: formatCents(r.totalCents), totalCents: r.totalCents, transactions: r.count })),
      };
    },
  };
}

export type ReadOnlyTools = ReturnType<typeof createReadOnlyTools>;
