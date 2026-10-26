import { Router } from 'express';
import { z } from 'zod';
import { currentCustomerId } from '../auth/middleware.js';
import type { Db } from '../db/connection.js';
import { AppError } from '../lib/errors.js';
import { parseAmountToCents } from '../lib/money.js';
import { getOwnedAccount, listAccounts } from '../services/accounts.js';
import { askAssistant } from '../services/assistant/index.js';
import { listPayees } from '../services/payees.js';
import { queryTransactions } from '../services/transactions.js';
import { executeTransfer, getTransfer } from '../services/transfers.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.').refine((s) => !Number.isNaN(Date.parse(s)), 'Not a real date.');

const TransactionQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    type: z.enum(['debit', 'credit']).optional(),
    category: z.string().max(32).optional(),
    search: z.string().trim().max(100).optional().transform((s) => s || undefined),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'Start date must be on or before end date.', path: ['from'] });

// Control characters are stripped so notes can't break statements or logs.
const Note = z
  .string()
  .max(140, 'Keep the note under 140 characters.')
  .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, '').trim())
  .optional();

const TransferBody = z
  .object({
    fromAccountId: z.string().min(1).max(64),
    toAccountId: z.string().min(1).max(64).optional(),
    payeeId: z.string().min(1).max(64).optional(),
    amount: z.string().max(16),
    note: Note,
  })
  .refine((b) => Boolean(b.toAccountId) !== Boolean(b.payeeId), {
    message: 'Choose exactly one destination: one of your accounts or a saved payee.',
    path: ['toAccountId'],
  });

const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, 'Idempotency-Key header must be 16–128 URL-safe characters.');

const AssistantBody = z.object({
  message: z.string().trim().min(1).max(500),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(20)
    .default([]),
});

export function bankingRoutes(db: Db, opts: { anthropicApiKey: string; anthropicModel: string; fetchImpl?: typeof fetch }) {
  const router = Router();

  router.get('/accounts', (_req, res) => {
    res.json({ accounts: listAccounts(db, currentCustomerId(res)) });
  });

  router.get('/accounts/:accountId', (req, res) => {
    res.json({ account: getOwnedAccount(db, currentCustomerId(res), req.params.accountId) });
  });

  router.get('/accounts/:accountId/transactions', (req, res) => {
    const query = TransactionQuery.parse(req.query);
    res.json(queryTransactions(db, currentCustomerId(res), req.params.accountId, query));
  });

  router.get('/payees', (_req, res) => {
    res.json({ payees: listPayees(db, currentCustomerId(res)) });
  });

  router.post('/transfers', (req, res) => {
    const keyResult = IdempotencyKey.safeParse(req.get('Idempotency-Key'));
    if (!keyResult.success) {
      throw new AppError(400, 'idempotency_key_required', 'Idempotency-Key header must be 16–128 URL-safe characters.');
    }
    const body = TransferBody.parse(req.body);
    const amountCents = parseAmountToCents(body.amount);
    if (amountCents === null || amountCents <= 0) {
      throw new AppError(400, 'invalid_amount', 'Enter an amount greater than zero, with up to two decimal places.', [
        { field: 'amount', message: 'Enter an amount greater than zero, with up to two decimal places.' },
      ]);
    }

    const { transfer, replayed } = executeTransfer(db, currentCustomerId(res), keyResult.data, {
      fromAccountId: body.fromAccountId,
      destination: body.payeeId ? { kind: 'payee', payeeId: body.payeeId } : { kind: 'account', accountId: body.toAccountId! },
      amountCents,
      note: body.note,
    });
    res.setHeader('Idempotent-Replayed', String(replayed));
    res.status(replayed ? 200 : 201).json({ transfer });
  });

  router.get('/transfers/:transferId', (req, res) => {
    res.json({ transfer: getTransfer(db, currentCustomerId(res), req.params.transferId) });
  });

  router.post('/assistant', async (req, res) => {
    const { message, history } = AssistantBody.parse(req.body);
    const answer = await askAssistant(db, currentCustomerId(res), message, history, {
      apiKey: opts.anthropicApiKey,
      model: opts.anthropicModel,
      fetchImpl: opts.fetchImpl,
    });
    res.json(answer);
  });

  return router;
}
