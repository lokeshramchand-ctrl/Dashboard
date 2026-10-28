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
  hostPowerEnabled: bool('HOST_POWER_ENABLED', false), // allow POST /api/host/shutdown (powers off the whole Proxmox node)

  nginxDir: env('NGINX_SITES_DIR', '/etc/nginx/sites-enabled'),

  grafanaUrl: trim(env('GRAFANA_URL')), // how the backend reaches Grafana
  grafanaPublicUrl: trim(env('GRAFANA_PUBLIC_URL') || env('GRAFANA_URL')), // what the browser opens/embeds
  grafanaToken: env('GRAFANA_TOKEN'),
  grafanaDsUid: env('GRAFANA_DS_UID'), // Prometheus datasource uid

  kumaUrl: trim(env('KUMA_URL')),
  kumaApiKey: env('KUMA_API_KEY'),
  kumaPollMs: Number(env('KUMA_POLL_MS', '60000')),

  journalEnabled: bool('JOURNAL_ENABLED', true), // /api/logs/journal reads the host journal (dashboard user needs the systemd-journal group)
  eventRetentionDays: Number(env('EVENT_RETENTION_DAYS', '90')),

  keycloak: {
    issuer: trim(env('KEYCLOAK_ISSUER')), // https://sso.example.com/realms/<realm>
    clientId: env('KEYCLOAK_CLIENT_ID'),
    clientSecret: env('KEYCLOAK_CLIENT_SECRET'), // empty = public client (PKCE only)
    redirectUri: env('KEYCLOAK_REDIRECT_URI'), // https://<dashboard host>/api/auth/sso/callback
    allowedUsers: env('KEYCLOAK_ALLOWED_USERS').toLowerCase().split(/[\s,]+/).filter(Boolean), // preferred_username or email
    requiredRole: env('KEYCLOAK_REQUIRED_ROLE'), // realm role or client role
    label: env('KEYCLOAK_LABEL', 'Keycloak'),
  },

  ntfy: {
    url: trim(env('NTFY_URL')), // how the backend reaches ntfy, e.g. http://10.10.10.103
    publicUrl: trim(env('NTFY_PUBLIC_URL')), // what phones subscribe to
    topic: env('NTFY_TOPIC'),
    token: env('NTFY_TOKEN'), // optional access token
    clickUrl: env('NTFY_CLICK_URL'), // opened when the notification is tapped
    cpuLimit: Number(env('ALERT_CPU', '0.9')), memLimit: Number(env('ALERT_MEM', '0.92')), diskLimit: Number(env('ALERT_DISK', '0.9')),
  },

  ai: {
    baseUrl: trim(env('AI_BASE_URL')), // OpenAI-compatible base, e.g. http://10.10.10.x:11434/v1 (Ollama) or https://api.openai.com/v1
    apiKey: env('AI_API_KEY'), // empty for most local servers (Ollama/LM Studio)
    model: env('AI_MODEL'), // e.g. llama3.1, qwen2.5-coder, gpt-4o-mini
    label: env('AI_LABEL'), // display name, e.g. "Ollama · llama3.1"
  },

  frameSrc: env('FRAME_SRC').split(/\s+/).filter(Boolean), // origins the UI may embed (Grafana, Kuma status page)
};

export const pveConfigured = () => !!(cfg.pveUrl && cfg.pveNode && cfg.pveTokenId && cfg.pveTokenSecret);
export const grafanaConfigured = () => !!(cfg.grafanaUrl && cfg.grafanaToken);
export const keycloakConfigured = () => !!(cfg.keycloak.issuer && cfg.keycloak.clientId && cfg.keycloak.redirectUri);
export const kumaConfigured = () => !!(cfg.kumaUrl && cfg.kumaApiKey);
export const ntfyConfigured = () => !!(cfg.ntfy.url && cfg.ntfy.topic);
export const aiConfigured = () => !!(cfg.ai.baseUrl && cfg.ai.model);
