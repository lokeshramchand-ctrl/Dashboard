import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import Fastify from 'fastify';
import { registerAuth } from './auth.js';
import { cfg } from './config.js';
import { closeDb, connectDb } from './db.js';
import { HttpError } from './errors.js';
import { registerGrafana } from './grafana.js';
import { registerGuests } from './guests.js';
import { registerKuma, startKuma } from './kuma.js';
import { recordCleanStop, registerLogs, startEvents } from './events.js';
import { registerNginx } from './nginx.js';
import { registerNode } from './node.js';
import { registerNotify, startNotify } from './notify.js';
import { registerOidc } from './oidc.js';
import { registerOverview } from './overview.js';

const app = Fastify({
  trustProxy: cfg.trustProxy,
  bodyLimit: 64 * 1024,
  logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
});

app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, code: err.code });
  const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  if (status >= 500) req.log.error(err);
  return reply.code(status).send({ error: status >= 500 ? 'Internal server error' : err.message, code: status >= 500 ? 'INTERNAL' : err.code ?? 'BAD_REQUEST' });
});

app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: `No route for ${req.method} ${req.url.split('?')[0]}`, code: 'NOT_FOUND' }));

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  `frame-src 'self' ${[cfg.grafanaPublicUrl, ...cfg.frameSrc].filter(Boolean).join(' ')}`,
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

app.addHook('onSend', async (_req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'same-origin');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Content-Security-Policy', csp);
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  if (cfg.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
});
app.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
});

await connectDb();
await app.register(cookie);
registerAuth(app);
registerOidc(app);
registerLogs(app);
registerOverview(app);
registerGuests(app);
registerNode(app);
registerNotify(app);
registerNginx(app);
registerGrafana(app);
registerKuma(app);
if (cfg.serveDist) await app.register(staticFiles, { root: resolve(cfg.serveDist) });
startKuma(app);
startEvents(app);
startNotify(app);

const shutdown = async () => { await recordCleanStop(); await app.close(); await closeDb(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: cfg.port, host: cfg.host });
