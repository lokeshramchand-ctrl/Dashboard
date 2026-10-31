// Small in-memory fixed-window limiter for /api: one bucket per client IP for reads and a
// stricter one for state-changing calls, so a stolen session or a loop cannot hammer Proxmox.
import type { FastifyInstance } from 'fastify';
import { HttpError } from './errors.js';

const WINDOW_MS = 60_000;
const LIMITS = { read: 600, write: 60 };
const buckets = new Map<string, { n: number; reset: number }>();

export function registerRateLimit(app: FastifyInstance) {
  setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k); }, WINDOW_MS).unref();
  app.addHook('onRequest', async (req, reply) => {
    const routed = req.routeOptions?.url ?? '';
    if (!routed.startsWith('/api/') || routed === '/api/events') return;
    const kind = req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write';
    const key = `${kind}|${req.ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { n: 0, reset: now + WINDOW_MS }; buckets.set(key, b); }
    if (++b.n > LIMITS[kind]) {
      reply.header('Retry-After', Math.ceil((b.reset - now) / 1000));
      throw new HttpError(429, 'RATE_LIMITED', 'Too many requests, slow down');
    }
  });
}
