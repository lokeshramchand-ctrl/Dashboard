// Windows (and any QEMU) VM debugging: one call that turns host-side evidence into findings.
// Read-only. Sources: the host journal, the Proxmox task log, the VM config, rrddata and the
// guest agent's GET endpoints. The agent is optional; most Windows problems are visible from the host.
import type { FastifyInstance } from 'fastify';
import { cfg } from './config.js';
import { HttpError } from './errors.js';
import { classify, parseSince, recurring } from './diagnostics.js';
import type { LogLine } from './diagnostics.js';
import { journal } from './events.js';
import { listGuests } from './guests.js';
import { listTasks } from './node.js';
import type { Timeframe } from './node.js';
import { pve } from './proxmox.js';

type Severity = 'critical' | 'warn' | 'info' | 'ok';
export interface Finding { id: string; severity: Severity; title: string; detail: string; advice?: string; count?: number }
interface Session { start: string; end: string | null; durationSec: number | null; cpuSec: number | null; memPeak: string | null; endedBy: string }
type Cfg = Record<string, unknown>;

const node = () => `/nodes/${encodeURIComponent(cfg.pveNode)}`;
const str = (v: unknown) => (v == null ? '' : String(v));
const SEV_ORDER: Record<Severity, number> = { critical: 0, warn: 1, info: 2, ok: 3 };

