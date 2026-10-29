# Kestrel Bank — online banking prototype

A demo online banking app for retail customers: sign in, see account balances, browse and filter
transaction history, move money between your own accounts or to a saved payee, and ask a
read-only assistant about your finances. All data is fictional and seeded on start.

**Stack:** React 19 + TypeScript (Vite) · Node.js + Express 5 + TypeScript · SQLite (better-sqlite3) · Zod · Vitest

## 1. How to run

Requires **Node.js 20.6 or newer**.

```bash
npm run setup     # installs root, server and client dependencies
npm run dev       # API on http://localhost:4000, web app on http://localhost:5173
```

Open http://localhost:5173 and sign in as **alex** or **sam**, password **Demo#2026**.
Each customer has a checking and a savings account, ~6 months of history and a few saved payees.

The database is in memory by default, so every restart gives fresh demo data. To keep data
between restarts, set `DATABASE_PATH=./bank.db` (see `server/.env.example`).

**AI assistant:** works out of the box with a rule-based responder. To use ChatGPT, put
`OPENAI_API_KEY=...` in `server/.env` and restart. `ANTHROPIC_API_KEY` is the fallback when no OpenAI key is set.

### Tests

```bash
npm test          # server (56 tests) then client (16 tests)
npm run typecheck
```

Server tests (`server/tests`) run the real Express app against a fresh in-memory database per
test via supertest. They cover sign-in and session handling, data isolation between customers,
history filtering/pagination/running balance, every transfer validation rule, ledger
consistency, and idempotency under retries and simultaneous duplicate requests. Client tests
(`client/src/**/*.test.tsx`) cover the transfer flow (confirmation step, double click, retry
with the same key), route protection, and the account history screen (filters following the
URL, including Back, and not keeping another account's rows on screen).

## Project layout

Architecture diagrams are in [`docs/`](docs/index.html). Open `docs/index.html` in a browser to see them drawn. The notes are in [`docs/architecture.md`](docs/architecture.md), and each diagram source is in `docs/diagrams/`.

```
server/src
  app.ts                 Express app wiring (security headers, JSON-only mutations, routes, errors)
  db/                    schema, connection, deterministic seed data
  auth/                  server-side sessions, login throttling, auth middleware
  routes/                HTTP layer: request validation (Zod) → services
  services/              accounts, transactions, payees, transfers, assistant
client/src
  api/                   typed fetch client
  auth/                  auth context + RequireAuth route guard
  pages/                 sign in, accounts, account history, transfer, transfer result
  lib/                   formatting, transfer validation, transfer draft + idempotency key
```

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | `{ username, password }` → sets session cookie |
| POST | `/api/auth/logout` | revokes session |
| GET | `/api/auth/me` | current customer |
| GET | `/api/accounts` | the customer's accounts with balances |
| GET | `/api/accounts/:id` | one account |
| GET | `/api/accounts/:id/transactions` | `from`, `to` (YYYY-MM-DD), `type` (debit/credit), `search`, `page`, `pageSize` (≤100) |
| GET | `/api/payees` | saved payees |
| POST | `/api/transfers` | header `Idempotency-Key`; body `{ fromAccountId, toAccountId \| payeeId, amount: "12.50", note? }` |
| GET | `/api/transfers/:id` | transfer result |
| POST | `/api/assistant` | `{ message, history? }` → `{ reply, source }` |

Errors always have the shape `{ error: { code, message, details? } }`.

## 2. Key design decisions and trade-offs

**Money is integer cents end to end.** Amounts are sent as decimal strings (`"12.50"`) and parsed
exactly; floats never touch money (`0.29 * 100` is `28.999…`). Display formatting happens only in
the UI.

**Double-entry ledger.** Every transfer writes one `transfers` row and exactly two
`transactions` rows (a debit and a matching credit) and updates both balances, all in one
database transaction. Payments to payees are credited to a bank-owned clearing account, since the
payee's bank is outside the system, so the books still balance. Each ledger line stores the
balance after it posted, which gives the running balance column for free and makes history
auditable. A test checks that every account's balance equals the sum of its ledger lines and
that every transfer nets to zero. A `CHECK (balance_cents >= 0)` on customer accounts is a last
line of defence against overdrafts.

**Exactly-once transfers.** The client creates an idempotency key (UUID) when the customer
reaches the confirmation step, sends it in the `Idempotency-Key` header and keeps it in
`sessionStorage` with the draft until the transfer succeeds or the details change. On the server,
the key lookup, the balance check and all writes happen inside a single `BEGIN IMMEDIATE`
transaction, and `UNIQUE(customer_id, idempotency_key)` backs it up. So:
- double click: the button is guarded synchronously and disabled; a second request would replay anyway
- retry after a network error: same key → the original result is returned (`200`, `Idempotent-Replayed: true`)
- refresh: after success the app redirects (history replace) to `/transfers/:id`, a read-only page; refreshing the confirm step keeps the same key
- the same key with different details is refused (`409`), so a key can never authorise a different transfer

Failed attempts (e.g. insufficient funds) are not stored against the key, so the customer can top
up and retry the same draft.

**Security basics.** Passwords hashed with bcrypt; constant-time-ish login (a dummy hash is
checked for unknown usernames) and one generic error message; failed sign-ins throttled per
username + IP. Sessions are server-side, random 256-bit tokens in an `HttpOnly`,
`SameSite=Strict` (and `Secure` in production) cookie; only the token's SHA-256 is stored;
30-minute sliding expiry; sign out deletes the session. State-changing requests must be JSON,
which a cross-site form cannot send, as CSRF defence in depth. Every query is scoped by the
signed-in customer's id; another customer's account, payee or transfer returns `404` so ids
can't be probed. Full account numbers never leave the server. Helmet security headers,
`Cache-Control: no-store` on all API responses, request body size limit, Zod validation on
every input, LIKE wildcards escaped in search, and unexpected errors are logged but never
leaked to the client.

**AI assistant is read-only by construction.** The model (or the rule-based fallback) can only
call three read tools — accounts, recent transactions, spending by category — which are bound to
the session's customer id on the server. There is no tool that writes, so the assistant cannot
move money regardless of what it is asked or what text appears in transaction descriptions; the
system prompt also tells it to treat tool results as data. If the LLM call fails, it falls back
to the rule-based answers.

**Why SQLite + Node.** SQLite gives real transactions and constraints with zero setup for
reviewers (`npm run setup && npm run dev`). better-sqlite3 is synchronous, so a transfer
transaction runs without interleaving inside the process. The structure (thin routes → services
→ data access, idempotent command in one DB transaction) maps directly onto ASP.NET Core + EF
Core with SQL Server/Postgres, where I'd use `SERIALIZABLE` or `SELECT … FOR UPDATE` on the
source account plus the same unique constraint.

**Filters live in the URL** on the history screen, so they survive refresh, back/forward and can
be shared. Pagination is offset-based, which is fine at this size; with large histories I'd
switch to keyset pagination on `(posted_at, id)`.

### Left out (deliberately)

- Real money movement, payee management, scheduled/recurring transfers, multi-currency, statements
- Multi-factor auth, password reset, account lockout notifications
- Time zones: date filters and "this month" use UTC
- Distributed concerns: login throttling is in-memory and SQLite is single-node; production would use a shared store (e.g. Redis) and a server database
- Seeded history from external parties (employer, shops) is single-sided by nature; everything done in the app is double-entry
- End-to-end browser tests (I tested the flows manually and cover the critical logic with API and component tests)
- Containerisation / CI pipeline

## 3. How AI tools were used

I used Claude as a pair programmer. It drafted the data model, the services, the tests, the React
screens and most of this README. I kept the design decisions in section 2, then ran the test
suites and the app and checked the screens at desktop width, at 390px, and in dark mode.

Several things in that draft were wrong. I changed them after reading the code, not because a
test failed:

- **Sending a transfer.** The first submit handler returned early with `if (submitting) return`.
  That flag is React state, so it does not flip until the next render. Two clicks in the same
  turn both saw `submitting === false` and both called the API. `TransferPage` now sets a ref
  before any `await`, which updates immediately, and the button is disabled as well. The server
  still replays a repeated `Idempotency-Key`, so a second request would not move the money twice
  even if it got through.
- **Account numbers on a transfer receipt.** `getTransfer` passed `accountNumberMasked` through
  `maskAccountNumber` again. Masking keeps the last four characters, and `•••• 7781` already ends
  in those four, so the response looked right and the tests stayed green. The number was already
  masked in `toAccount`. The second call is gone.
- **Narrow history layout.** At 390px the filter grid overflowed its panel. Grid items default to
  `min-width: auto`, so the date inputs refused to shrink. The columns are now `minmax(0, 1fr)`.
  The same width clipped the ledger, so on a small screen the date column is hidden and the date
  is shown under the description instead.
- **Wrong account left on screen.** Opening a second account, or a second transfer receipt, left
  the previous response in place until the new request finished. `useAsync` correctly ignores a
  stale response, but it did not clear the one already rendered. The history screen and the
  receipt remount when the id in the URL changes, so the old rows cannot sit under the new
  account. On the history screen the filter inputs also now follow the query string, including
  after Back. The results already did; the fields did not, so Apply after Back would put the old
  filter back.

Time spent: about 6 hours
