import bcrypt from 'bcryptjs';
import { Router, type CookieOptions } from 'express';
import { z } from 'zod';
import { LoginThrottle } from '../auth/loginThrottle.js';
import { currentCustomerId } from '../auth/middleware.js';
import { SESSION_COOKIE, type SessionStore } from '../auth/sessions.js';
import type { Db } from '../db/connection.js';
import { AppError } from '../lib/errors.js';

const LoginBody = z.object({
  username: z.string().trim().min(1, 'Enter your username.').max(64),
  password: z.string().min(1, 'Enter your password.').max(128),
});

// Compared against when the username doesn't exist, so response time doesn't reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function authRoutes(db: Db, sessions: SessionStore, opts: { secureCookies: boolean; requireAuth: import('express').RequestHandler }) {
  const router = Router();
  const throttle = new LoginThrottle();
  const cookieOptions: CookieOptions = { httpOnly: true, sameSite: 'strict', secure: opts.secureCookies, path: '/' };

  router.post('/login', async (req, res) => {
    const { username, password } = LoginBody.parse(req.body);
    const throttleKey = `${username.toLowerCase()}|${req.ip}`;
    if (throttle.isBlocked(throttleKey)) {
      throw new AppError(429, 'too_many_attempts', 'Too many failed sign-in attempts. Wait 15 minutes and try again.');
    }

    const user = db
      .prepare('SELECT id, username, display_name, password_hash FROM customers WHERE username = ?')
      .get(username) as { id: string; username: string; display_name: string; password_hash: string } | undefined;
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
      throttle.recordFailure(throttleKey);
      throw new AppError(401, 'invalid_credentials', 'Username or password is incorrect.');
    }

    throttle.reset(throttleKey);
    const token = sessions.create(user.id);
    res.cookie(SESSION_COOKIE, token, cookieOptions);
    res.json({ customer: { id: user.id, username: user.username, displayName: user.display_name } });
  });

  router.post('/logout', (req, res) => {
    sessions.revoke(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.status(204).end();
  });

  router.get('/me', opts.requireAuth, (_req, res) => {
    const row = db
      .prepare('SELECT id, username, display_name FROM customers WHERE id = ?')
      .get(currentCustomerId(res)) as { id: string; username: string; display_name: string };
    res.json({ customer: { id: row.id, username: row.username, displayName: row.display_name } });
  });

  return router;
}
