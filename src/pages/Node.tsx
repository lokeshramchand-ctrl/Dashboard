import { useState } from 'react';
import { api } from '../api';
import { Async, Badge, Card, CardHead, Chips, Meter, PageHeader } from '../components/ui';
import { KV, RrdCard, TimeframePicker } from '../components/Pve';
import { fmtBytes, fmtPct, fmtUptime } from '../format';
import { useQuery, useSearch } from '../hooks';
import type { Timeframe } from '../types';

type Tab = 'summary' | 'network' | 'disks' | 'services' | 'storage';

export default function Node({ tab: initial }: { tab?: string }) {
  const [tab, setTab] = useState<Tab>((['summary', 'network', 'disks', 'services', 'storage'].includes(initial ?? '') ? initial : 'summary') as Tab);
  const node = useQuery(api.node, [], 5000);
  return (
    <>
      <PageHeader eyebrow="Datacenter / Node" title={node.data?.name ?? 'Node'} sub={node.data ? `Proxmox VE ${node.data.pveVersion} · ${node.data.kernel}` : 'Proxmox host summary, hardware and services.'} />
      <Chips value={tab} onChange={(t) => { setTab(t); history.replaceState(null, '', `#/node/${t}`); }} options={[
        { id: 'summary', label: 'Summary' }, { id: 'network', label: 'Network' }, { id: 'disks', label: 'Disks' },
        { id: 'services', label: 'System services' }, { id: 'storage', label: 'Storage' },
      ]} />
      {tab === 'summary' && <Summary node={node} />}
      {tab === 'network' && <Network />}
      {tab === 'disks' && <Disks />}
      {tab === 'services' && <Services />}
      {tab === 'storage' && <StorageTab />}
    </>
  );
}

