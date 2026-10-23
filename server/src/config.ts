// All configuration comes from environment variables (see .env.example).

const env = (k: string, d = ''): string => (process.env[k] ?? d).trim();
const bool = (k: string, d: boolean): boolean => {
  const v = env(k);
  return v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};
const ids = (k: string): number[] =>
  env(k).split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0);

function conflicts(): Record<number, number[]> {
  const raw = env('GUEST_CONFLICTS');
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as Record<string, number[]>;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [Number(k), v.map(Number)]));
  } catch {
    throw new Error('GUEST_CONFLICTS must be JSON like {"100":[101,106],"101":[100]}');
  }
}

const trim = (u: string) => u.replace(/\/+$/, '');

export const cfg = {
  port: Number(env('PORT', '3000')),
  host: env('HOST', '127.0.0.1'),
  trustProxy: bool('TRUST_PROXY', true),
  serveDist: env('SERVE_DIST'), // optional path to the built UI (dist/)

  mongoUri: env('MONGO_URI', 'mongodb://127.0.0.1:27017'),
  mongoDb: env('MONGO_DB', 'homelab'),

  sessionTtlHours: Number(env('SESSION_TTL_HOURS', '12')),
  cookieSecure: bool('COOKIE_SECURE', true),

  pveUrl: trim(env('PVE_URL')),
  pveNode: env('PVE_NODE'),
  pveTokenId: env('PVE_TOKEN_ID'), // user@realm!tokenname
  pveTokenSecret: env('PVE_TOKEN_SECRET'),
  pveInsecureTls: bool('PVE_INSECURE_TLS', false),
  allowedVmids: new Set(ids('ALLOWED_VMIDS')), // empty = every guest on the node
  protectedVmids: new Set(ids('PROTECTED_VMIDS')),
  conflicts: conflicts(),

  nginxDir: env('NGINX_SITES_DIR', '/etc/nginx/sites-enabled'),

  grafanaUrl: trim(env('GRAFANA_URL')), // how the backend reaches Grafana
  grafanaPublicUrl: trim(env('GRAFANA_PUBLIC_URL') || env('GRAFANA_URL')), // what the browser opens/embeds
  grafanaToken: env('GRAFANA_TOKEN'),
  grafanaDsUid: env('GRAFANA_DS_UID'), // Prometheus datasource uid

  kumaUrl: trim(env('KUMA_URL')),
  kumaApiKey: env('KUMA_API_KEY'),
  kumaPollMs: Number(env('KUMA_POLL_MS', '60000')),
};

export const pveConfigured = () => !!(cfg.pveUrl && cfg.pveNode && cfg.pveTokenId && cfg.pveTokenSecret);
export const grafanaConfigured = () => !!(cfg.grafanaUrl && cfg.grafanaToken);
export const kumaConfigured = () => !!(cfg.kumaUrl && cfg.kumaApiKey);
