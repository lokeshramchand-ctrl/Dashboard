import { useState } from 'react';
import { Alert, Linking, Switch, View } from 'react-native';
import { api } from '../api';
import { Async, Badge, Button, Card, KV, ListRow, Screen, SectionTitle, StateView, Txt } from '../components/ui';
import { timeAgo } from '../format';
import { space, useTheme } from '../theme';
import type { NotifySettings } from '../types';
import { useQuery } from '../useQuery';

const LABEL: Record<string, string> = {
  monitor: 'Uptime monitors', guest: 'Guests', host: 'Proxmox host', resources: 'Resource pressure', tasks: 'Failed tasks',
  disks: 'Disk health', services: 'System services', db: 'MongoDB', app: 'Dashboard', auth: 'Sign-in',
};

export default function Notifications({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const q = useQuery(api.notify, 10_000);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  async function save(s: Partial<NotifySettings>) {
    setSaving(true);
    try { await api.notifySettings(s); await q.reload(); } catch (e) { Alert.alert("Couldn't save", (e as Error).message); } finally { setSaving(false); }
  }
  async function test() {
    setTesting(true);
    try { await api.notifyTest(); Alert.alert('Sent', 'Check the ntfy app for the test notification.'); q.reload(); } catch (e) { Alert.alert('Test failed', (e as Error).message); } finally { setTesting(false); }
  }
  const sw = (on: boolean, onChange: (v: boolean) => void, disabled?: boolean) => (
    <Switch value={on} onValueChange={onChange} disabled={saving || disabled} trackColor={{ true: t.green, false: t.border2 }} />
  );

  return (
    <Screen title="Notifications" sub="Push alerts via ntfy when anything goes down, and when it recovers." back={{ label: 'More', onPress: onBack }} queries={[q]}>
      <Async q={q} rows={3} h={100}>
        {(d) => !d.configured ? <StateView title="ntfy is not configured" hint="Set NTFY_URL and NTFY_TOPIC on the server." /> : (
          <>
            <Card style={{ gap: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Txt bold style={{ flex: 1 }}>Alerts enabled</Txt>
                {sw(d.settings.enabled, (v) => save({ enabled: v }))}
              </View>
              <KV rows={[['Server', d.server], ['Topic', d.topic], ['Status', d.settings.mutedUntil && new Date(d.settings.mutedUntil) > new Date()
                ? <Badge tone="amber">{`Muted until ${new Date(d.settings.mutedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</Badge>
                : <Badge tone={d.settings.enabled ? 'green' : 'gray'}>{d.settings.enabled ? 'Active' : 'Disabled'}</Badge>]]} />
              <Button title="Subscribe in ntfy" onPress={() => Linking.openURL(d.subscribeUrl).catch(() => Alert.alert('Cannot open link', d.subscribeUrl))} />
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <View style={{ flex: 1 }}><Button title="Send test" kind="primary" busy={testing} onPress={test} /></View>
                <View style={{ flex: 1 }}>{d.settings.mutedUntil && new Date(d.settings.mutedUntil) > new Date()
                  ? <Button title="Unmute" disabled={saving} onPress={() => save({ mutedUntil: null })} />
                  : <Button title="Mute 1 h" disabled={saving} onPress={() => save({ mutedUntil: new Date(Date.now() + 3600_000).toISOString() })} />}</View>
              </View>
            </Card>
            <SectionTitle>Alert rules</SectionTitle>
            <Card style={{ paddingVertical: 0 }}>
              {d.categories.map((c, i) => (
                <ListRow key={c} first={i === 0} title={LABEL[c] ?? c} right={sw(d.settings.categories[c] !== false, (v) => save({ categories: { ...d.settings.categories, [c]: v } }), !d.settings.enabled)} />
              ))}
              <ListRow title="Recovery messages" sub="Also notify when things come back up" right={sw(d.settings.recoveries, (v) => save({ recoveries: v }), !d.settings.enabled)} />
            </Card>
            <SectionTitle>Recently sent</SectionTitle>
            {d.sent.length === 0 ? <StateView title="Nothing sent yet" /> : (
              <Card style={{ paddingVertical: 0 }}>
                {d.sent.slice(0, 30).map((s, i) => (
                  <ListRow key={i} first={i === 0} title={s.title} sub={`${s.message} · ${timeAgo(s.ts)}${s.ok ? '' : ` · failed: ${s.error}`}`}
                    right={<Badge tone={s.priority >= 5 ? 'red' : s.priority >= 4 ? 'amber' : 'green'}>{s.priority >= 5 ? 'down' : s.priority >= 4 ? 'warn' : 'ok'}</Badge>} />
                ))}
              </Card>
            )}
          </>
        )}
      </Async>
    </Screen>
  );
}
