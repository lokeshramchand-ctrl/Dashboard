import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { Logo } from '../components/Brand';
import { InView, Reveal, RevealWords } from '../components/Reveal';
import { Icon, Spinner } from '../components/ui';
import { HeroLiquid } from '../webgl/hero-liquid/HeroLiquid';

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

  // Always the site's light hero: the liquid bands are tuned for a white ground.
  return (
    <div className="login" data-theme="light">
      <HeroLiquid intro />
      <Logo />
      <InView className="login-main">
        <div>
          <h1><RevealWords text="Engineering the intelligent future." /></h1>
          <Reveal stagger={6}><p className="login-lead">One calm console for your guests, sites, metrics and uptime.</p></Reveal>
        </div>
        <Reveal stagger={4}>
          <form onSubmit={submit}>
            <h2>Sign in</h2>
            {error && <div className="callout err" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
            <label>Username<input className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
            <label>Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? <Spinner /> : null}Sign in</button>
            {demo && <p className="muted small demo-hint">Demo mode: any username, password <code>demo</code>.</p>}
          </form>
        </Reveal>
      </InView>
      <div className="login-foot"><span>SPL Systems · Console</span><span>Secured session · HTTPS</span></div>
    </div>
  );
}
