import type {
  Account, ChatTurn, Customer, Payee, TransactionFilters, TransactionPage, Transfer, TransferRequest,
} from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { field: string; message: string }[],
  ) {
    super(message);
  }

  /** True when we don't know whether the server processed the request. */
  get isNetworkError() {
    return this.status === 0;
  }
}

let onUnauthorized: () => void = () => {};
/** Lets the auth layer react when any request finds the session has expired. */
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the bank. Check your connection and try again.');
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'unknown_error', err?.message ?? 'Something went wrong. Try again.', err?.details);
  }
  return data as T;
}

const query = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const api = {
  login: (username: string, password: string) =>
    request<{ customer: Customer }>('POST', '/auth/login', { username, password }),
  logout: () => request<void>('POST', '/auth/logout', {}),
  me: () => request<{ customer: Customer }>('GET', '/auth/me'),

  accounts: () => request<{ accounts: Account[] }>('GET', '/accounts'),
  account: (id: string) => request<{ account: Account }>('GET', `/accounts/${encodeURIComponent(id)}`),
  transactions: (accountId: string, f: TransactionFilters, pageSize = 20) =>
    request<TransactionPage>('GET', `/accounts/${encodeURIComponent(accountId)}/transactions${query({ ...f, pageSize })}`),
  payees: () => request<{ payees: Payee[] }>('GET', '/payees'),

  createTransfer: (body: TransferRequest, idempotencyKey: string) =>
    request<{ transfer: Transfer }>('POST', '/transfers', body, { 'Idempotency-Key': idempotencyKey }),
  transfer: (id: string) => request<{ transfer: Transfer }>('GET', `/transfers/${encodeURIComponent(id)}`),

  ask: (message: string, history: ChatTurn[]) =>
    request<{ reply: string; source: 'llm' | 'rules' }>('POST', '/assistant', { message, history }),
};
