// Standalone mock of the /api contract. Patches fetch + EventSource so dist/ works with no backend.
// Disabled with VITE_MOCK=false (npm run build:prod).
import type { BackupList, Guest, GuestAction, GuestConfigPatch, Heartbeat, KumaMonitor, KumaStatus, NginxSite, RrdPoint, Snapshot, TaskRow } from './types';

const GB = 1024 ** 3;
const now = () => Date.now();
const iso = (msAgo: number) => new Date(now() - msAgo).toISOString();

// ---------- state ----------
const g = (vmid: number, name: string, type: 'lxc' | 'qemu', status: Guest['status'], memGB: number, up: number, extra: Partial<Guest> = {}): Guest => ({
  vmid, name, type, status, cpu: 0, memUsed: status === 'running' ? memGB * GB * 0.4 : 0, memMax: memGB * GB,
  uptime: status === 'running' ? up : 0, protected: false, tags: [], conflicts: [], ...extra,
});

const guests: Guest[] = [
  g(100, 'gaming-win11', 'qemu', 'stopped', 16, 0, { tags: ['gaming', 'windows', 'gpu'], conflicts: [101, 106] }),
  g(101, 'jellyfin', 'lxc', 'running', 4, 86400 * 12 + 3600 * 4, { tags: ['media', 'gpu'], conflicts: [100] }),
  g(102, 'pihole', 'lxc', 'running', 0.5, 86400 * 41, { tags: ['dns'] }),
  g(103, 'nextcloud', 'lxc', 'running', 4, 86400 * 8, { tags: ['files'] }),
  g(104, 'grafana', 'lxc', 'running', 2, 86400 * 19, { tags: ['monitoring'] }),
  g(105, 'uptime-kuma', 'lxc', 'running', 1, 86400 * 19, { tags: ['monitoring'] }),
  g(106, 'frigate', 'lxc', 'stopped', 6, 0, { tags: ['cctv', 'gpu'], conflicts: [100] }),
  g(107, 'nginx-proxy', 'lxc', 'running', 1, 86400 * 41, { tags: ['proxy'] }),
  g(108, 'homeassistant', 'qemu', 'running', 4, 86400 * 5 + 7200, { tags: ['home'] }),
  g(109, 'docker-host', 'lxc', 'stopped', 8, 0, { tags: ['docker'] }),
  g(120, 'homelab-dashboard', 'lxc', 'running', 1, 86400 * 2, { protected: true, tags: ['dashboard'] }),
];

const hb = (statuses: KumaStatus[], base: number): Heartbeat[] =>
  statuses.map((s, i) => ({
    time: iso((statuses.length - i) * 60_000), status: s,
    ping: s === 'down' ? null : Math.max(2, Math.round(base + Math.sin(i * 1.7) * base * 0.3 + (i % 5) * 2)),
  }));
const up30 = Array<KumaStatus>(30).fill('up');
const withDown = (n: number) => [...up30.slice(0, 30 - n - 3), ...Array<KumaStatus>(n).fill('down'), ...Array<KumaStatus>(3).fill('down')].slice(0, 30);

