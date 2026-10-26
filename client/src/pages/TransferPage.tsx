import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Account, Payee } from '../api/types';
import { Money } from '../components/Money';
import { ErrorNotice } from '../components/Notice';
import { formatMoney, parseAmount } from '../lib/format';
import { newIdempotencyKey, useTransferDraft, type TransferForm } from '../lib/transferDraft';
import { useAsync } from '../lib/useAsync';
import { validateTransfer, type TransferErrors } from '../lib/validateTransfer';

export function TransferPage() {
  const data = useAsync(() => Promise.all([api.accounts(), api.payees()]), []);
  if (data.error) return <section className="page"><ErrorNotice onRetry={data.reload}>{data.error.message}</ErrorNotice></section>;
  if (!data.data) return <section className="page"><p className="status-line" role="status">Loading…</p></section>;
  const [{ accounts }, { payees }] = data.data;
  return <TransferFlow accounts={accounts} payees={payees} />;
}

function Steps({ current }: { current: 1 | 2 | 3 }) {
  const labels = ['Details', 'Review', 'Done'];
  return (
    <ol className="steps" aria-label="Transfer progress">
      {labels.map((l, i) => (
        <li key={l} className={i + 1 === current ? 'is-current' : i + 1 < current ? 'is-done' : ''} aria-current={i + 1 === current ? 'step' : undefined}>
          {l}
        </li>
      ))}
    </ol>
  );
}

