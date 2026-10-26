import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { ErrorNotice } from '../components/Notice';
import { useAsync } from '../lib/useAsync';

export function AccountsPage() {
  const { customer } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.accounts(), []);
  const firstName = customer?.displayName.split(' ')[0];

  return (
    <section className="page">
      <h1>Hello, {firstName}</h1>
      <p className="lede">Here’s where your money is right now.</p>

      {loading && <p className="status-line" role="status">Loading accounts…</p>}
      {error && <ErrorNotice onRetry={reload}>{error.message}</ErrorNotice>}

      {data && (
        <ul className="account-list">
          {data.accounts.map((a) => (
            <li key={a.id}>
              <Link to={`/accounts/${a.id}`} className="account-row">
                <span className="account-meta">
                  <span className="account-name">{a.name}</span>
                  <span className="muted">
                    {a.type === 'checking' ? 'Checking' : 'Savings'} {a.accountNumberMasked}
                  </span>
                </span>
                <span className="account-balance">
                  <span className="visually-hidden">Balance </span>
                  <Money cents={a.balanceCents} currency={a.currency} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data && (
        <p className="after-list">
          <Link to="/transfer" className="button-primary">Make a transfer</Link>
        </p>
      )}
    </section>
  );
}