const mon = (id: number, name: string, url: string, type: string, status: KumaStatus, u24: number, u30: number, ping: number | null, beats: KumaStatus[]): KumaMonitor => ({
  id, name, url, type, status, uptime24h: u24, uptime30d: u30, avgPing: ping, lastCheck: iso(20_000 + id * 7000), heartbeats: hb(beats, ping ?? 20),
});
const monitors: KumaMonitor[] = [
  mon(1, 'Grafana', 'https://grafana.home.lan', 'http', 'up', 100, 99.98, 42, up30),
  mon(2, 'Nextcloud', 'https://cloud.home.lan', 'http', 'up', 99.9, 99.71, 118, up30),
  mon(3, 'Jellyfin', 'https://jellyfin.home.lan', 'http', 'up', 100, 99.95, 64, up30),
  mon(4, 'Legacy Wiki', 'http://wiki.home.lan', 'http', 'down', 71.2, 92.4, null, withDown(9)),
  mon(5, 'Pi-hole DNS', 'pihole.home.lan', 'dns', 'up', 100, 100, 6, up30),
  mon(6, 'Home Assistant', 'https://ha.home.lan', 'http', 'up', 100, 99.89, 87, up30),
  mon(7, 'Proxmox UI', 'https://pve.home.lan:8006', 'http', 'up', 100, 99.99, 31, up30),
  mon(8, 'Blog', 'https://blog.home.lan', 'http', 'maintenance', 100, 99.5, 55, [...up30.slice(0, 24), ...Array<KumaStatus>(6).fill('maintenance')]),
  mon(9, 'Homelab Dashboard', 'https://dash.home.lan', 'http', 'up', 100, 100, 23, up30),
  mon(10, 'Frigate', 'https://frigate.home.lan', 'http', 'pending', 98.1, 97.3, 140, [...up30.slice(0, 27), 'pending', 'pending', 'pending']),
];

const site = (file: string, names: string[], ssl: boolean, upstream: string | null, root: string | null = null): NginxSite => ({
  file, serverNames: names, listen: ssl ? ['443 ssl http2', '[::]:443 ssl http2'] : ['80'], ssl, upstream, root,
  url: `${ssl ? 'https' : 'http'}://${names[0]}`,
});
const sites: NginxSite[] = [
  site('grafana.conf', ['grafana.home.lan'], true, 'http://192.168.1.14:3000'),
  site('nextcloud.conf', ['cloud.home.lan'], true, 'http://192.168.1.13:80'),
  site('jellyfin.conf', ['jellyfin.home.lan'], true, 'http://192.168.1.11:8096'),
  site('homeassistant.conf', ['ha.home.lan'], true, 'http://192.168.1.18:8123'),
  site('dashboard.conf', ['dash.home.lan'], true, 'http://192.168.1.20:3000'),
  site('frigate.conf', ['frigate.home.lan'], true, 'http://192.168.1.16:5000'),
  site('wiki-legacy.conf', ['wiki.home.lan', 'wiki'], false, 'http://192.168.1.30:8080'),
  site('blog.conf', ['blog.home.lan', 'www.blog.home.lan'], true, null, '/var/www/blog'),
];

const dashboards = [
  { uid: 'rYdddlPWk', title: 'Node Exporter Full', folder: 'Infrastructure', tags: ['linux', 'prometheus'] },
  { uid: 'pve-cluster', title: 'Proxmox VE', folder: 'Infrastructure', tags: ['proxmox', 'hypervisor'] },
  { uid: 'nginx-overview', title: 'Nginx Overview', folder: 'Web', tags: ['nginx', 'http'] },
  { uid: 'pihole', title: 'Pi-hole Exporter', folder: 'Network', tags: ['dns', 'pihole'] },
  { uid: 'ups-nut', title: 'UPS (NUT)', folder: 'Power', tags: ['power'] },
  { uid: 'kuma-metrics', title: 'Uptime Kuma', folder: 'Web', tags: ['kuma', 'availability'] },
].map((d) => ({ ...d, url: `https://grafana.home.lan/d/${d.uid}`, embedUrl: `mock/embed.html?title=${encodeURIComponent(d.title)}&full=1` }));

const panelTitles = ['CPU Busy', 'Memory Used', 'Network Traffic', 'Disk I/O', 'Root FS Used', 'Load Average'];

// ---------- tasks + events ----------
const tasks: Record<string, { doneAt: number; fail?: string; ok: string }> = {};
const listeners = new Set<(d: string) => void>();
const emit = (vmid: number, status: string) => listeners.forEach((l) => l(JSON.stringify({ type: 'guest', vmid, status })));

class MockEventSource {
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  private fn = (d: string) => this.onmessage?.({ data: d });
  constructor(_url: string) { listeners.add(this.fn); }
  close() { listeners.delete(this.fn); }
}

