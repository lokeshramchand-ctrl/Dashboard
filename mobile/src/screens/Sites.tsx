import { useMemo, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { api } from '../api';
import { hostOf } from '../format';
import { Async, Badge, Card, Screen, SearchInput, Txt } from '../components/ui';
import { space } from '../theme';
import type { KumaMonitor, NginxSite } from '../types';
import { useQuery } from '../useQuery';

/** Same client-side matching rule as the web UI (see API_NOTES.md). */
function matchMonitor(site: NginxSite, monitors: KumaMonitor[]): KumaMonitor | undefined {
  const names = site.serverNames.map((n) => n.toLowerCase());
  const labels = names.map((n) => n.split('.')[0]);
  return monitors.find((m) => names.includes(hostOf(m.url)) || labels.includes(m.name.toLowerCase()));
}

export default function Sites({ onBack }: { onBack?: () => void }) {
  const sites = useQuery(api.nginx, 30000);
  const mons = useQuery(api.monitors, 15000);
  const [search, setSearch] = useState('');

  const list = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (sites.data ?? []).filter((s) => !needle || `${s.serverNames.join(' ')} ${s.upstream ?? ''} ${s.file}`.toLowerCase().includes(needle));
  }, [sites.data, search]);

  return (
    <Screen title="Nginx sites" sub="Read-only view of nginx." queries={[sites, mons]} back={onBack ? { label: 'More', onPress: onBack } : undefined}
      header={<SearchInput value={search} onChange={setSearch} placeholder="Search domain, upstream or file" />}>
      <Async q={sites} rows={4} h={110} isEmpty={(d) => d.length === 0} empty={{ title: 'No sites', hint: 'No enabled nginx sites were found.' }}>
        {() => list.length === 0
          ? <Txt muted style={{ textAlign: 'center', paddingVertical: space.xl }}>No sites match your search.</Txt>
          : (
            <View style={{ gap: space.md }}>
              {list.map((s) => {
                const m = matchMonitor(s, mons.data ?? []);
                return (
                  <Pressable key={s.file + s.serverNames.join()} onPress={() => Linking.openURL(s.url).catch(() => {})} accessibilityRole="link" accessibilityLabel={`Open ${s.serverNames[0]}`}>
                    <Card style={{ gap: space.sm }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                        <View style={{ flex: 1 }}>
                          <Txt bold numberOfLines={1}>{s.serverNames[0] ?? s.file}</Txt>
                          <Txt muted small numberOfLines={1}>{s.file}</Txt>
                        </View>
                        <Badge tone={s.ssl ? 'green' : 'amber'}>{s.ssl ? 'SSL' : 'HTTP'}</Badge>
                      </View>
                      <Txt muted small numberOfLines={1}>{s.upstream ? `→ ${s.upstream}` : s.root ? `root ${s.root}` : 'no upstream'}</Txt>
                      {m ? <Badge tone={m.status === 'up' ? 'green' : m.status === 'down' ? 'red' : 'amber'}>{`Monitor ${m.status}`}</Badge> : null}
                    </Card>
                  </Pressable>
                );
              })}
            </View>
          )}
      </Async>
    </Screen>
  );
}
