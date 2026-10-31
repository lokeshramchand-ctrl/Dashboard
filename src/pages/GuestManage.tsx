import { useEffect, useState } from 'react';
import { api } from '../api';
import { Async, Badge, Card, CardHead, EmptyState, Icon, Meter, Modal } from '../components/ui';
import { KV } from '../components/Pve';
import { fmtBytes } from '../format';
import { useQuery, useToast } from '../hooks';
import { waitTask } from './GuestQemu';

/** Windows/QEMU day-to-day management: agent facts, resources, installation media, NICs, clone. */
export default function GuestManage({ vmid, running, protectedGuest }: { vmid: number; running: boolean; protectedGuest: boolean }) {
  return (
    <>
      {protectedGuest && <div className="stale"><Icon name="lock" size={14} />This guest is protected: changes are disabled.</div>}
      <AgentCard vmid={vmid} running={running} />
      <Resources vmid={vmid} locked={protectedGuest} />
      <Media vmid={vmid} locked={protectedGuest} />
      <Nics vmid={vmid} locked={protectedGuest} />
      <CloneCard vmid={vmid} locked={protectedGuest} />
    </>
  );
}

function AgentCard({ vmid, running }: { vmid: number; running: boolean }) {
  const q = useQuery(() => api.vmAgent(vmid), [vmid, running], 30_000);
  return (
    <>
      <span className="section-label">Inside the guest</span>
      <Async q={q} rows={3} h={48}>
        {(a) => !a.available ? (
          <Card><EmptyState icon="server" title="Guest agent unavailable" hint={a.reason} /></Card>
        ) : (
          <div className="grid-3">
            <Card>
              <CardHead title="System" sub={<Badge tone="green" dot>agent online</Badge>} />
              <KV rows={[['Hostname', a.hostname ?? '–'], ['OS', a.os?.name ?? '–'], ['Version', a.os?.version ?? '–'], ['Build', a.os?.build ?? '–'], ['Arch', a.os?.arch ?? '–'], ['Clock', a.guestTime ? new Date(a.guestTime * 1000).toLocaleString() : '–']]} />
            </Card>
            <Card>
              <CardHead title="Addresses" />
              {(a.interfaces ?? []).length === 0 ? <p className="muted">No interfaces reported.</p> : (a.interfaces ?? []).map((n) => (
                <div key={n.name} className="mg-nic">
                  <b>{n.name}</b><span className="muted small">{n.mac ?? ''}</span>
                  {n.ips.filter((i) => !i.v6).map((i) => <code key={i.ip} className="ip">{i.ip}/{i.prefix}</code>)}
                </div>
              ))}
            </Card>
            <Card>
              <CardHead title="Volumes" />
              {(a.volumes ?? []).length === 0 ? <p className="muted">No volumes reported.</p> : (a.volumes ?? []).map((v) => (
                <div key={v.mount} className="mg-vol">
                  <div><b>{v.mount}</b> <span className="muted small">{v.type}</span><span className="muted small grow-r">{fmtBytes(v.used)} / {fmtBytes(v.total)}</span></div>
                  <Meter value={v.total ? v.used / v.total : 0} />
                </div>
              ))}
            </Card>
          </div>
        )}
      </Async>
    </>
  );
}

