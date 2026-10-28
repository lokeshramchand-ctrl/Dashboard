import { useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../api';
import { Async, Badge, Card, Chips, ListRow, Screen, SectionTitle, StateView, Txt } from '../components/ui';
import { timeAgo } from '../format';
import { space, useTheme } from '../theme';
import type { Tone } from '../theme';
import type { LogLine, Recurring } from '../types';
import { useQuery } from '../useQuery';
import { TaskList } from './Tasks';

export const SINCE = [{ id: '24h', label: '24 hours' }, { id: '7d', label: '7 days' }, { id: '30d', label: '30 days' }];
const LV: Record<LogLine['level'], Tone> = { error: 'red', warn: 'amber', info: 'gray' };
/** Shortens Proxmox task ids to "‹task type›". */
export const tidy = (m: string) => m.replace(/UPID:[\w.-]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:([\w-]+):[\w.:-]*?:[\w@.!-]+:/g, '‹task $1›');

export function LogLines({ lines, max = 120 }: { lines: LogLine[]; max?: number }) {
  const t = useTheme();
  const [all, setAll] = useState<'problems' | 'all'>(lines.some((l) => l.level !== 'info') ? 'problems' : 'all');
  const rows = lines.filter((l) => all === 'all' || l.level !== 'info');
  return (
    <View style={{ gap: space.md }}>
      <Chips value={all} onChange={setAll} options={[{ id: 'problems', label: 'Problems', count: lines.filter((l) => l.level !== 'info').length }, { id: 'all', label: 'All', count: lines.length }]} />
      {rows.length === 0 ? <StateView title="No problems found" /> : (
        <Card style={{ paddingVertical: space.sm, gap: 0 }}>
          {rows.slice(0, max).map((l, i) => (
            <View key={i} style={{ paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: t.border, gap: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Badge tone={LV[l.level]}>{l.kind}</Badge>
                <Txt muted small numberOfLines={1} style={{ flex: 1 }}>{l.unit} · {timeAgo(l.ts)}</Txt>
              </View>
              <Text selectable style={{ color: t.text, fontFamily: 'Courier', fontSize: 12 }}>{tidy(l.message)}</Text>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

export function RecurringList({ rows }: { rows: Recurring[] }) {
  if (!rows.length) return <StateView title="No recurring problems" />;
  return (
    <Card style={{ paddingVertical: 0 }}>
      {rows.slice(0, 20).map((r, i) => (
        <ListRow key={i} first={i === 0} title={`${r.unit || 'system'} · ${r.count}×`} sub={`${tidy(r.sample)}\nlast ${timeAgo(r.last)}`}
          right={<Badge tone={LV[r.level]}>{r.kind}</Badge>} />
      ))}
    </Card>
  );
}

const KINDS: [string, string][] = [['crash', 'Crashes'], ['start-failed', 'Start failures'], ['oom', 'Out of memory'], ['gpu', 'GPU faults'], ['hardware', 'Hardware'], ['error', 'Other']];

export default function Diagnostics({ onBack }: { onBack: () => void }) {
  const [since, setSince] = useState('7d');
  const q = useQuery(() => api.diagnostics(since), 30_000, [since]);
  const tasks = { ...q, data: q.data?.failedTasks };
  return (
    <Screen title="Diagnostics" sub="Crashes, failed starts, OOM kills, GPU and hardware errors." back={{ label: 'More', onPress: onBack }} queries={[q]}
      header={<Chips value={since} onChange={setSince} options={SINCE} />}>
      <Async q={q} rows={3} h={80}>
        {(d) => (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {KINDS.map(([k, label]) => (
                <Card key={k} style={{ width: '31%', padding: space.md, gap: 2 }}>
                  <Txt muted small numberOfLines={1}>{label}</Txt>
                  <Txt bold tone={d.byKind[k] ? (k === 'gpu' ? 'blue' : 'red') : undefined} style={{ fontSize: 22 }}>{d.byKind[k] ?? 0}</Txt>
                </Card>
              ))}
            </View>
            <SectionTitle>Recurring problems</SectionTitle>
            <RecurringList rows={d.recurring} />
            <SectionTitle>{`Failed tasks (${d.failedTasks.length})`}</SectionTitle>
            <TaskList q={tasks} />
            <SectionTitle>Failure log</SectionTitle>
            <LogLines lines={d.lines} />
          </>
        )}
      </Async>
    </Screen>
  );
}