// ---------- journal patterns (the lines are already scoped to this VMID by the caller) ----------
const AGENT_TIMEOUT = /qga command .*guest-ping.* (got timeout|not running)|QEMU guest agent is not running/i;
const SHUTDOWN_TIMEOUT = /(qmshutdown|qmstop|qmreboot).*(timeout|failed)|VM quit\/powerdown failed/i;
const VFIO_RESET = /vfio-pci ([0-9a-f:.]+): resetting/i;
const VFIO_BAD = /vfio-pci [0-9a-f:.]+: .*(timed out|timeout|not ready|failed|can't|cannot|error)|VFIO_MAP_DMA failed|vfio_.*(error|fail)|FLR.*(fail|timeout)|not ready after/i;
const SCOPE_START = /^Started \d+\.scope\b/;
const SCOPE_END = /^\d+\.scope: Deactivated successfully/;
const SCOPE_STATS = /^\d+\.scope: Consumed (.+?) CPU time(?:, ([\d.]+[KMGT]) memory peak)?/;

/** "1h 3min 4.5s" (systemd timespan) -> seconds. */
export function cpuSeconds(s: string): number {
  let t = 0;
  for (const m of s.matchAll(/([\d.]+)\s*(d|h|min|s|ms|us)\b/g)) {
    const n = Number(m[1]);
    t += m[2] === 'd' ? n * 86400 : m[2] === 'h' ? n * 3600 : m[2] === 'min' ? n * 60 : m[2] === 's' ? n : m[2] === 'ms' ? n / 1000 : n / 1e6;
  }
  return Math.round(t);
}

interface TaskRow { type: string; start: number; status: string; message: string }

/** Pairs "Started N.scope" with the following "Deactivated", and names what ended each run from the task log. */
export function buildSessions(lines: { ts: string; message: string }[], tasks: TaskRow[], vmid: number): Session[] {
  const asc = [...lines].sort((a, b) => a.ts.localeCompare(b.ts));
  const out: Session[] = [];
  let cur: Session | null = null;
  const stop = new Set(['qmshutdown', 'qmstop', 'qmreboot', 'qmreset', 'qmsuspend']);
  for (const l of asc) {
    if (!l.message.includes(`${vmid}.scope`) && !SCOPE_START.test(l.message)) continue;
    if (SCOPE_START.test(l.message) && l.message.includes(`${vmid}.scope`)) {
      if (cur) out.push(cur); // started again without a recorded end (host rebooted or journal rotated)
      cur = { start: l.ts, end: null, durationSec: null, cpuSec: null, memPeak: null, endedBy: 'still running or host restarted' };
    } else if (SCOPE_END.test(l.message) && l.message.includes(`${vmid}.scope`) && cur) {
      cur.end = l.ts;
      cur.durationSec = Math.max(0, Math.round((Date.parse(l.ts) - Date.parse(cur.start)) / 1000));
      const endMs = Date.parse(l.ts);
      const t = tasks.filter((x) => stop.has(x.type) && Math.abs(x.start * 1000 - endMs) < 150_000)
        .sort((a, b) => Math.abs(a.start * 1000 - endMs) - Math.abs(b.start * 1000 - endMs))[0];
      cur.endedBy = t ? `${t.type}${t.status === 'ok' || t.status === 'running' ? '' : ' (' + t.message.slice(0, 40) + ')'}` : 'from inside the guest (or crash)';
    } else {
      const m = SCOPE_STATS.exec(l.message);
      if (m && cur?.end) { cur.cpuSec = cpuSeconds(m[1]); cur.memPeak = m[2] ?? null; }
    }
  }
  if (cur) out.push(cur);
  return out.reverse(); // newest first
}

// ---------- findings ----------
export function analyse(p: { vmid: number; since: string; lines: LogLine[]; tasks: TaskRow[]; sessions: Session[]; status: string }): Finding[] {
  const f: Finding[] = [];
  const { lines, tasks, sessions } = p;

  const agentLines = lines.filter((l) => AGENT_TIMEOUT.test(l.message));
  if (agentLines.length >= 3) {
    f.push({
      id: 'agent-timeouts', severity: 'warn', count: agentLines.length,
      title: `${agentLines.length} guest-agent pings timed out`,
      detail: 'Proxmox pings the QEMU guest agent and the VM never answers. This also floods the host journal and makes shutdown/reboot wait for a timeout.',
      advice: 'Inside Windows install "virtio-win-guest-tools" from the virtio-win ISO (this installs QEMU Guest Agent), then check the "QEMU Guest Agent" service is running. Or set agent: 0 if you do not want it.',
    });
  }

  const sdTimeouts = tasks.filter((t) => t.status === 'error' && SHUTDOWN_TIMEOUT.test(`${t.type} ${t.message}`));
  if (sdTimeouts.length) {
    f.push({
      id: 'shutdown-timeout', severity: 'warn', count: sdTimeouts.length,
      title: `${sdTimeouts.length} shutdown request${sdTimeouts.length > 1 ? 's' : ''} timed out`,
      detail: `Windows did not act on the ACPI/agent shutdown. Latest: ${new Date(sdTimeouts[0].start * 1000).toLocaleString('en-GB')} (${sdTimeouts[0].message.slice(0, 80)}).`,
      advice: 'Usually the guest agent is missing or Windows was busy/hung. Use Stop only as a last resort (it cuts power). Check Windows Fast Startup and pending updates.',
    });
  }

  // Reboot loop: 3+ starts inside any 30 minute window.
  const starts = tasks.filter((t) => t.type === 'qmstart' && t.status === 'ok').map((t) => t.start).sort((a, b) => a - b);
  let loop: { n: number; at: number } | null = null;
  for (let i = 0; i < starts.length; i++) {
    let j = i;
    while (j + 1 < starts.length && starts[j + 1] - starts[i] <= 1800) j++;
    if (j - i + 1 >= 3 && (!loop || j - i + 1 > loop.n)) loop = { n: j - i + 1, at: starts[i] };
  }
  if (loop) {
    f.push({
      id: 'reboot-loop', severity: 'critical', count: loop.n,
      title: `Restart loop: ${loop.n} starts within 30 minutes`,
      detail: `First at ${new Date(loop.at * 1000).toLocaleString('en-GB')}. Windows is rebooting repeatedly (update install, driver crash, or someone resetting it).`,
      advice: 'Check the session list for what ended each run. Boot into Safe Mode if it is crashing on a driver, and look at the Windows System log for BugCheck events once it is stable.',
    });
  }

  const vfioBad = lines.filter((l) => VFIO_BAD.test(l.message));
  if (vfioBad.length) {
    f.push({
      id: 'vfio-errors', severity: 'critical', count: vfioBad.length,
      title: `${vfioBad.length} passthrough (vfio) error${vfioBad.length > 1 ? 's' : ''}`,
      detail: vfioBad[0].message.slice(0, 160),
      advice: 'A GPU/PCI device failed to reset or map. Cold boot the host if the GPU is stuck; check the GPU & passthrough page for the IOMMU group.',
    });
  }

  const resets: Record<string, number> = {};
  for (const l of lines) { const m = VFIO_RESET.exec(l.message); if (m) resets[m[1]] = (resets[m[1]] ?? 0) + 1; }
  const totalResets = Object.values(resets).reduce((a, b) => a + b, 0);
  if (totalResets) {
    const perRun = sessions.length ? Math.round(totalResets / sessions.length) : totalResets;
    f.push({
      id: 'vfio-resets', severity: perRun > 150 ? 'warn' : 'info', count: totalResets,
      title: `${totalResets} device resets across ${Object.keys(resets).length} passthrough function${Object.keys(resets).length > 1 ? 's' : ''}`,
      detail: Object.entries(resets).map(([a, n]) => `${a}: ${n}`).join(' · ') + ` · about ${perRun} per run. Windows resets the GPU on every driver load, so this is normal in moderation.`,
      advice: perRun > 150 ? 'An unusually high reset count per run often means the Windows display driver is crashing and restarting (TDR). Check Event Viewer for "Display driver stopped responding".' : undefined,
    });
  }

  const oom = lines.filter((l) => l.kind === 'oom');
  if (oom.length) {
    f.push({ id: 'oom', severity: 'critical', count: oom.length, title: 'Host ran out of memory', detail: oom[0].message.slice(0, 160), advice: 'The kernel OOM killer fired. Lower the VM memory or disable ballooning conflicts, or add swap/RAM to the host.' });
  }

  const crashes = lines.filter((l) => l.kind === 'crash');
  if (crashes.length) {
    f.push({ id: 'qemu-crash', severity: 'critical', count: crashes.length, title: `${crashes.length} abnormal process exit${crashes.length > 1 ? 's' : ''}`, detail: crashes[0].message.slice(0, 160), advice: 'QEMU itself crashed or was killed. Compare the time against the session list to see which run it belongs to.' });
  }

  const failedStarts = tasks.filter((t) => t.type === 'qmstart' && t.status === 'error');
  if (failedStarts.length) {
    f.push({ id: 'start-failed', severity: 'critical', count: failedStarts.length, title: `${failedStarts.length} failed start${failedStarts.length > 1 ? 's' : ''}`, detail: failedStarts[0].message.slice(0, 160), advice: 'Open the task log for the exact QEMU error (often a busy PCI device, missing disk, or a conflicting VM that holds the GPU).' });
  }

  const unclean = sessions.filter((s) => s.end && s.endedBy.startsWith('from inside')).length;
  if (unclean >= 3) {
    f.push({ id: 'guest-initiated', severity: 'info', count: unclean, title: `${unclean} runs ended from inside the guest`, detail: 'No Proxmox shutdown/stop task matches these, so Windows shut itself down or restarted (updates, user action, or a crash with auto-restart).' });
  }

  if (!f.some((x) => x.severity === 'critical' || x.severity === 'warn')) {
    f.push({ id: 'clean', severity: 'ok', title: 'No Windows-side problems found', detail: `Nothing in the last ${p.since.slice(1)} points at crashes, restart loops, failed shutdowns or passthrough errors.` });
  }
  return f.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}

// ---------- configuration health ----------
export function configChecks(c: Cfg, running: { machine: string | null; status: string; agentUp: boolean | null }): Finding[] {
  const out: Finding[] = [];
  const ok = (id: string, title: string, detail = '') => out.push({ id, severity: 'ok', title, detail });
  const bad = (id: string, severity: Severity, title: string, detail: string, advice?: string) => out.push({ id, severity, title, detail, advice });
  const ostype = str(c.ostype);
  const win11 = ostype === 'win11';
  const machine = str(c.machine);

  str(c.bios) === 'ovmf' ? ok('bios', 'UEFI firmware (OVMF)') : bad('bios', win11 ? 'critical' : 'warn', 'Legacy BIOS firmware', 'SeaBIOS cannot boot Windows 11 and has no GPU passthrough support for UEFI GPUs.', 'Switch to OVMF and add an EFI disk (this requires a reinstall or conversion).');
  /q35/.test(machine) ? ok('machine', 'q35 machine type', machine) : bad('machine', 'warn', 'i440fx machine type', machine || 'default', 'PCIe passthrough (pcie=1) needs q35.');
  if (running.status === 'running' && running.machine && machine && running.machine !== machine && !machine.startsWith('q35') && !machine.startsWith('pc')) {
    // fall through: only pinned versions are comparable
  } else if (running.status === 'running' && running.machine && /^pc-(q35|i440fx)-/.test(machine) && running.machine !== machine) {
    bad('machine-pending', 'info', 'Machine version changes on next full restart', `Running ${running.machine}, config pins ${machine}.`, 'Do a full Stop + Start (not Reboot) to apply it.');
  }

  const cpu = str(c.cpu).split(',')[0];
  cpu === 'host' ? ok('cpu', 'CPU type host', 'Best performance; Proxmox enables Hyper-V enlightenments automatically for Windows.') : bad('cpu', 'info', `CPU type ${cpu || 'default (kvm64)'}`, 'Generic CPU types are slower and hide features Windows uses (and some anti-cheat checks).', 'Use host for a single-node setup.');

  if (win11) {
    c.tpmstate0 ? ok('tpm', 'TPM 2.0 present') : bad('tpm', 'warn', 'No virtual TPM', 'Windows 11 expects TPM 2.0. It runs only if the installer requirement bypass was used, and Windows Update or features may complain.', 'Add a TPM State disk (v2.0) in Hardware.');
  }

  const agentOn = /^(1|enabled=1)/.test(str(c.agent)) || str(c.agent).includes('enabled=1');
  if (!agentOn) bad('agent-cfg', 'warn', 'Guest agent disabled in config', '', 'Enable QEMU Guest Agent in Options for clean shutdowns and IP/disk reporting.');
  else if (running.status === 'running' && running.agentUp === false) bad('agent-run', 'warn', 'Guest agent enabled but not answering', 'Proxmox is configured to use it but nothing inside Windows responds.', 'Install virtio-win-guest-tools in the guest. Until then shutdowns wait for a timeout and the journal fills with ping errors.');
  else ok('agent', 'Guest agent enabled' + (running.agentUp ? ' and responding' : ''));

  const nets = Object.entries(c).filter(([k]) => /^net\d+$/.test(k));
  const slow = nets.filter(([, v]) => /^(e1000|rtl8139)/.test(str(v)));
  slow.length ? bad('nic', 'warn', 'Emulated network card', slow.map(([k, v]) => `${k}: ${str(v).split(',')[0]}`).join(', '), 'virtio is much faster; install the virtio-win network driver then switch the model.') : nets.length && ok('nic', 'virtio network', `${nets.length} interface${nets.length > 1 ? 's' : ''}`);

  const disks = Object.entries(c).filter(([k]) => /^(sata|ide|scsi|virtio|nvme)\d+$/.test(k) && !/media=cdrom/.test(str(c[k])));
  const sata = disks.filter(([k]) => k.startsWith('sata') || k.startsWith('ide'));
  if (sata.length) bad('disk-bus', 'info', 'Disk on an emulated SATA/IDE bus', sata.map(([k, v]) => `${k}: ${str(v).split(',')[0]}`).join(', '), 'virtio-scsi or NVMe gives noticeably better IOPS and lower CPU. Install the virtio storage driver first or Windows will not boot.');
  else if (disks.length) ok('disk-bus', 'Paravirtual disk bus');

  const iso = Object.entries(c).filter(([, v]) => /media=cdrom/.test(str(v)) && !/none/.test(str(v)));
  if (iso.length) bad('iso', 'info', 'ISO still attached', iso.map(([k, v]) => `${k}: ${str(v).split(',')[0]}`).join(', '), 'Fine for the virtio-win drivers; detach installer ISOs so a boot cannot hit them.');

  str(c.onboot) === '1' ? ok('onboot', 'Starts with the host', str(c.startup)) : bad('onboot', 'info', 'Does not start with the host', '', undefined);
  return out;
}

// ---------- metrics ----------
const pct = (a: number[], q: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))] : null);
const stats = (rows: Record<string, number | null>[], key: string) => {
  const v = rows.map((r) => r[key]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? { avg: v.reduce((a, b) => a + b, 0) / v.length, p95: pct(v, 0.95) as number, max: Math.max(...v), samples: v.length } : null;
};

export function summarise(rows: Record<string, number | null>[]) {
  const cpu = stats(rows, 'cpu');
  const saturated = rows.filter((r) => (r.cpu ?? 0) >= 0.95).length;
  return {
    samples: rows.length,
    cpu, mem: stats(rows, 'mem'), netIn: stats(rows, 'netin'), netOut: stats(rows, 'netout'),
    diskRead: stats(rows, 'diskread'), diskWrite: stats(rows, 'diskwrite'),
    cpuSaturatedPct: rows.length ? saturated / rows.length : 0,
    // Consecutive zero-CPU, zero-IO samples while the VM reports running look like a hang.
    idleSamples: rows.filter((r) => r.cpu !== null && r.cpu < 0.001 && (r.diskwrite ?? 0) < 1 && (r.netin ?? 0) < 1).length,
  };
}

// ---------- guest agent (all GET; every call may fail) ----------
async function agentProbe(vmid: number, status: string) {
  if (status !== 'running') return { state: 'vm-stopped' as const, error: null, os: null, hostname: null, timezone: null, timeSkewSec: null, disks: [], nics: [], users: [] };
  const base = `${node()}/qemu/${vmid}/agent`;
  const os = await pve<any>('GET', `${base}/get-osinfo`).then((r) => r?.result ?? r).catch((e: Error) => e);
  if (os instanceof Error) {
    return { state: 'unreachable' as const, error: os.message.replace(/^Proxmox \d+: /, '').slice(0, 200), os: null, hostname: null, timezone: null, timeSkewSec: null, disks: [], nics: [], users: [] };
  }
  const get = <T,>(p: string) => pve<any>('GET', `${base}/${p}`).then((r) => (r?.result ?? r) as T).catch(() => null);
  const [host, tz, time, fs, nics, users] = await Promise.all([
    get<any>('get-host-name'), get<any>('get-timezone'), get<number>('get-time'), get<any[]>('get-fsinfo'), get<any[]>('network-get-interfaces'), get<any[]>('get-users'),
  ]);
  return {
    state: 'ok' as const, error: null,
    os: { name: str(os['pretty-name'] ?? os.name), version: str(os.version), kernel: str(os['kernel-version']), arch: str(os.machine) },
    hostname: host?.['host-name'] ? str(host['host-name']) : null,
    timezone: tz?.zone ? str(tz.zone) : null,
    timeSkewSec: typeof time === 'number' ? Math.round((time / 1e9 - Date.now() / 1000) * 10) / 10 : null,
    disks: (fs ?? []).filter((d) => d['total-bytes'] != null).map((d) => ({
      mount: str(d.mountpoint), name: str(d.name), type: str(d.type), used: Number(d['used-bytes'] ?? 0), total: Number(d['total-bytes'] ?? 0),
    })),
    nics: (nics ?? []).filter((n) => n.name && !/loopback/i.test(n.name)).map((n) => ({
      name: str(n.name), mac: str(n['hardware-address']), ips: (n['ip-addresses'] ?? []).filter((a: any) => a['ip-address-type'] === 'ipv4').map((a: any) => str(a['ip-address'])),
    })),
    users: (users ?? []).map((u) => str(u.user)),
  };
}

const TF: Record<string, Timeframe> = { '-24h': 'day', '-7d': 'week', '-30d': 'month' };
function timeframeFor(since: string): Timeframe {
  const hours = since.endsWith('d') ? Number(since.slice(1, -1)) * 24 : Number(since.slice(1, -1));
  return TF[since] ?? (hours <= 24 ? 'day' : hours <= 168 ? 'week' : 'month');
}

export async function windowsReport(vmid: number, since: string) {
  const g = (await listGuests()).find((x) => x.vmid === vmid);
  if (!g) throw new HttpError(404, 'NOT_FOUND', `Guest ${vmid} does not exist or is not allowed`);
  if (g.type !== 'qemu') throw new HttpError(400, 'UNSUPPORTED', 'Windows diagnostics are only available for virtual machines');

  const [config, cur, tasks, raw, rrd] = await Promise.all([
    pve<Cfg>('GET', `${node()}/qemu/${vmid}/config`),
    pve<any>('GET', `${node()}/qemu/${vmid}/status/current`),
    listTasks({ vmid, limit: 500 }).catch(() => []),
    // Same scope as the per-guest log tab, plus the scope start/stop/CPU-time lines that give run history.
    journal(['--since', since, '-g', `\\b(VM|CT|vm|ct) ${vmid}\\b|\\b${vmid}\\.scope|qemu-server@${vmid}\\b|:(qmstart|qmstop|qmshutdown|qmreboot|qmreset|qmsuspend|qmresume):${vmid}:|\\bvmid[= ]${vmid}\\b|vfio-pci`, '-n', '4000', '-r']).catch(() => []),
    pve<any[]>('GET', `${node()}/qemu/${vmid}/rrddata?timeframe=${timeframeFor(since)}&cf=AVERAGE`).catch(() => []),
  ]);
  const agent = await agentProbe(vmid, g.status);

  // vfio-pci lines are host-wide; keep only the functions assigned to this VM.
  const assigned = Object.entries(config).filter(([k]) => /^hostpci\d+$/.test(k))
    .flatMap(([, v]) => str(v).split(',')[0].replace(/^host=/, '').split(';')).map((a) => (/^[0-9a-f]{2}:/i.test(a) ? `0000:${a}` : a).toLowerCase());
  const mine = raw.filter((l) => !l.message.includes('vfio-pci ') || assigned.some((a) => l.message.toLowerCase().includes(a)));
  const lines = mine.map(classify);
  const since7 = since;
  const sessions = buildSessions(mine, tasks, vmid);
  const findings = analyse({ vmid, since: since7, lines, tasks, sessions, status: g.status });
  const health = configChecks(config, { machine: cur['running-machine'] ? str(cur['running-machine']) : null, status: g.status, agentUp: agent.state === 'ok' ? true : agent.state === 'unreachable' ? false : null });

  const rows = rrd.map((r) => ({ time: Number(r.time), cpu: r.cpu == null ? null : Number(r.cpu), mem: r.mem == null ? null : Number(r.mem), netin: r.netin == null ? null : Number(r.netin), netout: r.netout == null ? null : Number(r.netout), diskread: r.diskread == null ? null : Number(r.diskread), diskwrite: r.diskwrite == null ? null : Number(r.diskwrite) }));
  const noisy = lines.filter((l) => l.level !== 'info');
  const verdict: Severity = findings.some((f) => f.severity === 'critical') ? 'critical' : findings.some((f) => f.severity === 'warn') ? 'warn' : 'ok';
  return {
    vmid, name: g.name, since, ostype: str(config.ostype), status: g.status, verdict,
    uptime: g.uptime, agent, findings, health, sessions: sessions.slice(0, 30),
    taskHistory: tasks.filter((t) => /^(qm(start|stop|shutdown|reboot|reset|suspend|resume)|vncproxy)$/.test(t.type)).slice(0, 60),
    metrics: summarise(rows), metricsTimeframe: timeframeFor(since),
    counts: { lines: lines.length, problems: noisy.length },
    recurring: recurring(noisy).slice(0, 15),
    lines: lines.slice(0, 600),
  };
}

export function registerWindows(app: FastifyInstance) {
  app.get<{ Params: { vmid: string }; Querystring: { since?: string } }>('/api/guests/:vmid/windows', async (req) => {
    const vmid = Number(req.params.vmid);
    if (!Number.isInteger(vmid) || vmid <= 0) throw new HttpError(400, 'BAD_REQUEST', 'Invalid vmid');
    return windowsReport(vmid, parseSince(req.query.since));
  });
}
