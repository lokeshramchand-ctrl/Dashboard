import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GuestStatus } from './types';

export const RefreshCtx = createContext<{ tick: number; bump: () => void }>({ tick: 0, bump: () => {} });

/** Search text shared between the top bar and whichever page is open. */
export const SearchCtx = createContext<{ q: string; setQ: (v: string) => void }>({ q: '', setQ: () => {} });
export const useSearch = () => useContext(SearchCtx);

export interface Query<T> {
  data?: T;
  error?: Error;
  loading: boolean;
  refreshing: boolean;
  reload: () => void;
  mutate: (fn: (d: T) => T) => void;
}

/** Fetch + optional polling. Keeps stale data on refresh so panels never flicker. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = [], interval = 0): Query<T> {
  const { tick } = useContext(RefreshCtx);
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean; refreshing: boolean }>({
    loading: true, refreshing: false,
  });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);
  const alive = useRef(true);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, refreshing: true }));
    try {
      const d = await fnRef.current();
      if (alive.current && id === seq.current) setState({ data: d, loading: false, refreshing: false });
    } catch (e) {
      if (alive.current && id === seq.current) setState((s) => ({ data: s.data, error: e as Error, loading: false, refreshing: false }));
    }
  }, []);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [tick, load, ...deps]);
  useEffect(() => {
    if (!interval) return;
    const t = setInterval(() => { if (!document.hidden) load(); }, interval);
    return () => clearInterval(t);
  }, [interval, load]);

  const mutate = useCallback((f: (d: T) => T) => setState((s) => (s.data === undefined ? s : { ...s, data: f(s.data) })), []);
  return { ...state, reload: load, mutate };
}

/** Subscribes to GET /api/events (SSE). Polling still covers us if it is unavailable. */
export function useGuestEvents(cb: (e: { vmid: number; status: GuestStatus }) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data);
        if (e.type === 'guest') ref.current(e);
      } catch { /* ignore malformed */ }
    };
    return () => es.close();
  }, []);
}

/** Eases a number toward its target with an ease-out curve. Honours reduced-motion
 *  (snaps instantly) and always lands exactly on the target. Return value is a float;
 *  round it at the call site. */
export function useCountUp(target: number, ms = 650): number {
  const [val, setVal] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const a = cur.current, b = target;
    if (reduce || a === b || !Number.isFinite(b)) { cur.current = b; setVal(b); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const v = a + (b - a) * e;
      cur.current = v;
      setVal(v);
      if (t < 1) raf = requestAnimationFrame(tick);
      else { cur.current = b; setVal(b); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

export function useHash(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const f = () => setParts(read());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return parts;
}

// ---- toasts ----
type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<{ push: (kind: Toast['kind'], text: string) => void }>({ push: () => {} });
export const useToast = () => {
  const { push } = useContext(ToastCtx);
  return { success: (t: string) => push('success', t), error: (t: string) => push('error', t), info: (t: string) => push('info', t) };
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const n = useRef(0);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++n.current;
    setItems((a) => [...a.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((a) => a.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span className="toast-bar" />
            <span>{t.text}</span>
            <button className="toast-x" aria-label="Dismiss" onClick={() => setItems((a) => a.filter((x) => x.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
