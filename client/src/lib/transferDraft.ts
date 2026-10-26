import { useCallback, useEffect, useState } from 'react';

export interface TransferForm {
  fromAccountId: string;
  destinationKind: 'account' | 'payee';
  toAccountId: string;
  payeeId: string;
  amount: string;
  note: string;
}

export interface TransferDraft {
  step: 'details' | 'review';
  form: TransferForm;
  /**
   * Created when the customer reaches the review step and kept until the transfer succeeds or
   * the details change. Double clicks, retries after a network error and page refreshes all
   * resend the same key, so the server moves the money at most once.
   */
  idempotencyKey: string | null;
}

const STORAGE_KEY = 'kestrel.transferDraft';

export const emptyForm = (): TransferForm => ({
  fromAccountId: '',
  destinationKind: 'account',
  toAccountId: '',
  payeeId: '',
  amount: '',
  note: '',
});

function load(): TransferDraft {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as TransferDraft;
  } catch {
    /* ignore corrupt drafts */
  }
  return { step: 'details', form: emptyForm(), idempotencyKey: null };
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** Transfer draft kept in sessionStorage (cleared on sign out and when the tab closes). */
export function useTransferDraft() {
  const [draft, setDraft] = useState<TransferDraft>(load);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  }, [draft]);

  const clear = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setDraft({ step: 'details', form: emptyForm(), idempotencyKey: null });
  }, []);

  return { draft, setDraft, clear };
}

export const discardTransferDraft = () => sessionStorage.removeItem(STORAGE_KEY);
