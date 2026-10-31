import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ObjectId } from 'mongodb';
import { cfg } from './config.js';
import { col } from './db.js';
import { HttpError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: ObjectId; username: string };
  }
}

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60_000;
export const COOKIE = 'sid';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEYLEN, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, N, r, p, salt, key] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(actual, expected);
}

// Used so unknown usernames cost the same as wrong passwords (no user enumeration by timing).
const DUMMY_HASH = hashPassword(randomBytes(8).toString('hex'));
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(req: FastifyRequest, reply: FastifyReply, userId: ObjectId, username: string) {
  const token = randomBytes(32).toString('hex');
  const ttlMs = cfg.sessionTtlHours * 3600_000;
  await col.sessions().insertOne({
    tokenHash: sha256(token), userId, username,
    createdAt: new Date(), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + ttlMs),
    ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
  } as never);
  reply.setCookie(COOKIE, token, {
    httpOnly: true, sameSite: 'strict', secure: cfg.cookieSecure, path: '/', maxAge: Math.floor(ttlMs / 1000),
  });
}

function decodedPath(url: string): string {
  const raw = url.split('?')[0];
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export function registerAuth(app: FastifyInstance) {
  // Everything under /api needs a valid session except login. Also blocks cross-site state changes.
  app.addHook('onRequest', async (req, reply) => {
    // Fastify decodes percent-escapes before routing ("/%61pi/x" reaches the /api/x handler), so the
    // guard must test the decoded path AND the route that actually matched, never the raw URL alone.
    const path = decodedPath(req.url);
    const routed = req.routeOptions?.url ?? '';
    if (!path.startsWith('/api/') && !routed.startsWith('/api/')) return;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const fetchSite = req.headers['sec-fetch-site'];
      if (fetchSite === 'cross-site') throw new HttpError(403, 'BAD_ORIGIN', 'Cross-site request refused');
      const origin = req.headers.origin;
      if (origin) {
        const allowed = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
        let host = '';
        try { host = new URL(origin).host; } catch { /* malformed origin */ }
        if (!allowed.includes(host)) throw new HttpError(403, 'BAD_ORIGIN', 'Cross-site request refused');
      }
    }

    if (path === '/api/auth/login' || path.startsWith('/api/auth/sso/')) return;

    const token = req.cookies[COOKIE];
    const session = token ? await col.sessions().findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } }) : null;
    if (!session) {
      reply.clearCookie(COOKIE, { path: '/' });
      throw new HttpError(401, 'UNAUTHENTICATED', 'Login required');
    }
    // Idle timeout: lastSeenAt is refreshed at most once a minute to keep writes cheap.
    const now = Date.now();
    const last = (session.lastSeenAt ?? session.createdAt).getTime();
    if (now - last > cfg.sessionIdleMinutes * 60_000) {
      await col.sessions().deleteOne({ _id: session._id });
      reply.clearCookie(COOKIE, { path: '/' });
      throw new HttpError(401, 'UNAUTHENTICATED', 'Session expired from inactivity');
    }
    if (now - last > 60_000) await col.sessions().updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date(now) } });
    req.user = { id: session.userId, username: session.username };
  });

  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/login', async (req, reply) => {
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!username || !password || username.length > 64 || password.length > 256) {
      throw new HttpError(400, 'BAD_REQUEST', 'Username and password are required');
    }

    // Two counters: per ip+username (targeted guessing) and per ip (spraying many usernames).
    const key = `${req.ip}|${username}`;
    const ipKey = `ip|${req.ip}`;
    const [attempts, ipAttempts] = await Promise.all([col.attempts().findOne({ _id: key }), col.attempts().findOne({ _id: ipKey })]);
    if ((attempts && attempts.count >= MAX_ATTEMPTS) || (ipAttempts && ipAttempts.count >= MAX_ATTEMPTS * 4)) {
      throw new HttpError(429, 'RATE_LIMITED', 'Too many failed attempts. Try again in a few minutes.');
    }

    const user = await col.users().findOne({ username });
    const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH) && !!user;
    if (!ok || !user) {
      for (const _id of [key, ipKey]) {
        await col.attempts().updateOne({ _id }, { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date(Date.now() + ATTEMPT_WINDOW_MS) } }, { upsert: true });
      }
      // Only a bounded, printable slice is logged: a mistyped password in the username box must not hit the logs raw.
      req.log.warn({ username: username.slice(0, 24).replace(/[^\w.@-]/g, '?'), ip: req.ip }, 'failed login');
      throw new HttpError(401, 'BAD_CREDENTIALS', 'Invalid username or password');
    }

    await col.attempts().deleteOne({ _id: key });
    await col.users().updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    await createSession(req, reply, user._id, user.username);
    req.log.info({ username: user.username, ip: req.ip }, 'login');
    return { username: user.username };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await col.sessions().deleteOne({ tokenHash: sha256(token) });
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  // Sign out everywhere: drops every session of the caller (this browser included).
  app.post('/api/auth/logout-all', async (req, reply) => {
    const r = await col.sessions().deleteMany({ userId: req.user!.id });
    reply.clearCookie(COOKIE, { path: '/' });
    req.log.info({ username: req.user!.username, revoked: r.deletedCount }, 'sessions revoked');
    return { ok: true, revoked: r.deletedCount };
  });

  app.get('/api/auth/me', async (req) => ({ username: req.user!.username }));
}
