import { useState } from 'react';
import { View } from 'react-native';
import { api } from '../api';
import { Async, Badge, Card, Chips, KV, Screen, SectionTitle, Txt } from '../components/ui';
import { fmtBytes } from '../format';
import { space } from '../theme';
import { useQuery } from '../useQuery';
import { LogLines, SINCE } from './Diagnostics';
import { Res } from './Node';

export default function Gpu({ onBack }: { onBack: () => void }) {
  const [since, setSince] = useState('7d');
  const q = useQuery(api.gpu, 5000);
  const logs = useQuery(() => api.gpuLogs(since), 30_000, [since]);
  return (
    <Screen title="GPU & passthrough" sub="Which VM owns each GPU, IOMMU, PCIe link and kernel GPU logs." back={{ label: 'More', onPress: onBack }} queries={[q, logs]}>
      <Async q={q} rows={2} h={160} isEmpty={(d) => d.gpus.length === 0} empty={{ title: 'No GPUs found' }}>
        {(d) => (
          <>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Txt bold style={{ flex: 1 }}>IOMMU</Txt>
              <Badge tone={d.iommu.enabled ? 'green' : 'red'}>{d.iommu.enabled ? 'enabled' : 'disabled'}</Badge>
            </Card>
            {d.gpus.map((g) => {
              const narrow = g.link.width && g.link.maxWidth && Number(g.link.width) < Number(g.link.maxWidth);
              const t = g.telemetry;
              return (
                <Card key={g.addr} style={{ gap: space.md }}>
                  <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Txt muted small>{g.vendor}</Txt>
                      <Txt bold style={{ fontSize: 17 }}>{g.name}</Txt>
                      <Txt muted small>{g.addr}</Txt>
                    </View>
                    <Badge tone={g.mode === 'passthrough' ? 'blue' : g.mode === 'host' ? 'green' : 'gray'}>{g.mode}</Badge>
                  </View>
                  {g.mode === 'passthrough' ? (
                    <Badge tone={g.inUseBy ? 'green' : 'amber'}>{g.inUseBy ? `In use by ${g.inUseBy.name} (${g.inUseBy.vmid})` : 'Idle: assigned VM not running'}</Badge>
                  ) : null}
                  <KV rows={[
                    ['Driver', g.driver ?? 'none'], ['IOMMU group', g.iommuGroup ?? '–'],
                    ['PCIe link', <Txt small bold tone={narrow ? 'red' : undefined}>{g.link.speed ? `${g.link.speed} x${g.link.width}${narrow ? ` (max x${g.link.maxWidth})` : ''}` : '–'}</Txt>],
                    ['Assigned to', g.assignedTo.length ? g.assignedTo.map((a) => `${a.name} (${a.status})`).join(', ') : 'host only'],
                  ]} />
                  {t ? (
                    <View style={{ gap: space.sm }}>
                      {t.busyPercent != null ? <Res label="Utilisation" pct={t.busyPercent / 100} text={`${t.busyPercent}%`} /> : null}
                      {t.vramTotal ? <Res label="VRAM" pct={(t.vramUsed ?? 0) / t.vramTotal} text={`${fmtBytes(t.vramUsed ?? 0)} / ${fmtBytes(t.vramTotal)}`} /> : null}
                      <Txt muted small>{[t.tempC != null && `${t.tempC.toFixed(0)}°C`, t.powerW != null && `${t.powerW.toFixed(1)} W`, t.clockMHz != null && `${t.clockMHz} MHz`].filter(Boolean).join(' · ')}</Txt>
                    </View>
                  ) : g.mode === 'passthrough' ? <Txt muted small>No host telemetry while passed through: the VM owns the device.</Txt> : null}
                </Card>
              );
            })}
          </>
        )}
      </Async>
      <SectionTitle>Kernel GPU log</SectionTitle>
      <Chips value={since} onChange={setSince} options={SINCE} />
      <Async q={logs} rows={4} h={40} isEmpty={(d) => d.length === 0} empty={{ title: 'No GPU log lines' }}>
        {(lines) => <LogLines lines={lines} />}
      </Async>
    </Screen>
  );
}
