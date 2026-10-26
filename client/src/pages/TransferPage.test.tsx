import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Account, Payee } from '../api/types';
import { TransferFlow } from './TransferPage';

const accounts: Account[] = [
  { id: 'chk', type: 'checking', name: 'Everyday Checking', accountNumberMasked: '•••• 1111', currency: 'USD', balanceCents: 10000 },
  { id: 'sav', type: 'savings', name: 'Rainy Day Savings', accountNumberMasked: '•••• 2222', currency: 'USD', balanceCents: 500 },
];
const payees: Payee[] = [];

const transfer = {
  id: 'trf_1', status: 'completed', createdAt: '2026-10-01T10:00:00Z', amountCents: 2500, note: null,
  from: { accountId: 'chk', name: 'Everyday Checking', accountNumberMasked: '•••• 1111', balanceAfterCents: 7500 },
  to: { kind: 'account', accountId: 'sav', name: 'Rainy Day Savings', accountNumberMasked: '•••• 2222', balanceAfterCents: 3000 },
};

function renderFlow() {
  render(
    <MemoryRouter initialEntries={['/transfer']}>
      <Routes>
        <Route path="/transfer" element={<TransferFlow accounts={accounts} payees={payees} />} />
        <Route path="/transfers/:id" element={<p>Result page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const idempotencyKeys = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>).map((h) => h['Idempotency-Key']);

afterEach(() => vi.unstubAllGlobals());

describe('transfer flow', () => {
  it('shows validation errors and stays on the details step', async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.type(screen.getByLabelText('Amount'), '200');
    await user.click(screen.getByRole('button', { name: 'Review transfer' }));
    expect(screen.getByText(/more than the \$100\.00 available/)).toBeInTheDocument();
    expect(screen.queryByText('Check your transfer')).not.toBeInTheDocument();
  });

  it('asks for confirmation, then sends once even on a double click', async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderFlow();

    await user.type(screen.getByLabelText('Amount'), '25');
    await user.click(screen.getByRole('button', { name: 'Review transfer' }));
    expect(screen.getByText('Check your transfer')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled(); // nothing is sent before confirmation

    const send = screen.getByRole('button', { name: 'Send $25.00' });
    await user.dblClick(send);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve(new Response(JSON.stringify({ transfer }), { status: 201 }));
    expect(await screen.findByText('Result page')).toBeInTheDocument();
  });

  it('retries after a network error with the same idempotency key', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ transfer }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderFlow();

    await user.type(screen.getByLabelText('Amount'), '25');
    await user.click(screen.getByRole('button', { name: 'Review transfer' }));
    await user.click(screen.getByRole('button', { name: 'Send $25.00' }));
    expect(await screen.findByText(/won’t be made twice/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send $25.00 again' }));
    expect(await screen.findByText('Result page')).toBeInTheDocument();

    const [first, second] = idempotencyKeys(fetchMock);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it('uses a new key when the details change', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'insufficient_funds', message: 'Not enough money.' } }), { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ transfer }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderFlow();

    await user.type(screen.getByLabelText('Amount'), '25');
    await user.click(screen.getByRole('button', { name: 'Review transfer' }));
    await user.click(screen.getByRole('button', { name: 'Send $25.00' }));
    expect(await screen.findByText('Not enough money.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const amount = screen.getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '20');
    await user.click(screen.getByRole('button', { name: 'Review transfer' }));
    await user.click(screen.getByRole('button', { name: 'Send $20.00' }));
    await screen.findByText('Result page');

    const [first, second] = idempotencyKeys(fetchMock);
    expect(second).not.toBe(first);
  });
});
