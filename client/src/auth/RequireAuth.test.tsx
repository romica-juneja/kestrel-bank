import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, RequireAuth } from './AuthContext';

afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/signin" element={<p>Sign in page</p>} />
          <Route path="/accounts" element={<RequireAuth><p>Secret balances</p></RequireAuth>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('RequireAuth', () => {
  it('redirects to sign in when there is no session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'unauthenticated', message: 'x' } }), { status: 401 })));
    renderAt('/accounts');
    expect(await screen.findByText('Sign in page')).toBeInTheDocument();
    expect(screen.queryByText('Secret balances')).not.toBeInTheDocument();
  });

  it('shows the protected screen for a signed-in customer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ customer: { id: 'c', username: 'alex', displayName: 'Alex Morgan' } }), { status: 200 })));
    renderAt('/accounts');
    expect(await screen.findByText('Secret balances')).toBeInTheDocument();
  });
});
