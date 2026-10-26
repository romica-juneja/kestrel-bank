import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function SignInPage() {
  const { customer, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/accounts';
  if (customer) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await signIn(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="signin">
      <div className="signin-brand">
        <svg viewBox="0 0 32 32" width="40" height="40" aria-hidden="true">
          <path d="M4 22 L16 6 L28 22 L16 17 Z" fill="currentColor" />
        </svg>
        <p>Kestrel Bank</p>
      </div>
      <form className="signin-form" onSubmit={onSubmit} noValidate>
        <h1>Sign in to online banking</h1>
        <label htmlFor="username">Username</label>
        <input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button-primary button-wide" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="demo-hint">
          Demo customers: <strong>alex</strong> or <strong>sam</strong>, password <strong>Demo#2026</strong>
        </p>
      </form>
    </main>
  );
}
