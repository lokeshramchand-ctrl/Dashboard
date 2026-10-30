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

export type LogKind = 'start' | 'stop' | 'lifecycle' | 'start-failed' | 'crash' | 'oom' | 'gpu' | 'agent' | 'hardware' | 'error' | 'info';
export interface LogLine { ts: string; priority: number; unit: string; message: string; kind: LogKind; level: 'info' | 'warn' | 'error' }
export interface Recurring { unit: string; kind: LogKind; level: 'info' | 'warn' | 'error'; sample: string; count: number; first: string; last: string }
export interface GuestLogs {
  vmid: number; since: string; type: 'lxc' | 'qemu'; passthrough: string[]; counts: Record<'error' | 'warn' | 'info', number>;
  lastFailure: LogLine | null; reason: string | null; failedTasks: PveTask[]; timeline: LogLine[]; recurring: Recurring[]; lines: LogLine[];
}
export interface Gpu {
  addr: string; vendor: string; name: string; vendorId: string; deviceId: string; driver: string | null; mode: 'passthrough' | 'host' | 'unbound';
  iommuGroup: string | null; groupDevices: string[]; functions: { addr: string; name: string; class: string }[];
  assignedTo: { vmid: number; name: string; status: GuestStatus }[]; inUseBy: { vmid: number; name: string; status: GuestStatus } | null;
  link: { speed: string | null; width: string | null; maxSpeed: string | null; maxWidth: string | null };
  telemetry: { busyPercent: number | null; vramUsed: number | null; vramTotal: number | null; tempC: number | null; powerW: number | null; clockMHz: number | null } | null;
}
export interface GpuInfo { iommu: { enabled: boolean; cmdline: string[] }; gpus: Gpu[] }
export interface Sensor { chip: string; label: string; kind: 'temp' | 'fan' | 'power' | 'voltage'; value: number; unit: string; max: number | null; crit: number | null }
export interface Diagnostics { since: string; failedTasks: PveTask[]; byKind: Record<string, number>; guestHits: Record<string, number>; recurring: Recurring[]; lines: LogLine[] }
export interface AiInfo { configured: boolean; label: string; model: string; local: boolean }

export type Severity = 'critical' | 'warn' | 'info' | 'ok';
export interface Finding { id: string; severity: Severity; title: string; detail: string; advice?: string; count?: number }
export interface WinSession { start: string; end: string | null; durationSec: number | null; cpuSec: number | null; memPeak: string | null; endedBy: string }
export interface Stat { avg: number; p95: number; max: number; samples: number }
export interface WindowsReport {
  vmid: number; name: string; since: string; ostype: string; status: GuestStatus; verdict: Severity; uptime: number;
  agent: {
    state: 'ok' | 'unreachable' | 'no-permission' | 'vm-stopped'; error: string | null;
    os: { name: string; version: string; kernel: string; arch: string } | null; hostname: string | null; timezone: string | null; timeSkewSec: number | null;
    disks: { mount: string; name: string; type: string; used: number; total: number }[];
    nics: { name: string; mac: string; ips: string[] }[]; users: string[];
  };
  findings: Finding[]; health: Finding[]; sessions: WinSession[]; taskHistory: PveTask[];
  metrics: { samples: number; cpu: Stat | null; mem: Stat | null; netIn: Stat | null; netOut: Stat | null; diskRead: Stat | null; diskWrite: Stat | null; cpuSaturatedPct: number; idleSamples: number };
  metricsTimeframe: Timeframe; counts: { lines: number; problems: number }; recurring: Recurring[]; lines: LogLine[];
}

export interface LokiStatus { configured: boolean; ready: boolean; publicUrl: string; error: string | null; labels: string[] }
export interface LokiLine { ts: string; ns: string; line: string; labels: Record<string, string> }
export interface LokiHistogram { stepSeconds: number; points: { t: string; n: number }[] }

export interface QemuDisk { key: string; bus: string; storage: string; volume: string; size: string | null; cdrom: boolean; cache: string | null; iothread: boolean; discard: boolean; ssd: boolean; backup: boolean }
export interface QemuNic { key: string; model: string; mac: string | null; bridge: string | null; vlan: string | null; firewall: boolean; rate: string | null; queues: string | null; linkDown: boolean }
export interface QemuPci { key: string; device: string; pcie: boolean; xvga: boolean; romBar: boolean; mapping: boolean }
export interface QemuDevices {
  machine: string | null; bios: string; cpu: string; sockets: number; cores: number; memoryMb: number; balloonMb: number | null; ostype: string | null; scsihw: string | null;
  efi: boolean; tpm: boolean; agent: boolean; disks: QemuDisk[]; nics: QemuNic[]; pci: QemuPci[]; usb: { key: string; value: string }[]; other: { key: string; value: string }[];
  warnings: { severity: 'warn' | 'info'; title: string; advice: string }[];
}
export interface Backup { volid: string; storage: string; size: number; time: number; format: string; notes: string; protected: boolean }
export interface BackupList { storages: string[]; backups: Backup[] }
