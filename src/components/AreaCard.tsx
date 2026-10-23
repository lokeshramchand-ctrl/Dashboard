import { useId } from 'react';
import { api } from '../api';
import { useQuery } from '../hooks';
import { Icon, Skeleton } from './ui';
import type { IconName } from './ui';

/** Smooth path through points (Catmull-Rom → cubic Bézier). */
function smooth(p: [number, number][]): string {
  if (p.length < 2) return '';
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Compact "last 24 hours" area card fed by POST /api/metrics/query. */
export function AreaCard({ icon, title, sub, query, color, format }: {
  icon: IconName; title: string; sub: string; query: string; color: string; format: (v: number) => string;
}) {
  const gid = useId();
  const q = useQuery(async () => {
    const end = Math.floor(Date.now() / 1000);
    const r = await api.query(query, end - 86400, end, 900);
    return (r.data.result[0]?.values ?? []).map(([, v]) => parseFloat(v));
  }, [query], 60_000);

  const vals = q.data ?? [];
  const W = 300, H = 120;
  const max = Math.max(...vals, 1e-9) * 1.15, min = Math.min(...vals) * 0.85;
  const pts = vals.map((v, i) => [(i / Math.max(1, vals.length - 1)) * W, H - 8 - ((v - min) / Math.max(1e-9, max - min)) * (H - 24)] as [number, number]);
  const line = smooth(pts);

  return (
    <section className="card area-card">
      <div className="area-head">
        <span className="area-title"><Icon name={icon} size={18} />{title}</span>
        <span className="area-val">{vals.length ? format(vals[vals.length - 1]) : q.error ? '—' : ''}</span>
      </div>
      <p className="muted area-sub">{sub}</p>
      {q.data === undefined && !q.error && <Skeleton rows={1} h={132} />}
      {q.error && q.data === undefined && <p className="muted small" style={{ padding: '40px 0', textAlign: 'center' }}>Couldn’t load metrics. <button className="link" style={{ border: 0, background: 'none' }} onClick={q.reload}>Retry</button></p>}
      {q.data !== undefined && vals.length === 0 && <p className="muted small" style={{ padding: '40px 0', textAlign: 'center' }}>No data for this range.</p>}
      {vals.length > 1 && (
        <div className="area">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${title}, last 24 hours`}>
            <defs>
              <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity=".28" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${line}L${W},${H}L0,${H}Z`} fill={`url(#${gid})`} />
            <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
          </svg>
        </div>
      )}
      <div className="area-foot"><span>Last 24 hours</span><span>Current</span></div>
    </section>
  );
}
