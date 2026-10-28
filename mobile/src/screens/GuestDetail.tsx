import { useState } from 'react';
import { Alert, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { api } from '../api';
import { Async, Badge, Bars, Button, Card, Chips, KV, ListRow, Screen, SectionTitle, StateView, Txt } from '../components/ui';
import { fmtBytes, fmtPct, fmtUptime, sleep } from '../format';
import { mono, space, useTheme } from '../theme';
import type { GuestAction, GuestStatusDetail, Timeframe } from '../types';
import { useQuery } from '../useQuery';
import { Res, TIMEFRAMES } from './Node';
import { TaskList } from './Tasks';
import { LogLines, RecurringList, SINCE, tidy } from './Diagnostics';

type Tab = 'summary' | 'config' | 'snapshots' | 'tasks' | 'logs';
const VERB: Record<GuestAction, string> = { start: 'Start', shutdown: 'Shut down', stop: 'Force stop', reboot: 'Reboot', reset: 'Reset', suspend: 'Pause', resume: 'Resume' };
const WARN: Partial<Record<GuestAction, string>> = {
  stop: 'Cuts power immediately and may corrupt data inside the guest.',
  reset: 'Hard power cycle. Unsaved data inside the guest is lost.',
};

export default function GuestDetail({ vmid, onBack }: { vmid: number; onBack: () => void }) {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('summary');
  const [tf, setTf] = useState<Timeframe>('hour');
  const [busy, setBusy] = useState<GuestAction | null>(null);
  const st = useQuery(() => api.guestStatus(vmid), 4000, [vmid]);
  const cfg = useQuery(() => api.guestConfig(vmid), 30_000, [vmid]);
  const rrd = useQuery(() => api.guestRrd(vmid, tf), 60_000, [vmid, tf]);
  const snaps = useQuery(() => api.snapshots(vmid), 0, [vmid]);
  const tasks = useQuery(() => api.tasks({ vmid, limit: 40 }), 10_000, [vmid]);
  const g = st.data;
  const series = (k: string, scale = 1) => (rrd.data ?? []).filter((r) => r[k] != null).map((r) => (r[k] ?? 0) * scale);

  async function run(action: GuestAction) {
    if (!g) return;
    setBusy(action);
    try {
      const { taskId } = await api.guestAction(vmid, action);
      for (let i = 0; i < 180; i++) {
        await sleep(1000);
        const r = await api.task(taskId);
        if (r.status === 'error') throw new Error(r.message || 'Task failed');
        if (r.status === 'ok') break;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert(`${VERB[action]} failed`, (e as Error).message);
    } finally {
      setBusy(null);
      st.reload();
      tasks.reload();
    }
  }

  function ask(action: GuestAction) {
    if (!g) return;
    if (action === 'start' || action === 'resume') return run(action);
    Alert.alert(`${VERB[action]} ${g.name}?`, WARN[action] ?? 'This sends the request to Proxmox.', [
      { text: 'Cancel', style: 'cancel' },
      { text: VERB[action], style: WARN[action] ? 'destructive' : 'default', onPress: () => run(action) },
    ]);
  }

  function more(g: GuestStatusDetail) {
    const acts: GuestAction[] = g.status === 'paused' ? ['stop'] : g.type === 'qemu' ? ['reboot', 'suspend', 'reset', 'stop'] : ['reboot', 'stop'];
    Alert.alert(g.name, 'More power actions', [
      ...acts.map((a) => ({ text: VERB[a], style: WARN[a] ? ('destructive' as const) : ('default' as const), onPress: () => ask(a) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  const on = g?.status === 'running';
  return (
    <Screen title={g?.name ?? `Guest ${vmid}`} sub={g ? `${g.type === 'qemu' ? 'Virtual machine' : 'Container'} · ${vmid}` : undefined}
      back={{ label: 'Guests', onPress: onBack }} queries={[st, cfg, rrd, snaps, tasks]}
      header={g ? (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={busy ? 'amber' : on ? 'green' : g.status === 'paused' ? 'amber' : 'gray'}>{busy ? `${VERB[busy]}…` : g.status}</Badge>
            {g.protected ? <Badge tone="blue">Protected</Badge> : null}
            {g.lock ? <Badge tone="amber">{`Locked: ${g.lock}`}</Badge> : null}
            {g.tags.map((x) => <Badge key={x}>{x}</Badge>)}
          </View>
          {!g.protected && (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                {g.status === 'paused'
                  ? <Button title="Resume" kind="primary" busy={busy === 'resume'} disabled={!!busy} onPress={() => ask('resume')} />
                  : on ? <Button title="Shut down" busy={busy === 'shutdown'} disabled={!!busy} onPress={() => ask('shutdown')} />
                    : <Button title="Start" kind="primary" busy={busy === 'start'} disabled={!!busy} onPress={() => ask('start')} />}
              </View>
              {(on || g.status === 'paused') && <View style={{ width: 110 }}><Button title="More…" disabled={!!busy} onPress={() => more(g)} /></View>}
            </View>
          )}
          <Chips value={tab} onChange={setTab} options={[{ id: 'summary', label: 'Summary' }, { id: 'config', label: g.type === 'qemu' ? 'Hardware' : 'Resources' }, { id: 'snapshots', label: 'Snapshots' }, { id: 'tasks', label: 'Tasks' }, { id: 'logs', label: 'Logs' }]} />
        </View>
      ) : null}>
      {st.data === undefined && st.error ? <StateView error title="Couldn't load this guest" hint={st.error.message} onRetry={st.reload} /> : null}
      {tab === 'summary' && g && (
        <>
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt bold>Status</Txt><Txt muted small>{on ? `Up ${fmtUptime(g.uptime)}` : g.status}</Txt></View>
            <Res label="CPU" pct={on ? g.cpu : 0} text={on ? `${fmtPct(g.cpu, 1)} of ${g.cpus}` : `${g.cpus} CPUs`} />
            <Res label="Memory" pct={on && g.memMax ? g.memUsed / g.memMax : 0} text={on ? `${fmtBytes(g.memUsed)} / ${fmtBytes(g.memMax)}` : fmtBytes(g.memMax)} />
            {g.diskMax > 0 ? <Res label="Disk" pct={g.diskUsed / g.diskMax} text={g.diskUsed ? `${fmtBytes(g.diskUsed)} / ${fmtBytes(g.diskMax)}` : fmtBytes(g.diskMax)} /> : null}
          </Card>
          <Card>
            <KV rows={[
              ['Network in', fmtBytes(g.netIn)], ['Network out', fmtBytes(g.netOut)], ['Disk read', fmtBytes(g.diskRead)], ['Disk write', fmtBytes(g.diskWrite)],
              ...(g.type === 'qemu' ? [['Guest agent', g.agent ? 'Enabled' : 'Disabled'] as [string, string]] : []),
            ]} />
          </Card>
          <SectionTitle>Performance</SectionTitle>
          <Chips value={tf} onChange={setTf} options={TIMEFRAMES} />
          <Async q={rrd} rows={2} h={110} isEmpty={(d) => d.length < 2} empty={{ title: 'No data yet' }}>
            {() => (
              <View style={{ gap: space.md }}>
                <Card style={{ gap: space.sm }}><Txt bold>CPU usage</Txt><Bars label="CPU usage" values={series('cpu', 100)} /></Card>
                <Card style={{ gap: space.sm }}><Txt bold>Memory used</Txt><Bars label="Memory used" color={t.chart2} values={series('mem')} /></Card>
                <Card style={{ gap: space.sm }}><Txt bold>Network in</Txt><Bars label="Network in" values={series('netin')} /></Card>
              </View>
            )}
          </Async>
        </>
      )}
      {tab === 'config' && (
        <Async q={cfg} rows={6} h={44} isEmpty={(d) => d.length === 0} empty={{ title: 'No configuration' }}>
          {(rows) => (
            <Card style={{ paddingVertical: 0 }}>
              {rows.map((r, i) => (
                <ListRow key={r.key} first={i === 0} title={r.key}
                  sub={`${r.value ?? '–'}${r.pending !== null ? `  →  ${r.pending} (on restart)` : ''}${r.delete ? '  (removed on restart)' : ''}`}
                  right={r.pending !== null || r.delete ? <Badge tone="amber">pending</Badge> : undefined} />
              ))}
            </Card>
          )}
        </Async>
      )}
      {tab === 'snapshots' && (
        <Async q={snaps} rows={2} h={52} isEmpty={(d) => !d.some((s) => !s.current)} empty={{ title: 'No snapshots', hint: 'Only the current state exists.' }}>
          {(list) => (
            <Card style={{ paddingVertical: 0 }}>
              {list.filter((s) => !s.current).map((s, i) => (
                <ListRow key={s.name} first={i === 0} title={s.name} sub={`${s.time ? new Date(s.time * 1000).toLocaleString() : ''}${s.description ? ` · ${s.description}` : ''}`}
                  right={s.vmstate ? <Badge tone="blue">RAM</Badge> : undefined} />
              ))}
            </Card>
          )}
        </Async>
      )}
      {tab === 'tasks' && <TaskList q={tasks} />}
      {tab === 'logs' && <GuestLogsView vmid={vmid} />}
    </Screen>
  );
}

function GuestLogsView({ vmid }: { vmid: number }) {
  const [since, setSince] = useState('7d');
  const q = useQuery(() => api.guestLogs(vmid, since), 30_000, [vmid, since]);
  return (
    <>
      <Chips value={since} onChange={setSince} options={SINCE} />
      <Async q={q} rows={3} h={80}>
        {(d) => (
          <>
            <Card style={{ gap: space.sm, borderLeftWidth: 3, borderLeftColor: d.lastFailure ? '#ed272e' : '#3eb850' }}>
              <Txt bold>{d.lastFailure ? 'Last failure' : 'No failures'}</Txt>
              {d.lastFailure ? (
                <>
                  <Txt small bold>{d.reason}</Txt>
                  <Txt muted small>{new Date(d.lastFailure.ts).toLocaleString()}</Txt>
                  <Txt small style={{ fontFamily: mono }}>{tidy(d.lastFailure.message)}</Txt>
                </>
              ) : <Txt muted small>{`Nothing failed in the last ${since}.`}</Txt>}
              <Txt muted small>{`${d.counts.error} errors · ${d.counts.warn} warnings · ${d.failedTasks.length} failed tasks`}</Txt>
            </Card>
            {d.recurring.length ? <><SectionTitle>Recurring problems</SectionTitle><RecurringList rows={d.recurring} /></> : null}
            <SectionTitle>Lifecycle</SectionTitle>
            <Card style={{ paddingVertical: 0 }}>
              {d.timeline.slice(0, 12).map((l, i) => <ListRow key={i} first={i === 0} title={tidy(l.message)} sub={new Date(l.ts).toLocaleString()} right={<Badge tone={l.level === 'error' ? 'red' : l.kind === 'start' ? 'green' : 'gray'}>{l.kind}</Badge>} />)}
              {d.timeline.length === 0 ? <ListRow first title="No lifecycle events" /> : null}
            </Card>
            <SectionTitle>Journal</SectionTitle>
            <LogLines lines={d.lines} />
          </>
        )}
      </Async>
    </>
  );
}
