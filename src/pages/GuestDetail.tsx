import { useState } from 'react';
import { api } from '../api';
import { Async, Badge, Card, CardHead, Chips, EmptyState, HoldButton, Icon, Menu, Meter, Modal, PageHeader, Spinner } from '../components/ui';
import type { IconName } from '../components/ui';
import { KV, RrdCard, TaskTable, TimeframePicker } from '../components/Pve';
import { fmtBytes, fmtPct, fmtUptime, sleep } from '../format';
import { useGuestEvents, useQuery, useToast } from '../hooks';
import type { ConfigRow, GuestAction, GuestStatusDetail, Timeframe } from '../types';

type Tab = 'summary' | 'hardware' | 'options' | 'snapshots' | 'tasks';
const VERB: Record<GuestAction, string> = { start: 'Start', shutdown: 'Shutdown', stop: 'Stop', reboot: 'Reboot', reset: 'Reset', suspend: 'Pause', resume: 'Resume' };
const EXPLAIN: Partial<Record<GuestAction, string>> = {
  shutdown: 'The guest will be asked to shut down gracefully.',
  stop: 'Stop cuts power immediately and may corrupt data inside the guest. Prefer a graceful shutdown.',
  reboot: 'The guest will be restarted gracefully.',
  reset: 'Reset is a hard power cycle, like pressing the reset button. Unsaved data inside the guest is lost.',
  suspend: 'The VM is frozen in memory until you resume it.',
};
// Config keys that describe hardware (the rest are options), as in the PVE Hardware panel.
const HW = /^(memory|balloon|cores|sockets|cpu|cpulimit|cpuunits|vcpus|numa|bios|machine|scsihw|swap|rootfs|mp\d+|(ide|sata|scsi|virtio|efidisk|tpmstate|unused)\d+|net\d+|hostpci\d+|usb\d+|serial\d+|audio\d+|vga|rng\d+|arch)$/;

export default function GuestDetail({ vmid, tab: initial }: { vmid: number; tab?: string }) {
  const [tab, setTab] = useState<Tab>((['summary', 'hardware', 'options', 'snapshots', 'tasks'].includes(initial ?? '') ? initial : 'summary') as Tab);
  const st = useQuery(() => api.guestStatus(vmid), [vmid], 4000);
  const cfg = useQuery(() => api.guestConfig(vmid), [vmid], 30_000);
  const toast = useToast();
  const [busy, setBusy] = useState<GuestAction | null>(null);
  const [confirm, setConfirm] = useState<GuestAction | null>(null);
  useGuestEvents((e) => { if (e.vmid === vmid) st.reload(); });

  const g = st.data;
  const go = (t: Tab) => { setTab(t); history.replaceState(null, '', `#/guests/${vmid}/${t}`); };

  async function run(action: GuestAction) {
    if (!g) return;
    setBusy(action);
    try {
      const { taskId } = await api.guestAction(vmid, action);
      for (let i = 0; i < 180; i++) {
        await sleep(1000);
        const t = await api.task(taskId);
        if (t.status === 'error') throw new Error(t.message || 'Task failed');
        if (t.status === 'ok') { toast.success(`${g.name}: ${VERB[action].toLowerCase()} completed`); return; }
      }
      throw new Error('Timed out waiting for the task');
    } catch (e) {
      toast.error(`${g.name}: ${VERB[action].toLowerCase()} failed — ${(e as Error).message}`);
    } finally {
      setBusy(null);
      st.reload();
    }
  }

  const ask = (a: GuestAction) => (a === 'start' || a === 'resume' ? run(a) : setConfirm(a));

  return (
    <>
      <PageHeader eyebrow={`Datacenter / ${g?.type === 'qemu' ? 'Virtual machine' : g ? 'Container' : 'Guest'} ${vmid}`}
        title={g?.name ?? `Guest ${vmid}`}
        actions={g && <PowerBar g={g} busy={busy} onAction={ask} />} />
      {g && (
        <div className="guest-strip">
          <Badge tone={g.status === 'running' ? 'green' : g.status === 'paused' ? 'amber' : 'gray'} dot>{busy ? <><Spinner size={10} />{VERB[busy]}…</> : g.status}</Badge>
          <Badge tone={g.type === 'qemu' ? 'blue' : 'gray'}>{g.type === 'qemu' ? 'QEMU VM' : 'LXC container'}</Badge>
          {g.protected && <Badge tone="violet"><Icon name="lock" size={11} />Protected</Badge>}
          {g.lock && <Badge tone="amber"><Icon name="lock" size={11} />Locked: {g.lock}</Badge>}
          {g.haManaged && <Badge tone="blue">HA managed</Badge>}
          {g.tags.map((t) => <em key={t} className="tag">{t}</em>)}
          {cfg.data?.some((r) => r.pending !== null || r.delete) && <a className="link small" onClick={() => go('hardware')}>Pending changes apply on next restart</a>}
        </div>
      )}
      <Chips value={tab} onChange={go} options={[
        { id: 'summary', label: 'Summary' }, { id: 'hardware', label: g?.type === 'lxc' ? 'Resources' : 'Hardware' }, { id: 'options', label: 'Options' },
        { id: 'snapshots', label: 'Snapshots' }, { id: 'tasks', label: 'Task history' },
      ]} />
      {st.data === undefined && st.error ? (
        <Card><EmptyState icon="alert" title="Couldn't load this guest" hint={st.error.message} action={<a className="btn" href="#/guests">Back to guests</a>} /></Card>
      ) : (
        <>
          {tab === 'summary' && <Summary vmid={vmid} g={g} cfg={cfg.data} />}
          {(tab === 'hardware' || tab === 'options') && (
            <Async q={cfg} rows={8} h={36} isEmpty={(d) => d.length === 0} empty={{ title: 'No configuration' }}>
              {(rows) => <ConfigTable rows={rows.filter((r) => (tab === 'hardware') === HW.test(r.key))} />}
            </Async>
          )}
          {tab === 'snapshots' && <Snapshots vmid={vmid} />}
          {tab === 'tasks' && <GuestTasks vmid={vmid} />}
        </>
      )}

      {confirm && g && (
        <Modal title={`${VERB[confirm]} ${g.name}?`} onClose={() => setConfirm(null)} footer={
          <>
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <HoldButton danger={confirm === 'stop' || confirm === 'reset'} onConfirm={() => { const a = confirm; setConfirm(null); run(a); }}>{VERB[confirm]}</HoldButton>
          </>
        }>
          <p className="muted">{EXPLAIN[confirm]}</p>
        </Modal>
      )}
    </>
  );
}

