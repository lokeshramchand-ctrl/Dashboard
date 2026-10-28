import { useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { Async, Badge, Button, Card, Chips, ListRow, Screen, Txt } from '../components/ui';
import { timeAgo } from '../format';
import { mono, space, useTheme } from '../theme';
import type { Tone } from '../theme';
import type { PveTask } from '../types';
import { useQuery } from '../useQuery';
import type { Query } from '../useQuery';

const TONE: Record<PveTask['status'], Tone> = { running: 'blue', ok: 'green', warning: 'amber', error: 'red' };
const NAME: Record<string, string> = {
  qmstart: 'VM start', qmstop: 'VM stop', qmshutdown: 'VM shutdown', qmreboot: 'VM reboot', qmreset: 'VM reset', qmsuspend: 'VM pause', qmresume: 'VM resume',
  vzstart: 'CT start', vzstop: 'CT stop', vzshutdown: 'CT shutdown', vzreboot: 'CT reboot', vzdump: 'Backup', vncproxy: 'Console', termproxy: 'Console',
  vncshell: 'Shell', aptupdate: 'Update package database', startall: 'Bulk start', stopall: 'Bulk stop',
};
export const taskName = (t: PveTask) => `${NAME[t.type] ?? t.type}${t.id ? ` ${t.id}` : ''}`;

export function TaskList({ q }: { q: Query<PveTask[]> }) {
  const [open, setOpen] = useState<PveTask | null>(null);
  return (
    <>
      <Async q={q} rows={5} h={52} isEmpty={(d) => d.length === 0} empty={{ title: 'No tasks', hint: 'Proxmox has no matching tasks.' }}>
        {(list) => (
          <Card style={{ paddingVertical: 0 }}>
            {list.map((t, i) => (
              <ListRow key={t.upid} first={i === 0} title={taskName(t)} onPress={() => setOpen(t)}
                sub={`${t.user} · ${timeAgo(new Date(t.start * 1000).toISOString())}${t.status === 'error' ? ` · ${t.message}` : ''}`}
                right={<Badge tone={TONE[t.status]}>{t.status}</Badge>} />
            ))}
          </Card>
        )}
      </Async>
      {open ? <TaskLog task={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function TaskLog({ task, onClose }: { task: PveTask; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const q = useQuery(() => api.taskLog(task.upid), task.status === 'running' ? 2000 : 0, [task.upid]);
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg, padding: space.lg, paddingTop: space.xl, paddingBottom: insets.bottom + space.lg, gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Txt bold style={{ fontSize: 20 }}>{taskName(task)}</Txt>
            <Txt muted small>{new Date(task.start * 1000).toLocaleString()} · {task.user}</Txt>
          </View>
          <Badge tone={TONE[task.status]}>{task.status}</Badge>
        </View>
        <ScrollView style={{ flex: 1, borderRadius: 12, backgroundColor: '#0b0b0b' }} contentContainerStyle={{ padding: space.md }}>
          <Async q={q} rows={4} h={16}>
            {(lines) => <Text selectable style={{ color: '#e8e8e8', fontFamily: mono, fontSize: 12, lineHeight: 18 }}>{lines.join('\n') || 'No output'}</Text>}
          </Async>
        </ScrollView>
        <Button title="Close" onPress={onClose} />
      </View>
    </Modal>
  );
}

export default function Tasks({ onBack }: { onBack: () => void }) {
  const [errors, setErrors] = useState<'all' | 'errors'>('all');
  const q = useQuery(() => api.tasks({ errors: errors === 'errors', limit: 100 }), 6000, [errors]);
  return (
    <Screen title="Task log" sub="Proxmox tasks on this node, newest first." queries={[q]} back={{ label: 'More', onPress: onBack }}
      header={<View style={{ gap: space.md }}><Chips value={errors} onChange={setErrors} options={[{ id: 'all', label: 'All tasks' }, { id: 'errors', label: 'Errors only' }]} /></View>}>
      <TaskList q={q} />
    </Screen>
  );
}