function runAction(gu: Guest, action: GuestAction) {
  const taskId = `UPID:pve:${Math.random().toString(16).slice(2, 10)}:qm${action}:${gu.vmid}:root@pam:`;
  const fail = action === 'start' && gu.vmid === 109 ? "TASK ERROR: storage 'local-zfs' is not available on node 'pve'" : undefined;
  const dur = action === 'reboot' ? 4500 : action === 'stop' ? 1500 : 3000;
  tasks[taskId] = { doneAt: now() + dur, fail, ok: 'TASK OK' };
  if (!fail) {
    setTimeout(() => {
      if (action === 'start') { gu.status = 'running'; gu.uptime = 1; }
      else if (action === 'shutdown' || action === 'stop') { gu.status = 'stopped'; gu.uptime = 0; gu.cpu = 0; gu.memUsed = 0; }
      else { gu.uptime = 1; }
      emit(gu.vmid, gu.status);
    }, dur - 200);
  }
  return taskId;
}

// ---------- per-guest detail: config, rrd, snapshots, backups, task history ----------
const MB = 1024 ** 2;
const confs: Record<number, Record<string, string | number>> = {};
const confOf = (gu: Guest) => (confs[gu.vmid] ??= gu.type === 'lxc'
  ? {
    hostname: gu.name, cores: 2, memory: Math.round(gu.memMax / MB), swap: 512, onboot: 1, tags: gu.tags.join(';'), description: '',
    ostype: 'debian', arch: 'amd64', unprivileged: 1, rootfs: `local-zfs:subvol-${gu.vmid}-disk-0,size=16G`,
    net0: `name=eth0,bridge=vmbr0,hwaddr=BC:24:11:00:${gu.vmid.toString(16).padStart(2, '0')}:A1,ip=dhcp,type=veth`, features: 'nesting=1',
  }
  : {
    name: gu.name, cores: 4, sockets: 1, memory: Math.round(gu.memMax / MB), balloon: 0, onboot: 1, tags: gu.tags.join(';'), description: '',
    ostype: 'l26', machine: 'q35', bios: 'ovmf', scsi0: `local-zfs:vm-${gu.vmid}-disk-0,size=64G`, net0: 'virtio=BC:24:11:AA:BB:CC,bridge=vmbr0',
    ...(gu.vmid === 108 ? { serial0: 'socket' } : {}),
  });

const snaps: Record<number, Snapshot[]> = {
  101: [{ name: 'before-upgrade', description: 'Jellyfin 10.9 upgrade', time: Math.floor(now() / 1000) - 86400 * 6, vmstate: false, parent: null }],
};
const backupItems: BackupList['items'] = [103, 101, 104].map((vmid, i) => ({
  volid: `backups:backup/vzdump-lxc-${vmid}-2026_10_2${i}-03_00_01.tar.zst`, storage: 'backups', size: (1.2 + i) * GB,
  time: Math.floor(now() / 1000) - 86400 * (i + 1), format: 'tar.zst', notes: 'nightly',
}));
const history: Record<number, TaskRow[]> = {};
const logs: Record<string, string[]> = {};

function newTask(vmid: number, type: string, durMs = 2500, failMsg?: string) {
  const upid = `UPID:pve:${Math.random().toString(16).slice(2, 10)}:${type}:${vmid}:dashboard@pve!ui:`;
  tasks[upid] = { doneAt: now() + durMs, fail: failMsg ? `TASK ERROR: ${failMsg}` : undefined, ok: 'TASK OK' };
  const row: TaskRow = { upid, type, user: 'dashboard@pve!ui', start: Math.floor(now() / 1000), end: null, status: 'running', message: '' };
  (history[vmid] ??= []).unshift(row);
  logs[upid] = [`starting task ${upid}`, `${type} guest ${vmid}`];
  setTimeout(() => {
    row.end = Math.floor(now() / 1000) + 1;
    row.status = failMsg ? 'error' : 'ok';
    row.message = failMsg ?? 'OK';
    logs[upid].push(failMsg ? `TASK ERROR: ${failMsg}` : 'TASK OK');
  }, durMs);
  return upid;
}

