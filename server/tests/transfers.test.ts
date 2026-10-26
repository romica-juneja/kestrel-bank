import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db/connection.js';
import { balanceOf, newKey, setup, signIn } from './helpers.js';

type Agent = Awaited<ReturnType<typeof signIn>>;
const transfer = (agent: Agent, body: Record<string, unknown>, key = newKey()) =>
  agent.post('/api/transfers').set('Idempotency-Key', key).send(body);

/** Every account's balance equals the sum of its ledger lines, and app transfers net to zero. */
function expectLedgerConsistent(db: Db) {
  const mismatches = db
    .prepare(
      `SELECT a.id FROM accounts a
       WHERE a.balance_cents <> COALESCE((SELECT SUM(CASE direction WHEN 'credit' THEN amount_cents ELSE -amount_cents END)
                                          FROM transactions t WHERE t.account_id = a.id), 0)`,
    )
    .all();
  expect(mismatches).toEqual([]);
  const unbalanced = db
    .prepare(
      `SELECT transfer_id FROM transactions WHERE transfer_id IS NOT NULL GROUP BY transfer_id
       HAVING SUM(CASE direction WHEN 'credit' THEN amount_cents ELSE -amount_cents END) <> 0 OR COUNT(*) <> 2`,
    )
    .all();
  expect(unbalanced).toEqual([]);
}

describe('transfers between own accounts', () => {
  it('moves money and records a matching debit and credit', async () => {
    const { db, app } = setup();
    const agent = await signIn(app);
    const chk = balanceOf(db, 'acc_alex_chk');
    const sav = balanceOf(db, 'acc_alex_sav');

    const res = await transfer(agent, { fromAccountId: 'acc_alex_chk', toAccountId: 'acc_alex_sav', amount: '125.40', note: 'Holiday fund' }).expect(201);

    expect(res.body.transfer).toMatchObject({
      status: 'completed',
      amountCents: 12540,
      note: 'Holiday fund',
      from: { accountId: 'acc_alex_chk', balanceAfterCents: chk - 12540 },
      to: { kind: 'account', accountId: 'acc_alex_sav', balanceAfterCents: sav + 12540 },
    });
    expect(balanceOf(db, 'acc_alex_chk')).toBe(chk - 12540);
    expect(balanceOf(db, 'acc_alex_sav')).toBe(sav + 12540);

    const lines = db.prepare('SELECT account_id, direction, amount_cents FROM transactions WHERE transfer_id = ? ORDER BY direction').all(res.body.transfer.id);
    expect(lines).toEqual([
      { account_id: 'acc_alex_sav', direction: 'credit', amount_cents: 12540 },
      { account_id: 'acc_alex_chk', direction: 'debit', amount_cents: 12540 },
    ]);
    const history = await agent.get('/api/accounts/acc_alex_chk/transactions?pageSize=1').expect(200);
    expect(history.body.items[0]).toMatchObject({ direction: 'debit', amountCents: 12540, transferId: res.body.transfer.id });
    expectLedgerConsistent(db);
  });

  it('can be fetched again by id (safe to refresh the result page)', async () => {
    const { app } = setup();
    const agent = await signIn(app);
    const created = await transfer(agent, { fromAccountId: 'acc_alex_sav', toAccountId: 'acc_alex_chk', amount: '10' }).expect(201);
    const fetched = await agent.get(`/api/transfers/${created.body.transfer.id}`).expect(200);
    expect(fetched.body.transfer).toEqual(created.body.transfer);
  });
});

describe('transfers to saved payees', () => {
  it('debits the customer and credits the bank clearing account', async () => {
    const { db, app } = setup();
    const agent = await signIn(app);
    const chk = balanceOf(db, 'acc_alex_chk');
    const res = await transfer(agent, { fromAccountId: 'acc_alex_chk', payeeId: 'pay_alex_jordan', amount: '40' }).expect(201);
    expect(res.body.transfer.to).toMatchObject({ kind: 'payee', name: 'Jordan Lee' });
    expect(balanceOf(db, 'acc_alex_chk')).toBe(chk - 4000);
    expect(balanceOf(db, 'acc_bank_clearing')).toBe(4000);
    expectLedgerConsistent(db);
  });

  it('cannot use another customer’s payee', async () => {
    const { app } = setup();
    const agent = await signIn(app, 'alex');
    await transfer(agent, { fromAccountId: 'acc_alex_chk', payeeId: 'pay_sam_gym', amount: '5' }).expect(404);
  });
});

