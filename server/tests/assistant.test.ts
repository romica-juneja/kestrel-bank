import { describe, expect, it, vi } from 'vitest';
import { formatCents } from '../src/lib/money.js';
import { balanceOf, setup, signIn } from './helpers.js';

const ask = async (agent: Awaited<ReturnType<typeof signIn>>, message: string) =>
  (await agent.post('/api/assistant').send({ message }).expect(200)).body as { reply: string; source: string };

describe('assistant (rule-based fallback)', () => {
  it('answers balance questions from the customer’s own data', async () => {
    const { db, app } = setup();
    const agent = await signIn(app);
    const { reply, source } = await ask(agent, 'What is my checking balance?');
    expect(source).toBe('rules');
    expect(reply).toContain(formatCents(balanceOf(db, 'acc_alex_chk')));
    expect(reply).not.toContain('Savings');
  });

  it('answers category spending for this month', async () => {
    const { db, app } = setup();
    const agent = await signIn(app);
    const expected = db
      .prepare(
        `SELECT SUM(amount_cents) AS s FROM transactions WHERE account_id IN ('acc_alex_chk','acc_alex_sav')
         AND category = 'groceries' AND direction = 'debit' AND posted_at >= '2026-10-01'`,
      )
      .get() as { s: number };
    const { reply } = await ask(agent, 'How much did I spend on groceries this month?');
    expect(reply).toContain(formatCents(expected.s));
  });

  it('lists the last five transactions', async () => {
    const { app } = setup();
    const agent = await signIn(app);
    const { reply } = await ask(agent, 'Show my last five transactions');
    expect(reply.split('\n')).toHaveLength(6);
  });

  it('never sees another customer’s data', async () => {
    const { db, app } = setup();
    const agent = await signIn(app, 'sam');
    const { reply } = await ask(agent, 'What is my balance?');
    expect(reply).toContain(formatCents(balanceOf(db, 'acc_sam_chk')));
    expect(reply).not.toContain(formatCents(balanceOf(db, 'acc_alex_chk')));
  });

  it('is read-only: asking it to move money changes nothing', async () => {
    const { db, app } = setup();
    const agent = await signIn(app);
    const before = balanceOf(db, 'acc_alex_chk');
    const { reply } = await ask(agent, 'Transfer $500 from checking to savings');
    expect(reply).toMatch(/can only look/i);
    expect(balanceOf(db, 'acc_alex_chk')).toBe(before);
  });

  it('requires a session', async () => {
    const { app } = setup();
    const { default: request } = await import('supertest');
    await request(app).post('/api/assistant').send({ message: 'balance' }).expect(401);
  });
});

describe('assistant (LLM with read-only tools)', () => {
  it('runs tool calls server-side, scoped to the signed-in customer', async () => {
    const calls: unknown[] = [];
    const fakeFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      // The model may only see read tools.
      expect(body.tools.map((t: { name: string }) => t.name)).toEqual(['get_accounts', 'get_recent_transactions', 'get_spending']);
      const reply =
        calls.length === 1
          ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'get_accounts', input: {} }] }
          : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here are your balances.' }] };
      return new Response(JSON.stringify(reply), { status: 200 });
    });

    const { db, app } = setup({ anthropicApiKey: 'test-key', fetchImpl: fakeFetch as typeof fetch });
    const agent = await signIn(app, 'alex');
    const res = await ask(agent, 'What are my balances?');

    expect(res).toEqual({ reply: 'Here are your balances.', source: 'llm' });
    const toolResult = JSON.stringify((calls[1] as { messages: unknown[] }).messages.at(-1));
    expect(toolResult).toContain(formatCents(balanceOf(db, 'acc_alex_chk')).replace('$', ''));
    expect(toolResult).not.toContain('Sam');
  });

  it('falls back to rules when the LLM is unavailable', async () => {
    const fakeFetch = vi.fn(async () => new Response('down', { status: 503 }));
    const { app } = setup({ anthropicApiKey: 'test-key', fetchImpl: fakeFetch as typeof fetch });
    const agent = await signIn(app);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await ask(agent, 'What is my savings balance?');
    expect(res.source).toBe('rules');
    warn.mockRestore();
  });
});
