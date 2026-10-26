import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { Money } from '../components/Money';
import { ErrorNotice } from '../components/Notice';
import { formatDateTime, formatMoney } from '../lib/format';
import { useAsync } from '../lib/useAsync';

/** Read-only result page: refreshing it re-reads the transfer, never re-sends it. */
export function TransferResultPage() {
  const { transferId = '' } = useParams();
  return <TransferReceipt key={transferId} transferId={transferId} />;
}

function TransferReceipt({ transferId }: { transferId: string }) {
  const { data, error, reload } = useAsync(() => api.transfer(transferId), [transferId]);

  if (error) return <section className="page"><ErrorNotice onRetry={reload}>{error.status === 404 ? 'We couldn’t find that transfer.' : error.message}</ErrorNotice></section>;
  if (!data) return <section className="page"><p className="status-line" role="status">Loading…</p></section>;
  const t = data.transfer;

  return (
    <section className="page">
      <ol className="steps" aria-label="Transfer progress">
        <li className="is-done">Details</li>
        <li className="is-done">Review</li>
        <li className="is-current" aria-current="step">Done</li>
      </ol>
      <div className="result" role="status">
        <h1>Transfer sent</h1>
        <p className="result-amount"><Money cents={t.amountCents} className="money-large" /></p>
        <p>
          to {t.to.name} {t.to.accountNumberMasked}
          {t.to.kind === 'payee' && `, ${t.to.bankName}`}
        </p>
      </div>
      <dl className="summary">
        <div><dt>From</dt><dd>{t.from.name} {t.from.accountNumberMasked}</dd></div>
        <div><dt>{t.from.name} balance after</dt><dd>{formatMoney(t.from.balanceAfterCents)}</dd></div>
        {t.to.kind === 'account' && <div><dt>{t.to.name} balance after</dt><dd>{formatMoney(t.to.balanceAfterCents)}</dd></div>}
        {t.note && <div><dt>Note</dt><dd>{t.note}</dd></div>}
        <div><dt>Date</dt><dd>{formatDateTime(t.createdAt)}</dd></div>
        <div><dt>Reference</dt><dd className="ref">{t.id}</dd></div>
      </dl>
      <div className="actions">
        <Link to={`/accounts/${t.from.accountId}`} className="button-primary">View {t.from.name}</Link>
        <Link to="/transfer" className="button-quiet">Make another transfer</Link>
      </div>
    </section>
  );
}
