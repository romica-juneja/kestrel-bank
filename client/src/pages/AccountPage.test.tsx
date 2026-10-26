import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, TransactionPage } from '../api/types';
import { api } from '../api/client';
import { AccountPage } from './AccountPage';

vi.mock('../api/client', () => ({
  api: {
    account: vi.fn(),
    transactions: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

const account = (id: string, name: string): { account: Account } => ({
  account: { id, type: 'checking', name, accountNumberMasked: '•••• 1111', currency: 'USD', balanceCents: 10_000 },
});

const history = (description: string): TransactionPage => ({
  items: [
    {
      id: 1,
      postedAt: '2026-10-01T12:00:00.000Z',
      description,
      category: 'groceries',
      direction: 'debit',
      amountCents: 1000,
      balanceAfterCents: 9000,
      transferId: null,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
});

function renderAccount(initialEntry: string) {
  const router = createMemoryRouter([{ path: '/accounts/:accountId', element: <AccountPage /> }], {
    initialEntries: [initialEntry],
  });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.mocked(api.account).mockReset();
  vi.mocked(api.transactions).mockReset();
});

describe('account history', () => {
  it('follows the URL when the back button restores a previous filter', async () => {
    vi.mocked(api.account).mockResolvedValue(account('a', 'Everyday Checking'));
    vi.mocked(api.transactions).mockResolvedValue(history('FreshMart'));
    const user = userEvent.setup();
    const router = renderAccount('/accounts/a?search=FreshMart');

    const search = await screen.findByLabelText('Search');
    expect(search).toHaveValue('FreshMart');
    await user.clear(search);
    await user.type(search, 'Costwise');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(router.state.location.search).toBe('?search=Costwise');

    await router.navigate(-1);
    expect(await screen.findByDisplayValue('FreshMart')).toBeInTheDocument();
  });

  it('does not keep the previous account’s transactions while the next account loads', async () => {
    let releaseNext: () => void = () => {};
    vi.mocked(api.account).mockImplementation(async (id: string) => account(id, id === 'a' ? 'Checking A' : 'Checking B'));
    vi.mocked(api.transactions).mockImplementation(async (id: string) => {
      if (id === 'b') await new Promise<void>((resolve) => (releaseNext = resolve));
      return history(id === 'a' ? 'Groceries from A' : 'Groceries from B');
    });
    const router = renderAccount('/accounts/a');
    expect(await screen.findByText('Groceries from A')).toBeInTheDocument();

    await router.navigate('/accounts/b');
    await waitFor(() => expect(screen.queryByText('Groceries from A')).not.toBeInTheDocument());
    expect(screen.getByText('Loading transactions…')).toBeInTheDocument();

    releaseNext();
    expect(await screen.findByText('Groceries from B')).toBeInTheDocument();
  });
});
