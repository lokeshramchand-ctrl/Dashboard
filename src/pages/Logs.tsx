import { useState } from 'react';
import { api } from '../api';
import { Async, Badge, Card, CardHead, Chips, PageHeader } from '../components/ui';
import type { Tone } from '../components/ui';
import { useQuery, useSearch } from '../hooks';
import type { BootInfo, EventLevel, LokiLine } from '../types';

type Tab = 'events' | 'journal' | 'loki' | 'boots';
const LEVEL: Record<EventLevel, Tone> = { info: 'blue', warn: 'amber', error: 'red' };
const PRIO = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'];
const PRIO_TONE: Tone[] = ['red', 'red', 'red', 'red', 'amber', 'blue', 'gray', 'gray'];
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dur = (a: string, b: string) => {
  const m = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));
  return m < 120 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};

export default function Logs() {
  const [tab, setTab] = useState<Tab>('events');
  const summary = useQuery(api.logSummary, [], 30000);
  return (
    <>
      <PageHeader title="Logs" sub="Dashboard events and the host journal: use it to see why something went offline." />
      <div className="toolbar">
        <Chips value={tab} onChange={setTab} options={[
          { id: 'events', label: 'Events', count: summary.data?.errors24h },
          { id: 'journal', label: 'Host journal' },
          { id: 'loki', label: 'Loki' },
          { id: 'boots', label: 'Boot history' },
        ]} />
        {summary.data && summary.data.errors24h > 0 && <Badge tone="red" dot>{summary.data.errors24h} errors in 24 h</Badge>}
      </div>
      {tab === 'events' && <Events />}
      {tab === 'journal' && <Journal />}
      {tab === 'loki' && <Loki />}
      {tab === 'boots' && <Boots />}
    </>
  );
}

function Events() {
  const { q: search } = useSearch();
  const [level, setLevel] = useState<'all' | EventLevel>('all');
  const [source, setSource] = useState('all');
  const q = useQuery(() => api.events({ level: level === 'all' ? undefined : level, source: source === 'all' ? undefined : source, q: search.trim() || undefined }), [level, source, search], 10000);
  return (
    <>
      <div className="toolbar">
        <Chips value={level} onChange={setLevel} options={[{ id: 'all', label: 'All' }, { id: 'error', label: 'Errors' }, { id: 'warn', label: 'Warnings' }, { id: 'info', label: 'Info' }]} />
        <Chips value={source} onChange={setSource} options={['all', 'app', 'db', 'host', 'guest', 'monitor', 'auth'].map((s) => ({ id: s, label: s === 'all' ? 'Any source' : s }))} />
      </div>
      <Card pad={false}>
        <Async q={q} rows={6} h={36} isEmpty={(d) => d.length === 0} empty={{ title: 'No events', hint: 'Nothing matches these filters.' }}>
          {(rows) => (
            <div className="log-list">
              {rows.map((e) => (
                <div key={e.id} className={`log-row ${e.level === 'info' ? '' : e.level === 'error' ? 'err' : 'warn'}`}>
                  <span className="muted">{when(e.ts)}</span>
                  <span><Badge tone={LEVEL[e.level]}>{e.level}</Badge></span>
                  <span className="muted">{e.source}</span>
                  <span className="msg">{e.message}</span>
                </div>
              ))}
            </div>
          )}
        </Async>
      </Card>
    </>
  );
}

function Journal() {
  const { q: search } = useSearch();
  const [priority, setPriority] = useState('err');
  const [boot, setBoot] = useState('0');
  const [kernel, setKernel] = useState(false);
  const [unit, setUnit] = useState('');
  const q = useQuery(() => api.journal({
    priority: priority === 'all' ? undefined : priority, boot, kernel: kernel ? 'true' : undefined,
    unit: unit.trim() || undefined, q: search.trim() || undefined,
  }), [priority, boot, kernel, unit, search], 0);
  return (
    <>
      <div className="toolbar">
        <Chips value={priority} onChange={setPriority} options={[
          { id: 'crit', label: 'Critical' }, { id: 'err', label: 'Errors+' }, { id: 'warning', label: 'Warnings+' }, { id: 'info', label: 'Info+' }, { id: 'all', label: 'Everything' },
        ]} />
        <Chips value={boot} onChange={setBoot} options={[{ id: '0', label: 'This boot' }, { id: '-1', label: 'Previous boot' }, { id: '-2', label: '2 boots ago' }]} />
        <Chips value={kernel ? 'k' : 'all'} onChange={(v) => setKernel(v === 'k')} options={[{ id: 'all', label: 'All sources' }, { id: 'k', label: 'Kernel only' }]} />
        <input className="input" style={{ maxWidth: 240 }} placeholder="Unit, e.g. pveproxy.service" aria-label="Unit filter" value={unit} onChange={(e) => setUnit(e.target.value)} />
      </div>
      <Card pad={false}>
        <Async q={q} rows={8} h={36} isEmpty={(d) => d.length === 0} empty={{ title: 'No journal entries', hint: 'Nothing matches these filters, which is good news at error level.' }}>
          {(rows) => (
            <div className="log-list">
              {rows.map((l, i) => (
                <div key={i} className={`log-row ${l.priority <= 3 ? 'err' : l.priority === 4 ? 'warn' : ''}`}>
                  <span className="muted">{when(l.ts)}</span>
                  <span><Badge tone={PRIO_TONE[l.priority] ?? 'gray'}>{PRIO[l.priority] ?? l.priority}</Badge></span>
                  <span className="muted" title={l.unit}>{l.unit.replace(/\.service$/, '')}</span>
                  <span className="msg">{l.message}</span>
                </div>
              ))}
            </div>
          )}
        </Async>
      </Card>
    </>
  );
}

