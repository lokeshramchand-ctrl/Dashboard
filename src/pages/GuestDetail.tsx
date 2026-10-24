import { Suspense, lazy, useState } from 'react';
import { api, waitTask } from '../api';
import { LineChart } from '../components/MetricChart';
import type { Series } from '../components/MetricChart';
import { Async, Badge, Card, CardHead, Chips, EmptyState, HoldButton, Icon, Meter, Modal, PageHeader, Spinner } from '../components/ui';
import { fmtBytes, fmtPct, fmtUptime, sleep } from '../format';
import { useGuestEvents, useQuery, useToast } from '../hooks';
import type { Guest, GuestAction, Timeframe } from '../types';
import Backups from './guest/Backups';
import Options from './guest/Options';
import Snapshots from './guest/Snapshots';
import Tasks from './guest/Tasks';

const Terminal = lazy(() => import('../components/Terminal').then((m) => ({ default: m.Terminal })));

export type Tab = 'summary' | 'console' | 'options' | 'snapshots' | 'backup' | 'tasks';
const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: 'Summary' }, { id: 'console', label: 'Console' }, { id: 'options', label: 'Resources & options' },
  { id: 'snapshots', label: 'Snapshots' }, { id: 'backup', label: 'Backup' }, { id: 'tasks', label: 'Tasks' },
];
const VERB: Record<GuestAction, string> = { start: 'Start', shutdown: 'Shutdown', stop: 'Force stop', reboot: 'Reboot' };
const WANT: Record<GuestAction, Guest['status'] | null> = { start: 'running', shutdown: 'stopped', stop: 'stopped', reboot: null };

/** Passed to tabs so every long-running Proxmox call reports the same way (toast + refresh). */
export type Track = (label: string, start: () => Promise<{ taskId: string }>, done?: () => void) => Promise<boolean>;

export default function GuestDetail({ vmid, tab }: { vmid: number; tab?: string }) {
  const q = useQuery(api.guests, [], 7000);
  const toast = useToast();
  const [pending, setPending] = useState<GuestAction | null>(null);
  const [confirm, setConfirm] = useState<GuestAction | null>(null);
  const [tasksKey, setTasksKey] = useState(0);
  const current: Tab = TABS.some((t) => t.id === tab) ? (tab as Tab) : 'summary';

  useGuestEvents((e) => q.mutate((list) => list.map((x) => (x.vmid === e.vmid ? { ...x, status: e.status } : x))));

  const track: Track = async (label, start, done) => {
    try {
      const { taskId } = await start();
      setTasksKey((n) => n + 1);
      await waitTask(taskId);
      toast.success(`${label} completed`);
      done?.();
      return true;
    } catch (e) {
      toast.error(`${label} failed — ${(e as Error).message}`);
      return false;
    } finally {
      setTasksKey((n) => n + 1);
      q.reload();
    }
  };

  async function power(g: Guest, action: GuestAction) {
    setPending(action);
    const ok = await track(`${g.name}: ${VERB[action].toLowerCase()}`, () => api.guestAction(g.vmid, action));
    if (ok) {
      const want = WANT[action];
      for (let i = 0; i < 20 && want; i++) {
        const list = await api.guests();
        q.mutate(() => list);
        if (list.find((x) => x.vmid === g.vmid)?.status === want) break;
        await sleep(1000);
      }
    }
    setPending(null);
  }

  return (
    <Async q={q} rows={4} h={70} isEmpty={(d) => !d.some((x) => x.vmid === vmid)} empty={{ title: `Guest ${vmid} not found`, hint: 'It may have been removed, or it is not allowed on this dashboard.' }}>
      {(list) => {
        const g = list.find((x) => x.vmid === vmid)!;
        const running = g.status === 'running';
        const locked = g.protected || !!pending;
        return (
          <>
            <a href="#/guests" className="back"><Icon name="back" size={16} />All guests</a>
            <PageHeader eyebrow={`${g.type === 'qemu' ? 'Virtual machine' : 'Container'} · #${g.vmid}`} title={g.name}
              sub={g.tags.length ? g.tags.join(' · ') : undefined}
              actions={
                <div className="power-row">
                  {pending ? <Badge tone="amber"><Spinner size={11} />{VERB[pending]}…</Badge>
                    : <Badge tone={running ? 'green' : g.status === 'paused' ? 'amber' : 'gray'} dot>{g.status}</Badge>}
                  {g.protected && <Badge tone="violet"><Icon name="lock" size={11} />Protected</Badge>}
                  <button className="btn btn-primary" disabled={locked || running} onClick={() => power(g, 'start')}><Icon name="power" size={15} />Start</button>
                  <button className="btn" disabled={locked || !running} onClick={() => setConfirm('shutdown')}>Shutdown</button>
                  <button className="btn" disabled={locked || !running} onClick={() => setConfirm('reboot')}><Icon name="rotate" size={15} />Reboot</button>
                  <button className="btn btn-danger" disabled={locked || !running} onClick={() => setConfirm('stop')}><Icon name="stop" size={15} />Stop</button>
                </div>
              } />

            <Chips value={current} onChange={(t) => { location.hash = `#/guests/${vmid}/${t}`; }} options={TABS} />

            <div className="tab-body">
              {current === 'summary' && <Summary g={g} />}
              {current === 'console' && <ConsoleTab g={g} />}
              {current === 'options' && <Options g={g} track={track} />}
              {current === 'snapshots' && <Snapshots g={g} track={track} />}
              {current === 'backup' && <Backups g={g} track={track} />}
              {current === 'tasks' && <Tasks g={g} refreshKey={tasksKey} />}
            </div>

            {confirm && (
              <Modal title={`${VERB[confirm]} ${g.name}?`} onClose={() => setConfirm(null)} footer={
                <>
                  <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
                  <HoldButton danger={confirm === 'stop'} onConfirm={() => { const a = confirm; setConfirm(null); void power(g, a); }}>{VERB[confirm]}</HoldButton>
                </>
              }>
                <p className="muted">
                  {confirm === 'stop' && 'Force stop cuts power immediately and may corrupt data inside the guest. Prefer a graceful shutdown.'}
                  {confirm === 'shutdown' && 'The guest will be asked to shut down gracefully. This can take a little while.'}
                  {confirm === 'reboot' && 'The guest will be restarted.'}
                </p>
              </Modal>
            )}
          </>
        );
      }}
    </Async>
  );
}

