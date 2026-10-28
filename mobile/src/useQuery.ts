import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

export interface Query<T> {
  data?: T;
  error?: Error;
  loading: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
}

/** Fetch with optional polling. Keeps stale data on refresh; polling pauses while the app is backgrounded. */
export function useQuery<T>(fn: () => Promise<T>, interval = 0, deps: unknown[] = []): Query<T> {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean; refreshing: boolean }>({ loading: true, refreshing: false });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const alive = useRef(true);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, refreshing: true }));
    try {
      const d = await fnRef.current();
      if (alive.current) setState({ data: d, loading: false, refreshing: false });
    } catch (e) {
      if (alive.current) setState((s) => ({ data: s.data, error: e as Error, loading: false, refreshing: false }));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);

  useEffect(() => {
    if (!interval) return;
    const t = setInterval(() => { if (AppState.currentState === 'active') load(); }, interval);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [interval, load]);

  return { ...state, reload: load };
}