function rrd(gu: Guest, tf: string): RrdPoint[] {
  const span = ({ hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 } as Record<string, number>)[tf] ?? 3600;
  const n = 70, end = Math.floor(now() / 1000);
  let seed = gu.vmid * 31 + span;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) => {
    const t = end - span + Math.round((i / (n - 1)) * span);
    const w = Math.sin(t / (span / 6));
    const on = gu.status === 'running';
    return {
      time: t, cpu: on ? Math.max(0.01, 0.12 + w * 0.06 + rnd() * 0.04) : null,
      mem: on ? gu.memMax * (0.4 + w * 0.04 + rnd() * 0.02) : null, maxmem: gu.memMax,
      netin: on ? 40_000 + (w + 1) * 30_000 + rnd() * 20_000 : null, netout: on ? 25_000 + (w + 1) * 20_000 + rnd() * 10_000 : null,
      diskread: on ? rnd() * 120_000 : null, diskwrite: on ? 80_000 + rnd() * 200_000 : null,
    };
  });
}

// ---------- fake shell (WebSocket) ----------
const enc = new TextEncoder();
class MockShell {
  readyState = 0;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private line = '';
  private name = '';
  constructor(url: string) {
    const vmid = Number(url.match(/guests\/(\d+)\/shell/)?.[1]);
    const gu = guests.find((x) => x.vmid === vmid);
    this.name = gu?.name ?? 'guest';
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
      const err = !authed() ? 'Login required'
        : !gu ? 'Guest does not exist or is not allowed'
        : gu.protected ? `Guest ${gu.vmid} (${gu.name}) is protected`
        : gu.status !== 'running' ? `${gu.name} is not running`
        : gu.type === 'qemu' && confOf(gu).serial0 !== 'socket' ? 'This VM has no serial terminal (serial0: socket)' : '';
      if (err) { this.json({ t: 'error', message: err }); setTimeout(() => this.close(), 50); return; }
      this.json({ t: 'ready' });
      this.out(`\x1b[2mDemo shell: commands are simulated. Try: help\x1b[0m\r\n${this.prompt()}`);
    }, 450);
  }
  private json(o: object) { this.onmessage?.({ data: JSON.stringify(o) }); }
  private out(s: string) { this.onmessage?.({ data: enc.encode(s).buffer }); }
  private prompt() { return `\x1b[32mroot@${this.name}\x1b[0m:\x1b[34m~\x1b[0m# `; }
  send(raw: string) {
    let m: { t?: string; d?: string };
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t !== 'i' || !m.d) return;
    for (const ch of m.d) {
      if (ch === '\r') { this.out('\r\n'); this.run(this.line.trim()); this.line = ''; }
      else if (ch === '\x7f') { if (this.line) { this.line = this.line.slice(0, -1); this.out('\b \b'); } }
      else if (ch === '\x03') { this.line = ''; this.out(`^C\r\n${this.prompt()}`); }
      else if (ch === '\x04') { this.out('logout\r\n'); this.json({ t: 'exit' }); this.close(); }
      else if (ch >= ' ') { this.line += ch; this.out(ch); }
    }
  }
  private run(cmd: string) {
    const gu = guests.find((x) => x.name === this.name);
    const [c, ...a] = cmd.split(/\s+/);
    const L: Record<string, string> = {
      '': '', help: 'Available: help, ls, pwd, whoami, hostname, uname, uptime, free, df, date, echo, clear, exit',
      ls: 'bin  etc  home  opt  srv  var', pwd: '/root', whoami: 'root', hostname: this.name,
      uname: `Linux ${this.name} 6.8.12-4-pve #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux`,
      uptime: ` ${new Date().toLocaleTimeString()} up ${gu ? Math.floor(gu.uptime / 86400) : 0} days, load average: 0.08, 0.11, 0.09`,
      free: '               total        used        free\r\nMem:         4194304      1677721     2516583\r\nSwap:         524288           0      524288',
      df: 'Filesystem      Size  Used Avail Use% Mounted on\r\nrootfs           16G  3.1G   12G  21% /', date: new Date().toString(),
      echo: a.join(' '),
    };
    if (c === 'clear') { this.out(`\x1b[2J\x1b[H${this.prompt()}`); return; }
    if (c === 'exit') { this.out('logout\r\n'); this.json({ t: 'exit' }); this.close(); return; }
    this.out((c in L ? (L[c] ? `${L[c]}\r\n` : '') : `bash: ${c}: command not found\r\n`) + this.prompt());
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setTimeout(() => this.onclose?.(), 0);
  }
}

