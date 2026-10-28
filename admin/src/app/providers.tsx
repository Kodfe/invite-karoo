'use client';
import { ReactNode } from 'react';
import { AuthProvider, useAuth } from '../auth';
import { LoginPage } from '../screens/Login';
import { Shell } from '../shell';
import { Btn, ConfirmHost, ErrorNote, Loading, ToastHost } from '../ui';

/** every page is behind sign-in: until Firebase answers we show a spinner, never a flash of the login */
function Gate({ children }: { children: ReactNode }) {
  const { state, retry, logout } = useAuth();
  if (state.phase === 'starting') return <Loading label="Opening…" />;
  if (state.phase === 'signedOut') return <LoginPage />;
  if (state.phase === 'stuck') {
    return (
      <div className="login">
        <div className="login-card">
          <h1>Invite Karoo</h1>
          <ErrorNote>{state.message}</ErrorNote>
          <Btn kind="primary" className="block" onClick={() => void retry()}>
            Try again
          </Btn>
          <button type="button" className="linkish login-forgot" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }
  return <Shell>{children}</Shell>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastHost>
      <ConfirmHost>
        <AuthProvider>
          <Gate>{children}</Gate>
        </AuthProvider>
      </ConfirmHost>
    </ToastHost>
  );
}
