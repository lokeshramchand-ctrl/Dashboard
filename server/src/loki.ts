import type { FastifyInstance } from 'fastify';
import { cfg, lokiConfigured } from './config.js';
import { HttpError, notConfigured } from './errors.js';

// Read-only window onto Loki. Nothing is stored here: every request is answered by querying Loki live.

const RANGE = /^(\d{1,3})(m|h|d)$/;
const LABEL = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

async function loki<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  if (!lokiConfigured()) throw notConfigured('Loki');
  const u = new URL(cfg.lokiUrl + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(u, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    console.error('loki unreachable:', (e as Error).message);
    throw new HttpError(502, 'LOKI_UNREACHABLE', 'Cannot reach Loki');
  }
  if (res.status === 400) throw new HttpError(400, 'BAD_QUERY', (await res.text().catch(() => '')).trim().slice(0, 300) || 'Loki rejected the query');
  if (!res.ok) throw new HttpError(502, 'LOKI_ERROR', `Loki returned ${res.status}`);
  return (await res.json()) as T;
}

function window(since: string | undefined) {
  const m = RANGE.exec(since ?? '1h');
  if (!m) throw new HttpError(400, 'BAD_REQUEST', 'since must look like 15m, 6h or 7d');
  const ms = Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
  if (ms > 31 * UNIT_MS.d) throw new HttpError(400, 'BAD_REQUEST', 'since is limited to 31d');
  const end = Date.now();
  return { ms, start: (end - ms) * 1e6, end: end * 1e6 }; // Loki wants nanoseconds
}

const selector = (q: unknown) => {
  const s = typeof q === 'string' ? q.trim() : '';
  if (!s || s.length > 2000) throw new HttpError(400, 'BAD_REQUEST', 'query is required (LogQL, max 2000 characters), e.g. {job="varlogs"}');
  return s;
};

interface Streams { data: { result: { stream: Record<string, string>; values: [string, string][] }[] } }
interface Matrix { data: { result: { metric: Record<string, string>; values: [number, string][] }[] } }

// ---------- analytics: everything is a LogQL metric query, nothing is stored here ----------
interface Vector { data: { result: { metric: Record<string, string>; value: [number, string] }[] } }
const ERR = 'error|err|crit|alert|emerg|fatal';
const lvlClass = (l: string | undefined): 'error' | 'warning' | 'other' =>
  !l ? 'other' : new RegExp(`^(${ERR})$`).test(l) ? 'error' : /^warn(ing)?$/.test(l) ? 'warning' : 'other';
const statusClass = (s: string | undefined): 'ok' | 'redirect' | 'client' | 'server' | 'other' =>
  s?.[0] === '2' ? 'ok' : s?.[0] === '3' ? 'redirect' : s?.[0] === '4' ? 'client' : s?.[0] === '5' ? 'server' : 'other';

async function instant(query: string, at: number): Promise<{ metric: Record<string, string>; v: number }[]> {
  const r = await loki<Vector>('/loki/api/v1/query', { query, time: at });
  return r.data.result.map((x) => ({ metric: x.metric, v: Number(x.value[1]) }));
}
async function range(query: string, w: { start: number; end: number }, step: number) {
  const r = await loki<Matrix>('/loki/api/v1/query_range', { query, start: w.start, end: w.end, step });
  return r.data.result;
}
const sumBy = (rows: { metric: Record<string, string>; v: number }[], key: (m: Record<string, string>) => string) => {
  const o = new Map<string, number>();
  for (const r of rows) o.set(key(r.metric), (o.get(key(r.metric)) ?? 0) + (Number.isFinite(r.v) ? r.v : 0));
  return o;
};
const cache = new Map<string, { at: number; data: unknown }>();

