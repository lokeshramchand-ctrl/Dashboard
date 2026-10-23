import type {
  AppConfig, Guest, GuestAction, GrafanaDashboard, GrafanaPanel, KumaIncident, KumaMonitor,
  NginxSite, Overview, PromResult, Task,
} from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server', 0, 'NETWORK');
  }
  if (res.status === 401 && path !== '/auth/login') {
    window.dispatchEvent(new Event('auth:expired'));
  }
  const text = await res.text();
  let data: any = null;
  if (text) {
    try { data = JSON.parse(text); } catch { /* non-JSON body */ }
  }
  if (!res.ok) {
    throw new ApiError(data?.error || res.statusText || 'Request failed', res.status, data?.code || 'ERROR');
  }
  return data as T;
}

const get = <T,>(p: string) => req<T>('GET', p);
const post = <T,>(p: string, b?: unknown) => req<T>('POST', p, b ?? {});

export const api = {
  login: (username: string, password: string) => post<unknown>('/auth/login', { username, password }),
  logout: () => post<unknown>('/auth/logout'),
  me: () => get<{ username: string }>('/auth/me'),
  overview: () => get<Overview>('/overview'),
  guests: () => get<Guest[]>('/guests'),
  guestAction: (vmid: number, action: GuestAction) => post<{ taskId: string }>(`/guests/${vmid}/${action}`),
  task: (id: string) => get<Task>(`/tasks/${encodeURIComponent(id)}`),
  nginx: () => get<NginxSite[]>('/nginx/sites'),
  dashboards: () => get<GrafanaDashboard[]>('/grafana/dashboards'),
  panels: (uid: string) => get<GrafanaPanel[]>(`/grafana/panels/${encodeURIComponent(uid)}`),
  query: (query: string, start: number, end: number, step: number) =>
    post<PromResult>('/metrics/query', { query, start, end, step }),
  monitors: () => get<KumaMonitor[]>('/kuma/monitors'),
  incidents: () => get<KumaIncident[]>('/kuma/incidents'),
};

/** Optional runtime config shipped next to index.html (see API_NOTES.md). */
export async function loadConfig(): Promise<AppConfig> {
  try {
    const r = await fetch('config.json', { cache: 'no-store' });
    if (!r.ok) return {};
    return await r.json();
  } catch {
    return {};
  }
}
