import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DEMO_PASSWORD } from '../src/db/seed.js';
import { setup, signIn } from './helpers.js';

describe('authentication', () => {
  it('signs in with valid credentials and sets an httpOnly, SameSite=Strict cookie', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/auth/login').send({ username: 'alex', password: DEMO_PASSWORD }).expect(200);
    expect(res.body.customer).toEqual({ id: 'cus_alex', username: 'alex', displayName: 'Alex Morgan' });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  it('rejects a wrong password with a generic message', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/auth/login').send({ username: 'alex', password: 'nope' }).expect(401);
    expect(res.body.error.code).toBe('invalid_credentials');
    const unknown = await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'nope' }).expect(401);
    expect(unknown.body.error.message).toBe(res.body.error.message); // no username enumeration
  });

  it('blocks protected endpoints without a session', async () => {
    const { app } = setup();
    for (const path of ['/api/accounts', '/api/payees', '/api/accounts/acc_alex_chk/transactions', '/api/auth/me']) {
      await request(app).get(path).expect(401);
    }
  });

  it('ends the session on sign out', async () => {
    const { app } = setup();
    const agent = await signIn(app);
    await agent.get('/api/accounts').expect(200);
    await agent.post('/api/auth/logout').send({}).expect(204);
    await agent.get('/api/accounts').expect(401);
  });

  it('throttles repeated failed sign-ins', async () => {
    const { app } = setup();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ username: 'alex', password: 'wrong' }).expect(401);
    }
    const res = await request(app).post('/api/auth/login').send({ username: 'alex', password: DEMO_PASSWORD }).expect(429);
    expect(res.body.error.code).toBe('too_many_attempts');
  });

  it('rejects non-JSON state-changing requests (CSRF defence)', async () => {
    const { app } = setup();
    const agent = await signIn(app);
    await agent
      .post('/api/transfers')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('fromAccountId=acc_alex_chk&toAccountId=acc_alex_sav&amount=10')
      .expect(415);
  });
});
