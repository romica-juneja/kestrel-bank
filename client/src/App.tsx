import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { AccountPage } from './pages/AccountPage';
import { AccountsPage } from './pages/AccountsPage';
import { SignInPage } from './pages/SignInPage';
import { TransferPage } from './pages/TransferPage';
import { TransferResultPage } from './pages/TransferResultPage';

export function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignInPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/accounts/:accountId" element={<AccountPage />} />
        <Route path="/transfer" element={<TransferPage />} />
        <Route path="/transfers/:transferId" element={<TransferResultPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/accounts" replace />} />
    </Routes>
  );
}
