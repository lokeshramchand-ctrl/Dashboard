// Day-to-day Windows/QEMU VM management beyond power and snapshots: guest-agent facts
// (OS, IPs, volumes), config edits (CPU, RAM, autostart, agent), ISO mount/eject, NIC link
// toggle and clone. Every write is validated strictly, audited, and refuses protected guests.
import type { FastifyInstance } from 'fastify';
import { cfg } from './config.js';
import { HttpError } from './errors.js';
import { findGuest, guestPath, invalidateGuests } from './guests.js';
import { pve } from './proxmox.js';
import { guard, parseKv, run } from './qemu.js';

const node = () => `/nodes/${encodeURIComponent(cfg.pveNode)}`;
const ISO_VOLID = /^[A-Za-z0-9][\w.-]*:iso\/[\w .+()-]{1,120}\.iso$/i;
const CD_SLOT = /^(ide[0-3]|sata[0-5]|scsi\d{1,2})$/;
const NET_SLOT = /^net\d{1,2}$/;
const VM_NAME = /^[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?$/;

const int = (v: unknown, min: number, max: number, what: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, 'BAD_REQUEST', `${what} must be a whole number between ${min} and ${max}`);
  return n;
};

async function agentCall<T>(path: string): Promise<T | null> {
  try { return (await pve<{ result?: T }>('GET', path))?.result ?? null; } catch { return null; }
}