function Boots() {
  const q = useQuery(api.logSummary, [], 0);
  return (
    <Card pad={false}>
      <CardHead title="Host boots" sub="A boot whose journal ends with no shutdown sequence lost power, was reset, or crashed." />
      <Async q={q} rows={4} h={52} isEmpty={(d) => d.boots.length === 0} empty={{ title: 'No boot history', hint: q.data?.journalError ?? 'The journal is not readable by the dashboard user.' }}>
        {(d) => (
          <div className="boot-list">
            {d.boots.map((b: BootInfo) => (
              <div key={b.bootId} className="boot-row">
                <span className="mono">{b.index === 0 ? 'now' : b.index}</span>
                <span>
                  <b>{when(b.first)}</b> → {b.index === 0 ? 'running' : when(b.last)}
                  <br /><small className="muted">{b.index === 0 ? `up ${dur(b.first, new Date().toISOString())}` : `ran ${dur(b.first, b.last)} · ${b.endReason}`}</small>
                </span>
                <span>{b.clean === null ? <Badge tone="blue">current</Badge> : b.clean ? <Badge tone="green">clean stop</Badge> : <Badge tone="red" dot>unclean stop</Badge>}</span>
              </div>
            ))}
          </div>
        )}
      </Async>
    </Card>
  );
}

const RANGES = ['15m', '1h', '6h', '24h', '7d'];
const LVL = /\b(crit|fatal|panic|error|err|warn(?:ing)?)\b/i;
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// Queries Loki live through the backend; nothing is copied or stored by the dashboard.
function Loki() {
  const { q: search } = useSearch();
  const status = useQuery(api.lokiStatus, [], 0);
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [raw, setRaw] = useState('');
  const [since, setSince] = useState('1h');
  const [live, setLive] = useState(false);
  const labels = status.data?.labels ?? [];
  const values = useQuery(() => (label ? api.lokiLabelValues(label) : Promise.resolve([] as string[])), [label], 0);

  const base = raw.trim() || (label && value ? `{${label}="${esc(value)}"}` : label ? `{${label}=~".+"}` : '');
  const text = search.trim();
  const query = base && !raw.trim() && text ? `${base} |~ "(?i)${esc(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}"` : base;
  const lines = useQuery(() => (query ? api.lokiQuery(query, since) : Promise.resolve([] as LokiLine[])), [query, since], live ? 5000 : 0);
  const hist = useQuery(() => (query ? api.lokiHistogram(query, since) : Promise.resolve(null)), [query, since], live ? 15000 : 0);

  if (status.data && !status.data.configured) return <Card><CardHead title="Loki is not configured" sub="Set LOKI_URL in server/.env (for example http://10.10.10.121:3100) and restart the dashboard." /></Card>;
  const max = Math.max(1, ...(hist.data?.points.map((p) => p.n) ?? [1]));
  return (
    <>
      <div className="toolbar">
        {status.data && (status.data.ready ? <Badge tone="green" dot>Loki connected</Badge> : <Badge tone="red" dot>{status.data.error ?? 'Loki unreachable'}</Badge>)}
        <select className="input" style={{ maxWidth: 180 }} aria-label="Label" value={label} onChange={(e) => { setLabel(e.target.value); setValue(''); }}>
          <option value="">Pick a label…</option>
          {labels.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className="input" style={{ maxWidth: 220 }} aria-label="Value" value={value} disabled={!label} onChange={(e) => setValue(e.target.value)}>
          <option value="">Any value</option>
          {(values.data ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <Chips value={since} onChange={setSince} options={RANGES.map((r) => ({ id: r, label: r }))} />
        <Chips value={live ? 'live' : 'off'} onChange={(v) => setLive(v === 'live')} options={[{ id: 'off', label: 'Paused' }, { id: 'live', label: 'Live 5 s' }]} />
      </div>
      <div className="toolbar">
        <input className="input mono" style={{ flex: 1 }} placeholder='Or write LogQL, e.g. {job="varlogs"} |= "error"' aria-label="LogQL query" value={raw} onChange={(e) => setRaw(e.target.value)} />
      </div>
      {query && hist.data && hist.data.points.length > 0 && (
        <Card>
          <div className="loki-bars" role="img" aria-label={`Matching lines over the last ${since}`}>
            {hist.data.points.map((p) => <span key={p.t} title={`${when(p.t)}: ${p.n}`} style={{ height: `${Math.max(2, (p.n / max) * 100)}%` }} />)}
          </div>
        </Card>
      )}
      <Card pad={false}>
        {!query
          ? <CardHead title="Choose a label or write a query" sub={`${labels.length} labels available. Results come straight from Loki; the dashboard stores nothing.`} />
          : (
            <Async q={lines} rows={8} h={36} isEmpty={(d) => d.length === 0} empty={{ title: 'No log lines', hint: `Nothing matched ${query} in the last ${since}.` }}>
              {(rows) => (
                <div className="log-list">
                  {rows.map((l) => (
                    <div key={l.ns} className={`log-row ${/\b(crit|fatal|panic|error|err)\b/i.test(l.line) ? 'err' : LVL.test(l.line) ? 'warn' : ''}`}>
                      <span className="muted">{when(l.ts)}</span>
                      <span className="muted" title={JSON.stringify(l.labels)}>{l.labels.job ?? l.labels.service_name ?? l.labels.app ?? Object.values(l.labels)[0] ?? ''}</span>
                      <span className="muted">{l.labels.host ?? l.labels.hostname ?? l.labels.filename?.split('/').pop() ?? ''}</span>
                      <span className="msg">{l.line}</span>
                    </div>
                  ))}
                </div>
              )}
            </Async>
          )}
      </Card>
    </>
  );
}
