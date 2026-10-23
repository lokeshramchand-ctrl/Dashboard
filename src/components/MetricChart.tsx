import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useQuery } from '../hooks';
import { Async } from './ui';

type Pt = [number, number];
interface Series { name: string; points: Pt[] }

function LineChart({ series, unit, height = 220 }: { series: Series[]; unit: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const m = { l: 46, r: 12, t: 12, b: 24 };
  const all = series.flatMap((s) => s.points);
  const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]));
  const rawMax = Math.max(...all.map((p) => p[1]), 1e-9);
  const niceMax = useMemo(() => {
    const p = Math.pow(10, Math.floor(Math.log10(rawMax)));
    return Math.ceil((rawMax * 1.1) / p) * p;
  }, [rawMax]);
  const X = (t: number) => m.l + ((t - x0) / Math.max(1, x1 - x0)) * (w - m.l - m.r);
  const Y = (v: number) => m.t + (1 - v / niceMax) * (height - m.t - m.b);
  const fmt = (v: number) => (unit === '%' ? `${v.toFixed(v < 10 ? 1 : 0)}%` : v >= 1e9 ? `${(v / 1e9).toFixed(1)}G` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(1));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax);
  const xt = [0, 0.25, 0.5, 0.75, 1].map((f) => x0 + f * (x1 - x0));
  const colors = ['#0a95e8', 'var(--c2)', 'var(--c3)', 'var(--c4)'];

  const base = series[0].points;
  const idx = hover == null ? null : Math.max(0, Math.min(base.length - 1, Math.round(((hover - m.l) / (w - m.l - m.r)) * (base.length - 1))));

  return (
    <div ref={ref} className="chart" style={{ height }}>
      <svg width={w} height={height} role="img" aria-label="Metric chart"
        onMouseMove={(e) => setHover(e.clientX - e.currentTarget.getBoundingClientRect().left)}
        onMouseLeave={() => setHover(null)}>
        <defs>
          {series.map((_, i) => (
            <linearGradient key={i} id={`g${i}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={colors[i % 4]} stopOpacity=".22" />
              <stop offset="100%" stopColor={colors[i % 4]} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={w - m.r} y1={Y(v)} y2={Y(v)} className="grid" />
            <text x={m.l - 8} y={Y(v) + 4} textAnchor="end" className="axis">{fmt(v)}</text>
          </g>
        ))}
        {xt.map((t, i) => (
          <text key={i} x={X(t)} y={height - 6} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} className="axis">
            {new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </text>
        ))}
        {series.map((s, i) => {
          const d = s.points.map((p, j) => `${j ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.name}>
              <path d={`${d}L${X(last[0])},${Y(0)}L${X(s.points[0][0])},${Y(0)}Z`} fill={`url(#g${i})`} />
              <path d={d} fill="none" stroke={colors[i % 4]} strokeWidth="2" strokeLinejoin="round" />
            </g>
          );
        })}
        {idx != null && (
          <g>
            <line x1={X(base[idx][0])} x2={X(base[idx][0])} y1={m.t} y2={height - m.b} className="cross" />
            {series.map((s, i) => <circle key={i} cx={X(s.points[idx][0])} cy={Y(s.points[idx][1])} r="4" fill="var(--surface)" stroke={colors[i % 4]} strokeWidth="2" />)}
          </g>
        )}
      </svg>
      {idx != null && (
        <div className="tip" style={{ left: Math.min(w - 150, Math.max(0, X(base[idx][0]) + 12)) }}>
          <b>{new Date(base[idx][0] * 1000).toLocaleTimeString()}</b>
          {series.map((s, i) => (
            <span key={s.name}><i style={{ background: colors[i % 4] }} />{s.name}: {fmt(s.points[idx][1])}{unit === '%' ? '' : ` ${unit}`}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A chart fed by POST /api/metrics/query (PromQL proxy). */
export function MetricChart({ query, rangeSec = 3600, unit = '%', height, name = 'value' }: {
  query: string; rangeSec?: number; unit?: string; height?: number; name?: string;
}) {
  const q = useQuery(async () => {
    const end = Math.floor(Date.now() / 1000);
    const step = Math.max(15, Math.floor(rangeSec / 120));
    return api.query(query, end - rangeSec, end, step);
  }, [query, rangeSec], 30_000);

  return (
    <Async q={q} rows={1} h={height ?? 220}
      isEmpty={(d) => !d.data?.result?.length || !d.data.result[0].values.length}
      empty={{ title: 'No data points', hint: 'The query returned an empty result for this range.' }}>
      {(d) => (
        <LineChart unit={unit} height={height}
          series={d.data.result.slice(0, 4).map((r, i) => ({
            name: r.metric.instance || r.metric.__name__ || (d.data.result.length > 1 ? `series ${i + 1}` : name),
            points: r.values.map(([t, v]) => [t, parseFloat(v)] as Pt),
          }))} />
      )}
    </Async>
  );
}
