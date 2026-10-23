import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { Icon, Spinner } from '../components/ui';

export default function Login({ onLogin, demo }: { onLogin: (u: string) => void; demo: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(username.trim(), password);
      onLogin(username.trim());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <aside className="login-art">
        <div className="brand"><span className="logo"><Icon name="server" size={18} /></span>Homelab Console</div>
        <div>
          <h2>Run your lab like a command center.</h2>
          <p>Guests, sites, metrics and uptime — one calm, fast workspace.</p>
          <ul>
            <li><Icon name="check" size={16} />Start and stop guests safely</li>
            <li><Icon name="check" size={16} />Grafana dashboards, embedded</li>
            <li><Icon name="check" size={16} />Live Uptime Kuma status</li>
          </ul>
        </div>
        <small>Secured session · HTTPS via nginx</small>
      </aside>
      <main className="login-form">
        <form onSubmit={submit}>
          <h1>Welcome back</h1>
          <p className="muted">Sign in to your console.</p>
          {error && <div className="callout err" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
          <label>Username<input className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
          <label>Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? <Spinner /> : null}Sign in</button>
          {demo && <p className="muted small demo-hint">Demo mode — any username, password <code>demo</code>.</p>}
        </form>
      </main>
    </div>
  );
}
