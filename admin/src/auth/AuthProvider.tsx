import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, Role, setUnauthorizedHandler, token } from './api';

export type Admin = { id: string; email: string; name: string; role: Role };
type Auth = { admin: Admin | null; ready: boolean; login: (email: string, password: string) => Promise<void>; logout: () => void };

const Ctx = createContext<Auth>({ admin: null, ready: false, login: async () => {}, logout: () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    token.set(null);
    setAdmin(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!token.get()) {
      setReady(true);
      return;
    }
    api
      .get<Admin>('/me')
      .then(setAdmin)
      .catch(() => token.set(null))
      .finally(() => setReady(true));
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ token: string; admin: Admin }>('/auth/login', { email, password });
    token.set(r.token);
    setAdmin(r.admin);
  }, []);

  return <Ctx.Provider value={{ admin, ready, login, logout }}>{children}</Ctx.Provider>;
}
