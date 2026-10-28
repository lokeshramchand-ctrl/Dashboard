import type {
  Guest, GuestAction, GrafanaDashboard, KumaIncident, KumaMonitor, NginxSite, Overview, Task,
  ConfigRow, Disk, GuestStatusDetail, NodeInfo, NotifyInfo, NotifySettings, PveTask, RrdPoint, Service, Snapshot, Timeframe,
} from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
  }
}

let baseUrl = '';
let onExpired: () => void = () => {};

export const setBaseUrl = (u: string) => { baseUrl = u; };
export const setExpiredHandler = (f: () => void) => { onExpired = f; };

/** Accepts "dash.home.lan", "http://192.168.1.5:3000/" etc. and returns a clean origin. */
export function normalizeUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!baseUrl) throw new ApiError('Server URL is not set', 0, 'NO_SERVER');
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server', 0, 'NETWORK');
  }
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') onExpired();
  const text = await res.text();
  let data: { error?: string; code?: string } | null = null;
  if (text) {
    try { data = JSON.parse(text); } catch { /* non-JSON body */ }
  }
  if (!res.ok) throw new ApiError(data?.error || res.statusText || 'Request failed', res.status, data?.code || 'ERROR');
  return data as T;
}

const get = <T,>(p: string) => req<T>('GET', p);
const post = <T,>(p: string, b?: unknown) => req<T>('POST', p, b ?? {});

export const api = {
  login: (username: string, password: string) => post<{ username: string }>('/auth/login', { username, password }),
  logout: () => post<unknown>('/auth/logout'),
  me: () => get<{ username: string }>('/auth/me'),
  overview: () => get<Overview>('/overview'),
  guests: () => get<Guest[]>('/guests'),
  guestAction: (vmid: number, action: GuestAction) => post<{ taskId: string }>(`/guests/${vmid}/${action}`),
  task: (id: string) => get<Task>(`/tasks/${encodeURIComponent(id)}`),
  nginx: () => get<NginxSite[]>('/nginx/sites'),
  dashboards: () => get<GrafanaDashboard[]>('/grafana/dashboards'),
  monitors: () => get<KumaMonitor[]>('/kuma/monitors'),
  incidents: () => get<KumaIncident[]>('/kuma/incidents'),
  guestStatus: (vmid: number) => get<GuestStatusDetail>(`/guests/${vmid}/status`),
  guestConfig: (vmid: number) => get<ConfigRow[]>(`/guests/${vmid}/config`),
  guestRrd: (vmid: number, tf: Timeframe) => get<RrdPoint[]>(`/guests/${vmid}/rrd?timeframe=${tf}`),
  snapshots: (vmid: number) => get<Snapshot[]>(`/guests/${vmid}/snapshots`),
  node: () => get<NodeInfo>('/node'),
  nodeRrd: (tf: Timeframe) => get<RrdPoint[]>(`/node/rrd?timeframe=${tf}`),
  disks: () => get<Disk[]>('/node/disks'),
  services: () => get<Service[]>('/node/services'),
  tasks: (p: { vmid?: number; errors?: boolean; limit?: number } = {}) =>
    get<PveTask[]>(`/tasks?limit=${p.limit ?? 100}${p.vmid ? `&vmid=${p.vmid}` : ''}${p.errors ? '&errors=1' : ''}`),
  taskLog: (id: string) => get<string[]>(`/tasks/${encodeURIComponent(id)}/log`),
  notify: () => get<NotifyInfo>('/notify'),
  notifySettings: (s: Partial<NotifySettings>) => post<NotifySettings>('/notify/settings', s),
  notifyTest: () => post<{ ok: true }>('/notify/test'),
};
