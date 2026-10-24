import { Pressable, View } from 'react-native';
import { api } from '../api';
import { Async, Badge, Card, Meter, Screen, Txt } from '../components/ui';
import { fmtBytes, fmtPct, fmtUptime, timeAgo } from '../format';
import { space, useTheme } from '../theme';
import type { Tone } from '../theme';
import type { Overview as Ov } from '../types';
import { useQuery } from '../useQuery';

function Tile({ label, value, sub, tone, onPress }: { label: string; value: number; sub: string; tone?: Tone; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flexBasis: '47%', flexGrow: 1 }} accessibilityRole="button" accessibilityLabel={`${label} ${value}`}>
      <Card style={{ gap: 2 }}>
        <Txt muted small>{label}</Txt>
        <Txt bold tone={tone} style={{ fontSize: 30, letterSpacing: -0.8, color: tone ? undefined : t.text }}>{value}</Txt>
        <Txt muted small>{sub}</Txt>
      </Card>
    </Pressable>
  );
}

function Res({ label, pct, text }: { label: string; pct: number; text: string }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt muted>{label}</Txt>
        <Txt bold>{text}</Txt>
      </View>
      <Meter value={pct} />
    </View>
  );
}

function attention(o: Ov, hasIncidents: number): number {
  const m = o.host.memTotal ? o.host.memUsed / o.host.memTotal : 0;
  const d = o.host.diskTotal ? o.host.diskUsed / o.host.diskTotal : 0;
  return hasIncidents + (o.host.cpu > 0.75 ? 1 : 0) + (m > 0.8 ? 1 : 0) + (d > 0.8 ? 1 : 0);
}

export default function Overview({ go }: { go: (tab: string) => void }) {
  const ov = useQuery(api.overview, 8000);
  const inc = useQuery(api.incidents, 10000);
  const bad = (inc.data ?? []).filter((i) => i.status !== 'maintenance');

  return (
    <Screen title="Overview" sub="Your homelab at a glance." queries={[ov, inc]}>
      <Async q={ov} rows={4} h={96}>
        {(o) => {
          const n = attention(o, bad.length);
          return (
            <>
              <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt bold>{n ? 'Needs attention' : 'All systems healthy'}</Txt>
                  <Txt muted small>{n ? `${n} issue${n > 1 ? 's' : ''} to look at` : 'Nothing needs your attention.'}</Txt>
                </View>
                <Badge tone={n ? 'red' : 'green'}>{n ? String(n) : 'OK'}</Badge>
              </Card>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
                <Tile label="Guests" value={o.guests.total} sub={`${o.guests.running} running · ${o.guests.stopped} stopped`} onPress={() => go('Guests')} />
                <Tile label="Nginx sites" value={o.nginx.sites} sub="sites-enabled" onPress={() => go('Sites')} />
                <Tile label="Monitors up" value={o.kuma.up} sub={`${o.kuma.pending} pending`} tone="green" onPress={() => go('Uptime')} />
                <Tile label="Monitors down" value={o.kuma.down} sub={o.kuma.down ? 'Needs attention' : 'All clear'} tone={o.kuma.down ? 'red' : undefined} onPress={() => go('Uptime')} />
              </View>

              <Card style={{ gap: space.lg }}>
                <View>
                  <Txt bold>Host resources</Txt>
                  <Txt muted small>Uptime {fmtUptime(o.host.uptime)}</Txt>
                </View>
                <Res label="CPU" pct={o.host.cpu} text={fmtPct(o.host.cpu)} />
                <Res label="Memory" pct={o.host.memTotal ? o.host.memUsed / o.host.memTotal : 0} text={`${fmtBytes(o.host.memUsed)} / ${fmtBytes(o.host.memTotal, 0)}`} />
                <Res label="Disk" pct={o.host.diskTotal ? o.host.diskUsed / o.host.diskTotal : 0} text={`${fmtBytes(o.host.diskUsed, 0)} / ${fmtBytes(o.host.diskTotal, 0)}`} />
              </Card>
            </>
          );
        }}
      </Async>

      <Card style={{ gap: space.md }}>
        <Txt bold>Recent incidents</Txt>
        <Async q={inc} rows={2} h={44} isEmpty={(d) => d.length === 0} empty={{ title: 'No incidents', hint: 'Every monitor is healthy.' }}>
          {(list) => (
            <View style={{ gap: space.md }}>
              {list.map((i) => (
                <View key={i.monitorId} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Txt bold>{i.name}</Txt>
                    <Txt muted small>{i.message} · {timeAgo(i.since)}</Txt>
                  </View>
                  <Badge tone={i.status === 'down' ? 'red' : i.status === 'pending' ? 'amber' : 'blue'}>{i.status}</Badge>
                </View>
              ))}
            </View>
          )}
        </Async>
      </Card>
    </Screen>
  );
}
