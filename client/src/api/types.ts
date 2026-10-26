export interface Customer {
  id: string;
  username: string;
  displayName: string;
}

export interface Account {
  id: string;
  type: 'checking' | 'savings';
  name: string;
  accountNumberMasked: string;
  currency: string;
  balanceCents: number;
}

export interface Payee {
  id: string;
  name: string;
  bankName: string;
  accountNumberMasked: string;
}

export interface Transaction {
  id: number;
  postedAt: string;
  description: string;
  category: string;
  direction: 'debit' | 'credit';
  amountCents: number;
  balanceAfterCents: number;
  transferId: string | null;
}

export interface TransactionPage {
  items: Transaction[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface TransactionFilters {
  from?: string;
  to?: string;
  type?: 'debit' | 'credit';
  search?: string;
  page: number;
}

export interface Transfer {
  id: string;
  status: 'completed';
  createdAt: string;
  amountCents: number;
  note: string | null;
  from: { accountId: string; name: string; accountNumberMasked: string; balanceAfterCents: number };
  to:
    | { kind: 'account'; accountId: string; name: string; accountNumberMasked: string; balanceAfterCents: number }
    | { kind: 'payee'; payeeId: string; name: string; bankName: string; accountNumberMasked: string };
}

export interface TransferRequest {
  fromAccountId: string;
  toAccountId?: string;
  payeeId?: string;
  amount: string;
  note?: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}