export function registerVmOps(app: FastifyInstance) {
  const qemu = async (v: string) => {
    const g = await findGuest(v);
    if (g.type !== 'qemu') throw new HttpError(400, 'UNSUPPORTED', 'Only available for virtual machines');
    return g;
  };

  // Facts reported by the QEMU guest agent. Each call may fail independently (agent missing, VM off).
  app.get<{ Params: { vmid: string } }>('/api/guests/:vmid/vm/agent', async (req) => {
    const g = await qemu(req.params.vmid);
    if (g.status !== 'running') return { available: false, reason: 'The VM is not running' };
    const base = `${guestPath(g)}/agent`;
    const ping = await pve('POST', `${base}/ping`).then(() => true, () => false);
    if (!ping) return { available: false, reason: 'The guest agent does not answer. Enable it in the VM options and install it inside Windows.' };
    const [os, host, nets, fs, time] = await Promise.all([
      agentCall<Record<string, string>>(`${base}/get-osinfo`),
      agentCall<Record<string, string>>(`${base}/get-host-name`),
      agentCall<any[]>(`${base}/network-get-interfaces`),
      agentCall<any[]>(`${base}/get-fsinfo`),
      agentCall<number>(`${base}/get-time`),
    ]);
    const interfaces = (nets ?? []).filter((n) => !/^(lo|Loopback)/i.test(String(n.name))).map((n) => ({
      name: String(n.name), mac: n['hardware-address'] ? String(n['hardware-address']) : null,
      ips: ((n['ip-addresses'] ?? []) as any[]).map((a) => ({ ip: String(a['ip-address']), v6: a['ip-address-type'] === 'ipv6', prefix: Number(a.prefix ?? 0) })),
    }));
    const volumes = (fs ?? []).filter((f) => Number(f['total-bytes']) > 0).map((f) => ({
      mount: String(f.mountpoint ?? f.name), type: String(f.type ?? ''), used: Number(f['used-bytes'] ?? 0), total: Number(f['total-bytes'] ?? 0),
    }));
    return {
      available: true, hostname: host?.['host-name'] ?? null,
      os: os ? { name: os.name ?? os['pretty-name'] ?? null, version: os.version ?? null, build: os['kernel-release'] ?? null, arch: os.machine ?? null } : null,
      interfaces, volumes, guestTime: typeof time === 'number' ? Math.round(time / 1e9) : null,
    };
  });

  // ISOs that can be mounted, from every storage that holds them.
  app.get<{ Params: { vmid: string } }>('/api/guests/:vmid/vm/isos', async (req) => {
    const g = await qemu(req.params.vmid);
    const stores = (await pve<any[]>('GET', `${node()}/storage?content=iso`)).filter((s) => s.active !== 0 && s.enabled !== 0);
    const rows = await Promise.all(stores.map(async (s) => {
      try {
        const items = await pve<any[]>('GET', `${node()}/storage/${encodeURIComponent(s.storage)}/content?content=iso`);
        return items.map((i) => ({ volid: String(i.volid), name: String(i.volid).split('/').pop() ?? '', size: Number(i.size ?? 0), storage: String(s.storage) }));
      } catch { return []; }
    }));
    const cfgNow = await pve<Record<string, unknown>>('GET', `${guestPath(g)}/config`);
    const drives = Object.entries(cfgNow).filter(([k, v]) => CD_SLOT.test(k) && /media=cdrom/.test(String(v))).map(([k, v]) => ({ slot: k, volid: parseKv(String(v))._ === 'none' ? null : parseKv(String(v))._ ?? null }));
    return { isos: rows.flat().sort((a, b) => a.name.localeCompare(b.name)), drives };
  });

  app.post<{ Params: { vmid: string }; Body: { slot?: string; iso?: string | null } }>('/api/guests/:vmid/vm/media', async (req) => {
    const g = await qemu(req.params.vmid);
    const slot = String(req.body?.slot ?? 'ide2');
    const iso = req.body?.iso == null || req.body.iso === 'none' ? null : String(req.body.iso);
    if (!CD_SLOT.test(slot)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid drive slot');
    if (iso && !ISO_VOLID.test(iso)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid ISO volume id');
    const done = await guard(req, g, iso ? 'media-mount' : 'media-eject', { slot, iso });
    return run(done, async () => {
      await pve('PUT', `${guestPath(g)}/config`, { [slot]: `${iso ?? 'none'},media=cdrom` });
      invalidateGuests();
      return null;
    });
  });

  app.post<{ Params: { vmid: string }; Body: { cores?: number; memoryMb?: number; balloonMb?: number; onboot?: boolean; agent?: boolean; description?: string; name?: string } }>('/api/guests/:vmid/vm/config', async (req) => {
    const g = await qemu(req.params.vmid);
    const b = req.body ?? {};
    const form: Record<string, string> = {};
    if (b.cores !== undefined) form.cores = String(int(b.cores, 1, 128, 'Cores'));
    if (b.memoryMb !== undefined) form.memory = String(int(b.memoryMb, 512, 1048576, 'Memory (MB)'));
    if (b.balloonMb !== undefined) form.balloon = String(int(b.balloonMb, 0, 1048576, 'Balloon (MB)'));
    if (b.onboot !== undefined) form.onboot = b.onboot ? '1' : '0';
    if (b.agent !== undefined) form.agent = b.agent ? 'enabled=1' : 'enabled=0';
    if (b.description !== undefined) form.description = String(b.description).slice(0, 1000);
    if (b.name !== undefined) {
      if (!VM_NAME.test(String(b.name))) throw new HttpError(400, 'BAD_REQUEST', 'Name may only use letters, digits and - (max 63)');
      form.name = String(b.name);
    }
    if (!Object.keys(form).length) throw new HttpError(400, 'BAD_REQUEST', 'Nothing to change');
    if (form.balloon && form.memory && Number(form.balloon) > Number(form.memory)) throw new HttpError(400, 'BAD_REQUEST', 'Balloon cannot exceed memory');
    const done = await guard(req, g, 'config-update', { changes: Object.keys(form) });
    return run(done, async () => { await pve('PUT', `${guestPath(g)}/config`, form); invalidateGuests(); return null; });
  });

  app.post<{ Params: { vmid: string }; Body: { key?: string; linkDown?: boolean } }>('/api/guests/:vmid/vm/nic', async (req) => {
    const g = await qemu(req.params.vmid);
    const key = String(req.body?.key ?? '');
    if (!NET_SLOT.test(key)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid network slot');
    if (typeof req.body?.linkDown !== 'boolean') throw new HttpError(400, 'BAD_REQUEST', 'linkDown must be true or false');
    const done = await guard(req, g, req.body.linkDown ? 'nic-disconnect' : 'nic-connect', { key });
    return run(done, async () => {
      const c = await pve<Record<string, unknown>>('GET', `${guestPath(g)}/config`);
      if (c[key] == null) throw new HttpError(404, 'NOT_FOUND', `${key} does not exist`);
      const parts = String(c[key]).split(',').filter((p) => !p.startsWith('link_down='));
      if (req.body!.linkDown) parts.push('link_down=1');
      await pve('PUT', `${guestPath(g)}/config`, { [key]: parts.join(',') });
      return null;
    });
  });

  app.post<{ Params: { vmid: string }; Body: { name?: string; full?: boolean } }>('/api/guests/:vmid/vm/clone', async (req) => {
    const g = await qemu(req.params.vmid);
    const name = String(req.body?.name ?? '');
    if (!VM_NAME.test(name)) throw new HttpError(400, 'BAD_REQUEST', 'Name may only use letters, digits and - (max 63)');
    const done = await guard(req, g, 'clone', { name });
    return run(done, async () => {
      const newid = await pve<number | string>('GET', '/cluster/nextid');
      const form: Record<string, string> = { newid: String(newid), name, full: req.body?.full === false ? '0' : '1' };
      const taskId = await pve<string>('POST', `${guestPath(g)}/clone`, form);
      invalidateGuests();
      return taskId;
    });
  });
}
