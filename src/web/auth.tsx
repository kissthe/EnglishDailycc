import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { User } from '../shared/types';
import { get, getToken, post, setToken, setUnauthorizedHandler } from './api';

interface AuthState {
  user: User | null;
  ready: boolean;
  needsSetup: boolean;
  login: (username: string, password: string) => Promise<User>;
  setup: (username: string, displayName: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
    });
    (async () => {
      try {
        const s = await get<{ needsSetup: boolean }>('/setup/status');
        setNeedsSetup(s.needsSetup);
        if (getToken()) {
          const me = await get<{ user: User }>('/auth/me');
          setUser(me.user);
        }
      } catch {
        setToken(null);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await post<{ token: string; user: User }>('/auth/login', { username, password });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const setup = useCallback(async (username: string, displayName: string, password: string) => {
    const r = await post<{ token: string; user: User }>('/setup', { username, displayName, password });
    setToken(r.token);
    setUser(r.user);
    setNeedsSetup(false);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } catch {
      /* 忽略 */
    }
    setToken(null);
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, ready, needsSetup, login, setup, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
