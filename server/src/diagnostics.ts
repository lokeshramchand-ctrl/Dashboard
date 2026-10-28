// Failure forensics: per-guest logs, GPU passthrough state + kernel logs, host sensors,
// and a host-wide failure summary. Read-only: journalctl (execFile) and sysfs.
import { readdir, readFile, readlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { cfg } from './config.js';
import { HttpError } from './errors.js';
import { journal } from './events.js';
import { listGuests } from './guests.js';
import { listTasks } from './node.js';
import { pve } from './proxmox.js';

export type Kind = 'start' | 'stop' | 'lifecycle' | 'start-failed' | 'crash' | 'oom' | 'gpu' | 'agent' | 'hardware' | 'error' | 'info';
export interface LogLine { ts: string; priority: number; unit: string; message: string; kind: Kind; level: 'info' | 'warn' | 'error' }

// Order matters: the first matching rule wins.
const RULES: [RegExp, Kind, LogLine['level']][] = [
  [/No VNC display is present/i, 'info', 'info'], // x-vga passthrough VMs have no VNC; Proxmox logs this on every console open
  [/out of memory|oom-kill|oom_reaper|killed process|memory cgroup out of memory/i, 'oom', 'error'],
  [/start failed|failed to start|TASK ERROR|unable to start|cannot start|start of .* failed/i, 'start-failed', 'error'],
  [/segfault|core dump|terminated by signal|killed by signal|crash|panic|general protection|Failed with result|exited with (?!code=0)|main process exited, code=(killed|dumped)/i, 'crash', 'error'],
  [/AER|PCIe Bus Error|Machine check|mce:|hardware error|I\/O error|nvme.*(timeout|reset)|EXT4-fs error|Buffer I\/O/i, 'hardware', 'error'],
  [/vfio|hostpci|nvidia|nouveau|amdgpu|radeon|AMD-Vi|DMAR|IOMMU|\bBAR\b|ROM|x-vga|GPU/i, 'gpu', 'info'],
  [/qga|guest agent|guest-ping/i, 'agent', 'warn'],
  [/started with PID|Started \d+\.scope|start VM|Starting CT|startup for container|Started PVE LXC Container/i, 'start', 'info'],
  [/Restarting VM|requesting (reboot|shutdown)|shutdown|stopping|stopped|Deactivated successfully|exited|Stopping/i, 'stop', 'info'],
];
const GPU_BAD = /fail|error|timeout|hang|fault|can't|cannot|unable|not ready|stuck|ring .* timeout|Xid|invalid|refused|denied/i;

export function classify(l: { ts: string; priority: number; unit: string; message: string }): LogLine {
  for (const [re, kind, level] of RULES) {
    if (!re.test(l.message)) continue;
    let lv = level;
    // Routine passthrough chatter (resets, BAR/ROM setup) is logged at kernel warning level; only real faults count.
    if (kind === 'gpu') lv = GPU_BAD.test(l.message) ? 'error' : l.priority <= 2 ? 'warn' : 'info';
    if (kind === 'stop' && l.priority <= 3) lv = 'error';
    if (kind === 'agent' && !/fail|timeout|not running/i.test(l.message)) lv = 'info';
    return { ...l, kind, level: lv };
  }
  return { ...l, kind: l.priority <= 3 ? 'error' : 'info', level: l.priority <= 3 ? 'error' : l.priority <= 4 ? 'warn' : 'info' };
}

const SINCE = /^(\d{1,3})([hd])$/;
export function parseSince(v: unknown, def = '7d'): string {
  const m = SINCE.exec(String(v ?? def));
  if (!m) throw new HttpError(400, 'BAD_REQUEST', 'since must look like 24h or 7d');
  const n = Math.min(Number(m[1]), m[2] === 'd' ? 90 : 720);
  return `-${n}${m[2]}`;
}

const node = () => `/nodes/${encodeURIComponent(cfg.pveNode)}`;
const PCI = /^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}(\.[0-7])?$/i;
/** hostpci values name a slot ("0000:01:00") or a function ("0000:01:00.0"); a short "01:00" means domain 0000. */
function hostpciAddrs(config: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(config)) {
    if (!/^hostpci\d+$/.test(k)) continue;
    for (const a of String(v).split(',')[0].replace(/^host=/, '').split(';')) {
      const full = /^[0-9a-f]{2}:[0-9a-f]{2}/i.test(a) ? `0000:${a}` : a;
      if (PCI.test(full)) out.push(full.toLowerCase());
    }
  }
  return out;
}
const sameDevice = (dev: string, assigned: string) => dev === assigned || dev.startsWith(`${assigned}.`) || assigned.startsWith(`${dev}.`);

