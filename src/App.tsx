import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, loadConfig } from './api';
import { Icon, Spinner } from './components/ui';
import type { IconName } from './components/ui';
import { RefreshCtx, SearchCtx, ToastProvider, useHash, useToast } from './hooks';
import Guests from './pages/Guests';
import Grafana from './pages/Grafana';
import Kuma from './pages/Kuma';
import Login from './pages/Login';
import Nginx from './pages/Nginx';
import Overview from './pages/Overview';
import type { AppConfig } from './types';

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
  useEffect(() => setQ(''), [current.id]);
  const onSearch = (v: string) => { setQ(v); if (current.id === 'overview' && v) location.hash = '#/guests'; };

  return (
    <RefreshCtx.Provider value={{ tick, bump }}>
     <SearchCtx.Provider value={{ q, setQ }}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand"><span className="logo"><Icon name="server" size={18} /></span><span className="brand-t">Homelab</span></div>
          <nav>
            {NAV.map((n, i) => (
              <Fragment key={n.id}>
                {NAV[i - 1]?.group !== n.group && <p className="nav-label">{n.group}</p>}
                <a href={`#/${n.id}`} className={current.id === n.id ? 'active' : ''} aria-current={current.id === n.id ? 'page' : undefined}>
                  <Icon name={n.icon} /><span>{n.label}</span>
                </a>
              </Fragment>
            ))}
          </nav>
          <div className="side-foot">
            <div className="me">
              <span className="avatar">{user.slice(0, 2).toUpperCase()}</span>
              <div className="grow"><b>{user}</b><small>Administrator</small></div>
              <button className="icon-btn dark" onClick={logout} aria-label="Sign out" title="Sign out"><Icon name="logout" size={17} /></button>
            </div>
          </div>
        </aside>

        <div className="main">
          <div className="topbar">
            <label className="search topsearch">
              <Icon name="search" size={16} />
              <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder={SEARCH_HINT[current.id]} aria-label="Search" />
              {q && <button onClick={() => setQ('')} aria-label="Clear search"><Icon name="x" size={14} /></button>}
            </label>
            <div className="top-actions">
              <button className="btn btn-ghost" onClick={bump} aria-label="Refresh data"><span className={spin ? 'spin' : ''}><Icon name="refresh" size={16} /></span><span className="hide-sm">Refresh</span></button>
              <button className="icon-btn" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} aria-label="Toggle theme" title="Toggle theme">
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
              </button>
              <button className="icon-btn show-sm" onClick={logout} aria-label="Sign out"><Icon name="logout" /></button>
            </div>
          </div>
          <main className="content" key={page}>
            {page === 'overview' && <Overview />}
            {page === 'guests' && <Guests />}
            {page === 'nginx' && <Nginx />}
            {page === 'grafana' && <Grafana uid={parts[1]} />}
            {page === 'kuma' && <Kuma statusUrl={config.kumaStatusUrl} />}
            {!NAV.some((n) => n.id === page) && <Overview />}
          </main>
        </div>
      </div>
     </SearchCtx.Provider>
    </RefreshCtx.Provider>
  );
}
