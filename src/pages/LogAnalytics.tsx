import { useState } from 'react';
import { api } from '../api';
import { Async, Badge, Card, CardHead, Chips } from '../components/ui';
import { useQuery } from '../hooks';
import type { LogAnalytics } from '../types';

const RANGES = ['1h', '6h', '24h', '7d'];
const n = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(0)}k` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(Math.round(v)));
const pct = (v: number) => (v === 0 ? '0%' : v < 0.001 ? '<0.1%' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`);
const ms = (s: number | null) => (s == null || !Number.isFinite(s) ? '-' : s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(1)} s`);
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

type Bar = { t: string; [k: string]: number | string };

/** Stacked bars over time, brand colours only. Keys are stacked bottom to top. */
function Stacked({ data, keys, colors, label }: { data: Bar[]; keys: string[]; colors: string[]; label: string }) {
  const totals = data.map((d) => keys.reduce((a, k) => a + (Number(d[k]) || 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <div className="stack-bars" role="img" aria-label={label}>
      {data.map((d, i) => (
        <span key={d.t} className="stack-col" title={`${new Date(d.t).toLocaleString()}\n${keys.map((k) => `${k}: ${Math.round(Number(d[k]) || 0)}`).join('\n')}`}>
          <span style={{ height: `${(totals[i] / max) * 100}%` }}>
            {keys.map((k, j) => <i key={k} style={{ flexGrow: Number(d[k]) || 0, background: colors[j] }} />)}
          </span>
        </span>
      ))}
    </div>
  );
}

const Legend = ({ items }: { items: [string, string][] }) => (
  <div className="stack-legend">{items.map(([l, c]) => <span key={l}><i style={{ background: c }} />{l}</span>)}</div>
);

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' | 'green' | 'blue' | 'gray' }) {
  return (
    <div className={`tile ic-${tone ?? 'gray'}`} style={{ minHeight: 120 }}>
      <span className="tile-label">{label}</span>
      <div><p className="tile-value">{value}</p>{sub && <p className="tile-sub">{sub}</p>}</div>
    </div>
  );
}

/** Log + web analytics. Every number is a live LogQL query against Loki; the dashboard stores nothing. */
export default function LogAnalyticsView({ onExplore }: { onExplore: (query: string, since: string) => void }) {
  const [since, setSince] = useState('24h');
  const q = useQuery(() => api.lokiAnalytics(since), [since], 30_000);
  return (
    <>
      <div className="toolbar">
        <Chips value={since} onChange={setSince} options={RANGES.map((r) => ({ id: r, label: r }))} />
        {q.data && q.data.health.silent.length > 0 && (
          <Badge tone="amber" dot title="Logged in the last 24 h but silent for 15 min">{q.data.health.silent.length} quiet: {q.data.health.silent.slice(0, 4).join(', ')}{q.data.health.silent.length > 4 ? '…' : ''}</Badge>
        )}
        {q.data && q.data.health.silent.length === 0 && <Badge tone="green" dot>all log sources reporting</Badge>}
      </div>
      <Async q={q} rows={5} h={110} isEmpty={(d: LogAnalytics) => d.logs.total === 0 && d.web.requests === 0}
        empty={{ title: 'No logs in this range', hint: 'Check that Alloy is running on the host and Loki is reachable.' }}>
        {(d) => (
          <>
            <div className="tiles tiles-6" style={{ marginBottom: 20 }}>
              <Stat label="Log lines" value={n(d.logs.total)} sub={`${d.logs.hosts} sources`} tone="blue" />
              <Stat label="Errors" value={n(d.logs.errors)} sub={d.logs.total ? `${pct(d.logs.errors / d.logs.total)} of lines` : ''} tone={d.logs.errors ? 'red' : 'green'} />
              <Stat label="Warnings" value={n(d.logs.warnings)} tone="gray" />
              <Stat label="Web requests" value={n(d.web.requests)} sub={`${(d.web.requests / (d.stepSeconds * Math.max(1, d.web.series.length))).toFixed(1)}/s avg`} tone="blue" />
              <Stat label="5xx rate" value={pct(d.web.errorRate)} sub={`${n(d.web.serverErrors)} server errors`} tone={d.web.errorRate > 0.01 ? 'red' : 'green'} />
              <Stat label="4xx" value={n(d.web.clientErrors)} tone="gray" />
            </div>

            <div className="grid-2">
              <Card>
                <CardHead title="Log volume by severity" sub="Every guest and the host, from Loki" />
                <Stacked data={d.logs.series} keys={['other', 'warning', 'error']} colors={['var(--blue)', 'var(--peri)', 'var(--red)']} label="Log lines over time by severity" />
                <Legend items={[['info/other', 'var(--blue)'], ['warning', 'var(--peri)'], ['error', 'var(--red)']]} />
              </Card>
              <Card>
                <CardHead title="Web traffic by status" sub="All sites behind nginx" />
                <Stacked data={d.web.series} keys={['ok', 'redirect', 'client', 'server']} colors={['var(--green)', 'var(--blue)', 'var(--peri)', 'var(--red)']} label="Requests over time by status class" />
                <Legend items={[['2xx', 'var(--green)'], ['3xx', 'var(--blue)'], ['4xx', 'var(--peri)'], ['5xx', 'var(--red)']]} />
              </Card>
            </div>

            <div className="grid-2" style={{ marginTop: 20 }}>
              <Card pad={false}>
                <CardHead title="Noisiest sources" sub="Sorted by errors. Click to open the logs." />
                <div className="rank">
                  {d.logs.topHosts.map((h) => (
                    <button key={h.host} className="rank-row" onClick={() => onExplore(`{host="${esc(h.host)}", level=~"error|err|crit|alert|emerg|fatal"}`, since)}>
                      <span>{h.host}</span><span className="muted">{n(h.lines)} lines</span>
                      <span>{h.errors ? <Badge tone="red">{n(h.errors)} errors</Badge> : <Badge tone="green">clean</Badge>}</span>
                    </button>
                  ))}
                </div>
              </Card>
              <Card pad={false}>
                <CardHead title="Top failing services" sub="Journal errors by unit" />
                {d.logs.topUnits.length === 0
                  ? <p className="muted" style={{ padding: '4px 24px 22px' }}>No service errors in this range.</p>
                  : (
                    <div className="rank">
                      {d.logs.topUnits.map((u) => (
                        <button key={`${u.host}/${u.unit}`} className="rank-row" onClick={() => onExplore(`{host="${esc(u.host)}", unit="${esc(u.unit)}.service", level=~"error|err|crit|alert|emerg|fatal"}`, since)}>
                          <span>{u.unit}</span><span className="muted">{u.host}</span><span><Badge tone="red">{n(u.errors)}</Badge></span>
                        </button>
                      ))}
                    </div>
                  )}
              </Card>
            </div>

            <Card pad={false} className="" >
              <CardHead title="Sites" sub="Requests, server errors and p95 latency per hostname" />
              <div className="rank">
                {d.web.topVhosts.length === 0 && <p className="muted" style={{ padding: '4px 24px 22px' }}>No web requests in this range.</p>}
                {d.web.topVhosts.map((v) => (
                  <button key={v.vhost} className="rank-row wide" onClick={() => onExplore(`{job="nginx-access", vhost="${esc(v.vhost)}"}`, since)}>
                    <span>{v.vhost}</span>
                    <span className="muted">{n(v.requests)} req</span>
                    <span>{v.errors5xx ? <Badge tone="red">{n(v.errors5xx)} 5xx</Badge> : <Badge tone="green">0 5xx</Badge>}</span>
                    <span className={v.p95 != null && v.p95 > 1 ? 'warn-text' : 'muted'}>p95 {ms(v.p95)}</span>
                  </button>
                ))}
              </div>
            </Card>
          </>
        )}
      </Async>
    </>
  );
}