async function analytics(since: string) {
  const hit = cache.get(since);
  if (hit && Date.now() - hit.at < 15_000) return hit.data;
  const w = window(since);
  const R = `${Math.round(w.ms / 1000)}s`;
  const at = w.end / 1e9;
  const step = Math.max(Math.round(w.ms / 1000 / 48), 60); // ~48 buckets
  const ALL = '{job=~".+"}';
  const WEB = '{job="nginx-access"}';
  const [byLevel, hostLines, hostErrs, unitErrs, status, vhostReq, vhostSrv, p95, quiet, seen, lvlSeries, webSeries] = await Promise.all([
    instant(`sum by (level) (count_over_time(${ALL} [${R}]))`, at),
    instant(`sum by (host) (count_over_time(${ALL} [${R}]))`, at),
    instant(`sum by (host) (count_over_time({job=~".+", level=~"${ERR}"} [${R}]))`, at),
    instant(`topk(8, sum by (unit, host) (count_over_time({job="systemd-journal", level=~"${ERR}"} [${R}])))`, at),
    instant(`sum by (status) (count_over_time(${WEB} [${R}]))`, at),
    instant(`sum by (vhost) (count_over_time(${WEB} [${R}]))`, at),
    instant(`sum by (vhost) (count_over_time({job="nginx-access", status=~"5.."} [${R}]))`, at),
    instant(`quantile_over_time(0.95, ${WEB} | unwrap rt [${R}]) by (vhost)`, at),
    instant('sum by (host) (count_over_time({job="systemd-journal"} [15m]))', at),
    instant('sum by (host) (count_over_time({job="systemd-journal"} [24h]))', at),
    range(`sum by (level) (count_over_time(${ALL} [${step}s]))`, w, step),
    range(`sum by (status) (count_over_time(${WEB} [${step}s]))`, w, step),
  ]);

  const lv = sumBy(byLevel, (m) => lvlClass(m.level));
  const st = sumBy(status, (m) => statusClass(m.status));
  const requests = [...st.values()].reduce((a, b) => a + b, 0);
  const total = [...lv.values()].reduce((a, b) => a + b, 0);
  const errByHost = sumBy(hostErrs, (m) => m.host ?? '?');
  const srvByVhost = sumBy(vhostSrv, (m) => m.vhost ?? '?');
  const p95By = sumBy(p95, (m) => m.vhost ?? '?');
  const quietSet = new Set(quiet.map((r) => r.metric.host));

  // time series bucketed by class
  const bucket = <K extends string>(series: Awaited<ReturnType<typeof range>>, label: string, cls: (v: string | undefined) => K, keys: K[]) => {
    const t = new Map<number, Record<string, number>>();
    for (const s of series) for (const [ts, v] of s.values) {
      const row = t.get(ts) ?? Object.fromEntries(keys.map((k) => [k, 0]));
      const k = cls(s.metric[label]);
      row[k] = (row[k] ?? 0) + Number(v);
      t.set(ts, row);
    }
    return [...t.entries()].sort((a, b) => a[0] - b[0]).map(([ts, row]) => ({ t: new Date(ts * 1000).toISOString(), ...row }));
  };

  const data = {
    since, stepSeconds: step,
    logs: {
      total, errors: lv.get('error') ?? 0, warnings: lv.get('warning') ?? 0, hosts: hostLines.length,
      series: bucket(lvlSeries, 'level', lvlClass, ['error', 'warning', 'other']),
      topHosts: hostLines.map((h) => ({ host: h.metric.host ?? '?', lines: h.v, errors: errByHost.get(h.metric.host ?? '?') ?? 0 }))
        .sort((a, b) => b.errors - a.errors || b.lines - a.lines).slice(0, 10),
      topUnits: unitErrs.map((u) => ({ unit: (u.metric.unit ?? 'kernel').replace(/\.service$/, ''), host: u.metric.host ?? '?', errors: u.v })).sort((a, b) => b.errors - a.errors),
    },
    web: {
      requests, serverErrors: st.get('server') ?? 0, clientErrors: st.get('client') ?? 0,
      errorRate: requests ? (st.get('server') ?? 0) / requests : 0,
      series: bucket(webSeries, 'status', statusClass, ['ok', 'redirect', 'client', 'server', 'other']),
      topVhosts: vhostReq.map((v) => ({ vhost: v.metric.vhost ?? '?', requests: v.v, errors5xx: srvByVhost.get(v.metric.vhost ?? '?') ?? 0, p95: p95By.get(v.metric.vhost ?? '?') ?? null }))
        .sort((a, b) => b.requests - a.requests).slice(0, 12),
    },
    // pipeline health: sources that logged in the last 24 h but not in the last 15 min
    health: { silent: seen.map((s) => s.metric.host ?? '?').filter((h) => !quietSet.has(h)).sort() },
  };
  cache.set(since, { at: Date.now(), data });
  return data;
}

