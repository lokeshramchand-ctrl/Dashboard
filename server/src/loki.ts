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
    throw new HttpError(502, 'LOKI_UNREACHABLE', `Cannot reach Loki: ${(e as Error).message}`);
  }
  if (res.status === 400) throw new HttpError(400, 'BAD_QUERY', (await res.text().catch(() => '')).trim().slice(0, 300) || 'Loki rejected the query');
  if (!res.ok) throw new HttpError(502, 'LOKI_ERROR', `Loki ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
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

export function registerLoki(app: FastifyInstance) {
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
