import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, loadConfig } from './api';
import { Logo } from './components/Brand';
import { CommandPalette } from './components/CommandPalette';
import type { Command } from './components/CommandPalette';
import { Icon, Spinner } from './components/ui';
import type { IconName } from './components/ui';
import { RefreshCtx, SearchCtx, ToastProvider, useHash, useToast } from './hooks';
import GuestDetail from './pages/GuestDetail';
import Guests from './pages/Guests';
import Grafana from './pages/Grafana';
import Kuma from './pages/Kuma';
import Login from './pages/Login';
import Nginx from './pages/Nginx';
import Overview from './pages/Overview';
import type { AppConfig, Guest } from './types';

const NAV: { id: string; label: string; icon: IconName; group: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'monitor', group: 'Workspace' },
  { id: 'guests', label: 'Guests', icon: 'server', group: 'Resources' },
  { id: 'nginx', label: 'Nginx sites', icon: 'network', group: 'Resources' },
  { id: 'grafana', label: 'Grafana', icon: 'analytics', group: 'Monitoring' },
  { id: 'kuma', label: 'Uptime', icon: 'pulse', group: 'Monitoring' },
];
const SEARCH_HINT: Record<string, string> = {
  overview: 'Search guests…', guests: 'Search name, vmid or tag…', nginx: 'Search domain, upstream or file…',
  grafana: 'Search dashboards, folders or tags…', kuma: 'Search monitors…',
};

export default function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}

