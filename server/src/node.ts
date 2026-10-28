import type { FastifyInstance } from 'fastify';
import { cfg } from './config.js';
import { HttpError } from './errors.js';
import { pve } from './proxmox.js';

const node = () => `/nodes/${encodeURIComponent(cfg.pveNode)}`;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

export const TIMEFRAMES = ['hour', 'day', 'week', 'month', 'year'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export function parseTimeframe(v: unknown): Timeframe {
  const t = String(v ?? 'hour');
  if (!(TIMEFRAMES as readonly string[]).includes(t)) throw new HttpError(400, 'BAD_REQUEST', `timeframe must be one of ${TIMEFRAMES.join(', ')}`);
  return t as Timeframe;
}

/** RRD rows from Proxmox carry every column as optional; keep only the ones the UI charts, as numbers or null. */
export function rrdRows(rows: any[], keys: string[]) {
  return rows.map((r) => {
    const o: Record<string, number | null> = { time: num(r.time) };
    for (const k of keys) o[k] = r[k] == null ? null : Number(r[k]);
    return o;
  });
}

// UPID:node:pid:pstart:starttime:type:id:user:  — validated before it ever reaches a URL path.
export const UPID = /^UPID:[\w.-]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:[\w-]+:[\w.:-]*:[\w@.!-]+:$/;
/** The guest a task belongs to, if its id field is a vmid. */
export const upidVmid = (upid: string) => {
  const id = upid.split(':')[6];
  return /^\d+$/.test(id) ? Number(id) : null;
};
const vmidAllowed = (vmid: number | null) => vmid === null || cfg.allowedVmids.size === 0 || cfg.allowedVmids.has(vmid);

export function mapTask(t: any) {
  return {
    upid: String(t.upid), type: String(t.type ?? ''), id: String(t.id ?? ''), user: String(t.user ?? ''),
    start: num(t.starttime), end: t.endtime ? num(t.endtime) : null,
    status: t.endtime ? (t.status === 'OK' ? 'ok' : String(t.status ?? '').startsWith('WARNINGS') ? 'warning' : 'error') : 'running',
    message: String(t.status ?? ''),
  };
}

export async function listTasks(p: { vmid?: number; limit?: number; errors?: boolean; type?: string }) {
  const q = new URLSearchParams({ limit: String(p.limit ?? 50), source: 'all' });
  if (p.vmid) q.set('vmid', String(p.vmid));
  if (p.errors) q.set('errors', '1');
  if (p.type) q.set('typefilter', p.type);
  const rows = await pve<any[]>('GET', `${node()}/tasks?${q}`);
  return rows.filter((t) => vmidAllowed(upidVmid(String(t.upid)))).map(mapTask);
}

export function registerNode(app: FastifyInstance) {
  app.get('/api/node', async () => {
    const [s, ver, sub, time, dns] = await Promise.all([
      pve<any>('GET', `${node()}/status`),
      pve<any>('GET', `${node()}/version`).catch(() => null),
      pve<any>('GET', `${node()}/subscription`).catch(() => null),
      pve<any>('GET', `${node()}/time`).catch(() => null),
      pve<any>('GET', `${node()}/dns`).catch(() => null),
    ]);
    return {
      name: cfg.pveNode,
      cpu: num(s.cpu), wait: num(s.wait),
      cpuModel: String(s.cpuinfo?.model ?? ''), cpus: num(s.cpuinfo?.cpus), cores: num(s.cpuinfo?.cores), sockets: num(s.cpuinfo?.sockets), mhz: num(s.cpuinfo?.mhz),
      loadavg: (s.loadavg ?? []).map(Number) as number[],
      memUsed: num(s.memory?.used), memTotal: num(s.memory?.total),
      swapUsed: num(s.swap?.used), swapTotal: num(s.swap?.total),
      rootUsed: num(s.rootfs?.used), rootTotal: num(s.rootfs?.total),
      ksmShared: num(s.ksm?.shared),
      uptime: num(s.uptime),
      kernel: String(s['current-kernel']?.release ?? s.kversion ?? ''),
      pveVersion: ver ? `${ver.version}` : String(s.pveversion ?? ''),
      bootMode: s['boot-info']?.mode ? `${String(s['boot-info'].mode).toUpperCase()}${s['boot-info'].secureboot ? ' (Secure Boot)' : ''}` : '',
      subscription: sub ? String(sub.status ?? 'unknown') : 'unknown',
      timezone: time ? String(time.timezone ?? '') : '',
      dns: dns ? [dns.dns1, dns.dns2, dns.dns3].filter(Boolean).map(String) : [],
      searchDomain: dns?.search ? String(dns.search) : '',
    };
  });

  app.get<{ Querystring: { timeframe?: string } }>('/api/node/rrd', async (req) => {
    const tf = parseTimeframe(req.query.timeframe);
    const rows = await pve<any[]>('GET', `${node()}/rrddata?timeframe=${tf}&cf=AVERAGE`);
    return rrdRows(rows, ['cpu', 'iowait', 'loadavg', 'memused', 'memtotal', 'swapused', 'netin', 'netout', 'rootused', 'roottotal']);
  });

  app.get('/api/node/network', async () => {
    const rows = await pve<any[]>('GET', `${node()}/network`);
    return rows.map((r) => ({
      iface: String(r.iface), type: String(r.type ?? ''), active: !!r.active, autostart: !!r.autostart,
      method: String(r.method ?? ''), cidr: r.cidr ? String(r.cidr) : r.address ? `${r.address}${r.netmask ? `/${r.netmask}` : ''}` : null,
      gateway: r.gateway ? String(r.gateway) : null, cidr6: r.cidr6 ? String(r.cidr6) : null,
      ports: r.bridge_ports ? String(r.bridge_ports).split(/\s+/).filter(Boolean) : r.slaves ? String(r.slaves).split(/\s+/).filter(Boolean) : [],
      vlanAware: !!r.bridge_vlan_aware, comments: r.comments ? String(r.comments).trim() : '',
    })).sort((a, b) => a.iface.localeCompare(b.iface, undefined, { numeric: true }));
  });

  app.get('/api/node/disks', async () => {
    const rows = await pve<any[]>('GET', `${node()}/disks/list`);
    return rows.map((r) => ({
      devpath: String(r.devpath), model: String(r.model ?? ''), serial: String(r.serial ?? ''), type: String(r.type ?? ''),
      size: num(r.size), health: String(r.health ?? 'UNKNOWN'), wearout: r.wearout == null || r.wearout === 'N/A' ? null : num(r.wearout),
      used: r.used ? String(r.used) : '', gpt: !!r.gpt, rpm: r.rpm == null ? null : num(r.rpm),
    }));
  });

  app.get('/api/node/services', async () => {
    const rows = await pve<any[]>('GET', `${node()}/services`);
    return rows.map((r) => ({
      name: String(r.name ?? r.service), desc: String(r.desc ?? ''), state: String(r.state ?? 'unknown'),
      active: String(r['active-state'] ?? ''), unit: String(r['unit-state'] ?? ''),
    }));
  });

  // Needs Datastore.Audit on /storage; without it Proxmox silently returns an empty list.
  app.get('/api/node/storage', async () => {
    const rows = await pve<any[]>('GET', `${node()}/storage`);
    return rows.map((r) => ({
      storage: String(r.storage), type: String(r.type ?? ''), content: String(r.content ?? '').split(',').filter(Boolean),
      active: !!r.active, enabled: r.enabled === undefined ? true : !!r.enabled, shared: !!r.shared,
      used: num(r.used), total: num(r.total),
    })).sort((a, b) => a.storage.localeCompare(b.storage));
  });

  app.get<{ Querystring: { vmid?: string; limit?: string; errors?: string; type?: string } }>('/api/tasks', async (req) => {
    const vmid = req.query.vmid ? Number(req.query.vmid) : undefined;
    if (vmid !== undefined && (!Number.isInteger(vmid) || vmid <= 0)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid vmid');
    if (vmid !== undefined && !vmidAllowed(vmid)) throw new HttpError(404, 'NOT_FOUND', `Guest ${vmid} does not exist or is not allowed`);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const type = req.query.type?.trim();
    if (type && !/^[\w-]{1,32}$/.test(type)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid task type');
    return listTasks({ vmid, limit, errors: req.query.errors === '1' || req.query.errors === 'true', type });
  });

  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/log', async (req) => {
    const id = req.params.taskId;
    if (!UPID.test(id)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid task id');
    if (!vmidAllowed(upidVmid(id))) throw new HttpError(404, 'NOT_FOUND', 'Task not found');
    const rows = await pve<{ n: number; t: string }[]>('GET', `${node()}/tasks/${encodeURIComponent(id)}/log?limit=1000`);
    return rows.map((r) => r.t);
  });
}
