import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as client from './api';
import { ApiError } from './api';
import { clearUserData, downloadOffline, getOfflineAuth, offlineMeta, saveOfflineAuth } from './offline';
import type { User } from './types';

interface AuthValue {
  user: User | null;
  loading: boolean;
  offline: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Context = createContext<AuthValue | null>(null);
const normalizeUser = (user: User): User => ({ ...user, id: String(user.id) });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);
  const transition = useRef(0);

  const activateOffline = useCallback(async () => {
    const currentTransition = ++transition.current;
    setOffline(true);
    const localUser = await getOfflineAuth();
    if (currentTransition === transition.current) setUser(localUser);
  }, []);

  const refresh = useCallback(async () => {
    if (!navigator.onLine) {
      await activateOffline();
      return;
    }

    const currentTransition = ++transition.current;
    try {
      const current = normalizeUser(await client.getMe());
      await client.getCsrf();
      await saveOfflineAuth(current);
      if (currentTransition !== transition.current) return;
      setUser(current);
      setOffline(false);
      const meta = await offlineMeta(current.id);
      if (!meta?.updatedAt || Date.now() - new Date(meta.updatedAt).getTime() > 3_600_000) {
        void downloadOffline(current, () => {}).catch(() => {});
      }
    } catch (error) {
      if (currentTransition !== transition.current) return;
      if (error instanceof ApiError && error.status === 401) {
        setOffline(false);
        setUser(null);
        return;
      }
      setOffline(true);
      setUser(await getOfflineAuth());
    }
  }, [activateOffline]);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
    const online = () => {
      void refresh();
    };
    const offlineEvent = () => {
      void activateOffline();
    };
    const expired = () => {
      if (navigator.onLine) {
        transition.current += 1;
        setUser(null);
      }
    };
    addEventListener('online', online);
    addEventListener('offline', offlineEvent);
    addEventListener('session-expired', expired);
    return () => {
      transition.current += 1;
      removeEventListener('online', online);
      removeEventListener('offline', offlineEvent);
      removeEventListener('session-expired', expired);
    };
  }, [activateOffline, refresh]);

  async function signIn(username: string, password: string) {
    const logged = normalizeUser(await client.login(username, password));
    transition.current += 1;
    setUser(logged);
    setOffline(false);
    await saveOfflineAuth(logged);
  }

  async function signOut() {
    const id = user?.id;
    transition.current += 1;
    try {
      if (navigator.onLine) await client.logout();
    } finally {
      if (id) await clearUserData(id);
      setUser(null);
    }
  }

  return (
    <Context.Provider value={{ user, loading, offline, signIn, signOut, refresh }}>
      {children}
    </Context.Provider>
  );
}

export const useAuth = () => {
  const value = useContext(Context);
  if (!value) throw new Error('AuthProvider requerido');
  return value;
};
