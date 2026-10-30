// QEMU-specific management on top of the Proxmox API: structured hardware with sanity checks,
// snapshot create/rollback/delete, backups and send-key. Every write is audited, refuses
// protected guests, and (for destructive ones) needs the name typed back as confirmation.
import type { FastifyInstance } from 'fastify';
import { cfg } from './config.js';
import { col } from './db.js';
import { HttpError } from './errors.js';
import { findGuest, guestPath } from './guests.js';
import type { Guest } from './guests.js';
import { pve } from './proxmox.js';

const node = () => `/nodes/${encodeURIComponent(cfg.pveNode)}`;
const SNAP_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const KEYS: Record<string, string> = { 'ctrl-alt-delete': 'ctrl-alt-delete', 'ctrl-alt-f1': 'ctrl-alt-f1', 'ctrl-alt-f2': 'ctrl-alt-f2', esc: 'esc', 'win': 'meta_l', 'alt-f4': 'alt-f4' };

/** "local-lvm:vm-100-disk-0,size=32G,cache=none" -> {_: first, size: '32G', cache: 'none'}. Bare flags become 'true'. */
export function parseKv(v: string): Record<string, string> {
  const out: Record<string, string> = {};
  v.split(',').forEach((part, i) => {
    const eq = part.indexOf('=');
    if (eq < 0) { if (i === 0) out._ = part; else out[part] = 'true'; } else out[part.slice(0, eq)] = part.slice(eq + 1);
  });
  return out;
}

export interface Disk { key: string; bus: string; storage: string; volume: string; size: string | null; cdrom: boolean; cache: string | null; iothread: boolean; discard: boolean; ssd: boolean; backup: boolean }
export interface Nic { key: string; model: string; mac: string | null; bridge: string | null; vlan: string | null; firewall: boolean; rate: string | null; queues: string | null; linkDown: boolean }
export interface PciDev { key: string; device: string; pcie: boolean; xvga: boolean; romBar: boolean; mapping: boolean }
export interface QemuDevices {
  machine: string | null; bios: string; cpu: string; sockets: number; cores: number; memoryMb: number; balloonMb: number | null; ostype: string | null; scsihw: string | null;
  efi: boolean; tpm: boolean; agent: boolean; disks: Disk[]; nics: Nic[]; pci: PciDev[]; usb: { key: string; value: string }[]; other: { key: string; value: string }[];
  warnings: { severity: 'warn' | 'info'; title: string; advice: string }[];
}

const DISK_KEY = /^(ide|sata|scsi|virtio)(\d+)$/;
const isWindows = (os: string | null) => !!os && /^w/.test(os);

