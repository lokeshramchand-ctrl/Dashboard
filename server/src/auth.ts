import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
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

export function registerAuth(app: FastifyInstance) {
  // Everything under /api needs a valid session except login. Also blocks cross-site state changes.
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin) {
        const allowed = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
        let host = '';
        try { host = new URL(origin).host; } catch { /* malformed origin */ }
        if (!allowed.includes(host)) throw new HttpError(403, 'BAD_ORIGIN', 'Cross-site request refused');
      }
    }

    if (path === '/api/auth/login') return;

    const token = req.cookies[COOKIE];
    const session = token ? await col.sessions().findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } }) : null;
    if (!session) {
      reply.clearCookie(COOKIE, { path: '/' });
      throw new HttpError(401, 'UNAUTHENTICATED', 'Login required');
    }
    req.user = { id: session.userId, username: session.username };
  });

  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/login', async (req, reply) => {
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!username || !password || username.length > 64 || password.length > 256) {
      throw new HttpError(400, 'BAD_REQUEST', 'Username and password are required');
    }

    const key = `${req.ip}|${username}`;
    const attempts = await col.attempts().findOne({ _id: key });
    if (attempts && attempts.count >= MAX_ATTEMPTS) {
      throw new HttpError(429, 'RATE_LIMITED', 'Too many failed attempts. Try again in a few minutes.');
    }

    const user = await col.users().findOne({ username });
    const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH) && !!user;
    if (!ok || !user) {
      await col.attempts().updateOne(
        { _id: key },
        { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date(Date.now() + ATTEMPT_WINDOW_MS) } },
        { upsert: true },
      );
      req.log.warn({ username, ip: req.ip }, 'failed login');
      throw new HttpError(401, 'BAD_CREDENTIALS', 'Invalid username or password');
    }

    await col.attempts().deleteOne({ _id: key });
    const token = randomBytes(32).toString('hex');
    const ttlMs = cfg.sessionTtlHours * 3600_000;
    await col.sessions().insertOne({
      tokenHash: sha256(token), userId: user._id, username: user.username,
      createdAt: new Date(), expiresAt: new Date(Date.now() + ttlMs),
      ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
    } as never);
    await col.users().updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

    reply.setCookie(COOKIE, token, {
      httpOnly: true, sameSite: 'strict', secure: cfg.cookieSecure, path: '/', maxAge: Math.floor(ttlMs / 1000),
    });
    req.log.info({ username: user.username, ip: req.ip }, 'login');
    return { username: user.username };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await col.sessions().deleteOne({ tokenHash: sha256(token) });
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ username: req.user!.username }));
}
