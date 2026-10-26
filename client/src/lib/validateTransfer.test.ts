import { describe, expect, it } from 'vitest';
import type { Account, Payee } from '../api/types';
import { emptyForm } from './transferDraft';
import { validateTransfer } from './validateTransfer';

const accounts: Account[] = [
  { id: 'chk', type: 'checking', name: 'Everyday Checking', accountNumberMasked: '•••• 1111', currency: 'USD', balanceCents: 10000 },
  { id: 'sav', type: 'savings', name: 'Rainy Day Savings', accountNumberMasked: '•••• 2222', currency: 'USD', balanceCents: 500 },
];
const payees: Payee[] = [{ id: 'p1', name: 'Jordan Lee', bankName: 'Maple CU', accountNumberMasked: '•••• 3333' }];
const form = (patch = {}) => ({ ...emptyForm(), fromAccountId: 'chk', toAccountId: 'sav', amount: '25', ...patch });

describe('validateTransfer', () => {
  it('accepts a valid transfer, including the full balance', () => {
    expect(validateTransfer(form(), accounts, payees)).toEqual({});
    expect(validateTransfer(form({ amount: '100.00' }), accounts, payees)).toEqual({});
  });

  it.each([
    ['', 'Enter an amount.'],
    ['0', 'Enter an amount greater than zero.'],
    ['-3', 'Enter an amount like 25 or 25.50.'],
    ['1.234', 'Enter an amount like 25 or 25.50.'],
  ])('rejects amount %j', (amount, message) => {
    expect(validateTransfer(form({ amount }), accounts, payees).amount).toBe(message);
  });

  it('rejects more than the available balance', () => {
    expect(validateTransfer(form({ amount: '100.01' }), accounts, payees).amount).toMatch(/more than the \$100\.00 available/);
  });

  it('rejects the same source and destination', () => {
    expect(validateTransfer(form({ toAccountId: 'chk' }), accounts, payees).toAccountId).toMatch(/different account/);
  });

  it('requires a payee when paying someone', () => {
    expect(validateTransfer(form({ destinationKind: 'payee' }), accounts, payees).payeeId).toBe('Choose who to pay.');
    expect(validateTransfer(form({ destinationKind: 'payee', payeeId: 'p1' }), accounts, payees)).toEqual({});
  });
});
