import { useState } from 'react';
import { api } from '../api';
import { Async, Badge, Card, CardHead, EmptyState, HoldButton, Icon } from '../components/ui';
import { KV } from '../components/Pve';
import { fmtBytes, sleep } from '../format';
import { useQuery, useToast } from '../hooks';
import type { QemuDevices } from '../types';

const KEYS: [string, string][] = [['ctrl-alt-delete', 'Ctrl+Alt+Del'], ['esc', 'Esc'], ['alt-f4', 'Alt+F4'], ['win', 'Win key']];

/** Wait for a Proxmox task; resolves on success, throws with its message on failure. */
export async function waitTask(taskId: string) {
  for (let i = 0; i < 600; i++) {
    await sleep(1000);
    const t = await api.task(taskId);
    if (t.status === 'error') throw new Error(t.message || 'Task failed');
    if (t.status === 'ok') return;
  }
  throw new Error('Timed out waiting for the task');
}

export default function GuestQemu({ vmid, running }: { vmid: number; running: boolean }) {
  const dev = useQuery(() => api.qemuDevices(vmid), [vmid], 60_000);
  return (
    <>
      <Async q={dev} rows={4} h={60}>{(d) => <Devices d={d} />}</Async>
      <Backups vmid={vmid} />
      <Keys vmid={vmid} running={running} />
    </>
  );
}