function Root() {
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const [config, setConfig] = useState<AppConfig>({});
  const toast = useToast();

  useEffect(() => {
    api.me().then((u) => setUser(u.username)).catch(() => setUser(null));
    loadConfig().then(setConfig);
    const expired = () => setUser((u) => { if (u) toast.error('Session expired — please sign in again'); return null; });
    window.addEventListener('auth:expired', expired);
    return () => window.removeEventListener('auth:expired', expired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (user === undefined) return <div className="boot"><Spinner size={28} /></div>;
  if (user === null) return <Login onLogin={setUser} demo={import.meta.env.VITE_MOCK !== 'false'} />;
  return <Shell user={user} config={config} onLogout={() => setUser(null)} />;
}

function Shell({ user, config, onLogout }: { user: string; config: AppConfig; onLogout: () => void }) {
  const [tick, setTick] = useState(0);
  const [spin, setSpin] = useState(false);
  const bump = useCallback(() => { setTick((t) => t + 1); setSpin(true); setTimeout(() => setSpin(false), 700); }, []);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const parts = useHash();
  const page = parts[0] || 'overview';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* storage unavailable */ }
  }, [theme]);

  async function logout() {
    try { await api.logout(); } catch { /* cookie may already be gone */ }
    onLogout();
  }

  const current = NAV.find((n) => n.id === page) ?? NAV[0];
  const [q, setQ] = useState('');
  const pendingQ = useRef('');
  useEffect(() => { setQ(pendingQ.current); pendingQ.current = ''; }, [current.id]);
  const onSearch = (v: string) => { setQ(v); if (current.id === 'overview' && v) location.hash = '#/guests'; };

  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMenu(false); }, [page]);
  useEffect(() => {
    if (!menu) return;
    const f = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [menu]);
  const [guests, setGuests] = useState<Guest[]>([]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((o) => !o); }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);
  useEffect(() => {
    if (palette) api.guests().then(setGuests).catch(() => setGuests([]));
  }, [palette]);

  const commands = useMemo<Command[]>(() => {
    const go = (id: string, search = '') => () => { pendingQ.current = search; if (location.hash === `#/${id}`) setQ(search); else location.hash = `#/${id}`; };
    return [
      ...NAV.map((n) => ({ id: `nav-${n.id}`, label: n.label, group: 'Go to', icon: n.icon, run: go(n.id) })),
      { id: 'act-refresh', label: 'Refresh data', group: 'Actions', icon: 'refresh', run: bump },
      { id: 'act-theme', label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', group: 'Actions', icon: theme === 'dark' ? 'sun' : 'moon', run: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) },
      { id: 'act-logout', label: 'Sign out', group: 'Actions', icon: 'logout', run: logout },
      ...guests.map((g) => ({ id: `guest-${g.vmid}`, label: g.name, hint: `${g.type} ${g.vmid} · ${g.status}`, group: 'Guests', icon: 'server' as const, run: () => { location.hash = `#/guests/${g.vmid}`; } })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guests, theme, bump]);

  return (
    <RefreshCtx.Provider value={{ tick, bump }}>
     <SearchCtx.Provider value={{ q, setQ }}>
      <header className="head">
        <div className="head-in">
          <a href="#/overview" aria-label="SPL Systems, overview"><Logo /></a>
          <nav className="head-nav" aria-label="Primary">
            {NAV.map((n) => (
              <a key={n.id} href={`#/${n.id}`} className={`nav-link ${current.id === n.id ? 'active' : ''}`} aria-current={current.id === n.id ? 'page' : undefined}>{n.label}</a>
            ))}
          </nav>
          <label className="search topsearch hide-sm">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder={SEARCH_HINT[current.id]} aria-label="Search" />
            {q && <button onClick={() => setQ('')} aria-label="Clear search"><Icon name="x" size={14} /></button>}
          </label>
          <div className="head-actions">
            <button className="btn btn-ghost" onClick={() => setPalette(true)} aria-label="Open command palette"><kbd>Ctrl K</kbd></button>
            <button className="icon-btn" onClick={bump} aria-label="Refresh data" title="Refresh"><span className={spin ? 'spin' : ''}><Icon name="refresh" size={17} /></span></button>
            <button className="icon-btn" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} aria-label="Toggle theme" title="Toggle theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
            <div className="me">
              <span className="avatar">{user.slice(0, 2).toUpperCase()}</span>
              <div><b>{user}</b><small>Administrator</small></div>
              <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out"><Icon name="logout" size={17} /></button>
            </div>
          </div>
          <button className="menu-btn" onClick={() => setMenu(true)} aria-haspopup="dialog" aria-expanded={menu}>Menu</button>
        </div>
      </header>

      <div className={`sheet ${menu ? 'open' : ''}`} role="dialog" aria-modal="true" aria-label="Site menu" aria-hidden={!menu} {...(menu ? {} : { inert: '' })}>
        <div className="sheet-bg" onClick={() => setMenu(false)} />
        <div className="sheet-panel">
          <div className="sheet-in">
            <button className="sheet-close" onClick={() => setMenu(false)}>Close</button>
            <ul>
              {NAV.map((n) => (
                <li key={n.id}><a href={`#/${n.id}`} className={current.id === n.id ? 'active' : ''} onClick={() => setMenu(false)}>{n.label}<Icon name={n.icon} size={22} /></a></li>
              ))}
            </ul>
            <div className="sheet-foot">
              <button onClick={() => { setMenu(false); setPalette(true); }}>Quick jump</button>
              <button onClick={() => { bump(); setMenu(false); }}>Refresh data</button>
              <button onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
              <button onClick={logout}>Sign out ({user})</button>
            </div>
          </div>
        </div>
      </div>

      <main className="content" key={page}>
        {page === 'overview' && <Overview />}
        {page === 'guests' && (Number.isInteger(Number(parts[1])) && Number(parts[1]) > 0 ? <GuestDetail key={parts[1]} vmid={Number(parts[1])} tab={parts[2]} /> : <Guests />)}
        {page === 'nginx' && <Nginx />}
        {page === 'grafana' && <Grafana uid={parts[1]} />}
        {page === 'kuma' && <Kuma statusUrl={config.kumaStatusUrl} />}
        {!NAV.some((n) => n.id === page) && <Overview />}
      </main>
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
     </SearchCtx.Provider>
    </RefreshCtx.Provider>
  );
}
