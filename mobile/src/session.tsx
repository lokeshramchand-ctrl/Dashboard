import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api, normalizeUrl, setBaseUrl, setExpiredHandler } from './api';

const KEY = 'serverUrl';

type Status = 'loading' | 'out' | 'in';

interface Session {
  status: Status;
  user: string | null;
  serverUrl: string;
  notice: string | null;
  signIn: (url: string, username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setExpiredHandler(() => {
      setUser(null);
      setStatus((s) => { if (s === 'in') setNotice('Session expired. Please sign in again.'); return 'out'; });
    });
    (async () => {
      let saved = '';
      try { saved = (await SecureStore.getItemAsync(KEY)) ?? ''; } catch { /* storage unavailable */ }
      if (!saved) { setStatus('out'); return; }
      setServerUrl(saved);
      setBaseUrl(saved);
      try {
        const me = await api.me();
        setUser(me.username);
        setStatus('in');
      } catch {
        setStatus('out');
      }
    })();
  }, []);

  const signIn = useCallback(async (rawUrl: string, username: string, password: string) => {
    const url = normalizeUrl(rawUrl);
    if (!url) throw new Error('Enter your dashboard address');
    setBaseUrl(url);
    const r = await api.login(username.trim(), password);
    try { await SecureStore.setItemAsync(KEY, url); } catch { /* remembered next time only if storage works */ }
    setServerUrl(url);
    setNotice(null);
    setUser(r.username);
    setStatus('in');
  }, []);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch { /* cookie may already be gone */ }
    setUser(null);
    setNotice(null);
    setStatus('out');
  }, []);

  const value = useMemo(() => ({ status, user, serverUrl, notice, signIn, signOut }), [status, user, serverUrl, notice, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
