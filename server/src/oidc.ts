import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createSession } from './auth.js';
import { cfg, keycloakConfigured } from './config.js';
import { col } from './db.js';
import { HttpError } from './errors.js';
import { logEvent } from './events.js';

// Keycloak sign-in: authorization code flow with PKCE and a verified ID token (RS256 via the realm JWKS).
// The Keycloak user must pass KEYCLOAK_ALLOWED_USERS and/or KEYCLOAK_REQUIRED_ROLE; with neither set SSO stays off.

const kc = cfg.keycloak;
const STATE_COOKIE = 'sso_state';
const b64u = (b: Buffer) => b.toString('base64url');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

interface Discovery { authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string }
let disco: { at: number; d: Discovery } | null = null;
let jwks: { at: number; keys: (JsonWebKey & { kid?: string })[] } | null = null;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function discovery(): Promise<Discovery> {
  if (disco && Date.now() - disco.at < 3600_000) return disco.d;
  const d = await json<Discovery>(`${kc.issuer}/.well-known/openid-configuration`);
  if (d.issuer !== kc.issuer) throw new Error('Issuer mismatch in discovery document');
  disco = { at: Date.now(), d };
  return d;
}

async function keyFor(kid: string | undefined) {
  const find = () => jwks?.keys.find((k) => k.kid === kid && (k as { use?: string }).use !== 'enc');
  if (!jwks || Date.now() - jwks.at > 3600_000 || !find()) {
    const set = await json<{ keys: (JsonWebKey & { kid?: string })[] }>((await discovery()).jwks_uri);
    jwks = { at: Date.now(), keys: set.keys };
  }
  const jwk = find();
  if (!jwk) throw new Error('Signing key not found in JWKS');
  return createPublicKey({ key: jwk as never, format: 'jwk' });
}

interface Claims {
  iss: string; aud: string | string[]; azp?: string; exp: number; nonce?: string; sub: string;
  preferred_username?: string; email?: string; email_verified?: boolean;
  realm_access?: { roles?: string[] }; resource_access?: Record<string, { roles?: string[] }>;
}

async function verifyIdToken(token: string, nonce: string): Promise<Claims> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('Malformed ID token');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString()) as { alg: string; kid?: string };
  if (header.alg !== 'RS256') throw new Error(`Unsupported ID token algorithm ${header.alg}`);
  const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), await keyFor(header.kid), Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('ID token signature invalid');
  const c = JSON.parse(Buffer.from(p, 'base64url').toString()) as Claims;
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (c.iss !== kc.issuer) throw new Error('ID token issuer mismatch');
  if (!aud.includes(kc.clientId)) throw new Error('ID token audience mismatch');
  if (!(c.exp * 1000 > Date.now() - 30_000)) throw new Error('ID token expired');
  if (c.nonce !== nonce) throw new Error('ID token nonce mismatch');
  return c;
}

function authorize(c: Claims): string | null {
  const names = [c.preferred_username, c.email_verified === false ? undefined : c.email].filter(Boolean).map((x) => x!.toLowerCase());
  const roles = new Set([...(c.realm_access?.roles ?? []), ...(c.resource_access?.[kc.clientId]?.roles ?? [])]);
  if (kc.allowedUsers.length && !names.some((n) => kc.allowedUsers.includes(n))) return 'USER_NOT_ALLOWED';
  if (kc.requiredRole && !roles.has(kc.requiredRole)) return 'ROLE_MISSING';
  return null;
}

export function ssoEnabled(): boolean {
  return keycloakConfigured() && (kc.allowedUsers.length > 0 || !!kc.requiredRole);
}

export function registerOidc(app: FastifyInstance) {
  if (keycloakConfigured() && !ssoEnabled()) {
    app.log.warn('Keycloak is configured but neither KEYCLOAK_ALLOWED_USERS nor KEYCLOAK_REQUIRED_ROLE is set; SSO stays disabled');
  }

  app.get('/api/auth/sso/config', async () => ({ enabled: ssoEnabled(), label: kc.label }));

  app.get('/api/auth/sso/login', async (req, reply) => {
    if (!ssoEnabled()) throw new HttpError(404, 'NOT_FOUND', 'SSO is not enabled');
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    await col.oidc().insertOne({ _id: sha256(state), verifier, nonce, expireAt: new Date(Date.now() + 10 * 60_000) });
    let d: Discovery;
    try { d = await discovery(); } catch (e) {
      req.log.error({ err: (e as Error).message }, 'keycloak discovery failed');
      return reply.redirect('/?sso_error=SSO_UNAVAILABLE');
    }
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: kc.clientId, response_type: 'code', scope: 'openid profile email', redirect_uri: kc.redirectUri,
      state, nonce, code_challenge: b64u(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    }).toString();
    // Lax: the callback is a cross-site top-level redirect, which a Strict cookie would not survive.
    reply.setCookie(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure, path: '/api/auth/sso', maxAge: 600 });
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/api/auth/sso/callback', async (req, reply) => {
    const fail = (code: string, why?: string) => {
      req.log.warn({ code, why, ip: req.ip }, 'sso login failed');
      logEvent('warn', 'auth', `Keycloak sign-in refused (${code})${why ? `: ${why}` : ''}`, { ip: req.ip });
      reply.clearCookie(STATE_COOKIE, { path: '/api/auth/sso' });
      return reply.redirect(`/?sso_error=${code}`);
    };
    if (!ssoEnabled()) throw new HttpError(404, 'NOT_FOUND', 'SSO is not enabled');
    const { code, state, error } = req.query;
    if (error) return fail('SSO_DENIED', error);
    if (!code || !state || state !== req.cookies[STATE_COOKIE]) return fail('SSO_STATE');
    const saved = await col.oidc().findOneAndDelete({ _id: sha256(state), expireAt: { $gt: new Date() } });
    if (!saved) return fail('SSO_STATE');

    let claims: Claims;
    try {
      const d = await discovery();
      const body = new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: kc.redirectUri, client_id: kc.clientId, code_verifier: saved.verifier,
      });
      const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (kc.clientSecret) headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(kc.clientId)}:${encodeURIComponent(kc.clientSecret)}`).toString('base64')}`;
      const tok = await json<{ id_token?: string }>(d.token_endpoint, { method: 'POST', headers, body });
      if (!tok.id_token) throw new Error('No id_token in token response');
      claims = await verifyIdToken(tok.id_token, saved.nonce);
    } catch (e) {
      return fail('SSO_FAILED', (e as Error).message);
    }

    const denied = authorize(claims);
    const display = claims.preferred_username ?? claims.email ?? claims.sub;
    if (denied) return fail(denied, display);

    const username = `kc:${display}`.toLowerCase().slice(0, 64);
    const user = await col.users().findOneAndUpdate(
      { ssoSub: `${kc.issuer}|${claims.sub}` },
      { $set: { username, lastLoginAt: new Date() }, $setOnInsert: { passwordHash: '', createdAt: new Date() } },
      { upsert: true, returnDocument: 'after' },
    );
    if (!user) return fail('SSO_FAILED', 'user upsert failed');
    await createSession(req, reply, user._id, user.username);
    reply.clearCookie(STATE_COOKIE, { path: '/api/auth/sso' });
    req.log.info({ username: user.username, ip: req.ip }, 'login (keycloak)');
    return reply.redirect('/');
  });
}
