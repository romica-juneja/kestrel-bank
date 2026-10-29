import request from 'supertest';
import { createApp, type AppOptions } from '../src/app.js';
import { openDatabase, type Db } from '../src/db/connection.js';
import { DEMO_PASSWORD } from '../src/db/seed.js';

export const NOW = new Date('2026-10-15T12:00:00.000Z');

export function setup(opts: AppOptions = {}) {
  const db = openDatabase({ path: ':memory:', now: NOW });
  const app = createApp(db, { secureCookies: false, anthropicApiKey: '', openaiApiKey: '', ...opts });
  return { db, app };
}

/** Returns a supertest agent that keeps the session cookie, already signed in. */
export async function signIn(app: ReturnType<typeof createApp>, username = 'alex') {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username, password: DEMO_PASSWORD }).expect(200);
  return agent;
}

export const balanceOf = (db: Db, accountId: string) =>
  (db.prepare('SELECT balance_cents FROM accounts WHERE id = ?').get(accountId) as { balance_cents: number }).balance_cents;

let keyCounter = 0;
export const newKey = () => `test-key-${Date.now()}-${++keyCounter}-padding`;
