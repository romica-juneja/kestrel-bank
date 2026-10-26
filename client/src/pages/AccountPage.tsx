import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { TransactionFilters } from '../api/types';
import { Money, SignedAmount } from '../components/Money';
import { ErrorNotice } from '../components/Notice';
import { formatDate, formatMoney } from '../lib/format';
import { useAsync } from '../lib/useAsync';

/** Filters live in the URL so they survive refresh and the back button. */
function readFilters(params: URLSearchParams): TransactionFilters {
  const type = params.get('type');
  return {
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    type: type === 'debit' || type === 'credit' ? type : undefined,
    search: params.get('search') ?? undefined,
    page: Math.max(1, Number(params.get('page')) || 1),
  };
}

export function AccountPage() {
  const { accountId = '' } = useParams();
  // A new account id must not keep the previous account's rows while its own history loads.
  return <AccountHistory key={accountId} accountId={accountId} />;
}

function AccountHistory({ accountId }: { accountId: string }) {
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const account = useAsync(() => api.account(accountId), [accountId]);
  const history = useAsync(() => api.transactions(accountId, filters), [accountId, params.toString()]);

  const [form, setForm] = useState({ from: filters.from ?? '', to: filters.to ?? '', type: filters.type ?? '', search: filters.search ?? '' });
  const [formError, setFormError] = useState<string>();

  // Filters live in the URL. Back/forward changes that URL without going through the form.
  useEffect(() => {
    setForm({ from: filters.from ?? '', to: filters.to ?? '', type: filters.type ?? '', search: filters.search ?? '' });
    setFormError(undefined);
  }, [filters.from, filters.to, filters.type, filters.search]);

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    if (form.from && form.to && form.from > form.to) {
      setFormError('The start date must be on or before the end date.');
      return;
    }
    setFormError(undefined);
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) if (v.trim()) next.set(k, v.trim());
    setParams(next);
  }

  function clearFilters() {
    setForm({ from: '', to: '', type: '', search: '' });
    setFormError(undefined);
    setParams(new URLSearchParams());
  }

  const goToPage = (page: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(page));
    setParams(next);
  };

  if (account.error) {
    return (
      <section className="page">
        <ErrorNotice>{account.error.status === 404 ? 'We couldn’t find that account.' : account.error.message}</ErrorNotice>
        <Link to="/accounts">Back to accounts</Link>
      </section>
    );
  }

  const hasFilters = Boolean(filters.from || filters.to || filters.type || filters.search);
  const page = history.data;

  return (
    <section className="page page-wide">
      <Link to="/accounts" className="back-link">All accounts</Link>
      {account.data && (
        <header className="account-header">
          <div>
            <h1>{account.data.account.name}</h1>
            <p className="muted">
              {account.data.account.type === 'checking' ? 'Checking' : 'Savings'} {account.data.account.accountNumberMasked}
            </p>
          </div>
          <div className="account-header-balance">
            <span className="muted">Available balance</span>
            <Money cents={account.data.account.balanceCents} className="money-large" />
          </div>
        </header>
      )}

      <form className="filters" onSubmit={applyFilters} aria-label="Filter transactions">
        <div className="field">
          <label htmlFor="f-search">Search</label>
          <input id="f-search" type="search" placeholder="e.g. FreshMart" maxLength={100} value={form.search} onChange={(e) => setForm({ ...form, search: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="f-from">From</label>
          <input id="f-from" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="f-to">To</label>
          <input id="f-to" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="f-type">Type</label>
          <select id="f-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="">All</option>
            <option value="debit">Money out</option>
            <option value="credit">Money in</option>
          </select>
        </div>
        <div className="filter-actions">
          <button type="submit" className="button-secondary">Apply</button>
          {hasFilters && (
            <button type="button" className="button-quiet" onClick={clearFilters}>Clear</button>
          )}
        </div>
        {formError && <p className="field-error filters-error" role="alert">{formError}</p>}
      </form>

      {history.error && <ErrorNotice onRetry={history.reload}>{history.error.message}</ErrorNotice>}

      {page && (
        <>
          <p className="result-count muted" role="status">
            {page.total === 0
              ? hasFilters ? 'No transactions match these filters. Try a wider date range or clear the filters.' : 'No transactions yet.'
              : `${page.total} transaction${page.total === 1 ? '' : 's'}${hasFilters ? ' match' : ''}, newest first`}
          </p>
          {page.total > 0 && (
            <div className="table-scroll">
              <table className={`ledger ${history.loading ? 'is-loading' : ''}`}>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Description</th>
                    <th scope="col" className="num">Amount</th>
                    <th scope="col" className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((t) => (
                    <tr key={t.id}>
                      <td className="date">{formatDate(t.postedAt)}</td>
                      <td>
                        <span className="desc">{t.description}</span>
                        <span className="category">{t.category}</span>
                        <span className="mobile-date">{formatDate(t.postedAt)}</span>
                      </td>
                      <td className="num"><SignedAmount cents={t.amountCents} direction={t.direction} /></td>
                      <td className="num muted">{formatMoney(t.balanceAfterCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {page.totalPages > 1 && (
            <nav className="pager" aria-label="Transaction pages">
              <button type="button" className="button-secondary" disabled={page.page <= 1} onClick={() => goToPage(page.page - 1)}>
                Newer
              </button>
              <span>Page {page.page} of {page.totalPages}</span>
              <button type="button" className="button-secondary" disabled={page.page >= page.totalPages} onClick={() => goToPage(page.page + 1)}>
                Older
              </button>
            </nav>
          )}
        </>
      )}
      {!page && history.loading && <p className="status-line" role="status">Loading transactions…</p>}
    </section>
  );
}
