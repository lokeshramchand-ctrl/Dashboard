import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { api } from '../api';
import { Async, Badge, Card, Chips, Meter, Screen, SearchInput, Txt } from '../components/ui';
import { fmtBytes, fmtPct, fmtUptime, sleep } from '../format';
import { space } from '../theme';
import type { Guest, GuestAction } from '../types';
import { useQuery } from '../useQuery';

type Filter = 'all' | 'running' | 'stopped';

const VERB: Record<GuestAction, string> = { start: 'Start', shutdown: 'Shut down', stop: 'Force stop', reboot: 'Reboot' };

export default function Guests() {
  const q = useQuery(api.guests, 7000);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<Record<number, GuestAction>>({});
  const guestsRef = useRef<Guest[]>([]);
  guestsRef.current = q.data ?? [];

  const list = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (q.data ?? []).filter((g) =>
      (filter === 'all' || (filter === 'running' ? g.status === 'running' : g.status !== 'running')) &&
      (!needle || `${g.name} ${g.vmid} ${g.tags.join(' ')}`.toLowerCase().includes(needle)));
  }, [q.data, filter, search]);

  const counts = useMemo(() => {
    const all = q.data ?? [];
    return { all: all.length, running: all.filter((g) => g.status === 'running').length };
  }, [q.data]);

  async function run(g: Guest, action: GuestAction) {
    setBusy((b) => ({ ...b, [g.vmid]: action }));
    try {
      const { taskId } = await api.guestAction(g.vmid, action);
      for (let i = 0; i < 90; i++) {
        const t = await api.task(taskId);
        if (t.status === 'error') throw new Error(t.message || 'Task failed');
        if (t.status === 'ok') break;
        await sleep(1000);
      }
      const want = action === 'start' ? 'running' : action === 'reboot' ? null : 'stopped';
      for (let i = 0; i < 20; i++) {
        await q.reload();
        const now = guestsRef.current.find((x) => x.vmid === g.vmid);
        if (!want || now?.status === want) break;
        await sleep(1000);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert(`${VERB[action]} failed`, (e as Error).message);
    } finally {
      setBusy((b) => { const { [g.vmid]: _drop, ...rest } = b; return rest; });
      q.reload();
    }
  }

  function choose(g: Guest) {
    const running = g.status === 'running';
    const actions: GuestAction[] = running ? ['reboot', 'shutdown', 'stop'] : ['start'];
    Alert.alert(g.name, `${g.type.toUpperCase()} ${g.vmid}`, [
      ...actions.map((a) => ({
        text: VERB[a],
        style: a === 'stop' ? ('destructive' as const) : ('default' as const),
        onPress: () => confirm(g, a),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  function confirm(g: Guest, action: GuestAction) {
    const clashing = action === 'start'
      ? g.conflicts.map((id) => guestsRef.current.find((x) => x.vmid === id)).filter((x): x is Guest => !!x && x.status === 'running')
      : [];
    const warn = clashing.length ? `\n\n${clashing.map((c) => c.name).join(', ')} share${clashing.length === 1 ? 's' : ''} the GPU and is running. Starting may fail.` : '';
    Alert.alert(`${VERB[action]} ${g.name}?`, `This sends a ${action} request to Proxmox.${warn}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: VERB[action], style: action === 'stop' ? 'destructive' : 'default', onPress: () => run(g, action) },
    ]);
  }

  return (
    <Screen title="Guests" sub="Containers and virtual machines." queries={[q]}
      header={
        <View style={{ gap: space.md }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, vmid or tag" />
          <Chips value={filter} onChange={setFilter} options={[
            { id: 'all', label: 'All', count: counts.all },
            { id: 'running', label: 'Running', count: counts.running },
            { id: 'stopped', label: 'Stopped', count: counts.all - counts.running },
          ]} />
        </View>
      }>
      <Async q={q} rows={5} h={110} isEmpty={(d) => d.length === 0} empty={{ title: 'No guests', hint: 'Nothing was returned by Proxmox.' }}>
        {() => list.length === 0
          ? <Txt muted style={{ textAlign: 'center', paddingVertical: space.xl }}>No guests match your filters.</Txt>
          : (
            <View style={{ gap: space.md }}>
              {list.map((g) => <GuestRow key={g.vmid} g={g} pending={busy[g.vmid]} onPress={() => choose(g)} />)}
            </View>
          )}
      </Async>
    </Screen>
  );
}

function GuestRow({ g, pending, onPress }: { g: Guest; pending?: GuestAction; onPress: () => void }) {
  const running = g.status === 'running';
  const mem = g.memMax ? g.memUsed / g.memMax : 0;
  return (
    <Pressable onPress={onPress} disabled={g.protected || !!pending} accessibilityRole="button" accessibilityLabel={`${g.name}, ${g.status}`}>
      <Card style={{ gap: space.md, opacity: pending ? 0.7 : 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Txt bold numberOfLines={1}>{g.name}</Txt>
            <Txt muted small>{g.type.toUpperCase()} {g.vmid}{g.tags.length ? ` · ${g.tags.join(', ')}` : ''}</Txt>
          </View>
          {g.protected ? <Badge tone="gray">Protected</Badge> : null}
          <Badge tone={pending ? 'amber' : running ? 'green' : g.status === 'paused' ? 'amber' : 'gray'}>{pending ? `${VERB[pending]}…` : g.status}</Badge>
        </View>
        {running ? (
          <View style={{ gap: space.sm }}>
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt muted small>CPU</Txt><Txt small>{fmtPct(g.cpu)}</Txt></View>
              <Meter value={g.cpu} />
            </View>
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt muted small>Memory</Txt><Txt small>{fmtBytes(g.memUsed)} / {fmtBytes(g.memMax, 0)}</Txt></View>
              <Meter value={mem} />
            </View>
            <Txt muted small>Up {fmtUptime(g.uptime)}</Txt>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}
