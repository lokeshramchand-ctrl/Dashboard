import type { FastifyInstance, FastifyRequest } from 'fastify';
import { cfg } from './config.js';
import { col } from './db.js';
import { HttpError } from './errors.js';
import { listGuests } from './guests.js';
import type { Guest } from './guests.js';
import { pve } from './proxmox.js';

const node = () => encodeURIComponent(cfg.pveNode);
const base = (g: Guest) => `/nodes/${node()}/${g.type}/${g.vmid}`;
const UPID = /^UPID:[\w.-]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:[\w-]+:[\w.:-]*:[\w@.!-]+:$/;
const SNAP = /^[A-Za-z][A-Za-z0-9_-]{1,39}$/;
const STORAGE = /^[A-Za-z0-9][\w.-]{0,63}$/;
const TAG = /^[\w.+-]{1,32}$/;
const SECRET_KEY = /pass|secret|key|token/i;
const TIMEFRAMES = ['hour', 'day', 'week', 'month', 'year'];

const parseVmid = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'BAD_REQUEST', 'Invalid vmid');
  return n;
};

/** Resolves an allowed guest for read-only routes. */
export async function findGuest(raw: string): Promise<Guest> {
  const vmid = parseVmid(raw);
  const g = (await listGuests()).find((x) => x.vmid === vmid);
  if (!g) throw new HttpError(404, 'NOT_FOUND', `Guest ${vmid} does not exist or is not allowed`);
  return g;
}

/**
 * Runs a state-changing guest operation. Protected guests are refused, and every attempt
 * (accepted, refused, error) lands in `audit`, same as power actions.
 */
export async function audited<T>(req: FastifyRequest, raw: string, action: string, detail: string | undefined, fn: (g: Guest) => Promise<T>): Promise<T> {
  const vmid = parseVmid(raw);
  const user = req.user!.username;
  const meta = { ts: new Date(), user, ip: req.ip, vmid, action, detail: detail?.slice(0, 300) };
  const g = (await listGuests()).find((x) => x.vmid === vmid);
  const refuse = async (status: number, code: string, msg: string) => {
    await col.audit().insertOne({ ...meta, name: g?.name, result: 'refused', reason: code });
    req.log.warn({ user, vmid, action, code }, 'guest operation refused');
    throw new HttpError(status, code, msg);
  };
  if (!g) return refuse(404, 'NOT_FOUND', `Guest ${vmid} does not exist or is not allowed`);
  if (g.protected) return refuse(403, 'PROTECTED', `Guest ${vmid} (${g.name}) is protected`);
  try {
    const out = await fn(g);
    const taskId = typeof out === 'string' && out.startsWith('UPID:') ? out : undefined;
    await col.audit().insertOne({ ...meta, name: g.name, result: 'accepted', taskId });
    req.log.info({ user, vmid, action }, 'guest operation');
    return out;
  } catch (e) {
    await col.audit().insertOne({ ...meta, name: g.name, result: 'error', reason: (e as Error).message });
    throw e;
  }
}

