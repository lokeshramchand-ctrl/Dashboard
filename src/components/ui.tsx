import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import type { Query } from '../hooks';
import { InView, Reveal, RevealWords } from './Reveal';

const P: Record<string, string> = {
  overview: 'M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z',
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
  memory: 'M3 7h18v9H3zM7 11v1M12 11v1M17 11v1M6 16v3M10 16v3M14 16v3M18 16v3',
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
  sparkles: 'M12 3l1.8 4.8L18.6 9.6 13.8 11.4 12 16.2 10.2 11.4 5.4 9.6 10.2 7.8zM19 14l.9 2.4 2.4.9-2.4.9L19 20.6l-.9-2.4-2.4-.9 2.4-.9zM5 14l.7 1.9 1.9.7-1.9.7L5 19.2l-.7-1.9L2.4 16.6l1.9-.7z',
  copy: 'M9 9h10a1 1 0 011 1v10a1 1 0 01-1 1H9a1 1 0 01-1-1V10a1 1 0 011-1zM5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M8 5v14M16 5v14',
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1zM12 17a4 4 0 100-8 4 4 0 000 8z',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 5l1 1 2-2M4 11l1 1 2-2M4 17l1 1 2-2',
  node: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01M12 7h4M12 17h4',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
  eject: 'M12 4l8 10H4zM4 19h16',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3',
  edit: 'M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17zM14 7l3 3',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  upload: 'M12 20V8M7 13l5-5 5 5M5 4h14',
  shield: 'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6zM9 12l2 2 4-4',
  key: 'M12 15a4 4 0 11-8 0 4 4 0 018 0zM10.8 12.2L20 3M16 7l3 3',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0zM12 17v4',
  unplug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0zM12 17v4M3 3l18 18',
  disc: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  terminal: 'M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM7 10l3 2-3 2M12 15h5',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5h.01',
  zap: 'M13 2L4 14h7l-1 8 9-12h-7z',
  windows: 'M3 5.5l7.5-1v7H3zM12 4.3L21 3v8.5h-9zM3 13h7.5v7l-7.5-1zM12 13h9v8l-9-1.3z',
  benchmark: 'M4 20a9 9 0 1116 0M12 20l4-7M7 12h.01M12 7h.01M17 12h.01',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  home: 'M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  chevron: 'M9 6l6 6-6 6',
  save: 'M5 4h11l3 3v12a1 1 0 01-1 1H6a1 1 0 01-1-1zM8 4v5h7V4M8 20v-6h8v6',
};

export type IconName = keyof typeof P;

const SOLID = new Set<string>(['play', 'stop']);

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill={SOLID.has(name) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={size <= 14 ? 1.9 : size >= 24 ? 1.5 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
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

export function Modal({ title, children, onClose, footer, wide }: { title: string; children: ReactNode; onClose: () => void; footer: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);
  // Portal to <body>: a transformed ancestor (e.g. a Reveal animation) would otherwise trap
  // the position:fixed scrim and shrink the dialog.
  return createPortal(
    <div className="scrim" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{footer}</div>
      </div>
    </div>,
    document.body,
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
