import type { Account, Payee } from '../api/types';
import { formatMoney, parseAmount } from './format';
import type { TransferForm } from './transferDraft';

export type TransferErrors = Partial<Record<'fromAccountId' | 'toAccountId' | 'payeeId' | 'amount' | 'note', string>>;

/** Client-side checks for fast feedback. The server repeats all of them and is the authority. */
export function validateTransfer(form: TransferForm, accounts: Account[], payees: Payee[]): TransferErrors {
  const errors: TransferErrors = {};
  const from = accounts.find((a) => a.id === form.fromAccountId);
  if (!from) errors.fromAccountId = 'Choose the account to send from.';

  if (form.destinationKind === 'account') {
    if (!accounts.some((a) => a.id === form.toAccountId)) errors.toAccountId = 'Choose the account to send to.';
    else if (form.toAccountId === form.fromAccountId) errors.toAccountId = 'Choose a different account from the one you’re sending from.';
  } else if (!payees.some((p) => p.id === form.payeeId)) {
    errors.payeeId = 'Choose who to pay.';
  }

  const cents = parseAmount(form.amount);
  if (!form.amount.trim()) errors.amount = 'Enter an amount.';
  else if (cents === null) errors.amount = 'Enter an amount like 25 or 25.50.';
  else if (cents <= 0) errors.amount = 'Enter an amount greater than zero.';
  else if (from && cents > from.balanceCents) errors.amount = `That’s more than the ${formatMoney(from.balanceCents)} available in ${from.name}.`;

  if (form.note.length > 140) errors.note = 'Keep the note under 140 characters.';
  return errors;
}