// ---------- metrics ----------
function series(query: string, start: number, end: number, step: number) {
  const n = Math.min(400, Math.floor((end - start) / step) + 1);
  const q = query.toLowerCase();
  let base = 35, amp = 20, max = 100;
  if (q.includes('mem')) { base = 58; amp = 6; }
  else if (q.includes('disk') || q.includes('filesystem')) { base = 41; amp = 1.5; }
  else if (q.includes('network') || q.includes('receive') || q.includes('bytes')) { base = 15e6; amp = 9e6; max = 1e9; }
  let seed = [...q].reduce((a, c) => a + c.charCodeAt(0), 7);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const values: [number, string][] = [];
  for (let i = 0; i < n; i++) {
    const t = start + i * step;
    const v = Math.max(0, Math.min(max, base + Math.sin(t / 900) * amp + Math.sin(t / 170) * amp * 0.3 + (rnd() - 0.5) * amp * 0.4));
    values.push([t, v.toFixed(2)]);
  }
  return { status: 'success', data: { resultType: 'matrix', result: [{ metric: { instance: 'pve:9100' }, values }] } };
}

// ---------- router ----------
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, error: string) => json({ error, code }, status);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jitter() {
  for (const x of guests) {
    if (x.status !== 'running') continue;
    x.cpu = Math.max(0.005, Math.min(0.95, (x.cpu || 0.08) + (Math.random() - 0.5) * 0.06));
    x.memUsed = Math.min(x.memMax * 0.95, Math.max(x.memMax * 0.15, x.memUsed + (Math.random() - 0.5) * 0.02 * x.memMax));
  }
}
const startedAt = now();
const tick = setInterval(() => guests.forEach((x) => { if (x.status === 'running') x.uptime += 1; }), 1000);
void tick;

function authed() {
  try { return sessionStorage.getItem('mock-auth') || null; } catch { return null; }
}