// ---------- per-guest logs ----------
async function guestLogs(vmid: number, since: string) {
  const g = (await listGuests()).find((x) => x.vmid === vmid);
  if (!g) throw new HttpError(404, 'NOT_FOUND', `Guest ${vmid} does not exist or is not allowed`);
  const config = g.type === 'qemu' ? await pve<Record<string, unknown>>('GET', `${node()}/qemu/${vmid}/config`).catch(() => ({})) : {};
  const pci = hostpciAddrs(config).map((a) => a.replace(/\./g, '\\.'));
  // vmid is a validated integer and PCI addresses are regex-checked, so this pattern is safe to hand to journalctl.
  const id = String(vmid);
  const pattern = [
    `\\b(VM|CT|vm|ct) ${id}\\b`, `\\b${id}\\.scope`, `qemu-server@${id}\\b`, `pve-container@${id}\\b`, `/lxc/${id}\\b`,
    `:(qmstart|qmstop|qmshutdown|qmreboot|qmreset|vzstart|vzstop|vzshutdown|vzreboot|vzdump):${id}:`, `\\bvmid[= ]${id}\\b`,
    ...pci.map((a) => `${a}`),
  ].join('|');
  const raw = await journal(['--since', since, '-g', pattern, '-n', '1500', '-r']);
  const lines = raw.map(classify);

  // Starts/stops in time order, to explain how the guest got to its current state.
  const timeline = lines.filter((l) => ['start', 'stop', 'start-failed', 'crash', 'oom'].includes(l.kind)).slice(0, 60);
  const failures = lines.filter((l) => l.level === 'error');
  const lastFailure = failures[0] ?? null;
  const reason = !lastFailure ? null
    : lastFailure.kind === 'oom' ? 'Killed by the out-of-memory killer: the host or the guest ran out of RAM.'
      : lastFailure.kind === 'start-failed' ? 'Proxmox could not start the guest. The task log has the exact error.'
        : lastFailure.kind === 'crash' ? 'The guest process exited abnormally (crash or signal).'
          : lastFailure.kind === 'gpu' ? 'A passthrough device (GPU/PCI) reported an error.'
            : lastFailure.kind === 'hardware' ? 'A host hardware error was logged around this guest.'
              : 'An error was logged for this guest.';
  const failedTasks = (await listTasks({ vmid, limit: 100, errors: true }).catch(() => [])).filter((t) => t.status === 'error').slice(0, 20);
  const counts = Object.fromEntries((['error', 'warn', 'info'] as const).map((lv) => [lv, lines.filter((l) => l.level === lv).length]));
  return {
    vmid, since, type: g.type, passthrough: hostpciAddrs(config), counts, lastFailure, reason, failedTasks, timeline,
    recurring: recurring(lines.filter((l) => l.level !== 'info')).slice(0, 15), lines: lines.slice(0, 600),
  };
}

// ---------- GPU ----------
const rd = (p: string) => readFile(p, 'utf8').then((s) => s.trim()).catch(() => null);
const rdNum = async (p: string) => { const s = await rd(p); return s === null || s === '' || Number.isNaN(Number(s)) ? null : Number(s); };

async function gpuTelemetry(addr: string) {
  const dev = `/sys/bus/pci/devices/${addr}`;
  let hw: string | null = null;
  try { hw = (await readdir(join(dev, 'hwmon')))[0] ?? null; } catch { /* no hwmon (e.g. bound to vfio-pci) */ }
  const h = hw ? join(dev, 'hwmon', hw) : null;
  const [busy, vramUsed, vramTotal, temp, power, sclk] = await Promise.all([
    rdNum(join(dev, 'gpu_busy_percent')), rdNum(join(dev, 'mem_info_vram_used')), rdNum(join(dev, 'mem_info_vram_total')),
    h ? rdNum(join(h, 'temp1_input')) : null, h ? rdNum(join(h, 'power1_average')).then((v) => v ?? (h ? rdNum(join(h, 'power1_input')) : null)) : null,
    h ? rdNum(join(h, 'freq1_input')) : null,
  ]);
  return {
    busyPercent: busy, vramUsed, vramTotal, tempC: temp == null ? null : temp / 1000,
    powerW: power == null ? null : power / 1e6, clockMHz: sclk == null ? null : Math.round(sclk / 1e6),
  };
}

