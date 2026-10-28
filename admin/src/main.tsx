import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { ConfirmHost, Loading, ToastHost } from './ui';
import { Shell } from './layout';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { ApplicationPage, ApplicationsPage } from './pages/Applications';
import { WeddingsPage } from './pages/Weddings';
import { WeddingPage } from './pages/Wedding';
import { UsersPage } from './pages/Users';
import { TicketPage, TicketsPage } from './pages/Tickets';
import { LookupPage } from './pages/Lookup';
import { TeamPage } from './pages/Team';
import { AccountPage } from './pages/Account';
import './styles.css';

function App() {
  const { admin, ready } = useAuth();
  if (!ready) return <Loading label="Opening…" />;
  if (!admin) return <LoginPage />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<OverviewPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="applications/:id" element={<ApplicationPage />} />
        <Route path="weddings" element={<WeddingsPage />} />
        <Route path="weddings/:id" element={<WeddingPage />} />
        <Route path="weddings/:id/:tab" element={<WeddingPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="tickets/:id" element={<TicketPage />} />
        <Route path="lookup" element={<LookupPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <ToastHost>
        <ConfirmHost>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ConfirmHost>
      </ToastHost>
    </HashRouter>
  </StrictMode>,
);
