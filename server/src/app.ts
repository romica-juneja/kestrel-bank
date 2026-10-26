import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { requireAuth, requireJsonForMutations } from './auth/middleware.js';
import { SessionStore } from './auth/sessions.js';
import { config } from './config.js';
import type { Db } from './db/connection.js';
import { AppError, errorHandler } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { bankingRoutes } from './routes/banking.js';

export interface AppOptions {
  secureCookies?: boolean;
  sessionIdleMinutes?: number;
  anthropicApiKey?: string;
  anthropicModel?: string;
  fetchImpl?: typeof fetch;
}

export function createApp(db: Db, opts: AppOptions = {}) {
  const app = express();
  const sessions = new SessionStore(db, opts.sessionIdleMinutes ?? config.sessionIdleMinutes);
  const auth = requireAuth(sessions);

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());
  app.use('/api', requireJsonForMutations);
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); // never cache financial data
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/api/auth', authRoutes(db, sessions, { secureCookies: opts.secureCookies ?? config.isProduction, requireAuth: auth }));
  app.use(
    '/api',
    auth,
    bankingRoutes(db, {
      anthropicApiKey: opts.anthropicApiKey ?? config.anthropicApiKey,
      anthropicModel: opts.anthropicModel ?? config.anthropicModel,
      fetchImpl: opts.fetchImpl,
    }),
  );
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'not_found', 'No such endpoint.')));
  app.use(errorHandler);
  return app;
}
