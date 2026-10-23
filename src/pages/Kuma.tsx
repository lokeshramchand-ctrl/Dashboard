import { useState } from 'react';
import { api } from '../api';
import { Async, Badge, Card, Chips, HeartbeatBar, Icon, PageHeader, SearchBox } from '../components/ui';
import type { Tone } from '../components/ui';
import { timeAgo } from '../format';
import { useQuery, useSearch } from '../hooks';
import type { KumaStatus } from '../types';

const TONE: Record<KumaStatus, Tone> = { up: 'green', down: 'red', pending: 'amber', maintenance: 'blue' };
type Filter = 'all' | KumaStatus;

export default function Kuma({ statusUrl }: { statusUrl?: string }) {
  const q = useQuery(api.monitors, [], 8000);
  const { q: search } = useSearch();
  const [filter, setFilter] = useState<Filter>('all');
  const [embed, setEmbed] = useState(false);

  return (
    <>
      <PageHeader title="Uptime Kuma" sub="Service availability and response times." actions={
        statusUrl ? (
          <>
            <button className="btn" onClick={() => setEmbed((e) => !e)}>{embed ? 'Hide status page' : 'Embed status page'}</button>
            <a className="btn btn-primary" href={statusUrl} target="_blank" rel="noopener noreferrer"><Icon name="external" size={15} />Status page</a>
          </>
        ) : undefined
      } />
      {embed && statusUrl && (
        <Card pad={false} className="frame-card">
          <iframe title="Uptime Kuma status page" src={statusUrl} className="frame tall" />
          <p className="frame-foot muted small">Not loading? <a className="link" href={statusUrl} target="_blank" rel="noopener noreferrer">Open it in a new tab</a>.</p>
        </Card>
      )}
      <Async q={q} rows={6} h={64} isEmpty={(d) => d.length === 0} empty={{ title: 'No monitors', hint: 'Add monitors in Uptime Kuma and they appear here.' }}>
        {(list) => {
          const n = (s: KumaStatus) => list.filter((m) => m.status === s).length;
          const s = search.trim().toLowerCase();
          const rows = list.filter((m) => (filter === 'all' || m.status === filter) && (!s || `${m.name} ${m.url} ${m.type}`.toLowerCase().includes(s)));
          return (
            <>
              <div className="toolbar">
                <Chips value={filter} onChange={setFilter} options={[
                  { id: 'all', label: 'All', count: list.length }, { id: 'up', label: 'Up', count: n('up') }, { id: 'down', label: 'Down', count: n('down') },
                  { id: 'pending', label: 'Pending', count: n('pending') }, { id: 'maintenance', label: 'Maintenance', count: n('maintenance') },
                ]} />
              </div>
              <div className="card table">
                <div className="k-row g-head"><span>Monitor</span><span>Status</span><span>24h</span><span>30d</span><span>Avg</span><span>Last check</span><span>Heartbeats</span></div>
                {rows.length === 0 && <div className="pad"><div className="empty"><div className="empty-ic"><Icon name="search" size={22} /></div><strong>No monitors match</strong><p className="muted small">Try a different search or filter.</p></div></div>}
                {rows.map((m) => (
                  <div key={m.id} className="k-row">
                    <span className="k-name"><b>{m.name}</b><small className="muted mono">{m.url}</small></span>
                    <span><Badge tone={TONE[m.status]} dot>{m.status}</Badge></span>
                    <span className="k-num" data-l="24h">{m.uptime24h.toFixed(1)}%</span>
                    <span className="k-num" data-l="30d">{m.uptime30d.toFixed(1)}%</span>
                    <span className="k-num" data-l="Avg">{m.avgPing != null ? `${m.avgPing} ms` : '–'}</span>
                    <span className="muted small">{timeAgo(m.lastCheck)}</span>
                    <span className="k-hb"><HeartbeatBar beats={m.heartbeats} /></span>
                  </div>
                ))}
              </div>
            </>
          );
        }}
      </Async>
      {!statusUrl && <p className="muted small">Tip: set <code>kumaStatusUrl</code> in <code>config.json</code> to show a status page link and embed here.</p>}
    </>
  );
}
