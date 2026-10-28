import { useState } from 'react';
import { View } from 'react-native';
import { api } from '../api';
import { Async, Badge, Bars, Card, Chips, KV, ListRow, Meter, Screen, SectionTitle, Txt } from '../components/ui';
import { fmtBytes, fmtPct, fmtUptime } from '../format';
import { space, useTheme } from '../theme';
import type { Timeframe } from '../types';
import { useQuery } from '../useQuery';

type Tab = 'summary' | 'disks' | 'services';
export const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: 'hour', label: 'Hour' }, { id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' },
];

export function Res({ label, pct, text }: { label: string; pct: number; text: string }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt muted small>{label}</Txt><Txt small bold>{text}</Txt></View>
      <Meter value={pct} />
    </View>
  );
}

export default function Node() {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('summary');
  const [tf, setTf] = useState<Timeframe>('hour');
  const node = useQuery(api.node, 5000);
  const rrd = useQuery(() => api.nodeRrd(tf), 60_000, [tf]);
  const disks = useQuery(api.disks, 0);
  const services = useQuery(api.services, 15_000);
  const series = (k: string, scale = 1) => (rrd.data ?? []).filter((r) => r[k] != null).map((r) => (r[k] ?? 0) * scale);

  return (
    <Screen title={node.data?.name ?? 'Node'} sub={node.data ? `Proxmox VE ${node.data.pveVersion}` : 'Proxmox host'} queries={[node, rrd, disks, services]}
      header={<Chips value={tab} onChange={setTab} options={[{ id: 'summary', label: 'Summary' }, { id: 'disks', label: 'Disks' }, { id: 'services', label: 'Services' }]} />}>
      {tab === 'summary' && (
        <>
          <Async q={node} rows={2} h={160}>
            {(n) => (
              <View style={{ gap: space.md }}>
                <Card style={{ gap: space.md }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt bold>Status</Txt><Txt muted small>Up {fmtUptime(n.uptime)}</Txt></View>
                  <Res label="CPU" pct={n.cpu} text={`${fmtPct(n.cpu, 1)} of ${n.cpus}`} />
                  <Res label="RAM" pct={n.memUsed / n.memTotal} text={`${fmtBytes(n.memUsed)} / ${fmtBytes(n.memTotal)}`} />
                  <Res label="Swap" pct={n.swapTotal ? n.swapUsed / n.swapTotal : 0} text={n.swapTotal ? `${fmtBytes(n.swapUsed)} / ${fmtBytes(n.swapTotal)}` : 'none'} />
                  <Res label="Root FS" pct={n.rootUsed / n.rootTotal} text={`${fmtBytes(n.rootUsed)} / ${fmtBytes(n.rootTotal)}`} />
                </Card>
                <Card>
                  <KV rows={[
                    ['CPU model', n.cpuModel || '–'], ['Cores', `${n.cpus} (${n.sockets} socket, ${n.cores} cores)`],
                    ['Load', n.loadavg.map((v) => v.toFixed(2)).join(' · ')], ['IO delay', fmtPct(n.wait, 2)],
                    ['Kernel', n.kernel], ['Boot mode', n.bootMode || '–'], ['Time zone', n.timezone || '–'],
                    ['Subscription', n.subscription === 'notfound' ? 'none' : n.subscription],
                  ]} />
                </Card>
              </View>
            )}
          </Async>
          <SectionTitle>Performance</SectionTitle>
          <Chips value={tf} onChange={setTf} options={TIMEFRAMES} />
          <Async q={rrd} rows={2} h={110} isEmpty={(d) => d.length < 2} empty={{ title: 'No data yet' }}>
            {() => (
              <View style={{ gap: space.md }}>
                <Card style={{ gap: space.sm }}><Txt bold>CPU usage</Txt><Bars label="CPU usage" values={series('cpu', 100)} /></Card>
                <Card style={{ gap: space.sm }}><Txt bold>Memory used</Txt><Bars label="Memory used" color={t.chart2} values={series('memused')} /></Card>
                <Card style={{ gap: space.sm }}><Txt bold>Network in</Txt><Bars label="Network in" values={series('netin')} /></Card>
              </View>
            )}
          </Async>
        </>
      )}
      {tab === 'disks' && (
        <Async q={disks} rows={2} h={80} isEmpty={(d) => d.length === 0} empty={{ title: 'No disks visible' }}>
          {(list) => (
            <Card style={{ paddingVertical: 0 }}>
              {list.map((d, i) => (
                <ListRow key={d.devpath} first={i === 0} title={d.model || d.devpath}
                  sub={`${d.devpath} · ${d.type} · ${fmtBytes(d.size)}${d.wearout != null ? ` · ${d.wearout}% life left` : ''}`}
                  right={<Badge tone={d.health === 'PASSED' || d.health === 'OK' ? 'green' : d.health === 'UNKNOWN' ? 'gray' : 'red'}>{d.health}</Badge>} />
              ))}
            </Card>
          )}
        </Async>
      )}
      {tab === 'services' && (
        <Async q={services} rows={6} h={52} isEmpty={(d) => d.length === 0} empty={{ title: 'No services' }}>
          {(list) => (
            <Card style={{ paddingVertical: 0 }}>
              {list.map((s, i) => (
                <ListRow key={s.name} first={i === 0} title={s.name} sub={s.desc}
                  right={<Badge tone={s.state === 'running' ? 'green' : s.unit === 'disabled' || s.unit === 'not-found' ? 'gray' : 'red'}>{s.state}</Badge>} />
              ))}
            </Card>
          )}
        </Async>
      )}
    </Screen>
  );
}
