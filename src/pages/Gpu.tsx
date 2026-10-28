import { useState } from 'react';
import { api } from '../api';
import { Async, Badge, Card, CardHead, Chips, Icon, Meter, PageHeader } from '../components/ui';
import { KV, LogList, SINCE } from '../components/Pve';
import { fmtBytes } from '../format';
import { useQuery } from '../hooks';
import type { Gpu as GpuT } from '../types';

export default function Gpu() {
  const q = useQuery(api.gpu, [], 5000);
  const [since, setSince] = useState('7d');
  const logs = useQuery(() => api.gpuLogs(since), [since], 30_000);
  return (
    <>
      <PageHeader eyebrow="Datacenter" title="GPU & passthrough" sub="Graphics devices on the host, which VM owns each one, IOMMU isolation, PCIe link health and kernel GPU logs." />
      <Async q={q} rows={2} h={180} isEmpty={(d) => d.gpus.length === 0} empty={{ title: 'No GPUs found', hint: 'Proxmox lists no display-class PCI devices.' }}>
        {(d) => (
          <>
            <Card>
              <CardHead title="IOMMU" sub="Required for PCI passthrough" right={<Badge tone={d.iommu.enabled ? 'green' : 'red'} dot>{d.iommu.enabled ? 'enabled' : 'disabled'}</Badge>} />
              <div className="chipline">{d.iommu.cmdline.length ? d.iommu.cmdline.map((a) => <code key={a}>{a}</code>) : <span className="muted small">No IOMMU / VFIO kernel parameters set.</span>}</div>
            </Card>
            <div className="gpu-grid">{d.gpus.map((g) => <GpuCard key={g.addr} g={g} />)}</div>
          </>
        )}
      </Async>
      <div className="toolbar"><span className="section-label grow">Kernel GPU log</span><Chips value={since} onChange={setSince} options={SINCE} /></div>
      <Async q={logs} rows={6} h={28} isEmpty={(d) => d.length === 0} empty={{ title: 'No GPU log lines', hint: 'The kernel logged nothing GPU-related in this range.' }}>
        {(lines) => <LogList lines={lines} empty="Passthrough resets and setup messages are normal; faults show here." />}
      </Async>
    </>
  );
}

function GpuCard({ g }: { g: GpuT }) {
  const t = g.telemetry;
  const narrow = g.link.width && g.link.maxWidth && Number(g.link.width) < Number(g.link.maxWidth);
  const slow = g.link.speed && g.link.maxSpeed && parseFloat(g.link.speed) < parseFloat(g.link.maxSpeed);
  return (
    <Card className="gpu-card">
      <div className="gpu-top">
        <div className={`gpu-ic ${g.mode}`}><Icon name="cpu" size={22} /></div>
        <div className="grow">
          <p className="eyebrow">{g.vendor}</p>
          <h3 className="gpu-name">{g.name}</h3>
          <p className="muted small mono">{g.addr} · {g.vendorId}:{g.deviceId}</p>
        </div>
        <Badge tone={g.mode === 'passthrough' ? 'blue' : g.mode === 'host' ? 'green' : 'gray'} dot>{g.mode}</Badge>
      </div>
      {g.mode === 'passthrough' && (
        <div className={`callout ${g.inUseBy ? 'ok' : 'warn'}`}>
          <Icon name={g.inUseBy ? 'check' : 'alert'} size={16} />
          <span>{g.inUseBy
            ? <>In use by <a className="link" href={`#/guests/${g.inUseBy.vmid}`}>{g.inUseBy.name} ({g.inUseBy.vmid})</a></>
            : g.assignedTo.length ? <>Assigned to {g.assignedTo.map((a) => `${a.name} (${a.vmid})`).join(', ')}, none running: the GPU is idle.</> : 'Bound to vfio-pci but not assigned to any VM.'}</span>
        </div>
      )}
      <KV rows={[
        ['Driver', <span className="mono">{g.driver ?? 'none'}</span>],
        ['IOMMU group', g.iommuGroup ? <>{g.iommuGroup}<span className="muted"> · {g.groupDevices.length} device{g.groupDevices.length === 1 ? '' : 's'}</span></> : '–'],
        ['PCIe link', g.link.speed ? <span className={narrow || slow ? 'err-t' : ''}>{g.link.speed} x{g.link.width}{(narrow || slow) ? ` (max ${g.link.maxSpeed} x${g.link.maxWidth})` : ''}</span> : '–'],
        ['Assigned to', g.assignedTo.length ? g.assignedTo.map((a) => <a key={a.vmid} className="link" href={`#/guests/${a.vmid}`}>{a.name} <Badge tone={a.status === 'running' ? 'green' : 'gray'}>{a.status}</Badge></a>) : <span className="muted">host only</span>],
        ['Functions', g.functions.map((f) => <div key={f.addr} className="mono small">{f.addr} · {f.name}</div>)],
      ]} />
      {narrow && <p className="muted small">The card trained at x{g.link.width} of x{g.link.maxWidth} lanes. This is normal for x8 cards and some slots; otherwise check riser and slot.</p>}
      {t ? (
        <div className="res gpu-tel">
          {t.busyPercent != null && <Res label="Utilisation" pct={t.busyPercent / 100} text={`${t.busyPercent}%`} />}
          {t.vramTotal ? <Res label="VRAM" pct={(t.vramUsed ?? 0) / t.vramTotal} text={`${fmtBytes(t.vramUsed ?? 0)} / ${fmtBytes(t.vramTotal)}`} /> : null}
          <div className="tel-row">
            {t.tempC != null && <span><b>{t.tempC.toFixed(0)}°C</b><small className="muted">temp</small></span>}
            {t.powerW != null && <span><b>{t.powerW.toFixed(1)} W</b><small className="muted">power</small></span>}
            {t.clockMHz != null && <span><b>{t.clockMHz} MHz</b><small className="muted">core clock</small></span>}
          </div>
        </div>
      ) : g.mode === 'passthrough' ? <p className="muted small">Live telemetry is not available from the host while the GPU is passed through; the VM owns the device.</p> : null}
    </Card>
  );
}

function Res({ label, pct, text }: { label: string; pct: number; text: string }) {
  return (
    <div className="res-row">
      <div className="res-top"><span>{label}</span><b>{text}</b></div>
      <Meter value={pct} />
    </div>
  );
}

