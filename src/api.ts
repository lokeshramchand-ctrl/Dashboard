import type {
  AppConfig, BackupList, Guest, GuestAction, GuestConfig, GuestConfigPatch, GrafanaDashboard, GrafanaPanel, KumaIncident, KumaMonitor,
  NginxSite, Overview, PromResult, RrdPoint, Snapshot, Task, TaskRow, Timeframe,
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
const put = <T,>(p: string, b: unknown) => req<T>('PUT', p, b);
const del = <T,>(p: string) => req<T>('DELETE', p);

export const api = {
  login: (username: string, password: string) => post<unknown>('/auth/login', { username, password }),
  logout: () => post<unknown>('/auth/logout'),
  me: () => get<{ username: string }>('/auth/me'),
  overview: () => get<Overview>('/overview'),
  guests: () => get<Guest[]>('/guests'),
  guestAction: (vmid: number, action: GuestAction) => post<{ taskId: string }>(`/guests/${vmid}/${action}`),
  guestConfig: (vmid: number) => get<GuestConfig>(`/guests/${vmid}/config`),
  setGuestConfig: (vmid: number, patch: GuestConfigPatch) => put<{ ok: true }>(`/guests/${vmid}/config`, patch),
  guestRrd: (vmid: number, tf: Timeframe) => get<RrdPoint[]>(`/guests/${vmid}/rrd?timeframe=${tf}`),
  guestTasks: (vmid: number) => get<TaskRow[]>(`/guests/${vmid}/tasks`),
  taskLog: (id: string) => get<{ lines: string[] }>(`/tasks/${encodeURIComponent(id)}/log`),
  snapshots: (vmid: number) => get<Snapshot[]>(`/guests/${vmid}/snapshots`),
  createSnapshot: (vmid: number, b: { name: string; description?: string; vmstate?: boolean }) => post<{ taskId: string }>(`/guests/${vmid}/snapshots`, b),
  rollbackSnapshot: (vmid: number, name: string) => post<{ taskId: string }>(`/guests/${vmid}/snapshots/${encodeURIComponent(name)}/rollback`),
  deleteSnapshot: (vmid: number, name: string) => del<{ taskId: string }>(`/guests/${vmid}/snapshots/${encodeURIComponent(name)}`),
  backups: (vmid: number) => get<BackupList>(`/guests/${vmid}/backups`),
  createBackup: (vmid: number, b: { storage: string; mode: string; notes?: string }) => post<{ taskId: string }>(`/guests/${vmid}/backups`, b),
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
