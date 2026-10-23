import type { FastifyInstance } from 'fastify';
import { cfg, grafanaConfigured } from './config.js';
import { HttpError, notConfigured } from './errors.js';

async function gf<T>(path: string): Promise<T> {
  if (!grafanaConfigured()) throw notConfigured('Grafana');
  let res: Response;
  try {
    res = await fetch(`${cfg.grafanaUrl}${path}`, {
      headers: { Authorization: `Bearer ${cfg.grafanaToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new HttpError(502, 'GRAFANA_UNREACHABLE', `Cannot reach Grafana: ${(e as Error).message}`);
  }
  if (res.status === 404) throw new HttpError(404, 'NOT_FOUND', 'Not found in Grafana');
  if (!res.ok) throw new HttpError(502, 'GRAFANA_ERROR', `Grafana ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return (await res.json()) as T;
}

const slugOf = (url: string) => url.split('?')[0].split('/').filter(Boolean).pop() ?? '';
const UID = /^[\w-]{1,64}$/;

export function registerGrafana(app: FastifyInstance) {
  app.get('/api/grafana/dashboards', async () => {
    const items = await gf<any[]>('/api/search?type=dash-db&limit=500');
    return items.map((d) => ({
      uid: d.uid, title: d.title, folder: d.folderTitle ?? 'General', tags: d.tags ?? [],
      url: `${cfg.grafanaPublicUrl}${d.url}`,
      embedUrl: `${cfg.grafanaPublicUrl}/d/${d.uid}/${slugOf(d.url)}?orgId=1&kiosk`,
    }));
  });

  app.get<{ Params: { uid: string } }>('/api/grafana/panels/:uid', async (req) => {
    const { uid } = req.params;
    if (!UID.test(uid)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid dashboard uid');
    const d = await gf<any>(`/api/dashboards/uid/${uid}`);
    const slug = slugOf(d.meta?.url ?? '') || uid;
    const flat = (d.dashboard?.panels ?? []).flatMap((p: any) => (p.type === 'row' ? p.panels ?? [] : [p]));
    return flat
      .filter((p: any) => p.id != null && p.type !== 'row')
      .map((p: any) => ({
        id: p.id, title: p.title || `Panel ${p.id}`,
        embedUrl: `${cfg.grafanaPublicUrl}/d-solo/${uid}/${slug}?orgId=1&panelId=${p.id}`,
      }));
  });

  // PromQL proxy through Grafana's datasource proxy (read-only service account token).
  app.post<{ Body: { query?: string; start?: number; end?: number; step?: number } }>('/api/metrics/query', async (req) => {
    if (!cfg.grafanaDsUid) throw notConfigured('Grafana datasource (GRAFANA_DS_UID)');
    const { query, start, end, step } = req.body ?? {};
    const s = Number(start), e = Number(end), st = Number(step);
    if (!query || typeof query !== 'string' || query.length > 2000) throw new HttpError(400, 'BAD_REQUEST', 'query is required (max 2000 chars)');
    if (![s, e, st].every(Number.isFinite) || e <= s || st <= 0) throw new HttpError(400, 'BAD_REQUEST', 'start, end and step must be valid numbers (end > start, step > 0)');
    if ((e - s) / st > 5000) throw new HttpError(400, 'BAD_REQUEST', 'Too many points requested; increase step');
    const qs = new URLSearchParams({ query, start: String(s), end: String(e), step: String(st) });
    return gf(`/api/datasources/proxy/uid/${encodeURIComponent(cfg.grafanaDsUid)}/api/v1/query_range?${qs}`);
  });
}
