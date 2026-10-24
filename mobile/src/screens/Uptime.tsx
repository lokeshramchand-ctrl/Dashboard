import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { api } from '../api';
import { Async, Badge, Card, Chips, Screen, SearchInput, Txt } from '../components/ui';
import { timeAgo } from '../format';
import { space, useTheme } from '../theme';
import type { Tone } from '../theme';
import type { Heartbeat, KumaMonitor, KumaStatus } from '../types';
import { useQuery } from '../useQuery';

type Filter = 'all' | 'down' | 'up';
const TONE: Record<KumaStatus, Tone> = { up: 'green', down: 'red', pending: 'amber', maintenance: 'blue' };

function Beats({ beats }: { beats: Heartbeat[] }) {
  const t = useTheme();
  const color: Record<KumaStatus, string> = { up: t.green, down: t.red, pending: t.amber, maintenance: t.blue };
  return (
    <View style={{ flexDirection: 'row', gap: 2, height: 20 }} accessibilityLabel="Recent heartbeats">
      {beats.slice(-40).map((b, i) => <View key={i} style={{ flex: 1, borderRadius: 2, backgroundColor: color[b.status] }} />)}
    </View>
  );
}

export default function Uptime() {
  const q = useQuery(api.monitors, 8000);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const list = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (q.data ?? [])
      .filter((m) => filter === 'all' || (filter === 'up' ? m.status === 'up' : m.status !== 'up'))
      .filter((m) => !needle || `${m.name} ${m.url}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.status === 'down') - Number(a.status === 'down') || a.name.localeCompare(b.name));
  }, [q.data, filter, search]);

  const down = (q.data ?? []).filter((m) => m.status !== 'up').length;

  return (
    <Screen title="Uptime" sub="Monitors from Uptime Kuma." queries={[q]}
      header={
        <View style={{ gap: space.md }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search monitors" />
          <Chips value={filter} onChange={setFilter} options={[
            { id: 'all', label: 'All', count: q.data?.length },
            { id: 'down', label: 'Issues', count: down },
            { id: 'up', label: 'Up', count: (q.data?.length ?? 0) - down },
          ]} />
        </View>
      }>
      <Async q={q} rows={4} h={120} isEmpty={(d) => d.length === 0} empty={{ title: 'No monitors', hint: 'Uptime Kuma has not reported any monitors yet.' }}>
        {() => list.length === 0
          ? <Txt muted style={{ textAlign: 'center', paddingVertical: space.xl }}>No monitors match your filters.</Txt>
          : <View style={{ gap: space.md }}>{list.map((m) => <Monitor key={m.id} m={m} />)}</View>}
      </Async>
    </Screen>
  );
}

function Monitor({ m }: { m: KumaMonitor }) {
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Txt bold numberOfLines={1}>{m.name}</Txt>
          <Txt muted small numberOfLines={1}>{m.url}</Txt>
        </View>
        <Badge tone={TONE[m.status]}>{m.status}</Badge>
      </View>
      <Beats beats={m.heartbeats} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt muted small>24h {m.uptime24h.toFixed(1)}%</Txt>
        <Txt muted small>30d {m.uptime30d.toFixed(1)}%</Txt>
        <Txt muted small>{m.avgPing != null ? `${Math.round(m.avgPing)} ms` : '–'}</Txt>
        <Txt muted small>{timeAgo(m.lastCheck)}</Txt>
      </View>
    </Card>
  );
}
