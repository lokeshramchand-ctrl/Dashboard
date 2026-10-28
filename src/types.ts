export type GuestStatus = 'running' | 'stopped' | 'paused';
export type GuestAction = 'start' | 'shutdown' | 'stop' | 'reboot' | 'reset' | 'suspend' | 'resume';
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

export type EventLevel = 'info' | 'warn' | 'error';
export interface SystemEvent {
  id: string; ts: string; level: EventLevel;
  source: 'app' | 'db' | 'host' | 'guest' | 'monitor' | 'auth'; message: string; data: Record<string, unknown> | null;
}
export interface JournalLine { ts: string; priority: number; unit: string; message: string; pid?: string }
export interface BootInfo { index: number; bootId: string; first: string; last: string; clean: boolean | null; endReason: string }
export interface LogSummary {
  boots: BootInfo[]; journalError: string | null; errors24h: number; lastHeartbeat: string | null; pendingEvents: number; processUptime: number;
}
export interface SsoConfig { enabled: boolean; label: string }

export type Timeframe = 'hour' | 'day' | 'week' | 'month' | 'year';
export type RrdPoint = { time: number } & Record<string, number | null>;
export interface NodeInfo {
  name: string; cpu: number; wait: number; cpuModel: string; cpus: number; cores: number; sockets: number; mhz: number;
  loadavg: number[]; memUsed: number; memTotal: number; swapUsed: number; swapTotal: number; rootUsed: number; rootTotal: number;
  ksmShared: number; uptime: number; kernel: string; pveVersion: string; bootMode: string; subscription: string;
  timezone: string; dns: string[]; searchDomain: string;
}
export interface NetIface { iface: string; type: string; active: boolean; autostart: boolean; method: string; cidr: string | null; gateway: string | null; cidr6: string | null; ports: string[]; vlanAware: boolean; comments: string }
export interface Disk { devpath: string; model: string; serial: string; type: string; size: number; health: string; wearout: number | null; used: string; gpt: boolean; rpm: number | null }
export interface Service { name: string; desc: string; state: string; active: string; unit: string }
export interface Storage { storage: string; type: string; content: string[]; active: boolean; enabled: boolean; shared: boolean; used: number; total: number }
export interface PveTask { upid: string; type: string; id: string; user: string; start: number; end: number | null; status: 'running' | 'ok' | 'warning' | 'error'; message: string }
export interface GuestStatusDetail extends Guest {
  cpus: number; diskUsed: number; diskMax: number; swapUsed: number; swapMax: number; netIn: number; netOut: number;
  diskRead: number; diskWrite: number; pid: number | null; lock: string | null; haManaged: boolean; agent: boolean | null;
  qmpStatus: string | null; runningMachine: string | null; runningQemu: string | null;
}
export interface ConfigRow { key: string; value: string | null; pending: string | null; delete: boolean }
export interface Snapshot { name: string; parent: string | null; description: string; time: number | null; vmstate: boolean; current: boolean }
export interface NotifySettings { enabled: boolean; recoveries: boolean; mutedUntil: string | null; categories: Record<string, boolean> }
export interface NotifyInfo {
  configured: boolean; server: string; topic: string; subscribeUrl: string;
  thresholds: { cpu: number; mem: number; disk: number };
  settings: NotifySettings; categories: string[];
  sent: { ts: string; title: string; message: string; priority: number; category: string; ok: boolean; error?: string }[];
}
