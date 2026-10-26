import type { RequestHandler, Response } from 'express';
import { AppError } from '../lib/errors.js';
import { SESSION_COOKIE, type SessionStore } from './sessions.js';

/** Rejects requests without a valid session and exposes the signed-in customer's id. */
export function requireAuth(sessions: SessionStore): RequestHandler {
  return (req, res, next) => {
    const customerId = sessions.resolve(req.cookies?.[SESSION_COOKIE]);
    if (!customerId) {
      next(new AppError(401, 'unauthenticated', 'Please sign in to continue.'));
      return;
    }
    res.locals.customerId = customerId;
    next();
  };
}

export function currentCustomerId(res: Response): string {
  const id = res.locals.customerId as string | undefined;
  if (!id) throw new AppError(401, 'unauthenticated', 'Please sign in to continue.');
  return id;
}

/**
 * CSRF defence in depth: on top of SameSite=Strict cookies, state-changing requests must be
 * JSON. A cross-site HTML form cannot send application/json without a CORS preflight, which
 * this API never approves.
 */
export const requireJsonForMutations: RequestHandler = (req, _res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    next(new AppError(415, 'unsupported_media_type', 'Requests must be sent as JSON.'));
    return;
  }
  next();
};
