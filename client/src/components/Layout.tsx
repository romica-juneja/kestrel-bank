import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AssistantPanel } from './AssistantPanel';

export function Layout() {
  const { customer, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [assistantOpen, setAssistantOpen] = useState(false);

  async function handleSignOut() {
    await signOut();
    navigate('/signin', { replace: true });
  }

  return (
    <div className={`shell ${assistantOpen ? 'shell-with-assistant' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/accounts" className="brand" aria-label="Kestrel Bank, accounts">
            <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
              <path d="M4 22 L16 6 L28 22 L16 17 Z" fill="currentColor" />
            </svg>
            Kestrel Bank
          </NavLink>
          <nav aria-label="Main">
            <NavLink to="/accounts">Accounts</NavLink>
            <NavLink to="/transfer" className={pathname.startsWith('/transfer') ? 'active' : undefined}>
              Transfer
            </NavLink>
          </nav>
          <div className="topbar-actions">
            <button type="button" className="button-quiet" aria-expanded={assistantOpen} onClick={() => setAssistantOpen((o) => !o)}>
              Assistant
            </button>
            <span className="who">{customer?.displayName}</span>
            <button type="button" className="button-quiet" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="main">
        <Outlet />
      </main>
      {assistantOpen && <AssistantPanel onClose={() => setAssistantOpen(false)} />}
    </div>
  );
}