function ConsoleTab({ g }: { g: Guest }) {
  if (g.status !== 'running') return <Card><EmptyState icon="server" title={`${g.name} is not running`} hint="Start the guest to open a shell." /></Card>;
  if (g.protected) return <Card><EmptyState icon="lock" title="Protected guest" hint="Shell access is refused for protected guests." /></Card>;
  return (
    <>
      {g.type === 'qemu' && <div className="callout warn"><Icon name="alert" size={16} /><span>This opens the VM’s serial terminal. It only works if the VM has a serial port (<code>serial0: socket</code>) and a login prompt on it; graphical desktops such as Windows are not available here.</span></div>}
      <Suspense fallback={<div className="pad"><Spinner size={20} /></div>}><Terminal vmid={g.vmid} active /></Suspense>
    </>
  );
}

const TF: { id: Timeframe; label: string }[] = [
  { id: 'hour', label: 'Hour' }, { id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'year', label: 'Year' },
];

function Summary({ g }: { g: Guest }) {
  const [tf, setTf] = useState<Timeframe>('hour');
  const running = g.status === 'running';
  const rrd = useQuery(() => api.guestRrd(g.vmid, tf), [g.vmid, tf], 30_000);

  const line = (name: string, key: 'cpu' | 'mem' | 'netin' | 'netout' | 'diskread' | 'diskwrite', scale = 1): Series => ({
    name, points: (rrd.data ?? []).filter((r) => r[key] != null).map((r) => [r.time, (r[key] as number) * scale] as [number, number]),
  });
  const bytes = (v: number) => fmtBytes(v, v < 1024 ? 0 : 1);
  const chart = (title: string, series: Series[], unit: string, fmtValue?: (v: number) => string) => (
    <Card>
      <CardHead title={title} />
      {series.every((s) => s.points.length < 2)
        ? <EmptyState title="No data yet" hint="Proxmox has not recorded samples for this range." />
        : <LineChart series={series.filter((s) => s.points.length > 1)} unit={unit} height={200} fmtValue={fmtValue} />}
    </Card>
  );

  return (
    <>
      <div className="grid-3">
        <Card>
          <p className="eyebrow">CPU</p>
          <div className="big">{running ? fmtPct(g.cpu, 1) : '–'}</div>
          <Meter value={running ? g.cpu : 0} />
        </Card>
        <Card>
          <p className="eyebrow">Memory</p>
          <div className="big">{running ? fmtBytes(g.memUsed) : '–'}<small> / {fmtBytes(g.memMax, 0)}</small></div>
          <Meter value={running && g.memMax ? g.memUsed / g.memMax : 0} />
        </Card>
        <Card>
          <p className="eyebrow">Uptime</p>
          <div className="big">{running ? fmtUptime(g.uptime) : 'Powered off'}</div>
          <p className="muted small">{g.type === 'qemu' ? 'QEMU virtual machine' : 'LXC container'}</p>
        </Card>
      </div>

      <div className="toolbar">
        <h3 className="section-title">Performance</h3>
        <Chips value={tf} onChange={setTf} options={TF} />
      </div>
      <Async q={rrd} rows={2} h={200} isEmpty={(d) => d.length === 0} empty={{ title: 'No metrics yet', hint: 'Proxmox returned no samples for this guest.' }}>
        {() => (
          <div className="grid-2">
            {chart('CPU usage', [line('CPU', 'cpu', 100)], '%')}
            {chart('Memory usage', [line('Memory', 'mem')], 'B', bytes)}
            {chart('Network traffic', [line('In', 'netin'), line('Out', 'netout')], 'B/s', (v) => `${bytes(v)}/s`)}
            {chart('Disk I/O', [line('Read', 'diskread'), line('Write', 'diskwrite')], 'B/s', (v) => `${bytes(v)}/s`)}
          </div>
        )}
      </Async>
    </>
  );
}