function PowerBar({ g, busy, onAction }: { g: GuestStatusDetail; busy: GuestAction | null; onAction: (a: GuestAction) => void }) {
  const dis = g.protected || !!busy;
  const run = g.status === 'running', paused = g.status === 'paused', vm = g.type === 'qemu';
  const more: { label: string; icon: IconName; danger?: boolean; onClick: () => void }[] = [];
  if (run) more.push({ label: 'Reboot', icon: 'rotate', onClick: () => onAction('reboot') });
  if (run && vm) more.push({ label: 'Pause', icon: 'pause', onClick: () => onAction('suspend') });
  if (run && vm) more.push({ label: 'Reset', icon: 'refresh', danger: true, onClick: () => onAction('reset') });
  if (run || paused) more.push({ label: 'Stop', icon: 'stop', danger: true, onClick: () => onAction('stop') });
  return (
    <div className="powerbar">
      {paused ? <button className="btn btn-primary" disabled={dis} onClick={() => onAction('resume')}><Icon name="play" size={15} />Resume</button>
        : <button className="btn btn-primary" disabled={dis || run} onClick={() => onAction('start')}><Icon name="play" size={15} />Start</button>}
      <button className="btn" disabled={dis || !run} onClick={() => onAction('shutdown')}><Icon name="power" size={15} />Shutdown</button>
      <Menu label="More power actions" disabled={dis || !more.length} items={more} />
    </div>
  );
}

