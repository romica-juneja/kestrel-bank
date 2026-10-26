import { createHash } from 'node:crypto';
import type { Db } from '../db/connection.js';
import { CLEARING_ACCOUNT_ID } from '../db/seed.js';
import { AppError, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { formatCents } from '../lib/money.js';
import { getOwnedAccount } from './accounts.js';
import { getOwnedPayee } from './payees.js';

export type TransferDestination = { kind: 'account'; accountId: string } | { kind: 'payee'; payeeId: string };

export interface TransferRequest {
  fromAccountId: string;
  destination: TransferDestination;
  amountCents: number;
  note?: string;
}

export interface TransferResult {
  id: string;
  status: 'completed';
  createdAt: string;
  amountCents: number;
  note: string | null;
  from: { accountId: string; name: string; accountNumberMasked: string; balanceAfterCents: number };
  to:
    | { kind: 'account'; accountId: string; name: string; accountNumberMasked: string; balanceAfterCents: number }
    | { kind: 'payee'; payeeId: string; name: string; bankName: string; accountNumberMasked: string };
}

export interface TransferOutcome {
  transfer: TransferResult;
  /** True when this call returned a transfer that an earlier call with the same key created. */
  replayed: boolean;
}

/** Stable fingerprint of what was asked for, so a reused key with different details is caught. */
function requestHash(req: TransferRequest): string {
  const canonical = JSON.stringify([
    req.fromAccountId,
    req.destination.kind,
    req.destination.kind === 'account' ? req.destination.accountId : req.destination.payeeId,
    req.amountCents,
    req.note ?? '',
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Executes a transfer exactly once per (customer, idempotency key).
 *
 * Everything happens inside one IMMEDIATE SQLite transaction, which takes the write lock up
 * front: the idempotency lookup, the balance check, the transfer row, the debit and credit
 * rows and both balance updates either all commit or none do. A second request with the same
 * key, whether concurrent or a later retry, finds the first transfer and gets it back instead
 * of moving money again. The UNIQUE(customer_id, idempotency_key) constraint backs this up.
 *
 * Failed attempts (e.g. insufficient funds) are not recorded, so a customer can retry the same
 * draft after topping up the account.
 */
export function executeTransfer(
  db: Db,
  customerId: string,
  idempotencyKey: string,
  req: TransferRequest,
  now = new Date(),
): TransferOutcome {
  const hash = requestHash(req);

  const run = db.transaction((): TransferOutcome => {
    const existing = db
      .prepare('SELECT id, request_hash FROM transfers WHERE customer_id = ? AND idempotency_key = ?')
      .get(customerId, idempotencyKey) as { id: string; request_hash: string } | undefined;
    if (existing) {
      if (existing.request_hash !== hash) {
        throw new AppError(
          409,
          'idempotency_key_reused',
          'This transfer was already submitted with different details. Start a new transfer instead.',
        );
      }
      return { transfer: getTransfer(db, customerId, existing.id), replayed: true };
    }

    const from = getOwnedAccount(db, customerId, req.fromAccountId);

    let toAccountId: string;
    let payeeId: string | null = null;
    let debitText: string;
    let creditText: string;
    if (req.destination.kind === 'account') {
      if (req.destination.accountId === req.fromAccountId) {
        throw new AppError(422, 'same_account', 'Choose a different account to send money to.');
      }
      const to = getOwnedAccount(db, customerId, req.destination.accountId);
      toAccountId = to.id;
      debitText = `Transfer to ${to.name} ${to.accountNumberMasked}`;
      creditText = `Transfer from ${from.name} ${from.accountNumberMasked}`;
    } else {
      const payee = getOwnedPayee(db, customerId, req.destination.payeeId);
      toAccountId = CLEARING_ACCOUNT_ID;
      payeeId = payee.id;
      debitText = `Payment to ${payee.name}`;
      creditText = `Outgoing payment to ${payee.name} (${payee.bankName} ${payee.accountNumberMasked})`;
    }

    if (req.amountCents > from.balanceCents) {
      throw new AppError(
        422,
        'insufficient_funds',
        `${from.name} has ${formatCents(from.balanceCents)} available, which is less than ${formatCents(req.amountCents)}.`,
      );
    }

    const id = newId('trf');
    const createdAt = now.toISOString();
    const note = req.note?.trim() || null;
    db.prepare(
      `INSERT INTO transfers (id, customer_id, idempotency_key, request_hash, from_account_id, to_account_id,
                              payee_id, amount_cents, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
    ).run(id, customerId, idempotencyKey, hash, from.id, toAccountId, payeeId, req.amountCents, note, createdAt);

    post(db, from.id, id, createdAt, withNote(debitText, note), 'debit', req.amountCents);
    post(db, toAccountId, id, createdAt, withNote(creditText, note), 'credit', req.amountCents);

    return { transfer: getTransfer(db, customerId, id), replayed: false };
  });

  return run.immediate();
}

const withNote = (text: string, note: string | null) => (note ? `${text} – ${note}` : text);

/** Updates the balance and writes the ledger line with the resulting running balance. */
function post(db: Db, accountId: string, transferId: string, at: string, description: string, direction: 'debit' | 'credit', cents: number) {
  const delta = direction === 'credit' ? cents : -cents;
  const { balance_cents: balance } = db
    .prepare('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ? RETURNING balance_cents')
    .get(delta, accountId) as { balance_cents: number };
  db.prepare(
    `INSERT INTO transactions (account_id, transfer_id, posted_at, description, category, direction, amount_cents, balance_after_cents)
     VALUES (?, ?, ?, ?, 'transfer', ?, ?, ?)`,
  ).run(accountId, transferId, at, description, direction, cents, balance);
}

interface TransferRow {
  id: string;
  amount_cents: number;
  note: string | null;
  created_at: string;
  from_account_id: string;
  to_account_id: string;
  payee_id: string | null;
}

/** Loads a transfer belonging to the customer, as it was right after it completed. */
export function getTransfer(db: Db, customerId: string, transferId: string): TransferResult {
  const t = db
    .prepare(
      `SELECT id, amount_cents, note, created_at, from_account_id, to_account_id, payee_id
       FROM transfers WHERE id = ? AND customer_id = ?`,
    )
    .get(transferId, customerId) as TransferRow | undefined;
  if (!t) throw notFound('Transfer');

  const balanceAfter = (accountId: string) =>
    (
      db
        .prepare('SELECT balance_after_cents FROM transactions WHERE transfer_id = ? AND account_id = ?')
        .get(t.id, accountId) as { balance_after_cents: number }
    ).balance_after_cents;

  const from = getOwnedAccount(db, customerId, t.from_account_id);
  const to: TransferResult['to'] = t.payee_id
    ? (() => {
        const p = getOwnedPayee(db, customerId, t.payee_id);
        return { kind: 'payee' as const, payeeId: p.id, name: p.name, bankName: p.bankName, accountNumberMasked: p.accountNumberMasked };
      })()
    : (() => {
        const a = getOwnedAccount(db, customerId, t.to_account_id);
        return {
          kind: 'account' as const,
          accountId: a.id,
          name: a.name,
          accountNumberMasked: a.accountNumberMasked,
          balanceAfterCents: balanceAfter(a.id),
        };
      })();

  return {
    id: t.id,
    status: 'completed',
    createdAt: t.created_at,
    amountCents: t.amount_cents,
    note: t.note,
    from: { accountId: from.id, name: from.name, accountNumberMasked: from.accountNumberMasked, balanceAfterCents: balanceAfter(from.id) },
    to,
  };
}
