import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api';
import { timeAgo } from '../format';
import { useQuery } from '../hooks';
import type { Query } from '../hooks';
import type { PveTask, RrdPoint, Timeframe } from '../types';
import { LineChart } from './MetricChart';
import { Async, Badge, Card, CardHead, Chips, EmptyState, Icon, Modal, Skeleton, Spinner } from './ui';
import type { Tone } from './ui';

export const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: 'hour', label: 'Hour' }, { id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'year', label: 'Year' },
];

export function TimeframePicker({ value, onChange }: { value: Timeframe; onChange: (t: Timeframe) => void }) {
  return <Chips value={value} onChange={onChange} options={TIMEFRAMES} />;
}

/** One chart card over RRD rows: each line picks a column (optionally scaled). */
export function RrdCard({ title, sub, q, lines, unit, max }: {
  title: string; sub?: string; q: Query<RrdPoint[]>; unit: string; max?: number;
  lines: { name: string; key: string; scale?: number; div?: string }[];
}) {
  return (
    <Card className="rrd-card">
      <CardHead title={title} sub={sub} />
      <Async q={q} rows={1} h={200} isEmpty={(d) => d.length < 2} empty={{ title: 'No data yet', hint: 'Proxmox has not recorded this range.' }}>
        {(rows) => {
          const pts = rows.filter((r) => lines.some((l) => r[l.key] != null));
          if (pts.length < 2) return <EmptyState icon="chart" title="No data yet" hint="Proxmox has not recorded this range." />;
          return (
            <LineChart unit={unit} height={200} max={max} series={lines.map((l) => ({
              name: l.name,
              points: pts.map((r) => {
                const v = (r[l.key] ?? 0) * (l.scale ?? 1);
                const d = l.div ? r[l.div] : null;
                return [r.time, d ? (v / d) * 100 : v] as [number, number];
              }),
            }))} />
          );
        }}
      </Async>
    </Card>
  );
}

/** Label / value rows, like the PVE summary panels. */
export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

const TASK_TONE: Record<PveTask['status'], Tone> = { running: 'blue', ok: 'green', warning: 'amber', error: 'red' };
// Human names for the task types Proxmox writes most often.
const TASK_NAME: Record<string, string> = {
  qmstart: 'VM start', qmstop: 'VM stop', qmshutdown: 'VM shutdown', qmreboot: 'VM reboot', qmreset: 'VM reset', qmsuspend: 'VM suspend', qmresume: 'VM resume',
  vzstart: 'CT start', vzstop: 'CT stop', vzshutdown: 'CT shutdown', vzreboot: 'CT reboot', vzdump: 'Backup', qmsnapshot: 'VM snapshot', vzsnapshot: 'CT snapshot',
  vncproxy: 'Console', vncshell: 'Shell', termproxy: 'Console', aptupdate: 'Update package database', startall: 'Bulk start', stopall: 'Bulk stop',
  qmcreate: 'VM create', vzcreate: 'CT create', qmdestroy: 'VM destroy', vzdestroy: 'CT destroy', imgcopy: 'Copy image', download: 'Download',
  qmigrate: 'VM migrate', vzmigrate: 'CT migrate', qmclone: 'VM clone', vzclone: 'CT clone', qmrollback: 'VM rollback', vzrollback: 'CT rollback',
};
export const taskName = (t: PveTask) => `${TASK_NAME[t.type] ?? t.type}${t.id ? ` ${t.id}` : ''}`;
const dur = (t: PveTask) => {
  const s = (t.end ?? Date.now() / 1000) - t.start;
  return s < 60 ? `${Math.max(0, Math.round(s))}s` : s < 3600 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

export function TaskTable({ q, compact }: { q: Query<PveTask[]>; compact?: boolean }) {
  const [open, setOpen] = useState<PveTask | null>(null);
  return (
    <>
      <Async q={q} rows={5} h={44} isEmpty={(d) => d.length === 0} empty={{ title: 'No tasks', hint: 'Proxmox has no matching tasks.' }}>
        {(list) => (
          <div className="card table">
            <div className={`t-row g-head ${compact ? 'compact' : ''}`}><span>Task</span><span>Status</span>{!compact && <span>User</span>}<span>Started</span><span>Duration</span></div>
            {list.map((t) => (
              <button key={t.upid} className={`t-row ${compact ? 'compact' : ''}`} onClick={() => setOpen(t)}>
                <span className="t-name"><b>{taskName(t)}</b>{t.status === 'error' && <small className="err-t">{t.message}</small>}</span>
                <span><Badge tone={TASK_TONE[t.status]} dot>{t.status === 'running' ? <><Spinner size={10} />running</> : t.status}</Badge></span>
                {!compact && <span className="muted mono">{t.user}</span>}
                <span className="muted" title={new Date(t.start * 1000).toLocaleString()}>{timeAgo(new Date(t.start * 1000).toISOString())}</span>
                <span className="muted">{dur(t)}</span>
              </button>
            ))}
          </div>
        )}
      </Async>
      {open && <TaskLogModal task={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function TaskLogModal({ task, onClose }: { task: PveTask; onClose: () => void }) {
  const running = task.status === 'running';
  const q = useQuery(() => api.taskLog(task.upid), [task.upid], running ? 2000 : 0);
  return (
    <Modal wide title={taskName(task)} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="task-meta">
        <Badge tone={TASK_TONE[task.status]} dot>{task.status}</Badge>
        <span className="muted small">{new Date(task.start * 1000).toLocaleString()} · {task.user} · {dur(task)}</span>
      </div>
      {q.data === undefined && !q.error ? <Skeleton rows={4} h={18} /> : q.error && !q.data ? (
        <div className="callout err"><Icon name="alert" size={16} /><span>{q.error.message}</span></div>
      ) : (
        <pre className="task-log">{(q.data ?? []).join('\n') || 'No output'}</pre>
      )}
      <code className="upid">{task.upid}</code>
    </Modal>
  );
}