async function listGpus() {
  const [pci, guests] = await Promise.all([
    pve<any[]>('GET', `${node()}/hardware/pci`).catch(() => [] as any[]),
    listGuests(),
  ]);
  const vms = guests.filter((g) => g.type === 'qemu');
  const configs = await Promise.all(vms.map(async (g) => ({ g, addrs: hostpciAddrs(await pve<Record<string, unknown>>('GET', `${node()}/qemu/${g.vmid}/config`).catch(() => ({}))) })));
  const cmdline = (await rd('/proc/cmdline')) ?? '';
  const display = pci.filter((p) => String(p.class ?? '').startsWith('0x03'));
  const gpus = await Promise.all(display.map(async (p) => {
    const addr = String(p.id).toLowerCase();
    const dev = `/sys/bus/pci/devices/${addr}`;
    const slot = addr.replace(/\.\d$/, '');
    const driver = await readlink(join(dev, 'driver')).then((l) => basename(l)).catch(() => null);
    const group = await readlink(join(dev, 'iommu_group')).then((l) => basename(l)).catch(() => null);
    const groupDevs = group ? await readdir(`/sys/kernel/iommu_groups/${group}/devices`).catch(() => [] as string[]) : [];
    const fns = pci.filter((x) => String(x.id).toLowerCase().startsWith(slot + '.')).map((x) => ({
      addr: String(x.id), name: String(x.device_name ?? x.device ?? ''), class: String(x.class ?? ''),
    }));
    const assigned = configs.filter((c) => c.addrs.some((a) => sameDevice(addr, a))).map((c) => ({ vmid: c.g.vmid, name: c.g.name, status: c.g.status }));
    const [speed, width, maxSpeed, maxWidth] = await Promise.all(['current_link_speed', 'current_link_width', 'max_link_speed', 'max_link_width'].map((f) => rd(join(dev, f))));
    const host = !!driver && driver !== 'vfio-pci';
    return {
      addr, vendor: String(p.vendor_name ?? p.vendor ?? ''), name: String(p.device_name ?? p.device ?? ''),
      vendorId: String(p.vendor ?? ''), deviceId: String(p.device ?? ''),
      driver, mode: !driver ? 'unbound' : driver === 'vfio-pci' ? 'passthrough' : 'host',
      iommuGroup: group, groupDevices: groupDevs, functions: fns,
      assignedTo: assigned, inUseBy: assigned.find((a) => a.status === 'running') ?? null,
      link: { speed, width, maxSpeed, maxWidth },
      telemetry: host ? await gpuTelemetry(addr) : null,
    };
  }));
  return {
    iommu: { enabled: (await readdir('/sys/kernel/iommu_groups').catch(() => [] as string[])).length > 0, cmdline: cmdline.split(/\s+/).filter((a) => /iommu|vfio|video=|pcie_acs|nomodeset|blacklist|amd_pstate|intel_pstate/.test(a)) },
    gpus,
  };
}

const GPU_PATTERN = 'vfio|nvidia|nouveau|NVRM|amdgpu|radeon|AMD-Vi|DMAR|IOMMU|iommu|AER|PCIe Bus Error|\\bBAR\\b|x-vga|drm|GPU|gpu';

// ---------- sensors ----------
async function sensors() {
  const out: { chip: string; label: string; kind: 'temp' | 'fan' | 'power' | 'voltage'; value: number; unit: string; max: number | null; crit: number | null }[] = [];
  const dirs = await readdir('/sys/class/hwmon').catch(() => [] as string[]);
  for (const d of dirs) {
    const base = `/sys/class/hwmon/${d}`;
    const chip = (await rd(join(base, 'name'))) ?? d;
    const files = await readdir(base).catch(() => [] as string[]);
    for (const f of files) {
      const m = /^(temp|fan|power|in)(\d+)_(input|average)$/.exec(f);
      if (!m) continue;
      const v = await rdNum(join(base, f));
      if (v == null) continue;
      const pre = `${m[1]}${m[2]}`;
      const label = (await rd(join(base, `${pre}_label`))) ?? (m[1] === 'temp' ? `Temp ${m[2]}` : pre);
      const kind = m[1] === 'temp' ? 'temp' : m[1] === 'fan' ? 'fan' : m[1] === 'power' ? 'power' : 'voltage';
      const scale = kind === 'temp' ? 1000 : kind === 'power' ? 1e6 : kind === 'voltage' ? 1000 : 1;
      const lim = async (suf: string) => { const x = await rdNum(join(base, `${pre}_${suf}`)); return x == null || x <= 0 || x >= 1e8 ? null : x / scale; };
      out.push({ chip, label, kind, value: v / scale, unit: kind === 'temp' ? '°C' : kind === 'fan' ? 'RPM' : kind === 'power' ? 'W' : 'V', max: await lim('max'), crit: await lim('crit') });
    }
  }
  return out.filter((s) => !(s.kind === 'temp' && (s.value <= -40 || s.value > 150)));
}

