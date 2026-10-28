import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { Logo } from '../components/Brand';
import { InView, Reveal, RevealWords } from '../components/Reveal';
import { Icon, Spinner } from '../components/ui';
import { HeroLiquid } from '../webgl/hero-liquid/HeroLiquid';

const SSO_ERRORS: Record<string, string> = {
  SSO_DENIED: 'Sign-in was cancelled or refused by Keycloak.',
  SSO_STATE: 'The sign-in attempt expired. Please try again.',
  SSO_FAILED: 'Keycloak sign-in could not be verified.',
  SSO_UNAVAILABLE: 'Keycloak is unreachable right now.',
  USER_NOT_ALLOWED: 'This Keycloak account is not allowed to use the console.',
  ROLE_MISSING: 'This Keycloak account lacks the required role.',
};

export default function Login({ onLogin }: { onLogin: (u: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sso, setSso] = useState<{ enabled: boolean; label: string }>({ enabled: false, label: '' });

  useEffect(() => {
    api.ssoConfig().then(setSso).catch(() => { /* password login still works */ });
    const code = new URLSearchParams(location.search).get('sso_error');
    if (code) {
      setError(SSO_ERRORS[code] ?? 'Single sign-on failed');
      history.replaceState(null, '', location.pathname + location.hash);
    }
  }, []);

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
            {sso.enabled && (
              <>
                <div className="login-or muted small"><span>or</span></div>
                <a className="btn btn-lg" href="/api/auth/sso/login"><Icon name="lock" size={16} />Sign in with {sso.label}</a>
              </>
            )}
          </form>
        </Reveal>
      </InView>
      <div className="login-foot"><span>SPL Systems · Console</span><span>Secured session · HTTPS</span></div>
    </div>
  );
}