async function handle(method: string, path: string, body: any): Promise<Response> {
  if (path === '/auth/login') {
    if (body?.username && body?.password === 'demo') {
      try { sessionStorage.setItem('mock-auth', body.username); } catch { /* ignore */ }
      return json({ ok: true });
    }
    return fail(401, 'BAD_CREDENTIALS', 'Invalid username or password');
  }
  if (path === '/auth/logout') { try { sessionStorage.removeItem('mock-auth'); } catch { /* ignore */ } return json({ ok: true }); }
  const user = authed();
  if (!user) return fail(401, 'UNAUTHENTICATED', 'Login required');
  if (path === '/auth/me') return json({ username: user });

  if (path === '/overview') {
    const running = guests.filter((x) => x.status === 'running').length;
    const c = (s: KumaStatus) => monitors.filter((m) => m.status === s).length;
    return json({
      guests: { total: guests.length, running, stopped: guests.length - running },
      nginx: { sites: sites.length },
      kuma: { up: c('up'), down: c('down'), pending: c('pending') },
      host: { cpu: 0.18 + Math.random() * 0.1, memUsed: 21.4 * GB, memTotal: 32 * GB, diskUsed: 412 * GB, diskTotal: 931 * GB, uptime: 86400 * 41 + (now() - startedAt) / 1000 },
    });
  }
  if (path === '/guests') { jitter(); return json(guests); }
  let m: RegExpMatchArray | null = path.match(/^\/guests\/(\d+)\/(config|rrd|tasks|snapshots|backups)(?:\/([^/?]+)(?:\/(rollback))?)?(?:\?(.*))?$/);
  if (m) {
    const gu = guests.find((x) => x.vmid === +m![1]);
    if (!gu) return fail(404, 'NOT_FOUND', `Guest ${m[1]} does not exist or is not allowed`);
    const [, , what, sub, sub2, qs] = m;
    const write = method !== 'GET';
    if (write && gu.protected) return fail(403, 'PROTECTED', `Guest ${gu.vmid} (${gu.name}) is protected`);
    if (what === 'config') {
      const c = confOf(gu);
      if (!write) return json({ config: c, pending: [] });
      const p = (body ?? {}) as GuestConfigPatch;
      if (!Object.keys(p).length) return fail(400, 'BAD_REQUEST', 'Nothing to change');
      for (const [k, v] of Object.entries(p)) {
        if (k === 'memory' && (v as number) < 16) return fail(400, 'BAD_REQUEST', 'memory must be a whole number between 16 and 1048576');
        if (k === 'tags') c.tags = (v as string[]).join(';');
        else if (k === 'onboot') c.onboot = v ? 1 : 0;
        else c[k] = v as string | number;
        if (k === 'memory') gu.memMax = (v as number) * MB;
        if (k === 'hostname' || k === 'name') gu.name = String(v);
      }
      gu.tags = String(c.tags || '').split(';').filter(Boolean);
      return json({ ok: true });
    }
    if (what === 'rrd') return json(rrd(gu, new URLSearchParams(qs).get('timeframe') ?? 'hour'));
    if (what === 'tasks') return json(history[gu.vmid] ?? []);
    if (what === 'backups') {
      if (!write) return json({ storages: ['backups', 'local'], defaultStorage: 'backups', items: backupItems.filter((b) => b.volid.includes(`-${gu.vmid}-`)) } satisfies BackupList);
      const storage = String(body?.storage ?? 'backups');
      setTimeout(() => backupItems.unshift({
        volid: `${storage}:backup/vzdump-${gu.type}-${gu.vmid}-${new Date().toISOString().replace(/[-:T]/g, '_').slice(0, 19)}.tar.zst`,
        storage, size: 0.9 * GB, time: Math.floor(now() / 1000), format: 'tar.zst', notes: body?.notes ?? '',
      }), 4800);
      return json({ taskId: newTask(gu.vmid, 'vzdump', 5000) });
    }
    const list = (snaps[gu.vmid] ??= []);
    if (!write) return json(list);
    if (method === 'POST' && !sub) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{1,39}$/.test(body?.name ?? '')) return fail(400, 'BAD_REQUEST', 'name is invalid');
      if (list.some((x) => x.name === body.name)) return fail(502, 'PVE_ERROR', `Proxmox 500: snapshot '${body.name}' already exists`);
      const parent = list.length ? list[list.length - 1].name : null;
      setTimeout(() => list.push({ name: body.name, description: body.description ?? '', time: Math.floor(now() / 1000), vmstate: !!body.vmstate, parent }), 1800);
      return json({ taskId: newTask(gu.vmid, gu.type === 'lxc' ? 'vzsnapshot' : 'qmsnapshot', 2000) });
    }
    if (!list.some((x) => x.name === sub)) return fail(404, 'NOT_FOUND', `Snapshot ${sub} not found`);
    if (sub2 === 'rollback') return json({ taskId: newTask(gu.vmid, 'vzrollback', 3000) });
    setTimeout(() => { const i = list.findIndex((x) => x.name === sub); if (i >= 0) list.splice(i, 1); }, 1500);
    return json({ taskId: newTask(gu.vmid, 'vzdelsnapshot', 1800) });
  }
  m = path.match(/^\/tasks\/(.+)\/log$/);
  if (m) return json({ lines: logs[decodeURIComponent(m[1])] ?? [] });
  m = path.match(/^\/guests\/(\d+)(?:\/(start|shutdown|stop|reboot))?$/);
  if (m) {
    const gu = guests.find((x) => x.vmid === +m![1]);
    if (!gu) return fail(404, 'NOT_FOUND', `Guest ${m[1]} does not exist`);
    if (!m[2]) return json(gu);
    if (method !== 'POST') return fail(405, 'METHOD', 'Use POST');
    const action = m[2] as GuestAction;
    if (gu.protected && action !== 'start') return fail(403, 'PROTECTED', `Guest ${gu.vmid} (${gu.name}) is protected`);
    if (action === 'start' && gu.status === 'running') return fail(409, 'ALREADY_RUNNING', `${gu.name} is already running`);
    if ((action === 'shutdown' || action === 'stop' || action === 'reboot') && gu.status !== 'running') return fail(409, 'NOT_RUNNING', `${gu.name} is not running`);
    return json({ taskId: runAction(gu, action) });
  }
  m = path.match(/^\/tasks\/(.+)$/);
  if (m) {
    const t = tasks[decodeURIComponent(m[1])];
    if (!t) return fail(404, 'NOT_FOUND', 'Unknown task');
    if (now() < t.doneAt) return json({ status: 'running', message: '' });
    return json(t.fail ? { status: 'error', message: t.fail } : { status: 'ok', message: t.ok });
  }
  if (path === '/nginx/sites') return json(sites);
  if (path === '/grafana/dashboards') return json(dashboards);
  m = path.match(/^\/grafana\/panels\/(.+)$/);
  if (m) {
    if (!dashboards.some((d) => d.uid === decodeURIComponent(m![1]))) return fail(404, 'NOT_FOUND', 'Dashboard not found');
    return json(panelTitles.map((title, i) => ({ id: i + 1, title, embedUrl: `mock/embed.html?title=${encodeURIComponent(title)}&seed=${i}` })));
  }
  if (path === '/metrics/query') {
    if (!body?.query) return fail(400, 'BAD_REQUEST', 'query is required');
    return json(series(String(body.query), +body.start, +body.end, Math.max(1, +body.step || 60)));
  }
  if (path === '/kuma/monitors') return json(monitors.map((x) => ({ ...x, lastCheck: iso(Math.random() * 25_000) })));
  if (path === '/kuma/incidents') {
    return json(monitors.filter((x) => x.status === 'down' || x.status === 'pending' || x.status === 'maintenance').map((x) => ({
      monitorId: x.id, name: x.name, status: x.status,
      since: iso(x.status === 'down' ? 3 * 3600_000 + 12 * 60_000 : 25 * 60_000),
      message: x.status === 'down' ? 'Request timed out after 48000ms (ECONNREFUSED 192.168.1.30:8080)' : x.status === 'pending' ? 'Retrying: HTTP 502 Bad Gateway' : 'Scheduled maintenance window',
    })));
  }
  return fail(404, 'NOT_FOUND', `No route for ${method} /api${path}`);
}

export function installMock() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    if (!url.pathname.startsWith('/api/')) return real(input, init);
    await wait(120 + Math.random() * 220);
    let body: unknown;
    try { body = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { body = undefined; }
    return handle((init?.method || 'GET').toUpperCase(), url.pathname.slice(4) + url.search, body);
  };
  (window as any).EventSource = MockEventSource;
  const RealWS = window.WebSocket;
  (window as any).WebSocket = class extends RealWS {
    constructor(url: string | URL, protocols?: string | string[]) {
      if (/\/api\/guests\/\d+\/shell/.test(String(url))) return new MockShell(String(url)) as unknown as WebSocket;
      super(url, protocols);
    }
  };
}