const bad = (msg: string) => new HttpError(400, 'BAD_REQUEST', msg);
const int = (v: unknown, k: string, min: number, max: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${k} must be a whole number between ${min} and ${max}`);
  return n;
};
const str = (v: unknown, k: string, max: number, re?: RegExp) => {
  if (typeof v !== 'string' || v.length > max || (re && !re.test(v))) throw bad(`${k} is invalid`);
  return v;
};

/** Only these keys can be changed from the dashboard; everything else stays read-only. */
function editable(g: Guest, body: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const lxc = g.type === 'lxc';
  for (const [k, v] of Object.entries(body)) {
    switch (k) {
      case 'hostname': if (!lxc) throw bad('hostname applies to containers only'); out.hostname = str(v, k, 63, /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/); break;
      case 'name': if (lxc) throw bad('name applies to VMs only'); out.name = str(v, k, 63, /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/); break;
      case 'description': out.description = str(v, k, 4096); break;
      case 'tags':
        if (!Array.isArray(v) || v.length > 16) throw bad('tags must be a list of up to 16 tags');
        out.tags = v.map((t) => str(t, 'tag', 32, TAG)).join(';');
        break;
      case 'onboot': if (typeof v !== 'boolean') throw bad('onboot must be true or false'); out.onboot = v; break;
      case 'startup': out.startup = str(v, k, 80, /^(order=\d+|up=\d+|down=\d+)(,(order=\d+|up=\d+|down=\d+))*$/); break;
      case 'cores': out.cores = int(v, k, 1, 128); break;
      case 'sockets': if (lxc) throw bad('sockets applies to VMs only'); out.sockets = int(v, k, 1, 8); break;
      case 'memory': out.memory = int(v, k, 16, 1_048_576); break;
      case 'swap': if (!lxc) throw bad('swap applies to containers only'); out.swap = int(v, k, 0, 1_048_576); break;
      case 'balloon': if (lxc) throw bad('balloon applies to VMs only'); out.balloon = int(v, k, 0, 1_048_576); break;
      case 'cpulimit': out.cpulimit = int(v, k, 0, 128); break;
      default: throw bad(`${k} cannot be changed here`);
    }
  }
  if (!Object.keys(out).length) throw bad('Nothing to change');
  return out;
}

interface Snap { name: string; description?: string; snaptime?: number; vmstate?: number; parent?: string }
interface Content { volid: string; size: number; ctime: number; format?: string; notes?: string }

export function registerGuestDetail(app: FastifyInstance) {
  // Raw config, plus anything Proxmox is holding as pending until the next restart.
  app.get<{ Params: { vmid: string } }>('/api/guests/:vmid/config', async (req) => {
    const g = await findGuest(req.params.vmid);
    const [conf, pending] = await Promise.all([
      pve<Record<string, string | number>>('GET', `${base(g)}/config`),
      pve<{ key: string; value?: string | number; pending?: string | number; delete?: number }[]>('GET', `${base(g)}/pending`).catch(() => []),
    ]);
    const config = Object.fromEntries(Object.entries(conf).map(([k, v]) => [k, SECRET_KEY.test(k) ? '********' : v]));
    return { config, pending: pending.filter((p) => p.pending !== undefined || p.delete).map((p) => p.key) };
  });

  app.put<{ Params: { vmid: string }; Body: Record<string, unknown> }>('/api/guests/:vmid/config', async (req) => {
    const g = await findGuest(req.params.vmid);
    const changes = editable(g, req.body ?? {});
    await audited(req, req.params.vmid, 'config', Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(' '), (guest) =>
      pve<null>('PUT', `${base(guest)}/config`, changes));
    return { ok: true };
  });

  // Chart data for the Summary tab. cpu is a 0..1 fraction, mem/maxmem/disk* in bytes, net* in bytes/s.
  app.get<{ Params: { vmid: string }; Querystring: { timeframe?: string } }>('/api/guests/:vmid/rrd', async (req) => {
    const g = await findGuest(req.params.vmid);
    const timeframe = req.query.timeframe ?? 'hour';
    if (!TIMEFRAMES.includes(timeframe)) throw bad('timeframe must be hour, day, week, month or year');
    const rows = await pve<Record<string, number | undefined>[]>('GET', `${base(g)}/rrddata?timeframe=${timeframe}&cf=AVERAGE`);
    return rows.filter((r) => r.time !== undefined).map((r) => ({
      time: r.time!, cpu: r.cpu ?? null, mem: r.mem ?? null, maxmem: r.maxmem ?? null,
      netin: r.netin ?? null, netout: r.netout ?? null, diskread: r.diskread ?? null, diskwrite: r.diskwrite ?? null,
    }));
  });

  app.get<{ Params: { vmid: string } }>('/api/guests/:vmid/tasks', async (req) => {
    const g = await findGuest(req.params.vmid);
    const rows = await pve<{ upid: string; type: string; user: string; starttime: number; endtime?: number; status?: string }[]>(
      'GET', `/nodes/${node()}/tasks?vmid=${g.vmid}&limit=50`);
    return rows.map((t) => ({
      upid: t.upid, type: t.type, user: t.user, start: t.starttime, end: t.endtime ?? null,
      status: t.endtime === undefined ? 'running' : t.status === 'OK' ? 'ok' : 'error', message: t.status ?? '',
    }));
  });

  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/log', async (req) => {
    if (!UPID.test(req.params.taskId)) throw bad('Invalid task id');
    const lines = await pve<{ n: number; t: string }[]>('GET', `/nodes/${node()}/tasks/${encodeURIComponent(req.params.taskId)}/log?limit=500`);
    return { lines: lines.map((l) => l.t) };
  });

  // ---- snapshots ----
  app.get<{ Params: { vmid: string } }>('/api/guests/:vmid/snapshots', async (req) => {
    const g = await findGuest(req.params.vmid);
    const rows = await pve<Snap[]>('GET', `${base(g)}/snapshot`);
    return rows.filter((s) => s.name !== 'current').map((s) => ({
      name: s.name, description: s.description ?? '', time: s.snaptime ?? null, vmstate: !!s.vmstate, parent: s.parent ?? null,
    }));
  });

  app.post<{ Params: { vmid: string }; Body: { name?: string; description?: string; vmstate?: boolean } }>('/api/guests/:vmid/snapshots', async (req) => {
    const name = str(req.body?.name, 'name', 40, SNAP);
    const description = req.body?.description === undefined ? '' : str(req.body.description, 'description', 512);
    const vmstate = req.body?.vmstate === true;
    const taskId = await audited(req, req.params.vmid, 'snapshot', name, (g) =>
      pve<string>('POST', `${base(g)}/snapshot`, { snapname: name, description: description || undefined, vmstate: g.type === 'qemu' && vmstate ? true : undefined }));
    return { taskId };
  });

  app.post<{ Params: { vmid: string; name: string } }>('/api/guests/:vmid/snapshots/:name/rollback', async (req) => {
    const name = str(req.params.name, 'name', 40, SNAP);
    return { taskId: await audited(req, req.params.vmid, 'rollback', name, (g) => pve<string>('POST', `${base(g)}/snapshot/${name}/rollback`, {})) };
  });

  app.delete<{ Params: { vmid: string; name: string } }>('/api/guests/:vmid/snapshots/:name', async (req) => {
    const name = str(req.params.name, 'name', 40, SNAP);
    return { taskId: await audited(req, req.params.vmid, 'snapshot-delete', name, (g) => pve<string>('DELETE', `${base(g)}/snapshot/${name}`)) };
  });

  // ---- backups (vzdump) ----
  app.get<{ Params: { vmid: string } }>('/api/guests/:vmid/backups', async (req) => {
    const g = await findGuest(req.params.vmid);
    const stores = await pve<{ storage: string }[]>('GET', `/nodes/${node()}/storage?content=backup`);
    const lists = await Promise.all(stores.map(async (s) => {
      if (!STORAGE.test(s.storage)) return [];
      const items = await pve<Content[]>('GET', `/nodes/${node()}/storage/${encodeURIComponent(s.storage)}/content?content=backup&vmid=${g.vmid}`).catch(() => []);
      return items.map((i) => ({ volid: i.volid, storage: s.storage, size: i.size, time: i.ctime, format: i.format ?? '', notes: i.notes ?? '' }));
    }));
    return {
      storages: stores.map((s) => s.storage),
      defaultStorage: stores.some((s) => s.storage === cfg.backupStorage) ? cfg.backupStorage : stores[0]?.storage ?? null,
      items: lists.flat().sort((a, b) => b.time - a.time),
    };
  });

  app.post<{ Params: { vmid: string }; Body: { storage?: string; mode?: string; notes?: string } }>('/api/guests/:vmid/backups', async (req) => {
    const storage = str(req.body?.storage, 'storage', 64, STORAGE);
    const mode = req.body?.mode ?? 'snapshot';
    if (!['snapshot', 'suspend', 'stop'].includes(mode)) throw bad('mode must be snapshot, suspend or stop');
    const notes = req.body?.notes === undefined ? undefined : str(req.body.notes, 'notes', 256);
    const taskId = await audited(req, req.params.vmid, 'backup', `${storage} ${mode}`, (g) =>
      pve<string>('POST', `/nodes/${node()}/vzdump`, { vmid: g.vmid, storage, mode, compress: 'zstd', 'notes-template': notes }));
    return { taskId };
  });
}