export function registerLoki(app: FastifyInstance) {
  app.get<{ Querystring: { since?: string } }>('/api/loki/analytics', async (req) => analytics(req.query.since ?? '24h'));

  app.get('/api/loki/status', async () => {
    if (!lokiConfigured()) return { configured: false, ready: false, publicUrl: '', error: null, labels: [] as string[] };
    const base = { configured: true, publicUrl: cfg.lokiPublicUrl };
    try {
      const w = window('1h');
      const l = await loki<{ data?: string[] }>('/loki/api/v1/labels', { start: w.start, end: w.end });
      return { ...base, ready: true, error: null, labels: l.data ?? [] };
    } catch (e) {
      return { ...base, ready: false, error: (e as Error).message, labels: [] as string[] };
    }
  });

  app.get<{ Querystring: { since?: string } }>('/api/loki/labels', async (req) => {
    const w = window(req.query.since ?? '24h');
    return (await loki<{ data?: string[] }>('/loki/api/v1/labels', { start: w.start, end: w.end })).data ?? [];
  });

  app.get<{ Params: { name: string }; Querystring: { since?: string } }>('/api/loki/labels/:name/values', async (req) => {
    if (!LABEL.test(req.params.name)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid label name');
    const w = window(req.query.since ?? '24h');
    return (await loki<{ data?: string[] }>(`/loki/api/v1/label/${req.params.name}/values`, { start: w.start, end: w.end })).data ?? [];
  });

  // Log lines for a LogQL query, newest first, flattened across streams.
  app.get<{ Querystring: { query?: string; since?: string; limit?: string; direction?: string } }>('/api/loki/query', async (req) => {
    const query = selector(req.query.query);
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? '300', 10) || 300, 1), 1000);
    const direction = req.query.direction === 'forward' ? 'forward' : 'backward';
    const w = window(req.query.since);
    const r = await loki<Streams>('/loki/api/v1/query_range', { query, start: w.start, end: w.end, limit, direction });
    const lines = r.data.result.flatMap((s) => s.values.map(([ns, line]) => ({
      ts: new Date(Number(BigInt(ns) / 1_000_000n)).toISOString(), ns, line: line.slice(0, 4000), labels: s.stream,
    })));
    lines.sort((a, b) => (a.ns === b.ns ? 0 : (a.ns < b.ns) === (direction === 'forward') ? -1 : 1));
    return lines.slice(0, limit);
  });

  // Matches per time bucket for the same query (a metric query wrapped around it), for the bar chart.
  app.get<{ Querystring: { query?: string; since?: string } }>('/api/loki/histogram', async (req) => {
    const query = selector(req.query.query);
    const w = window(req.query.since);
    const step = Math.max(Math.round(w.ms / 1000 / 60), 15); // ~60 buckets
    const r = await loki<Matrix>('/loki/api/v1/query_range', {
      query: `sum(count_over_time(${query} [${step}s]))`, start: w.start, end: w.end, step,
    });
    const values = r.data.result[0]?.values ?? [];
    return { stepSeconds: step, points: values.map(([t, v]) => ({ t: new Date(t * 1000).toISOString(), n: Math.round(Number(v)) })) };
  });
}