export function parseDevices(c: Record<string, unknown>): QemuDevices {
  const s = (k: string) => (c[k] == null ? null : String(c[k]));
  const keys = Object.keys(c).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const disks: Disk[] = [], nics: Nic[] = [], pci: PciDev[] = [], usb: { key: string; value: string }[] = [];
  for (const k of keys) {
    const v = String(c[k]);
    const dm = DISK_KEY.exec(k);
    if (dm) {
      const o = parseKv(v);
      const first = o._ ?? '';
      const cdrom = o.media === 'cdrom';
      const [storage, volume] = first.includes(':') ? [first.split(':')[0], first.slice(first.indexOf(':') + 1)] : ['', first];
      disks.push({
        key: k, bus: dm[1], storage, volume, size: o.size ?? null, cdrom, cache: o.cache ?? null,
        iothread: o.iothread === '1', discard: o.discard === 'on', ssd: o.ssd === '1', backup: o.backup !== '0',
      });
    } else if (/^net\d+$/.test(k)) {
      const o = parseKv(v);
      const [model, mac] = Object.entries(o).find(([n]) => /^(virtio|e1000|e1000e|rtl8139|vmxnet3|i82551|ne2k_pci)/.test(n)) ?? ['unknown', ''];
      nics.push({ key: k, model, mac: mac || null, bridge: o.bridge ?? null, vlan: o.tag ?? null, firewall: o.firewall === '1', rate: o.rate ?? null, queues: o.queues ?? null, linkDown: o.link_down === '1' });
    } else if (/^hostpci\d+$/.test(k)) {
      const o = parseKv(v);
      pci.push({ key: k, device: o._ ?? '', pcie: o.pcie === '1', xvga: o['x-vga'] === '1', romBar: o.rombar !== '0', mapping: (o._ ?? '').startsWith('mapping=') || !!o.mapping });
    } else if (/^usb\d+$/.test(k)) usb.push({ key: k, value: v });
  }
  const used = new Set(['digest', 'name', 'description', 'tags', 'boot', 'smbios1', 'vmgenid', 'meta', 'lock', 'parent', 'startup', 'onboot', 'numa', 'ostype', 'machine', 'bios', 'cpu', 'sockets', 'cores', 'memory', 'balloon', 'scsihw', 'agent', 'efidisk0', 'tpmstate0', 'vga']);
  const other = keys.filter((k) => !used.has(k) && !DISK_KEY.test(k) && !/^(net|hostpci|usb)\d+$/.test(k)).map((k) => ({ key: k, value: String(c[k]) }));

  const out: QemuDevices = {
    machine: s('machine'), bios: s('bios') ?? 'seabios', cpu: s('cpu') ?? 'kvm64', sockets: Number(c.sockets ?? 1), cores: Number(c.cores ?? 1),
    memoryMb: Number(c.memory ?? 0), balloonMb: c.balloon == null ? null : Number(c.balloon), ostype: s('ostype'), scsihw: s('scsihw'),
    efi: c.efidisk0 != null, tpm: c.tpmstate0 != null, agent: !!s('agent') && !/^0\b|enabled=0/.test(s('agent')!),
    disks, nics, pci, usb, other, warnings: [],
  };
  const w = out.warnings;
  const win = isWindows(out.ostype);
  if (win && out.bios === 'ovmf' && !out.tpm) w.push({ severity: 'warn', title: 'No TPM on a Windows UEFI VM', advice: 'Windows 11 needs a TPM 2.0. Add a TPM state disk (tpmstate0, v2.0) while the VM is stopped.' });
  if (win && out.bios !== 'ovmf') w.push({ severity: 'info', title: 'Legacy BIOS boot', advice: 'Windows 11, Secure Boot and a TPM all need OVMF (UEFI). Fine for Windows 10 and older.' });
  if (out.bios === 'ovmf' && !out.efi) w.push({ severity: 'warn', title: 'UEFI without an EFI disk', advice: 'Without efidisk0 UEFI settings (Secure Boot keys, boot order) are lost on every start.' });
  if (!out.machine || !/q35/.test(out.machine)) if (out.pci.some((p) => p.pcie)) w.push({ severity: 'warn', title: 'PCIe passthrough on a non-q35 machine', advice: 'pcie=1 devices need machine type q35.' });
  if (out.pci.length && out.balloonMb !== 0 && out.balloonMb != null) w.push({ severity: 'warn', title: 'Memory ballooning with PCI passthrough', advice: 'Passthrough pins all guest RAM; set balloon to 0 to avoid confusing memory accounting.' });
  if (out.pci.length && !/host/.test(out.cpu)) w.push({ severity: 'info', title: `CPU type is "${out.cpu}"`, advice: 'cpu=host exposes the real CPU features and is usually the best choice for passthrough/gaming VMs.' });
  if (!out.agent) w.push({ severity: 'info', title: 'QEMU guest agent is off', advice: 'Enable it and install it in the guest for clean shutdowns, IPs and freeze-on-backup.' });
  for (const d of out.disks) {
    if (d.cdrom) continue;
    if (d.bus === 'scsi' && !d.iothread && /virtio-scsi/.test(out.scsihw ?? '')) w.push({ severity: 'info', title: `${d.key}: IO thread off`, advice: 'With virtio-scsi-single, iothread=1 gives each disk its own IO thread.' });
    if (d.bus === 'ide' || d.bus === 'sata') w.push({ severity: 'info', title: `${d.key}: emulated ${d.bus.toUpperCase()} disk`, advice: 'VirtIO (scsi/virtio) is much faster; needs the virtio-win drivers on Windows.' });
    if (d.cache === 'unsafe') w.push({ severity: 'warn', title: `${d.key}: cache=unsafe`, advice: 'Data can be lost if the host crashes; use none or writeback.' });
    if (!d.backup) w.push({ severity: 'info', title: `${d.key}: excluded from backups`, advice: 'backup=0 means vzdump skips this disk.' });
  }
  for (const n of out.nics) {
    if (/^(e1000|rtl8139)/.test(n.model)) w.push({ severity: 'info', title: `${n.key}: emulated ${n.model} NIC`, advice: 'virtio is faster; Windows needs the virtio-win NetKVM driver.' });
    if (n.linkDown) w.push({ severity: 'warn', title: `${n.key}: link is disconnected`, advice: 'link_down=1 is set; the guest has no network on this NIC.' });
  }
  return out;
}

async function guard(req: { user?: { username: string }; ip: string }, g: Guest, action: string, extra: Record<string, unknown> = {}) {
  const base = { ts: new Date(), user: req.user!.username, ip: req.ip, vmid: g.vmid, name: g.name, action };
  if (g.protected) {
    await col.audit().insertOne({ ...base, result: 'refused', reason: 'PROTECTED' });
    throw new HttpError(403, 'PROTECTED', `Guest ${g.vmid} (${g.name}) is protected`);
  }
  return async (taskId?: string, error?: string) => {
    await col.audit().insertOne({ ...base, ...extra, result: error ? 'error' : 'accepted', ...(taskId ? { taskId } : {}), ...(error ? { reason: error } : {}) } as never);
  };
}