function Summary({ vmid, g, cfg }: { vmid: number; g?: GuestStatusDetail; cfg?: ConfigRow[] }) {
  const [tf, setTf] = useState<Timeframe>('hour');
  const rrd = useQuery(() => api.guestRrd(vmid, tf), [vmid, tf], 60_000);
  const on = g?.status === 'running';
  const val = (k: string) => cfg?.find((r) => r.key === k)?.value ?? null;
  const net = cfg?.filter((r) => /^net\d+$/.test(r.key)).map((r) => {
    const ip = /ip=([^,]+)/.exec(r.value ?? '')?.[1];
    const br = /bridge=([^,]+)/.exec(r.value ?? '')?.[1];
    return `${r.key}${br ? ` → ${br}` : ''}${ip ? ` (${ip})` : ''}`;
  }) ?? [];
  return (
    <>
      {g && (
        <div className="grid-3">
          <Card>
            <CardHead title="Status" sub={on ? `Up ${fmtUptime(g.uptime)}` : g.status} />
            <div className="res">
              <Res label="CPU usage" pct={on ? g.cpu : 0} text={on ? `${fmtPct(g.cpu, 1)} of ${g.cpus} CPU${g.cpus === 1 ? '' : 's'}` : `${g.cpus} CPUs`} />
              <Res label="Memory" pct={on && g.memMax ? g.memUsed / g.memMax : 0} text={on ? `${fmtBytes(g.memUsed)} / ${fmtBytes(g.memMax)}` : fmtBytes(g.memMax)} />
              {g.diskMax > 0 && <Res label={g.type === 'lxc' ? 'Bootdisk' : 'Disk'} pct={g.diskUsed / g.diskMax} text={g.diskUsed ? `${fmtBytes(g.diskUsed)} / ${fmtBytes(g.diskMax)}` : fmtBytes(g.diskMax)} />}
              {g.swapMax > 0 && <Res label="Swap" pct={g.swapUsed / g.swapMax} text={`${fmtBytes(g.swapUsed)} / ${fmtBytes(g.swapMax)}`} />}
            </div>
          </Card>
          <Card>
            <CardHead title="Details" />
            <KV rows={[
              ['VMID', g.vmid],
              ['OS type', val('ostype') ?? '–'],
              ['Start at boot', val('onboot') === '1' ? 'Yes' : 'No'],
              ['Network', net.length ? net.map((n) => <div key={n} className="mono">{n}</div>) : '–'],
              ...(g.type === 'qemu' ? [['Guest agent', g.agent ? 'Enabled' : 'Disabled'] as [string, string], ['Machine', g.runningMachine ?? val('machine') ?? 'default'] as [string, string]] : []),
              ...(g.pid ? [['PID', g.pid] as [string, number]] : []),
            ]} />
          </Card>
          <Card>
            <CardHead title="I/O since start" />
            <KV rows={[
              ['Network in', fmtBytes(g.netIn)], ['Network out', fmtBytes(g.netOut)],
              ['Disk read', fmtBytes(g.diskRead)], ['Disk write', fmtBytes(g.diskWrite)],
            ]} />
            {val('description') && <p className="notes">{decodeURIComponent(val('description')!)}</p>}
          </Card>
        </div>
      )}
      <div className="toolbar"><span className="section-label grow">Performance</span><TimeframePicker value={tf} onChange={setTf} /></div>
      <div className="rrd-grid">
        <RrdCard title="CPU usage" q={rrd} unit="%" lines={[{ name: 'CPU', key: 'cpu', scale: 100 }]} />
        <RrdCard title="Memory usage" q={rrd} unit="B" lines={[{ name: 'Total', key: 'maxmem' }, { name: 'Used', key: 'mem' }]} />
        <RrdCard title="Network traffic" q={rrd} unit="B/s" lines={[{ name: 'In', key: 'netin' }, { name: 'Out', key: 'netout' }]} />
        <RrdCard title="Disk I/O" q={rrd} unit="B/s" lines={[{ name: 'Read', key: 'diskread' }, { name: 'Write', key: 'diskwrite' }]} />
      </div>
    </>
  );
}

function Res({ label, pct, text }: { label: string; pct: number; text: string }) {
  return (
    <div className="res-row">
      <div className="res-top"><span>{label}</span><b>{text}</b></div>
      <Meter value={pct} />
    </div>
  );
}

function ConfigTable({ rows }: { rows: ConfigRow[] }) {
  if (!rows.length) return <Card><EmptyState title="Nothing configured here" /></Card>;
  return (
    <div className="card table">
      <div className="dt-row dt-cfg g-head"><span>Key</span><span>Value</span></div>
      {rows.map((r) => {
        const changed = r.pending !== null || r.delete;
        return (
          <div key={r.key} className={`dt-row dt-cfg ${changed ? 'pending' : ''}`}>
            <span><b className="mono">{r.key}</b></span>
            <span className="cfg-val">
              <span className={`mono ${changed ? 'old' : ''}`}>{r.value ?? '–'}</span>
              {r.pending !== null && <span className="mono new">→ {r.pending}</span>}
              {r.delete && <Badge tone="red">removed on restart</Badge>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Snapshots({ vmid }: { vmid: number }) {
  const q = useQuery(() => api.snapshots(vmid), [vmid], 30_000);
  return (
    <Async q={q} rows={3} h={44}>
      {(list) => {
        const snaps = list.filter((s) => !s.current);
        if (!snaps.length) return <Card><EmptyState icon="camera" title="No snapshots" hint="This guest has no snapshots. Only the current state exists." /></Card>;
        // Walk the parent chain so the list reads oldest → newest → "NOW", like the PVE tree.
        const depth = (s: { parent: string | null }): number => { let d = 0, p = s.parent; while (p && d < 50) { d++; p = list.find((x) => x.name === p)?.parent ?? null; } return d; };
        const ordered = [...list].sort((a, b) => depth(a) - depth(b));
        return (
          <div className="card table">
            <div className="dt-row dt-snap g-head"><span>Name</span><span>RAM</span><span>Date</span><span>Description</span></div>
            {ordered.map((s) => (
              <div key={s.name} className="dt-row dt-snap">
                <span style={{ paddingLeft: depth(s) * 16 }}><b>{s.current ? 'NOW' : s.name}</b></span>
                <span>{s.vmstate ? <Badge tone="blue">RAM</Badge> : <span className="muted">–</span>}</span>
                <span className="muted">{s.time ? new Date(s.time * 1000).toLocaleString() : '–'}</span>
                <span className="muted">{s.current ? 'You are here' : s.description || '–'}</span>
              </div>
            ))}
          </div>
        );
      }}
    </Async>
  );
}

function GuestTasks({ vmid }: { vmid: number }) {
  const q = useQuery(() => api.tasks({ vmid, limit: 50 }), [vmid], 10_000);
  return <TaskTable q={q} compact />;
}
