import { useState } from 'react';
import { api } from '../api';
import { Async, Badge, Chips, Icon, PageHeader } from '../components/ui';
import type { Tone } from '../components/ui';
import { hostOf } from '../format';
import { useQuery, useSearch } from '../hooks';
import type { KumaMonitor, NginxSite } from '../types';

type Filter = 'all' | 'ssl' | 'nossl' | 'proxy' | 'static';

function monitorFor(site: NginxSite, monitors: KumaMonitor[] | undefined): KumaMonitor | undefined {
  if (!monitors) return undefined;
  const names = site.serverNames.map((n) => n.toLowerCase());
  return monitors.find((m) => names.includes(hostOf(m.url)) || names.some((n) => m.name.toLowerCase() === n.split('.')[0]));
}
const TONE: Record<string, Tone> = { up: 'green', down: 'red', pending: 'amber', maintenance: 'blue' };

export default function Nginx() {
  const q = useQuery(api.nginx, [], 0);
  const kuma = useQuery(api.monitors, [], 15000);
  const { q: search } = useSearch();
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  return (
    <>
      <PageHeader title="Nginx sites" sub="Read-only view of sites-enabled." actions={
        <div className="seg">
          <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} aria-label="Card view"><Icon name="grid" size={16} /></button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="Table view"><Icon name="list" size={16} /></button>
        </div>
      } />
      <Async q={q} rows={4} h={120} isEmpty={(d) => d.length === 0} empty={{ title: 'No sites enabled', hint: 'sites-enabled is empty or not mounted.' }}>
        {(sites) => {
          const s = search.trim().toLowerCase();
          const rows = sites.filter((x) => {
            if (filter === 'ssl' && !x.ssl) return false;
            if (filter === 'nossl' && x.ssl) return false;
            if (filter === 'proxy' && !x.upstream) return false;
            if (filter === 'static' && x.upstream) return false;
            return !s || `${x.file} ${x.serverNames.join(' ')} ${x.upstream ?? ''} ${x.root ?? ''}`.toLowerCase().includes(s);
          });
          return (
            <>
              <div className="toolbar">
                <Chips value={filter} onChange={setFilter} options={[
                  { id: 'all', label: 'All', count: sites.length }, { id: 'ssl', label: 'SSL', count: sites.filter((x) => x.ssl).length },
                  { id: 'nossl', label: 'No SSL', count: sites.filter((x) => !x.ssl).length },
                  { id: 'proxy', label: 'Proxy', count: sites.filter((x) => x.upstream).length }, { id: 'static', label: 'Static', count: sites.filter((x) => !x.upstream).length },
                ]} />
              </div>
              {rows.length === 0 ? (
                <div className="card pad"><div className="empty"><div className="empty-ic"><Icon name="search" size={22} /></div><strong>No sites match</strong><p className="muted small">Try a different search or filter.</p></div></div>
              ) : view === 'grid' ? (
                <div className="site-grid">
                  {rows.map((x) => {
                    const m = monitorFor(x, kuma.data);
                    return (
                      <a key={x.file} className="site" href={x.url} target="_blank" rel="noopener noreferrer">
                        <div className="site-top">
                          <div className={`site-ic ${x.ssl ? 'ssl' : ''}`}><Icon name={x.ssl ? 'lock' : 'unlock'} size={18} /></div>
                          <div className="grow">
                            <b>{x.serverNames[0]}</b>
                            {x.serverNames.length > 1 && <small className="muted">+ {x.serverNames.slice(1).join(', ')}</small>}
                          </div>
                          <Icon name="external" size={15} />
                        </div>
                        <div className="site-badges">
                          <Badge tone={x.ssl ? 'green' : 'amber'}>{x.ssl ? 'SSL on' : 'SSL off'}</Badge>
                          {m && <Badge tone={TONE[m.status]} dot title={`Uptime Kuma: ${m.name}`}>{m.status}</Badge>}
                        </div>
                        <dl>
                          <div><dt>Listen</dt><dd>{x.listen.join(', ')}</dd></div>
                          <div><dt>{x.upstream ? 'Upstream' : 'Root'}</dt><dd className="mono">{x.upstream ?? x.root ?? '–'}</dd></div>
                          <div><dt>File</dt><dd className="mono">{x.file}</dd></div>
                        </dl>
                      </a>
                    );
                  })}
                </div>
              ) : (
                <div className="card table">
                  <div className="n-row g-head"><span>Site</span><span>SSL</span><span>Monitor</span><span>Listen</span><span>Upstream / root</span><span>File</span></div>
                  {rows.map((x) => {
                    const m = monitorFor(x, kuma.data);
                    return (
                      <a key={x.file} className="n-row" href={x.url} target="_blank" rel="noopener noreferrer">
                        <span><b>{x.serverNames.join(', ')}</b></span>
                        <span><Badge tone={x.ssl ? 'green' : 'amber'}>{x.ssl ? 'On' : 'Off'}</Badge></span>
                        <span>{m ? <Badge tone={TONE[m.status]} dot>{m.status}</Badge> : <span className="muted">–</span>}</span>
                        <span className="muted">{x.listen[0]}</span>
                        <span className="mono">{x.upstream ?? x.root ?? '–'}</span>
                        <span className="mono muted">{x.file}</span>
                      </a>
                    );
                  })}
                </div>
              )}
            </>
          );
        }}
      </Async>
    </>
  );
}