function Resources({ vmid, locked }: { vmid: number; locked: boolean }) {
  const q = useQuery(() => api.guestConfig(vmid), [vmid], 0);
  const toast = useToast();
  const [f, setF] = useState({ name: '', cores: 1, memoryMb: 1024, balloonMb: 0, onboot: false, agent: false, description: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    const g = (k: string) => q.data!.find((r) => r.key === k)?.value ?? null;
    setF({
      name: g('name') ?? '', cores: Number(g('cores') ?? 1), memoryMb: Number(g('memory') ?? 1024), balloonMb: Number(g('balloon') ?? 0),
      onboot: g('onboot') === '1', agent: /(^|,)enabled=1|^1/.test(g('agent') ?? ''), description: g('description') ?? '',
    });
  }, [q.data]);
  async function save() {
    setBusy(true);
    try { await api.vmConfig(vmid, f); toast.success('Saved. CPU and memory changes apply after a restart.'); q.reload(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <>
      <span className="section-label">Resources &amp; options</span>
      <Async q={q} rows={2} h={52}>
        {() => (
          <Card>
            <div className="form-grid">
              <label>Name<input className="input" value={f.name} maxLength={63} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={locked} /></label>
              <label>CPU cores<input className="input" type="number" min={1} max={128} value={f.cores} onChange={(e) => setF({ ...f, cores: Number(e.target.value) })} disabled={locked} /></label>
              <label>Memory (MB)<input className="input" type="number" min={512} step={512} value={f.memoryMb} onChange={(e) => setF({ ...f, memoryMb: Number(e.target.value) })} disabled={locked} /></label>
              <label>Balloon min (MB, 0 = off)<input className="input" type="number" min={0} step={512} value={f.balloonMb} onChange={(e) => setF({ ...f, balloonMb: Number(e.target.value) })} disabled={locked} /></label>
              <label className="span-2">Notes<textarea className="input" rows={2} maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} disabled={locked} /></label>
            </div>
            <div className="toolbar">
              <label className="tgl"><input type="checkbox" checked={f.onboot} onChange={(e) => setF({ ...f, onboot: e.target.checked })} disabled={locked} /><i />Start at host boot</label>
              <label className="tgl"><input type="checkbox" checked={f.agent} onChange={(e) => setF({ ...f, agent: e.target.checked })} disabled={locked} /><i />QEMU guest agent</label>
              <span className="grow" />
              <button className="btn btn-primary" disabled={locked || busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
            </div>
          </Card>
        )}
      </Async>
    </>
  );
}

function Media({ vmid, locked }: { vmid: number; locked: boolean }) {
  const q = useQuery(() => api.vmIsos(vmid), [vmid], 0);
  const toast = useToast();
  const [busy, setBusy] = useState('');
  async function set(slot: string, iso: string | null) {
    setBusy(slot);
    try { await api.vmMedia(vmid, slot, iso); toast.success(iso ? 'ISO mounted' : 'Disc ejected'); q.reload(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(''); }
  }
  return (
    <>
      <span className="section-label">Installation media</span>
      <Async q={q} rows={1} h={52}>
        {(d) => d.drives.length === 0 ? (
          <Card><EmptyState icon="disk" title="No CD/DVD drive" hint="Add a CD/DVD drive in Proxmox to mount an ISO (for example the virtio-win driver disc)." /></Card>
        ) : (
          <Card>
            {d.drives.map((dr) => (
              <div key={dr.slot} className="toolbar">
                <b style={{ width: 54 }}>{dr.slot}</b>
                <select className="input grow" value={dr.volid ?? ''} disabled={locked || busy === dr.slot} onChange={(e) => set(dr.slot, e.target.value || null)}>
                  <option value="">Empty (ejected)</option>
                  {dr.volid && !d.isos.some((i) => i.volid === dr.volid) && <option value={dr.volid}>{dr.volid}</option>}
                  {d.isos.map((i) => <option key={i.volid} value={i.volid}>{i.name} · {fmtBytes(i.size)}</option>)}
                </select>
                <button className="btn" disabled={locked || !dr.volid || busy === dr.slot} onClick={() => set(dr.slot, null)}><Icon name="eject" size={15} />Eject</button>
              </div>
            ))}
          </Card>
        )}
      </Async>
    </>
  );
}

function Nics({ vmid, locked }: { vmid: number; locked: boolean }) {
  const q = useQuery(() => api.qemuDevices(vmid), [vmid], 0);
  const toast = useToast();
  async function toggle(key: string, linkDown: boolean) {
    try { await api.vmNic(vmid, key, linkDown); toast.success(linkDown ? `${key} disconnected` : `${key} connected`); q.reload(); } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <>
      <span className="section-label">Virtual network cables</span>
      <Async q={q} rows={1} h={52}>
        {(d) => d.nics.length === 0 ? <Card><EmptyState icon="network" title="No network adapters" /></Card> : (
          <Card>
            {d.nics.map((n) => (
              <div key={n.key} className="toolbar">
                <b style={{ width: 54 }}>{n.key}</b>
                <span className="grow muted">{n.bridge ?? '–'}{n.vlan ? ` · vlan ${n.vlan}` : ''} · {n.model}</span>
                <Badge tone={n.linkDown ? 'amber' : 'green'} dot>{n.linkDown ? 'unplugged' : 'connected'}</Badge>
                <button className="btn" disabled={locked} onClick={() => toggle(n.key, !n.linkDown)}>{n.linkDown ? 'Plug in' : 'Unplug'}</button>
              </div>
            ))}
          </Card>
        )}
      </Async>
    </>
  );
}

function CloneCard({ vmid, locked }: { vmid: number; locked: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?$/.test(name);
  async function clone() {
    setBusy(true);
    try { const { taskId } = await api.vmClone(vmid, name); await waitTask(taskId); toast.success(`Cloned to ${name}`); setOpen(false); } catch (e) { toast.error(`Clone failed: ${(e as Error).message}`); } finally { setBusy(false); }
  }
  return (
    <>
      <span className="section-label">Clone</span>
      <Card>
        <div className="toolbar">
          <span className="muted grow">Makes a full, independent copy of this VM with a new id. Run it on a stopped or snapshot-able disk.</span>
          <button className="btn" disabled={locked} onClick={() => setOpen(true)}><Icon name="copy" size={15} />Clone VM…</button>
        </div>
      </Card>
      {open && (
        <Modal title="Clone this VM" onClose={() => setOpen(false)} footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!valid || busy} onClick={clone}>{busy ? 'Cloning…' : 'Clone'}</button></>}>
          <label>New VM name<input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="windows-test" /></label>
          <p className="muted small">Letters, digits and hyphens only.</p>
        </Modal>
      )}
    </>
  );
}