async function run(done: (t?: string, e?: string) => Promise<void>, fn: () => Promise<string | null>) {
  try {
    const taskId = await fn();
    await done(taskId ?? undefined);
    return { taskId };
  } catch (e) {
    await done(undefined, (e as Error).message);
    throw e;
  }
}

export function registerQemu(app: FastifyInstance) {
  const qemuGuest = async (v: string) => {
    const g = await findGuest(v);
    if (g.type !== 'qemu') throw new HttpError(400, 'UNSUPPORTED', 'Only available for virtual machines');
    return g;
  };

  app.get<{ Params: { vmid: string } }>('/api/guests/:vmid/qemu/devices', async (req) => {
    const g = await qemuGuest(req.params.vmid);
    return parseDevices(await pve<Record<string, unknown>>('GET', `${guestPath(g)}/config`));
  });

  // Backups of this guest across every storage that holds backups.
  app.get<{ Params: { vmid: string } }>('/api/guests/:vmid/backups', async (req) => {
    const g = await findGuest(req.params.vmid);
    const stores = (await pve<any[]>('GET', `${node()}/storage?content=backup`)).filter((s) => s.active !== 0 && s.enabled !== 0);
    const rows = await Promise.all(stores.map(async (s) => {
      try {
        const items = await pve<any[]>('GET', `${node()}/storage/${encodeURIComponent(s.storage)}/content?content=backup&vmid=${g.vmid}`);
        return items.map((i) => ({ volid: String(i.volid), storage: String(s.storage), size: Number(i.size ?? 0), time: Number(i.ctime ?? 0), format: String(i.format ?? ''), notes: i.notes ? String(i.notes) : '', protected: !!i.protected }));
      } catch { return []; }
    }));
    return { storages: stores.map((s) => String(s.storage)), backups: rows.flat().sort((a, b) => b.time - a.time) };
  });

  app.post<{ Params: { vmid: string }; Body: { storage?: string; mode?: string } }>('/api/guests/:vmid/backup', async (req) => {
    const g = await findGuest(req.params.vmid);
    const done = await guard(req, g, 'backup');
    const storage = String(req.body?.storage ?? '');
    const mode = req.body?.mode ?? 'snapshot';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(storage)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid storage');
    if (!['snapshot', 'suspend', 'stop'].includes(mode)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid mode');
    return run(done, () => pve<string>('POST', `${node()}/vzdump`, { vmid: String(g.vmid), storage, mode, compress: 'zstd' }));
  });

  app.post<{ Params: { vmid: string }; Body: { name?: string; description?: string; vmstate?: boolean } }>('/api/guests/:vmid/snapshots', async (req) => {
    const g = await findGuest(req.params.vmid);
    const name = String(req.body?.name ?? '');
    if (!SNAP_NAME.test(name)) throw new HttpError(400, 'BAD_REQUEST', 'Snapshot name must start with a letter and use only letters, digits, - and _ (max 40)');
    const done = await guard(req, g, 'snapshot-create');
    const form: Record<string, string> = { snapname: name };
    if (req.body?.description) form.description = String(req.body.description).slice(0, 200);
    if (req.body?.vmstate && g.type === 'qemu' && g.status === 'running') form.vmstate = '1';
    return run(done, () => pve<string>('POST', `${guestPath(g)}/snapshot`, form));
  });

  app.post<{ Params: { vmid: string; name: string }; Body: { confirm?: string } }>('/api/guests/:vmid/snapshots/:name/rollback', async (req) => {
    const g = await findGuest(req.params.vmid);
    const name = req.params.name;
    if (!SNAP_NAME.test(name)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid snapshot name');
    if (req.body?.confirm !== name) throw new HttpError(400, 'CONFIRM_REQUIRED', 'Type the snapshot name to confirm the rollback');
    const done = await guard(req, g, 'snapshot-rollback');
    return run(done, () => pve<string>('POST', `${guestPath(g)}/snapshot/${name}/rollback`));
  });

  app.delete<{ Params: { vmid: string; name: string } }>('/api/guests/:vmid/snapshots/:name', async (req) => {
    const g = await findGuest(req.params.vmid);
    const name = req.params.name;
    if (!SNAP_NAME.test(name)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid snapshot name');
    const done = await guard(req, g, 'snapshot-delete');
    return run(done, () => pve<string>('DELETE', `${guestPath(g)}/snapshot/${name}`));
  });

  app.post<{ Params: { vmid: string }; Body: { key?: string } }>('/api/guests/:vmid/qemu/sendkey', async (req) => {
    const g = await qemuGuest(req.params.vmid);
    const key = KEYS[String(req.body?.key ?? '')];
    if (!key) throw new HttpError(400, 'BAD_REQUEST', `key must be one of: ${Object.keys(KEYS).join(', ')}`);
    if (g.status !== 'running') throw new HttpError(409, 'NOT_RUNNING', `${g.name} is not running`);
    const done = await guard(req, g, `sendkey-${req.body!.key}`);
    return run(done, async () => { await pve<unknown>('PUT', `${guestPath(g)}/sendkey`, { key }); return null; });
  });
}
