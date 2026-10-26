import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

/** An error that is safe to show to the client, with a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} not found.`);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_failed',
        message: 'Some fields are invalid.',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON.' } });
    return;
  }
  // Unknown error: log it, but never leak internals to the client.
  console.error(err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } });
};