function Devices({ d }: { d: QemuDevices }) {
  return (
    <>
      <div className="grid-3">
        <Card>
          <CardHead title="Platform" />
          <KV rows={[
            ['Machine', d.machine ?? 'default (i440fx)'], ['Firmware', d.bios === 'ovmf' ? `UEFI (OVMF)${d.efi ? '' : ' – no EFI disk'}` : 'SeaBIOS'],
            ['CPU', `${d.cpu} · ${d.sockets}×${d.cores}`], ['Memory', `${fmtBytes(d.memoryMb * 1048576)}${d.balloonMb === 0 ? ' (ballooning off)' : ''}`],
            ['TPM', d.tpm ? 'present' : 'none'], ['Guest agent', d.agent ? 'enabled' : 'off'], ['OS type', d.ostype ?? '–'],
          ]} />
        </Card>
        <Card className="span-2">
          <CardHead title="Health" sub={d.warnings.length ? `${d.warnings.length} suggestion${d.warnings.length === 1 ? '' : 's'}` : undefined} />
          {d.warnings.length === 0 ? <p className="muted">Configuration looks sound.</p> : d.warnings.map((w, i) => (
            <div key={i} className="qemu-warn">
              <Badge tone={w.severity === 'warn' ? 'amber' : 'gray'}>{w.severity === 'warn' ? 'check' : 'tip'}</Badge>
              <div><b>{w.title}</b><div className="muted small">{w.advice}</div></div>
            </div>
          ))}
        </Card>
      </div>

      <span className="section-label">Disks</span>
      <div className="card table">
        <div className="dt-row dt-hw g-head"><span>Slot</span><span>Volume</span><span>Size</span><span>Options</span></div>
        {d.disks.map((x) => (
          <div key={x.key} className="dt-row dt-hw">
            <span><b>{x.key}</b></span>
            <span title={x.volume}>{x.storage ? `${x.storage}:` : ''}{x.volume}</span>
            <span className="muted">{x.cdrom ? 'CD-ROM' : x.size ?? '–'}</span>
            <span>{[x.iothread && 'iothread', x.discard && 'discard', x.ssd && 'ssd', x.cache && `cache=${x.cache}`, !x.backup && 'no backup'].filter(Boolean).join(' · ') || <span className="muted">–</span>}</span>
          </div>
        ))}
      </div>

      <span className="section-label">Network</span>
      <div className="card table">
        <div className="dt-row dt-hw g-head"><span>Slot</span><span>MAC</span><span>Model</span><span>Bridge</span></div>
        {d.nics.map((x) => (
          <div key={x.key} className="dt-row dt-hw">
            <span><b>{x.key}</b></span><span>{x.mac ?? '–'}</span><span className="muted">{x.model}</span>
            <span>{x.bridge ?? '–'}{x.vlan ? ` · vlan ${x.vlan}` : ''}{x.firewall ? ' · fw' : ''}{x.linkDown ? ' · link down' : ''}</span>
          </div>
        ))}
      </div>

      {(d.pci.length > 0 || d.usb.length > 0) && (
        <>
          <span className="section-label">Passthrough</span>
          <div className="card table">
            <div className="dt-row dt-hw g-head"><span>Slot</span><span>Device</span><span>Mode</span><span>Flags</span></div>
            {d.pci.map((x) => (
              <div key={x.key} className="dt-row dt-hw">
                <span><b>{x.key}</b></span><span>{x.device}</span><span className="muted">{x.pcie ? 'PCIe' : 'PCI'}</span>
                <span>{[x.xvga && 'primary GPU', !x.romBar && 'no ROM bar', x.mapping && 'mapped'].filter(Boolean).join(' · ') || <span className="muted">–</span>}</span>
              </div>
            ))}
            {d.usb.map((x) => (
              <div key={x.key} className="dt-row dt-hw"><span><b>{x.key}</b></span><span>{x.value}</span><span className="muted">USB</span><span className="muted">–</span></div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Backups({ vmid }: { vmid: number }) {
  const q = useQuery(() => api.backups(vmid), [vmid], 60_000);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState('');
  async function backup(s: string) {
    setBusy(true);
    try {
      const { taskId } = await api.backupNow(vmid, s);
      await waitTask(taskId);
      toast.success('Backup finished');
    } catch (e) { toast.error(`Backup failed: ${(e as Error).message}`); } finally { setBusy(false); q.reload(); }
  }
  return (
    <>
      <span className="section-label">Backups</span>
      <Async q={q} rows={2} h={44}>
        {(d) => (
          <>
            <div className="toolbar">
              <span className="muted grow">{d.storages.length ? `Storages: ${d.storages.join(', ')}` : 'No backup storage is configured on this node.'}</span>
              {d.storages.length > 0 && (
                <>
                  {d.storages.length > 1 && <select className="input" style={{ width: 160, height: 36 }} value={storage || d.storages[0]} onChange={(e) => setStorage(e.target.value)}>{d.storages.map((s) => <option key={s}>{s}</option>)}</select>}
                  <HoldButton onConfirm={() => backup(storage || d.storages[0])}>{busy ? 'Backing up…' : 'Back up now'}</HoldButton>
                </>
              )}
            </div>
            {d.backups.length === 0 ? (
              <Card><EmptyState icon="inbox" title="No backups" hint="This VM has no vzdump backups on any backup storage." /></Card>
            ) : (
              <div className="card table">
                <div className="dt-row dt-bk g-head"><span>Volume</span><span>Size</span><span>Storage</span><span>Date</span></div>
                {d.backups.map((b) => (
                  <div key={b.volid} className="dt-row dt-bk">
                    <span title={b.volid}><b>{b.volid.split('/').pop()}</b>{b.protected && <> <Badge tone="violet"><Icon name="lock" size={11} />protected</Badge></>}</span>
                    <span>{fmtBytes(b.size)}</span><span className="muted">{b.storage}</span><span className="muted">{new Date(b.time * 1000).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Async>
    </>
  );
}

function Keys({ vmid, running }: { vmid: number; running: boolean }) {
  const toast = useToast();
  const send = async (k: string, label: string) => {
    try { await api.qemuSendKey(vmid, k); toast.success(`Sent ${label}`); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <>
      <span className="section-label">Send key to guest</span>
      <Card>
        <p className="muted small">Injected through the QEMU monitor, so it works even when the guest is hung on a login screen.{!running && ' The VM must be running.'}</p>
        <div className="toolbar">
          {KEYS.map(([k, label]) => (k === 'ctrl-alt-delete' ? <HoldButton key={k} onConfirm={() => send(k, label)}>{label}</HoldButton> : <button key={k} className="btn" disabled={!running} onClick={() => send(k, label)}>{label}</button>))}
        </div>
      </Card>
    </>
  );
}
