import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { cfg } from './config.js';
import { col } from './db.js';
import { HttpError } from './errors.js';
import { parseTimeframe, rrdRows, UPID } from './node.js';
import { pve } from './proxmox.js';

export interface Guest {
  vmid: number; name: string; type: 'lxc' | 'qemu'; status: 'running' | 'stopped' | 'paused';
  cpu: number; memUsed: number; memMax: number; uptime: number; protected: boolean; tags: string[]; conflicts: number[];
}
type Action = 'start' | 'shutdown' | 'stop' | 'reboot' | 'reset' | 'suspend' | 'resume';
const ACTIONS: Action[] = ['start', 'shutdown', 'stop', 'reboot', 'reset', 'suspend', 'resume'];
const QEMU_ONLY: Action[] = ['reset', 'suspend', 'resume'];
// Which current status each action is valid from (paused = a suspended QEMU guest).
const FROM: Record<Action, Guest['status'][]> = {
  start: ['stopped'], shutdown: ['running'], reboot: ['running'], reset: ['running'], suspend: ['running'],
  resume: ['paused'], stop: ['running', 'paused'],
};
// Config keys whose values are secrets even in an admin view.
const SECRET_KEYS = new Set(['cipassword']);

function map(type: 'lxc' | 'qemu', r: any): Guest {
  const vmid = Number(r.vmid);
  const status = r.status === 'running' ? (r.qmpstatus === 'paused' ? 'paused' : 'running') : 'stopped';
  return {
    vmid, name: r.name ?? `${type}-${vmid}`, type, status,
    cpu: Number(r.cpu ?? 0), memUsed: Number(r.mem ?? 0), memMax: Number(r.maxmem ?? 0), uptime: Number(r.uptime ?? 0),
    protected: cfg.protectedVmids.has(vmid),
    tags: r.tags ? String(r.tags).split(/[;,]/).filter(Boolean) : [],
    conflicts: cfg.conflicts[vmid] ?? [],
  };
}

export async function listGuests(): Promise<Guest[]> {
  const n = encodeURIComponent(cfg.pveNode);
  const [lxc, qemu] = await Promise.all([pve<any[]>('GET', `/nodes/${n}/lxc`), pve<any[]>('GET', `/nodes/${n}/qemu`)]);
  return [...lxc.map((r) => map('lxc', r)), ...qemu.filter((r) => !r.template).map((r) => map('qemu', r))]
    .filter((g) => cfg.allowedVmids.size === 0 || cfg.allowedVmids.has(g.vmid))
    .sort((a, b) => a.vmid - b.vmid);
}

const parseVmid = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'BAD_REQUEST', 'Invalid vmid');
  return n;
};

async function findGuest(v: string): Promise<Guest> {
  const vmid = parseVmid(v);
  const g = (await listGuests()).find((x) => x.vmid === vmid);
  if (!g) throw new HttpError(404, 'NOT_FOUND', `Guest ${vmid} does not exist or is not allowed`);
  return g;
}
const guestPath = (g: Guest) => `/nodes/${encodeURIComponent(cfg.pveNode)}/${g.type}/${g.vmid}`;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

