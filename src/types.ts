export type GuestStatus = 'running' | 'stopped' | 'paused';
export type GuestAction = 'start' | 'shutdown' | 'stop' | 'reboot';
export type KumaStatus = 'up' | 'down' | 'pending' | 'maintenance';

export interface Overview {
  guests: { total: number; running: number; stopped: number };
  nginx: { sites: number };
  kuma: { up: number; down: number; pending: number };
  host: { cpu: number; memUsed: number; memTotal: number; diskUsed: number; diskTotal: number; uptime: number };
}

export interface Guest {
  vmid: number;
  name: string;
  type: 'lxc' | 'qemu';
  status: GuestStatus;
  cpu: number; // fraction 0..1
  memUsed: number; // bytes
  memMax: number; // bytes
  uptime: number; // seconds
  protected: boolean;
  tags: string[];
  conflicts: number[];
}

export interface Task {
  status: 'running' | 'ok' | 'error';
  message: string;
}

export interface NginxSite {
  file: string;
  serverNames: string[];
  listen: string[];
  ssl: boolean;
  upstream: string | null;
  root: string | null;
  url: string;
}

export interface GrafanaDashboard {
  uid: string;
  title: string;
  folder: string;
  tags: string[];
  url: string;
  embedUrl: string;
}

export interface GrafanaPanel {
  id: number;
  title: string;
  embedUrl: string;
}

export interface Heartbeat {
  time: string;
  status: KumaStatus;
  ping: number | null;
}

export interface KumaMonitor {
  id: number;
  name: string;
  url: string;
  type: string;
  status: KumaStatus;
  uptime24h: number; // percent 0..100
  uptime30d: number;
  avgPing: number | null;
  lastCheck: string;
  heartbeats: Heartbeat[];
}

export interface KumaIncident {
  monitorId: number;
  name: string;
  status: KumaStatus;
  since: string;
  message: string;
}

export interface PromResult {
  status: string;
  data: { resultType: string; result: { metric: Record<string, string>; values: [number, string][] }[] };
}

export interface AppConfig {
  kumaStatusUrl?: string;
  grafanaUrl?: string;
}

export interface GuestConfig {
  config: Record<string, string | number>;
  pending: string[]; // keys Proxmox applies at the next restart
}

export type GuestConfigPatch = Partial<{
  hostname: string; name: string; description: string; tags: string[]; onboot: boolean; startup: string;
  cores: number; sockets: number; memory: number; swap: number; balloon: number; cpulimit: number;
}>;

/** One RRD sample: cpu 0..1, memory/disk in bytes, net in bytes/s, time in unix seconds. */
export interface RrdPoint {
  time: number; cpu: number | null; mem: number | null; maxmem: number | null;
  netin: number | null; netout: number | null; diskread: number | null; diskwrite: number | null;
}
export type Timeframe = 'hour' | 'day' | 'week' | 'month' | 'year';

export interface TaskRow {
  upid: string; type: string; user: string; start: number; end: number | null;
  status: 'running' | 'ok' | 'error'; message: string;
}

export interface Snapshot { name: string; description: string; time: number | null; vmstate: boolean; parent: string | null }

export interface BackupList {
  storages: string[];
  defaultStorage: string | null;
  items: { volid: string; storage: string; size: number; time: number; format: string; notes: string }[];
}