function Summary({ node }: { node: ReturnType<typeof useQuery<Awaited<ReturnType<typeof api.node>>>> }) {
  const [tf, setTf] = useState<Timeframe>('hour');
  const rrd = useQuery(() => api.nodeRrd(tf), [tf], 60_000);
  return (
    <>
      <Async q={node} rows={2} h={160}>
        {(n) => (
          <div className="grid-3">
            <Card>
              <CardHead title="Status" sub={`Up ${fmtUptime(n.uptime)}`} />
              <div className="res">
                <Res label="CPU usage" pct={n.cpu} text={`${fmtPct(n.cpu, 1)} of ${n.cpus} CPUs`} />
                <Res label="IO delay" pct={n.wait} text={fmtPct(n.wait, 2)} />
                <Res label="RAM usage" pct={n.memUsed / n.memTotal} text={`${fmtBytes(n.memUsed)} / ${fmtBytes(n.memTotal)}`} />
                <Res label="SWAP usage" pct={n.swapTotal ? n.swapUsed / n.swapTotal : 0} text={n.swapTotal ? `${fmtBytes(n.swapUsed)} / ${fmtBytes(n.swapTotal)}` : 'none'} />
                <Res label="Root FS" pct={n.rootUsed / n.rootTotal} text={`${fmtBytes(n.rootUsed)} / ${fmtBytes(n.rootTotal)}`} />
              </div>
            </Card>
            <Card>
              <CardHead title="Hardware" />
              <KV rows={[
                ['CPU model', n.cpuModel || '–'],
                ['CPUs', `${n.cpus} (${n.sockets} socket${n.sockets === 1 ? '' : 's'}, ${n.cores} cores)`],
                ['Clock', n.mhz ? `${(n.mhz / 1000).toFixed(2)} GHz` : '–'],
                ['Load average', n.loadavg.map((v) => v.toFixed(2)).join(' · ')],
                ['KSM sharing', fmtBytes(n.ksmShared)],
                ['Boot mode', n.bootMode || '–'],
              ]} />
            </Card>
            <Card>
              <CardHead title="System" />
              <KV rows={[
                ['PVE manager', n.pveVersion],
                ['Kernel', <span className="mono">{n.kernel}</span>],
                ['Subscription', <Badge tone={n.subscription === 'active' ? 'green' : 'gray'}>{n.subscription === 'notfound' ? 'none' : n.subscription}</Badge>],
                ['Time zone', n.timezone || '–'],
                ['DNS', n.dns.join(', ') || '–'],
                ['Search domain', n.searchDomain || '–'],
              ]} />
            </Card>
          </div>
        )}
      </Async>
      <div className="toolbar"><span className="section-label grow">Performance</span><TimeframePicker value={tf} onChange={setTf} /></div>
      <div className="rrd-grid">
        <RrdCard title="CPU usage" q={rrd} unit="%" lines={[{ name: 'CPU', key: 'cpu', scale: 100 }, { name: 'IO delay', key: 'iowait', scale: 100 }]} />
        <RrdCard title="Server load" q={rrd} unit="" lines={[{ name: 'Load average', key: 'loadavg' }]} />
        <RrdCard title="Memory usage" q={rrd} unit="B" lines={[{ name: 'Total', key: 'memtotal' }, { name: 'Used', key: 'memused' }]} />
        <RrdCard title="Network traffic" q={rrd} unit="B/s" lines={[{ name: 'In', key: 'netin' }, { name: 'Out', key: 'netout' }]} />
      </div>
    </>
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

function Network() {
  const q = useQuery(api.network, [], 30_000);
  const { q: s } = useSearch();
  return (
    <Async q={q} rows={5} h={44} isEmpty={(d) => d.length === 0} empty={{ title: 'No interfaces' }}>
      {(list) => (
        <div className="card table">
          <div className="dt-row dt-net g-head"><span>Name</span><span>Type</span><span>Active</span><span>Autostart</span><span>Ports / slaves</span><span>CIDR</span><span>Gateway</span><span>Comment</span></div>
          {list.filter((i) => !s || `${i.iface} ${i.type} ${i.cidr ?? ''} ${i.comments}`.toLowerCase().includes(s.toLowerCase())).map((i) => (
            <div key={i.iface} className="dt-row dt-net">
              <span><b className="mono">{i.iface}</b></span>
              <span><Badge tone={i.type === 'bridge' ? 'blue' : 'gray'}>{i.type}</Badge></span>
              <span><Badge tone={i.active ? 'green' : 'gray'} dot>{i.active ? 'yes' : 'no'}</Badge></span>
              <span className="muted">{i.autostart ? 'Yes' : 'No'}</span>
              <span className="mono muted">{i.ports.join(' ') || '–'}{i.vlanAware && <em className="tag">VLAN</em>}</span>
              <span className="mono">{[i.cidr, i.cidr6].filter(Boolean).join(' · ') || '–'}</span>
              <span className="mono muted">{i.gateway ?? '–'}</span>
              <span className="muted">{i.comments || '–'}</span>
            </div>
          ))}
          {!list.some((i) => i.type === 'bridge' || i.type === 'OVSBridge') && <p className="muted small pad">Linux bridges (vmbr*) are hidden: the dashboard token needs SDN.Audit on /sdn/zones/localnetwork to list them.</p>}
        </div>
      )}
    </Async>
  );
}

function Disks() {
  const q = useQuery(api.disks, [], 60_000);
  return (
    <Async q={q} rows={3} h={44} isEmpty={(d) => d.length === 0} empty={{ title: 'No disks visible' }}>
      {(list) => (
        <div className="card table">
          <div className="dt-row dt-disk g-head"><span>Device</span><span>Model</span><span>Type</span><span>Usage</span><span>Size</span><span>S.M.A.R.T.</span><span>Wearout</span></div>
          {list.map((d) => (
            <div key={d.devpath} className="dt-row dt-disk">
              <span><b className="mono">{d.devpath}</b></span>
              <span><b>{d.model || '–'}</b><small className="muted mono block">{d.serial}</small></span>
              <span><Badge tone={d.type === 'nvme' || d.type === 'ssd' ? 'blue' : 'gray'}>{d.type}</Badge></span>
              <span className="muted">{d.used || 'unused'}</span>
              <span>{fmtBytes(d.size)}</span>
              <span><Badge tone={d.health === 'PASSED' || d.health === 'OK' ? 'green' : d.health === 'UNKNOWN' ? 'gray' : 'red'} dot>{d.health}</Badge></span>
              <span className="c-cpu">{d.wearout == null ? <span className="muted">N/A</span> : <><span className="mv">{d.wearout}% left</span><Meter value={(100 - d.wearout) / 100} /></>}</span>
            </div>
          ))}
        </div>
      )}
    </Async>
  );
}

function Services() {
  const q = useQuery(api.services, [], 15_000);
  return (
    <Async q={q} rows={6} h={40} isEmpty={(d) => d.length === 0} empty={{ title: 'No services' }}>
      {(list) => (
        <div className="card table">
          <div className="dt-row dt-svc g-head"><span>Service</span><span>State</span><span>Unit</span><span>Description</span></div>
          {list.map((s) => (
            <div key={s.name} className="dt-row dt-svc">
              <span><b className="mono">{s.name}</b></span>
              <span><Badge tone={s.state === 'running' ? 'green' : s.unit === 'disabled' || s.unit === 'not-found' ? 'gray' : 'red'} dot>{s.state}</Badge></span>
              <span className="muted">{s.unit}</span>
              <span className="muted">{s.desc}</span>
            </div>
          ))}
        </div>
      )}
    </Async>
  );
}

function StorageTab() {
  const q = useQuery(api.storage, [], 30_000);
  return (
    <Async q={q} rows={3} h={60} isEmpty={(d) => d.length === 0}
      empty={{ title: 'No storage visible', hint: 'The dashboard API token needs the Datastore.Audit privilege on /storage to list storage.' }}>
      {(list) => (
        <div className="card table">
          <div className="dt-row dt-sto g-head"><span>Storage</span><span>Type</span><span>Content</span><span>Status</span><span>Usage</span></div>
          {list.map((s) => (
            <div key={s.storage} className="dt-row dt-sto">
              <span><b>{s.storage}</b>{s.shared && <em className="tag">shared</em>}</span>
              <span><Badge tone="gray">{s.type}</Badge></span>
              <span className="muted">{s.content.join(', ')}</span>
              <span><Badge tone={s.active ? 'green' : 'red'} dot>{s.active ? 'active' : 'inactive'}</Badge></span>
              <span className="c-cpu"><span className="mv">{fmtBytes(s.used)} / {fmtBytes(s.total)}</span><Meter value={s.total ? s.used / s.total : 0} /></span>
            </div>
          ))}
        </div>
      )}
    </Async>
  );
}

