import { useState } from 'react';
import { api } from '../api';
import { MetricChart } from '../components/MetricChart';
import { Async, Badge, Card, CardHead, Chips, EmptyState, Icon, PageHeader, SearchBox } from '../components/ui';
import { useQuery, useSearch } from '../hooks';
import type { GrafanaDashboard } from '../types';

const PRESETS = [
  { label: 'CPU busy %', q: '100 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100', unit: '%' },
  { label: 'Memory used %', q: '(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100', unit: '%' },
  { label: 'Root disk used %', q: '100 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} * 100', unit: '%' },
  { label: 'Network receive', q: 'rate(node_network_receive_bytes_total{device="vmbr0"}[5m])', unit: 'B/s' },
];
const RANGES = [{ id: '3600', label: '1h' }, { id: '21600', label: '6h' }, { id: '86400', label: '24h' }];

export default function Grafana({ uid }: { uid?: string }) {
  const q = useQuery(api.dashboards, [], 0);
  if (uid) return <Detail uid={uid} list={q.data} />;
  return <List q={q} />;
}

function List({ q }: { q: ReturnType<typeof useQuery<GrafanaDashboard[]>> }) {
  const { q: search } = useSearch();
  const [preset, setPreset] = useState(0);
  const [custom, setCustom] = useState('');
  const [range, setRange] = useState('3600');
  const active = custom.trim() ? { label: 'Custom query', q: custom.trim(), unit: '' } : PRESETS[preset];

  return (
    <>
      <PageHeader title="Grafana" sub="Dashboards and live metrics, powered by your existing Grafana." />
      <Card>
        <CardHead title="Metrics explorer" sub="PromQL via /api/metrics/query" right={<Chips value={range} onChange={setRange} options={RANGES} />} />
        <div className="explorer">
          <div className="chips">
            {PRESETS.map((p, i) => <button key={p.label} className={!custom && preset === i ? 'on' : ''} onClick={() => { setPreset(i); setCustom(''); }}>{p.label}</button>)}
          </div>
          <input className="input mono" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Or type PromQL, e.g. rate(node_cpu_seconds_total[5m])" aria-label="Custom PromQL query" />
        </div>
        <MetricChart query={active.q} unit={active.unit} rangeSec={+range} name={active.label} />
      </Card>

      <Async q={q} rows={4} h={72} isEmpty={(d) => d.length === 0} empty={{ title: 'No dashboards', hint: 'The service account can’t see any dashboards yet.' }}>
        {(list) => {
          const s = search.trim().toLowerCase();
          const rows = list.filter((d) => !s || `${d.title} ${d.folder} ${d.tags.join(' ')}`.toLowerCase().includes(s));
          if (!rows.length) return <div className="card pad"><EmptyState icon="search" title="No dashboards match" hint="Try a different search." /></div>;
          return (
            <div className="dash-grid">
              {rows.map((d) => (
                <a key={d.uid} className="dash" href={`#/grafana/${encodeURIComponent(d.uid)}`}>
                  <div className="dash-ic"><Icon name="chart" size={20} /></div>
                  <div className="grow">
                    <b>{d.title}</b>
                    <p className="muted small">{d.folder}</p>
                    <div className="tags">{d.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>
                  </div>
                </a>
              ))}
            </div>
          );
        }}
      </Async>
    </>
  );
}

function Detail({ uid, list }: { uid: string; list?: GrafanaDashboard[] }) {
  const d = list?.find((x) => x.uid === uid);
  const panels = useQuery(() => api.panels(uid), [uid], 0);
  const [mode, setMode] = useState<'full' | 'panels'>('full');

  return (
    <>
      <PageHeader title={d?.title ?? 'Dashboard'} sub={d ? `${d.folder} · ${d.tags.join(', ')}` : undefined} actions={
        <>
          <a className="btn" href="#/grafana"><Icon name="back" size={15} />All dashboards</a>
          {d && <a className="btn btn-primary" href={d.url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={15} />Open in Grafana</a>}
        </>
      } />
      <div className="toolbar"><Chips value={mode} onChange={setMode} options={[{ id: 'full', label: 'Full dashboard' }, { id: 'panels', label: 'Panels' }]} /></div>
      {mode === 'full' ? (
        d ? (
          <Card pad={false} className="frame-card">
            <iframe title={d.title} src={d.embedUrl} className="frame tall" loading="lazy" />
            <p className="frame-foot muted small">Blank or refused to connect? Grafana needs <code>allow_embedding = true</code>. <a className="link" href={d.url} target="_blank" rel="noopener noreferrer">Open in Grafana</a></p>
          </Card>
        ) : <Card><EmptyState title="Dashboard not found" hint="It may have been removed or renamed." action={<a className="btn" href="#/grafana">Back to list</a>} /></Card>
      ) : (
        <Async q={panels} rows={3} h={200} isEmpty={(p) => p.length === 0} empty={{ title: 'No panels', hint: 'This dashboard has no embeddable panels.' }}>
          {(ps) => (
            <div className="panel-grid">
              {ps.map((p) => (
                <Card key={p.id} pad={false} className="frame-card">
                  <div className="frame-title">{p.title}</div>
                  <iframe title={p.title} src={p.embedUrl} className="frame" loading="lazy" />
                </Card>
              ))}
            </div>
          )}
        </Async>
      )}
    </>
  );
}
