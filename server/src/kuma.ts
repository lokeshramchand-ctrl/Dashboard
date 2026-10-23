import type { FastifyInstance } from 'fastify';
import { cfg, kumaConfigured } from './config.js';
import { col } from './db.js';
import type { SampleDoc } from './db.js';
import { HttpError, notConfigured } from './errors.js';

type Status = SampleDoc['status'];
const STATUS: Record<string, Status> = { '0': 'down', '1': 'up', '2': 'pending', '3': 'maintenance' };
const DAY = 86_400_000;

export interface Scraped { key: string; name: string; url: string; type: string; status: Status; ping: number | null }
let snapshot: { at: number; items: Scraped[] } | null = null;

// Stable numeric id: Kuma's /metrics endpoint exposes no monitor id.
function idOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) & 0x7fffffff;
}

/** Parses Uptime Kuma's Prometheus text (monitor_status / monitor_response_time). */
export function parseMetrics(text: string): Scraped[] {
  const map = new Map<string, Scraped>();
  for (const line of text.split('\n')) {
    const m = line.match(/^(monitor_status|monitor_response_time)\{(.*)\}\s+(\S+)$/);
    if (!m) continue;
    const labels: Record<string, string> = {};
    for (const l of m[2].matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) labels[l[1]] = l[2].replace(/\\(.)/g, '$1');
    const name = labels.monitor_name ?? 'unknown';
    const url = labels.monitor_url && labels.monitor_url !== 'null' ? labels.monitor_url : labels.monitor_hostname && labels.monitor_hostname !== 'null' ? labels.monitor_hostname : '';
    const type = labels.monitor_type ?? 'http';
    const key = `${name}|${type}|${url}`;
    const item = map.get(key) ?? { key, name, url, type, status: 'pending' as Status, ping: null };
    const v = Number(m[3]);
    if (m[1] === 'monitor_status') item.status = STATUS[String(v)] ?? 'pending';
    else item.ping = Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
    map.set(key, item);
  }
  return [...map.values()];
}

async function scrape(app: FastifyInstance) {
  try {
    const res = await fetch(`${cfg.kumaUrl}/metrics`, {
      headers: { Authorization: `Basic ${Buffer.from(`:${cfg.kumaApiKey}`).toString('base64')}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseMetrics(await res.text());
    snapshot = { at: Date.now(), items };
    const now = new Date();
    if (items.length) {
      await col.samples().insertMany(items.map((i) => ({
        monitorKey: i.key, name: i.name, url: i.url, type: i.type, status: i.status,
        ping: i.status === 'down' ? null : i.ping, ts: now, expireAt: new Date(now.getTime() + 31 * DAY),
      })));
    }
  } catch (e) {
    app.log.warn({ err: (e as Error).message }, 'kuma scrape failed');
  }
}

export function startKuma(app: FastifyInstance) {
  if (!kumaConfigured()) { app.log.warn('Uptime Kuma not configured; /api/kuma/* will return 503'); return; }
  void scrape(app);
  setInterval(() => void scrape(app), cfg.kumaPollMs).unref();
}

async function current(): Promise<Scraped[]> {
  if (!kumaConfigured()) throw notConfigured('Uptime Kuma');
  if (!snapshot) throw new HttpError(503, 'KUMA_NOT_READY', 'Waiting for the first Uptime Kuma scrape');
  return snapshot.items;
}

export async function kumaCounts(): Promise<{ up: number; down: number; pending: number }> {
  const items = await current();
  return {
    up: items.filter((i) => i.status === 'up').length,
    down: items.filter((i) => i.status === 'down').length,
    pending: items.filter((i) => i.status === 'pending').length,
  };
}

export function registerKuma(app: FastifyInstance) {
  app.get('/api/kuma/monitors', async () => {
    const items = await current();
    const now = Date.now();
    const since30 = new Date(now - 30 * DAY), since24 = new Date(now - DAY);
    const up = (d: Date) => ({ $sum: { $cond: [{ $and: [{ $gte: ['$ts', d] }, { $eq: ['$status', 'up'] }] }, 1, 0] } });
    const counted = (d: Date) => ({ $sum: { $cond: [{ $and: [{ $gte: ['$ts', d] }, { $ne: ['$status', 'maintenance'] }] }, 1, 0] } });
    const agg = await col.samples().aggregate<{ _id: string; up30: number; n30: number; up24: number; n24: number; ping: number | null }>([
      { $match: { ts: { $gte: since30 } } },
      { $group: { _id: '$monitorKey', up30: up(since30), n30: counted(since30), up24: up(since24), n24: counted(since24),
        ping: { $avg: { $cond: [{ $and: [{ $gte: ['$ts', since24] }, { $ne: ['$ping', null] }] }, '$ping', null] } } } },
    ]).toArray();
    const stats = new Map(agg.map((a) => [a._id, a]));
    const pct = (u: number, n: number, fallback: number) => (n ? Math.round((u / n) * 10000) / 100 : fallback);

    return Promise.all(items.map(async (i) => {
      const s = stats.get(i.key);
      const beats = (await col.samples().find({ monitorKey: i.key }).sort({ ts: -1 }).limit(30).toArray()).reverse();
      const fallback = i.status === 'up' ? 100 : 0;
      return {
        id: idOf(i.key), name: i.name, url: i.url, type: i.type, status: i.status,
        uptime24h: pct(s?.up24 ?? 0, s?.n24 ?? 0, fallback), uptime30d: pct(s?.up30 ?? 0, s?.n30 ?? 0, fallback),
        avgPing: s?.ping != null ? Math.round(s.ping) : i.ping,
        lastCheck: new Date(snapshot!.at).toISOString(),
        heartbeats: beats.map((b) => ({ time: b.ts.toISOString(), status: b.status, ping: b.ping })),
      };
    }));
  });

  app.get('/api/kuma/incidents', async () => {
    const bad = (await current()).filter((i) => i.status !== 'up');
    return Promise.all(bad.map(async (i) => {
      const lastUp = await col.samples().findOne({ monitorKey: i.key, status: 'up' }, { sort: { ts: -1 } });
      const first = await col.samples().findOne({ monitorKey: i.key, ...(lastUp ? { ts: { $gt: lastUp.ts } } : {}) }, { sort: { ts: 1 } });
      return {
        monitorId: idOf(i.key), name: i.name, status: i.status,
        since: (first?.ts ?? new Date(snapshot!.at)).toISOString(),
        message: i.status === 'down' ? 'Monitor is down' : i.status === 'pending' ? 'Monitor is retrying' : 'Under maintenance',
      };
    }));
  });
}
