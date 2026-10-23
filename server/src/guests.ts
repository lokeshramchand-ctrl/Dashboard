import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { cfg } from './config.js';
import { col } from './db.js';
import { HttpError } from './errors.js';
import { pve } from './proxmox.js';

export interface Guest {
  vmid: number; name: string; type: 'lxc' | 'qemu'; status: 'running' | 'stopped' | 'paused';
  cpu: number; memUsed: number; memMax: number; uptime: number; protected: boolean; tags: string[]; conflicts: number[];
}
type Action = 'start' | 'shutdown' | 'stop' | 'reboot';
const ACTIONS: Action[] = ['start', 'shutdown', 'stop', 'reboot'];

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

// UPID:node:pid:pstart:starttime:type:id:user:  — validated before it ever reaches a URL path.
const UPID = /^UPID:[\w.-]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:[\w-]+:[\w.:-]*:[\w@.!-]+:$/;

export function registerGuests(app: FastifyInstance) {
  app.get('/api/guests', () => listGuests());

  app.get<{ Params: { vmid: string } }>('/api/guests/:vmid', async (req) => {
    const vmid = parseVmid(req.params.vmid);
    const g = (await listGuests()).find((x) => x.vmid === vmid);
    if (!g) throw new HttpError(404, 'NOT_FOUND', `Guest ${vmid} does not exist or is not allowed`);
    return g;
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
    if (action === 'start' && g.status === 'running') return refuse(409, 'ALREADY_RUNNING', `${g.name} is already running`, g.name);
    if (action !== 'start' && g.status !== 'running') return refuse(409, 'NOT_RUNNING', `${g.name} is not running`, g.name);

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