// ---------- host-wide failure center ----------
/** Collapses repeats (same unit, same text once numbers are masked) into one row with a count. */
export function recurring(lines: LogLine[]) {
  const m = new Map<string, { unit: string; kind: Kind; level: LogLine['level']; sample: string; count: number; first: string; last: string }>();
  for (const l of lines) {
    const key = `${l.unit}|${l.message.replace(/0x[0-9a-f]+|\d+/gi, '#').slice(0, 160)}`;
    const e = m.get(key);
    if (e) { e.count++; if (l.ts < e.first) e.first = l.ts; if (l.ts > e.last) e.last = l.ts; }
    else m.set(key, { unit: l.unit, kind: l.kind, level: l.level, sample: l.message, count: 1, first: l.ts, last: l.ts });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).slice(0, 40);
}

const FAILURE_PATTERN = [
  'out of memory', 'oom-kill', 'Killed process', 'segfault', 'core dump', 'start failed', 'TASK ERROR', 'Failed with result',
  'qmeventd', 'AER', 'PCIe Bus Error', 'Machine check', 'mce:', 'I/O error', 'nvme.*(timeout|reset)', 'EXT4-fs error',
  'vfio.*(fail|error|timeout)', 'amdgpu.*(timeout|hang|fault|error)', 'NVRM', 'watchdog', 'soft lockup', 'hung_task', 'blocked for more than',
].join('|');

async function failures(since: string) {
  const [lines, tasks, crit] = await Promise.all([
    journal(['--since', since, '-g', FAILURE_PATTERN, '-n', '2000', '-r']).catch(() => []),
    listTasks({ errors: true, limit: 200 }).catch(() => []),
    journal(['--since', since, '-p', '0..3', '-n', '400', '-r']).catch(() => []),
  ]);
  const seen = new Set<string>();
  const merged = [...lines, ...crit].filter((l) => { const k = `${l.ts}|${l.message}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.ts.localeCompare(a.ts)).map(classify);
  const sinceSec = Date.now() / 1000 + Number(since.slice(1, -1)) * (since.endsWith('d') ? -86400 : -3600);
  const failedTasks = tasks.filter((t) => t.status === 'error' && t.start >= sinceSec);
  const byKind: Record<string, number> = {};
  for (const l of merged) if (l.level !== 'info') byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;
  // Which guests appear in failure lines, so the UI can link straight to them.
  const guestHits: Record<number, number> = {};
  for (const l of merged) {
    if (l.level === 'info') continue;
    const m = /\b(?:VM|CT) (\d+)\b|\b(\d+)\.scope|\/lxc\/(\d+)\b/.exec(l.message);
    const v = m ? Number(m[1] ?? m[2] ?? m[3]) : 0;
    if (v) guestHits[v] = (guestHits[v] ?? 0) + 1;
  }
  return {
    since, failedTasks, byKind, guestHits, recurring: recurring(merged.filter((l) => l.level !== 'info')),
    lines: merged.filter((l) => l.level !== 'info').slice(0, 500),
  };
}

export function registerDiagnostics(app: FastifyInstance) {
  app.get<{ Params: { vmid: string }; Querystring: { since?: string } }>('/api/guests/:vmid/logs', async (req) => {
    const vmid = Number(req.params.vmid);
    if (!Number.isInteger(vmid) || vmid <= 0) throw new HttpError(400, 'BAD_REQUEST', 'Invalid vmid');
    return guestLogs(vmid, parseSince(req.query.since));
  });
  app.get('/api/gpu', () => listGpus());
  app.get<{ Querystring: { since?: string } }>('/api/gpu/logs', async (req) => {
    const lines = await journal(['-k', '--since', parseSince(req.query.since), '-g', GPU_PATTERN, '-n', '800', '-r']);
    return lines.map(classify).map((l) => (l.kind === 'info' || l.kind === 'stop' || l.kind === 'start' ? { ...l, kind: 'gpu' as Kind } : l));
  });
  app.get('/api/node/sensors', () => sensors());
  app.get<{ Querystring: { since?: string } }>('/api/diagnostics', (req) => failures(parseSince(req.query.since, '7d')));
}

// Used by the notifier: new kernel lines since the last poll that look like GPU / hardware trouble.
export async function recentHardwareErrors(sinceIso: string) {
  const lines = await journal(['-k', '--since', sinceIso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace('Z', ' UTC'), '-g', `${GPU_PATTERN}|${FAILURE_PATTERN}`, '-n', '200']).catch(() => []);
  return lines.map(classify).filter((l) => l.level === 'error');
}