export function registerGuests(app: FastifyInstance) {
  app.get('/api/guests', () => listGuests());

  app.get<{ Params: { vmid: string } }>('/api/guests/:vmid', (req) => findGuest(req.params.vmid));

  app.get<{ Params: { vmid: string } }>('/api/guests/:vmid/status', async (req) => {
    const g = await findGuest(req.params.vmid);
    const s = await pve<any>('GET', `${guestPath(g)}/status/current`);
    return {
      ...g,
      cpus: num(s.cpus), diskUsed: num(s.disk), diskMax: num(s.maxdisk), swapUsed: num(s.swap), swapMax: num(s.maxswap),
      netIn: num(s.netin), netOut: num(s.netout), diskRead: num(s.diskread), diskWrite: num(s.diskwrite),
      pid: s.pid ? num(s.pid) : null, lock: s.lock ? String(s.lock) : null, haManaged: !!s.ha?.managed,
      agent: g.type === 'qemu' ? !!s.agent : null, qmpStatus: s.qmpstatus ? String(s.qmpstatus) : null,
      runningMachine: s['running-machine'] ? String(s['running-machine']) : null, runningQemu: s['running-qemu'] ? String(s['running-qemu']) : null,
    };
  });

  // /pending returns the current config plus any change that applies on the next restart.
  app.get<{ Params: { vmid: string } }>('/api/guests/:vmid/config', async (req) => {
    const g = await findGuest(req.params.vmid);
    const rows = await pve<{ key: string; value?: unknown; pending?: unknown; delete?: number }[]>('GET', `${guestPath(g)}/pending`);
    const show = (k: string, v: unknown) => (v === undefined ? null : SECRET_KEYS.has(k) ? '••••••' : String(v));
    return rows
      .filter((r) => r.key !== 'digest')
      .map((r) => ({ key: r.key, value: show(r.key, r.value), pending: show(r.key, r.pending), delete: !!r.delete }))
      .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  });

  app.get<{ Params: { vmid: string }; Querystring: { timeframe?: string } }>('/api/guests/:vmid/rrd', async (req) => {
    const tf = parseTimeframe(req.query.timeframe);
    const g = await findGuest(req.params.vmid);
    const rows = await pve<any[]>('GET', `${guestPath(g)}/rrddata?timeframe=${tf}&cf=AVERAGE`);
    return rrdRows(rows, ['cpu', 'maxcpu', 'mem', 'maxmem', 'disk', 'maxdisk', 'netin', 'netout', 'diskread', 'diskwrite']);
  });

  app.get<{ Params: { vmid: string } }>('/api/guests/:vmid/snapshots', async (req) => {
    const g = await findGuest(req.params.vmid);
    const rows = await pve<any[]>('GET', `${guestPath(g)}/snapshot`);
    return rows.map((r) => ({
      name: String(r.name), parent: r.parent ? String(r.parent) : null, description: String(r.description ?? '').trim(),
      time: r.snaptime ? num(r.snaptime) : null, vmstate: !!r.vmstate, current: r.name === 'current',
    }));
  });

  app.post<{ Params: { vmid: string; action: string } }>('/api/guests/:vmid/:action', async (req) => {
    const vmid = parseVmid(req.params.vmid);
    const action = req.params.action as Action;
    if (!ACTIONS.includes(action)) throw new HttpError(404, 'NOT_FOUND', `Unknown action ${req.params.action}`);
    const user = req.user!.username;
    const base = { ts: new Date(), user, ip: req.ip, vmid, action };
    const refuse = async (status: number, code: string, msg: string, name?: string) => {
      await col.audit().insertOne({ ...base, name, result: 'refused', reason: code });
      req.log.warn({ user, vmid, action, code }, 'guest action refused');
      throw new HttpError(status, code, msg);
    };

    const g = (await listGuests()).find((x) => x.vmid === vmid);
    if (!g) return refuse(404, 'NOT_FOUND', `Guest ${vmid} does not exist or is not allowed`);
    if (g.protected) return refuse(403, 'PROTECTED', `Guest ${vmid} (${g.name}) is protected`, g.name);
    if (QEMU_ONLY.includes(action) && g.type !== 'qemu') return refuse(400, 'UNSUPPORTED', `${action} is only available for virtual machines`, g.name);
    if (!FROM[action].includes(g.status)) {
      if (action === 'start') return refuse(409, g.status === 'paused' ? 'PAUSED' : 'ALREADY_RUNNING', g.status === 'paused' ? `${g.name} is suspended; resume it instead` : `${g.name} is already running`, g.name);
      if (action === 'resume') return refuse(409, 'NOT_PAUSED', `${g.name} is not suspended`, g.name);
      return refuse(409, 'NOT_RUNNING', `${g.name} is not running`, g.name);
    }

    try {
      const taskId = await pve<string>('POST', `/nodes/${encodeURIComponent(cfg.pveNode)}/${g.type}/${vmid}/status/${action}`);
      await col.audit().insertOne({ ...base, name: g.name, result: 'accepted', taskId });
      req.log.info({ user, vmid, action, taskId }, 'guest action');
      return { taskId };
    } catch (e) {
      await col.audit().insertOne({ ...base, name: g.name, result: 'error', reason: (e as Error).message });
      throw e;
    }
  });

  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId', async (req) => {
    const id = req.params.taskId;
    if (!UPID.test(id)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid task id');
    const t = await pve<{ status: string; exitstatus?: string }>('GET', `/nodes/${encodeURIComponent(cfg.pveNode)}/tasks/${encodeURIComponent(id)}/status`);
    if (t.status === 'running') return { status: 'running', message: '' };
    return t.exitstatus === 'OK'
      ? { status: 'ok', message: 'TASK OK' }
      : { status: 'error', message: t.exitstatus ? `TASK ERROR: ${t.exitstatus}` : 'Task failed' };
  });

  // --- SSE: server-side poll of Proxmox, pushed to every open browser tab ---
  const clients = new Set<ServerResponse>();
  let last = new Map<number, string>();
  let timer: NodeJS.Timeout | undefined;
  let busy = false;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const next = new Map<number, string>();
      for (const g of await listGuests()) {
        next.set(g.vmid, g.status);
        if (last.size && last.get(g.vmid) !== g.status) {
          const msg = `data: ${JSON.stringify({ type: 'guest', vmid: g.vmid, status: g.status })}\n\n`;
          clients.forEach((c) => c.write(msg));
        }
      }
      last = next;
      clients.forEach((c) => c.write(': ping\n\n'));
    } catch (e) {
      app.log.warn({ err: (e as Error).message }, 'events poll failed');
    } finally {
      busy = false;
    }
  };

  app.get('/api/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    clients.add(res);
    if (!timer) { last = new Map(); timer = setInterval(tick, 3000); void tick(); }
    req.raw.on('close', () => {
      clients.delete(res);
      if (!clients.size && timer) { clearInterval(timer); timer = undefined; }
    });
  });
}