describe('invalid transfers are rejected without moving money', () => {
  it.each([
    ['zero', '0'],
    ['zero with decimals', '0.00'],
    ['negative', '-10'],
    ['too many decimals', '1.005'],
    ['not a number', 'ten'],
  ])('%s amount', async (_label, amount) => {
    const { db, app } = setup();
    const agent = await signIn(app);
    const before = balanceOf(db, 'acc_alex_chk');
    await transfer(agent, { fromAccountId: 'acc_alex_chk', toAccountId: 'acc_alex_sav', amount }).expect(400);
    expect(balanceOf(db, 'acc_alex_chk')).toBe(before);
  });

  it('insufficient funds', async () => {
    const { db, app } = setup();
    const agent = await signIn(app);
    const available = balanceOf(db, 'acc_alex_chk');
    const tooMuch = ((available + 1) / 100).toFixed(2);
    const res = await transfer(agent, { fromAccountId: 'acc_alex_chk', toAccountId: 'acc_alex_sav', amount: tooMuch }).expect(422);
    expect(res.body.error.code).toBe('insufficient_funds');
    expect(balanceOf(db, 'acc_alex_chk')).toBe(available);
  });

  it('allows sending the exact available balance', async () => {
    const { db, app } = setup();
    const agent = await signIn(app);
    const exact = (balanceOf(db, 'acc_alex_sav') / 100).toFixed(2);
    await transfer(agent, { fromAccountId: 'acc_alex_sav', toAccountId: 'acc_alex_chk', amount: exact }).expect(201);
    expect(balanceOf(db, 'acc_alex_sav')).toBe(0);
  });

  it('same source and destination', async () => {
    const { app } = setup();
    const agent = await signIn(app);
    const res = await transfer(agent, { fromAccountId: 'acc_alex_chk', toAccountId: 'acc_alex_chk', amount: '1' }).expect(422);
    expect(res.body.error.code).toBe('same_account');
  });

  it('source or destination owned by someone else', async () => {
    const { db, app } = setup();
    const agent = await signIn(app, 'alex');
    const samBefore = balanceOf(db, 'acc_sam_chk');
    await transfer(agent, { fromAccountId: 'acc_sam_chk', toAccountId: 'acc_alex_chk', amount: '1' }).expect(404);
    await transfer(agent, { fromAccountId: 'acc_alex_chk', toAccountId: 'acc_sam_chk', amount: '1' }).expect(404);
    await transfer(agent, { fromAccountId: 'acc_alex_chk', toAccountId: 'acc_bank_clearing', amount: '1' }).expect(404);
    expect(balanceOf(db, 'acc_sam_chk')).toBe(samBefore);
  });

  it('both or neither destination given', async () => {
    const { app } = setup();
    const agent = await signIn(app);
    await transfer(agent, { fromAccountId: 'acc_alex_chk', amount: '1' }).expect(400);
    await transfer(agent, { fromAccountId: 'acc_alex_chk', toAccountId: 'acc_alex_sav', payeeId: 'pay_alex_jordan', amount: '1' }).expect(400);
  });

  it('missing or malformed Idempotency-Key', async () => {
    const { app } = setup();
    const agent = await signIn(app);
    const body = { fromAccountId: 'acc_alex_chk', toAccountId: 'acc_alex_sav', amount: '1' };
    await agent.post('/api/transfers').send(body).expect(400);
    await agent.post('/api/transfers').set('Idempotency-Key', 'short').send(body).expect(400);
  });
});

describe('exactly-once submission', () => {
  const body = { fromAccountId: 'acc_alex_chk', toAccountId: 'acc_alex_sav', amount: '50.00' };

  it('a retry with the same key returns the original transfer and moves no more money', async () => {
    const { db, app } = setup();
    const agent = await signIn(app);
    const before = balanceOf(db, 'acc_alex_chk');
    const key = newKey();

    const first = await transfer(agent, body, key).expect(201);
    const retry = await transfer(agent, body, key).expect(200);

    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.transfer).toEqual(first.body.transfer);
    expect(balanceOf(db, 'acc_alex_chk')).toBe(before - 5000);
    expect(db.prepare('SELECT COUNT(*) AS n FROM transfers').get()).toEqual({ n: 1 });
  });

  it('simultaneous duplicate requests (double click) create one transfer', async () => {
    const { db, app } = setup();
    const agent = await signIn(app);
    const before = balanceOf(db, 'acc_alex_chk');
    const key = newKey();

    const results = await Promise.all(Array.from({ length: 5 }, () => transfer(agent, body, key)));

    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.transfer.id)).size).toBe(1);
    expect(balanceOf(db, 'acc_alex_chk')).toBe(before - 5000);
    expectLedgerConsistent(db);
  });

  it('reusing a key for a different transfer is refused', async () => {
    const { app } = setup();
    const agent = await signIn(app);
    const key = newKey();
    await transfer(agent, body, key).expect(201);
    const res = await transfer(agent, { ...body, amount: '60.00' }, key).expect(409);
    expect(res.body.error.code).toBe('idempotency_key_reused');
  });

  it('keys are scoped per customer', async () => {
    const { app } = setup();
    const alex = await signIn(app, 'alex');
    const sam = await signIn(app, 'sam');
    const key = newKey();
    await transfer(alex, body, key).expect(201);
    await transfer(sam, { fromAccountId: 'acc_sam_chk', toAccountId: 'acc_sam_sav', amount: '50.00' }, key).expect(201);
  });

  it('distinct keys are distinct transfers', async () => {
    const { db, app } = setup();
    const agent = await signIn(app);
    const before = balanceOf(db, 'acc_alex_chk');
    await transfer(agent, body).expect(201);
    await transfer(agent, body).expect(201);
    expect(balanceOf(db, 'acc_alex_chk')).toBe(before - 10000);
  });
});
