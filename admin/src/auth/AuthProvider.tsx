'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ApiError, Role } from '../api';
import { whoAmI } from '../data';
import { backend } from './select';
import { AuthError } from './types';

export type Admin = { id: string; email: string; name: string; role: Role };

type State =
  | { phase: 'starting' }
  | { phase: 'signedOut'; notice: string | null }
  | { phase: 'signedIn'; admin: Admin }
  /** signed in to Firebase but Firestore could not be reached */
  | { phase: 'stuck'; message: string };

type Auth = {
  state: State;
  admin: Admin | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => Promise<void>;
};

const NOT_TEAM = 'This account is not on the Invite Karoo team';

const Ctx = createContext<Auth>({
  state: { phase: 'starting' },
  admin: null,
  login: async () => {},
  logout: async () => {},
  retry: async () => {},
});
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ phase: 'starting' });
  /** set while login() runs, so the auth listener doesn't check the account twice */
  const signingIn = useRef(false);

  /** looks this Firebase user up on the team; throws for the login form */
  const checkTeam = useCallback(async (): Promise<void> => {
    try {
      const admin = await whoAmI();
      setState({ phase: 'signedIn', admin });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        await backend.signOut().catch(() => {});
        const notice = e.code === 'NOT_TEAM' || e.status === 403 || e.status === 401 ? NOT_TEAM : e.message;
        setState({ phase: 'signedOut', notice });
        throw new AuthError(e.code, notice);
      }
      const message = e instanceof Error ? e.message : 'Could not reach the server';
      setState({ phase: 'stuck', message });
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    await backend.signOut().catch(() => {});
    setState({ phase: 'signedOut', notice: null });
  }, []);

  useEffect(() => {
    return backend.onChange((user) => {
      if (signingIn.current) return;
      if (!user) {
        setState((s) => (s.phase === 'signedOut' ? s : { phase: 'signedOut', notice: null }));
        return;
      }
      checkTeam().catch(() => {});
    });
  }, [checkTeam]);

  const login = useCallback(
    async (email: string, password: string) => {
      signingIn.current = true;
      try {
        await backend.signIn(email, password);
        await checkTeam();
      } finally {
        signingIn.current = false;
      }
    },
    [checkTeam],
  );

  const retry = useCallback(async () => {
    setState({ phase: 'starting' });
    await checkTeam().catch(() => {});
  }, [checkTeam]);

  const admin = state.phase === 'signedIn' ? state.admin : null;
  return <Ctx.Provider value={{ state, admin, login, logout, retry }}>{children}</Ctx.Provider>;
}
