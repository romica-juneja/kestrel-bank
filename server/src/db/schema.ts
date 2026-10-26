/**
 * Data model.
 *
 * - Money is stored as INTEGER cents.
 * - Every money movement made in the app is a `transfers` row plus exactly two `transactions`
 *   rows (one debit, one credit) written in the same database transaction.
 * - Transfers to payees are credited to a bank-owned clearing account, so the ledger always
 *   balances even though the payee's own bank is outside this system.
 * - `transactions.balance_after_cents` stores the running balance at posting time.
 */
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id             TEXT PRIMARY KEY,
  customer_id    TEXT REFERENCES customers(id),          -- NULL for bank-internal accounts
  type           TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'clearing')),
  name           TEXT NOT NULL,
  account_number TEXT NOT NULL UNIQUE,
  currency       TEXT NOT NULL DEFAULT 'USD',
  balance_cents  INTEGER NOT NULL,
  -- Last line of defence against overdrafts, in addition to the check in the transfer service.
  CHECK (type = 'clearing' OR balance_cents >= 0)
);

CREATE TABLE IF NOT EXISTS payees (
  id             TEXT PRIMARY KEY,
  customer_id    TEXT NOT NULL REFERENCES customers(id),
  name           TEXT NOT NULL,
  bank_name      TEXT NOT NULL,
  account_number TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transfers (
  id              TEXT PRIMARY KEY,
  customer_id     TEXT NOT NULL REFERENCES customers(id),
  idempotency_key TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  from_account_id TEXT NOT NULL REFERENCES accounts(id),
  to_account_id   TEXT NOT NULL REFERENCES accounts(id),
  payee_id        TEXT REFERENCES payees(id),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  note            TEXT,
  status          TEXT NOT NULL CHECK (status IN ('completed')),
  created_at      TEXT NOT NULL,
  -- The same key can never create two transfers for the same customer.
  UNIQUE (customer_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS transactions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id          TEXT NOT NULL REFERENCES accounts(id),
  transfer_id         TEXT REFERENCES transfers(id),
  posted_at           TEXT NOT NULL,                     -- ISO-8601 UTC
  description         TEXT NOT NULL,
  category            TEXT NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  balance_after_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_account_time
  ON transactions (account_id, posted_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,                          -- SHA-256 of the cookie value
  customer_id TEXT NOT NULL REFERENCES customers(id),
  expires_at  TEXT NOT NULL
);
`;