export function TransferFlow({ accounts, payees }: { accounts: Account[]; payees: Payee[] }) {
  const navigate = useNavigate();
  const { draft, setDraft, clear } = useTransferDraft();
  const [errors, setErrors] = useState<TransferErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false); // synchronous guard: state updates can lag a fast double click
  const [submitError, setSubmitError] = useState<ApiError>();
  const form = draft.form;

  // Sensible defaults: send from checking to savings.
  useEffect(() => {
    if (!form.fromAccountId && accounts[0]) {
      setDraft((d) => ({ ...d, form: { ...d.form, fromAccountId: accounts[0]!.id, toAccountId: accounts[1]?.id ?? '' } }));
    }
  }, [accounts, form.fromAccountId, setDraft]);

  const update = (patch: Partial<TransferForm>) => {
    // Any change to the details means a different transfer, so it needs a new key.
    setDraft((d) => ({ ...d, form: { ...d.form, ...patch }, idempotencyKey: null }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k as keyof TransferErrors];
      return next;
    });
  };

  function review(e: FormEvent) {
    e.preventDefault();
    const found = validateTransfer(form, accounts, payees);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSubmitError(undefined);
    setDraft((d) => ({ ...d, step: 'review', idempotencyKey: d.idempotencyKey ?? newIdempotencyKey() }));
  }

  async function submit() {
    if (inFlight.current || !draft.idempotencyKey) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const { transfer } = await api.createTransfer(
        {
          fromAccountId: form.fromAccountId,
          ...(form.destinationKind === 'account' ? { toAccountId: form.toAccountId } : { payeeId: form.payeeId }),
          amount: form.amount.trim(),
          note: form.note.trim() || undefined,
        },
        draft.idempotencyKey,
      );
      clear();
      // Replace history so Back or refresh shows the result instead of resubmitting.
      navigate(`/transfers/${transfer.id}`, { replace: true });
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError(0, 'network_error', String(err));
      setSubmitError(apiErr);
      if (apiErr.code === 'idempotency_key_reused') setDraft((d) => ({ ...d, idempotencyKey: newIdempotencyKey() }));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const from = accounts.find((a) => a.id === form.fromAccountId);
  const toAccount = accounts.find((a) => a.id === form.toAccountId);
  const payee = payees.find((p) => p.id === form.payeeId);
  const cents = parseAmount(form.amount) ?? 0;

  if (draft.step === 'review' && from) {
    const toLabel = form.destinationKind === 'account' ? `${toAccount?.name} ${toAccount?.accountNumberMasked}` : `${payee?.name}, ${payee?.bankName} ${payee?.accountNumberMasked}`;
    return (
      <section className="page">
        <Steps current={2} />
        <h1>Check your transfer</h1>
        <dl className="summary">
          <div><dt>Amount</dt><dd><Money cents={cents} className="money-large" /></dd></div>
          <div><dt>From</dt><dd>{from.name} {from.accountNumberMasked}</dd></div>
          <div><dt>To</dt><dd>{toLabel}</dd></div>
          {form.note.trim() && <div><dt>Note</dt><dd>{form.note.trim()}</dd></div>}
          <div><dt>{from.name} after transfer</dt><dd>{formatMoney(from.balanceCents - cents)}</dd></div>
        </dl>

        {submitError && (
          <ErrorNotice>
            {submitError.isNetworkError
              ? 'We couldn’t confirm whether the transfer went through. Sending it again is safe: it won’t be made twice.'
              : submitError.message}
          </ErrorNotice>
        )}

        <div className="actions">
          <button type="button" className="button-primary" onClick={submit} disabled={submitting}>
            {submitting ? 'Sending…' : submitError?.isNetworkError ? `Send ${formatMoney(cents)} again` : `Send ${formatMoney(cents)}`}
          </button>
          <button type="button" className="button-quiet" disabled={submitting} onClick={() => setDraft((d) => ({ ...d, step: 'details' }))}>
            Edit details
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <Steps current={1} />
      <h1>Move money</h1>
      <form className="transfer-form" onSubmit={review} noValidate>
        <div className="field">
          <label htmlFor="t-from">From</label>
          <select id="t-from" value={form.fromAccountId} aria-invalid={Boolean(errors.fromAccountId)} aria-describedby="t-from-err" onChange={(e) => update({ fromAccountId: e.target.value })}>
            <option value="">Choose an account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} {a.accountNumberMasked} · {formatMoney(a.balanceCents)} available</option>
            ))}
          </select>
          {errors.fromAccountId && <p id="t-from-err" className="field-error">{errors.fromAccountId}</p>}
        </div>

        <fieldset className="field">
          <legend>To</legend>
          <div className="segmented">
            <label className={form.destinationKind === 'account' ? 'is-on' : ''}>
              <input type="radio" name="destKind" checked={form.destinationKind === 'account'} onChange={() => update({ destinationKind: 'account' })} />
              One of my accounts
            </label>
            <label className={form.destinationKind === 'payee' ? 'is-on' : ''}>
              <input type="radio" name="destKind" checked={form.destinationKind === 'payee'} onChange={() => update({ destinationKind: 'payee' })} />
              A saved payee
            </label>
          </div>
          {form.destinationKind === 'account' ? (
            <>
              <label htmlFor="t-to" className="visually-hidden">Destination account</label>
              <select id="t-to" value={form.toAccountId} aria-invalid={Boolean(errors.toAccountId)} aria-describedby="t-to-err" onChange={(e) => update({ toAccountId: e.target.value })}>
                <option value="">Choose an account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} {a.accountNumberMasked}</option>
                ))}
              </select>
              {errors.toAccountId && <p id="t-to-err" className="field-error">{errors.toAccountId}</p>}
            </>
          ) : (
            <>
              <label htmlFor="t-payee" className="visually-hidden">Payee</label>
              <select id="t-payee" value={form.payeeId} aria-invalid={Boolean(errors.payeeId)} aria-describedby="t-payee-err" onChange={(e) => update({ payeeId: e.target.value })}>
                <option value="">Choose a payee</option>
                {payees.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {p.bankName} {p.accountNumberMasked}</option>
                ))}
              </select>
              {errors.payeeId && <p id="t-payee-err" className="field-error">{errors.payeeId}</p>}
            </>
          )}
        </fieldset>

        <div className="field">
          <label htmlFor="t-amount">Amount</label>
          <div className="amount-input">
            <span aria-hidden="true">$</span>
            <input id="t-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={form.amount} aria-invalid={Boolean(errors.amount)} aria-describedby="t-amount-err" onChange={(e) => update({ amount: e.target.value })} />
          </div>
          {errors.amount && <p id="t-amount-err" className="field-error">{errors.amount}</p>}
        </div>

        <div className="field">
          <label htmlFor="t-note">Note <span className="muted">(optional)</span></label>
          <input id="t-note" maxLength={140} value={form.note} aria-describedby="t-note-err" onChange={(e) => update({ note: e.target.value })} />
          {errors.note && <p id="t-note-err" className="field-error">{errors.note}</p>}
        </div>

        <div className="actions">
          <button type="submit" className="button-primary">Review transfer</button>
        </div>
      </form>
    </section>
  );
}
