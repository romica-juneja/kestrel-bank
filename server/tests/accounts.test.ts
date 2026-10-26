import { describe, expect, it } from 'vitest';
import { setup, signIn } from './helpers.js';

describe('accounts and transaction history', () => {
  it('lists only the signed-in customer’s accounts, with masked numbers', async () => {
    const { app } = setup();
    const agent = await signIn(app, 'alex');
    const res = await agent.get('/api/accounts').expect(200);
    expect(res.body.accounts.map((a: { id: string }) => a.id)).toEqual(['acc_alex_chk', 'acc_alex_sav']);
    expect(res.body.accounts[0].accountNumberMasked).toBe('•••• 7781');
    expect(JSON.stringify(res.body)).not.toContain('2201'); // full numbers never leave the server
  });

  it('treats another customer’s account as not found', async () => {
    const { app } = setup();
    const agent = await signIn(app, 'alex');
    await agent.get('/api/accounts/acc_sam_chk').expect(404);
    await agent.get('/api/accounts/acc_sam_chk/transactions').expect(404);
    await agent.get('/api/accounts/acc_bank_clearing/transactions').expect(404);
  });

  it('returns history newest first with date, description, amount and direction', async () => {
    const { app } = setup();
    const agent = await signIn(app);
    const res = await agent.get('/api/accounts/acc_alex_chk/transactions?pageSize=50').expect(200);
    const dates = res.body.items.map((t: { postedAt: string }) => t.postedAt);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(res.body.items[0]).toMatchObject({
      postedAt: expect.any(String),
      description: expect.any(String),
      amountCents: expect.any(Number),
      direction: expect.stringMatching(/^(debit|credit)$/),
    });
  });

  it('paginates long histories', async () => {
    const { app } = setup();
    const agent = await signIn(app);
    const p1 = await agent.get('/api/accounts/acc_alex_chk/transactions?pageSize=10&page=1').expect(200);
    const p2 = await agent.get('/api/accounts/acc_alex_chk/transactions?pageSize=10&page=2').expect(200);
    expect(p1.body.items).toHaveLength(10);
    expect(p1.body.total).toBeGreaterThan(20);
    expect(p1.body.totalPages).toBe(Math.ceil(p1.body.total / 10));
    const ids1 = new Set(p1.body.items.map((t: { id: number }) => t.id));
    expect(p2.body.items.some((t: { id: number }) => ids1.has(t.id))).toBe(false);
  });

  it('filters by type, date range and text', async () => {
    const { app } = setup();
    const agent = await signIn(app);
    const credits = await agent.get('/api/accounts/acc_alex_chk/transactions?type=credit&pageSize=100').expect(200);
    expect(credits.body.items.every((t: { direction: string }) => t.direction === 'credit')).toBe(true);

    const ranged = await agent.get('/api/accounts/acc_alex_chk/transactions?from=2026-09-01&to=2026-09-30&pageSize=100').expect(200);
    expect(ranged.body.total).toBeGreaterThan(0);
    for (const t of ranged.body.items) expect(t.postedAt.slice(0, 7)).toBe('2026-09');

    const search = await agent.get('/api/accounts/acc_alex_chk/transactions?search=payroll&pageSize=100').expect(200);
    expect(search.body.total).toBeGreaterThan(0);
    expect(search.body.items.every((t: { description: string }) => /payroll/i.test(t.description))).toBe(true);
  });

  it('treats LIKE wildcards in search as plain text', async () => {
    const { app } = setup();
    const agent = await signIn(app);
    const res = await agent.get('/api/accounts/acc_alex_chk/transactions?search=%25').expect(200);
    expect(res.body.total).toBe(0);
  });

  it('validates filter input', async () => {
    const { app } = setup();
    const agent = await signIn(app);
    await agent.get('/api/accounts/acc_alex_chk/transactions?from=2026-13-45').expect(400);
    await agent.get('/api/accounts/acc_alex_chk/transactions?type=refund').expect(400);
    await agent.get('/api/accounts/acc_alex_chk/transactions?from=2026-10-01&to=2026-09-01').expect(400);
    await agent.get('/api/accounts/acc_alex_chk/transactions?pageSize=1000').expect(400);
  });

  it('keeps a correct running balance on every line', async () => {
    const { app } = setup();
    const agent = await signIn(app);
    const res = await agent.get('/api/accounts/acc_alex_chk/transactions?pageSize=100').expect(200);
    const [newest, ...older] = res.body.items;
    const account = await agent.get('/api/accounts/acc_alex_chk').expect(200);
    expect(newest.balanceAfterCents).toBe(account.body.account.balanceCents);
    let expected = newest.balanceAfterCents - (newest.direction === 'credit' ? newest.amountCents : -newest.amountCents);
    for (const t of older) {
      expect(t.balanceAfterCents).toBe(expected);
      expected -= t.direction === 'credit' ? t.amountCents : -t.amountCents;
    }
  });
});
