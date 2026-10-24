import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Query } from '../hooks';
import { InView, Reveal, RevealWords } from './Reveal';

const P: Record<string, string> = {
  overview: 'M3 5a1 1 0 011-1h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1zM8 20h8M12 16v4',
  monitor: 'M3 5a1 1 0 011-1h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1zM8 20h8M12 16v4',
  network: 'M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4',
  analytics: 'M4 4v16h16M8 16v-4M12 16V8M16 16v-6',
  server: 'M5 4h14a2 2 0 012 2v3a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM5 13h14a2 2 0 012 2v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3a2 2 0 012-2zM7 7.5h.01M7 16.5h.01',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  pulse: 'M3 12h4l3-8 4 16 3-8h4',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  refresh: 'M20 11a8 8 0 00-14.9-3M4 4v4h4M4 13a8 8 0 0014.9 3M20 20v-4h-4',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  power: 'M12 2v10M18.4 6.6a9 9 0 11-12.8 0',
  more: 'M12 5h.01M12 12h.01M12 19h.01',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  check: 'M5 13l4 4L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  cpu: 'M9 9h6v6H9zM4 9H2M4 15H2M22 9h-2M22 15h-2M9 4V2M15 4V2M9 22v-2M15 22v-2M6 4h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2z',
  memory: 'M3 8h18v8H3zM7 8v8M11 8v8M15 8v8M19 8v8M6 16v3M18 16v3',
  disk: 'M12 21c4.97 0 9-1.8 9-4V7c0-2.2-4.03-4-9-4S3 4.8 3 7v10c0 2.2 4.03 4 9 4zM3 7c0 2.2 4.03 4 9 4s9-1.8 9-4M3 12c0 2.2 4.03 4 9 4s9-1.8 9-4',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  gamepad: 'M6 12h4M8 10v4M15 13h.01M18 11h.01M17.3 5H6.7a4 4 0 00-3.9 3.1l-1.5 6.2a2.5 2.5 0 004.2 2.3L8 14h8l2.5 2.6a2.5 2.5 0 004.2-2.3l-1.5-6.2A4 4 0 0017.3 5z',
  lock: 'M6 11h12a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1v-8a1 1 0 011-1zM8 11V7a4 4 0 118 0v4',
  unlock: 'M6 11h12a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1v-8a1 1 0 011-1zM8 11V7a4 4 0 017.5-2',
  back: 'M15 18l-6-6 6-6',
  rotate: 'M21 12a9 9 0 11-3-6.7M21 4v5h-5',
  stop: 'M6 6h12v12H6z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}

export type Tone = 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'gray';

export function Badge({ tone = 'gray', dot, children, title }: { tone?: Tone; dot?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {dot && <i className="dot" />}
      {children}
    </span>
  );
}

export const Spinner = ({ size = 16 }: { size?: number }) => <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;

export function Card({ children, className = '', pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={`card ${pad ? 'pad' : ''} ${className}`}>{children}</section>;
}

export function CardHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="card-head">
      <div>
        <h3>{title}</h3>
        {sub && <p className="muted small">{sub}</p>}
      </div>
      {right && <div className="card-head-r">{right}</div>}
    </div>
  );
}

export function PageHeader({ title, sub, actions, eyebrow }: { title: string; sub?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <InView>
      <header className="page-head">
        {eyebrow && <Reveal className="eyebrow">{eyebrow}</Reveal>}
        <div className="page-head-row">
          <h1><RevealWords text={title} /></h1>
          {actions && <Reveal stagger={3} className="page-actions">{actions}</Reveal>}
        </div>
        {sub && <Reveal stagger={2}><p className="muted">{sub}</p></Reveal>}
      </header>
    </InView>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="search">
      <Icon name="search" size={16} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <button onClick={() => onChange('')} aria-label="Clear search"><Icon name="x" size={14} /></button>}
    </label>
  );
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; count?: number }[] }) {
  return (
    <div className="chips" role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
          {o.count !== undefined && <em>{o.count}</em>}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ rows = 4, h = 52 }: { rows?: number; h?: number }) {
  return (
    <div className="skeletons" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: h, animationDelay: `${i * 90}ms` }} />)}
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, hint, action }: { icon?: IconName; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-ic"><Icon name={icon} size={22} /></div>
      <strong>{title}</strong>
      {hint && <p className="muted small">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="empty err">
      <div className="empty-ic"><Icon name="alert" size={22} /></div>
      <strong>Couldn't load this panel</strong>
      <p className="muted small">{error.message}</p>
      {onRetry && <button className="btn" onClick={onRetry}><Icon name="refresh" size={15} />Try again</button>}
    </div>
  );
}

/** Loading / error / empty wrapper used by every data panel. */
export function Async<T>({ q, isEmpty, empty, rows, h, children }: {
  q: Query<T>;
  isEmpty?: (d: T) => boolean;
  empty?: { title: string; hint?: string };
  rows?: number;
  h?: number;
  children: (d: T) => ReactNode;
}) {
  if (q.data === undefined) {
    if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
    return <Skeleton rows={rows} h={h} />;
  }
  if (isEmpty?.(q.data)) return <EmptyState title={empty?.title ?? 'Nothing here yet'} hint={empty?.hint} />;
  return (
    <>
      {q.error && <div className="stale"><Icon name="alert" size={14} />Connection issue — showing last known data. <button onClick={q.reload}>Retry</button></div>}
      {children(q.data)}
    </>
  );
}

export function Meter({ value, tone }: { value: number; tone?: Tone }) {
  const v = Math.max(0, Math.min(1, value));
  const t = tone ?? (v > 0.9 ? 'red' : v > 0.75 ? 'amber' : 'violet');
  return <div className="meter"><i className={`m-${t}`} style={{ width: `${v * 100}%` }} /></div>;
}

/** Press-and-hold (pointer or Space/Enter) to confirm; releasing early cancels. */
export function HoldButton({ children, onConfirm, danger, ms = 700 }: { children: ReactNode; onConfirm: () => void; danger?: boolean; ms?: number }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number>();
  const start = () => {
    if (timer.current) return;
    setHolding(true);
    timer.current = window.setTimeout(() => { timer.current = undefined; setHolding(false); onConfirm(); }, ms);
  };
  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button type="button" className={`btn hold ${danger ? 'btn-danger' : 'btn-primary'} ${holding ? 'holding' : ''}`}
      style={{ ['--hold-ms' as string]: `${ms}ms` }} autoFocus
      onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } }}
      onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') cancel(); }} onBlur={cancel}>
      <span className="hold-fill" aria-hidden="true" />
      <span className="hold-label">{holding ? 'Keep holding…' : <>{children}<small> · hold</small></>}</span>
    </button>
  );
}

export function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose: () => void; footer: ReactNode }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{footer}</div>
      </div>
    </div>
  );
}

export function Menu({ items, disabled, label }: { items: { label: string; icon: IconName; danger?: boolean; onClick: () => void }[]; disabled?: boolean; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn" disabled={disabled} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {items.map((it) => (
            <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => { setOpen(false); it.onClick(); }}>
              <Icon name={it.icon} size={16} />{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HeartbeatBar({ beats }: { beats: { time: string; status: string; ping: number | null }[] }) {
  return (
    <div className="hbar" aria-label="Recent heartbeats">
      {beats.map((b, i) => (
        <i key={i} className={`hb hb-${b.status}`} title={`${new Date(b.time).toLocaleTimeString()} · ${b.status}${b.ping != null ? ` · ${b.ping} ms` : ''}`} />
      ))}
    </div>
  );
}
