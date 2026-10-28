import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api';
import { timeAgo } from '../format';
import { useQuery } from '../hooks';
import type { Query } from '../hooks';
import type { LogKind, LogLine, PveTask, Recurring, RrdPoint, Timeframe } from '../types';
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

export const SINCE: { id: string; label: string }[] = [{ id: '24h', label: '24 hours' }, { id: '7d', label: '7 days' }, { id: '30d', label: '30 days' }];
const KIND_LABEL: Record<LogKind, string> = {
  start: 'start', stop: 'stop', lifecycle: 'lifecycle', 'start-failed': 'start failed', crash: 'crash', oom: 'out of memory',
  gpu: 'gpu', agent: 'agent', hardware: 'hardware', error: 'error', info: 'info',
};
const LEVEL_TONE: Record<LogLine['level'], Tone> = { error: 'red', warn: 'amber', info: 'gray' };
export const kindBadge = (k: LogKind, lv: LogLine['level']) => <Badge tone={lv === 'info' ? (k === 'start' ? 'green' : k === 'gpu' ? 'blue' : 'gray') : LEVEL_TONE[lv]}>{KIND_LABEL[k]}</Badge>;
/** Shortens Proxmox task ids (UPID:node:pid:pstart:start:type:id:user:) to "‹task type›" for reading. */
export const tidy = (msg: string) => msg.replace(/UPID:[\w.-]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:([\w-]+):[\w.:-]*?:[\w@.!-]+:/g, '‹task $1›');
const fmtTs = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Journal lines with level filter and text search. */
export function LogList({ lines, empty = 'No log lines in this range.' }: { lines: LogLine[]; empty?: string }) {
  const [lv, setLv] = useState<'problems' | 'all'>(lines.some((l) => l.level !== 'info') ? 'problems' : 'all');
  const [q, setQ] = useState('');
  const n = q.trim().toLowerCase();
  const rows = lines.filter((l) => (lv === 'all' || l.level !== 'info') && (!n || `${l.unit} ${l.message} ${l.kind}`.toLowerCase().includes(n)));
  return (
    <div className="card table">
      <div className="log-tools">
        <Chips value={lv} onChange={setLv} options={[{ id: 'problems', label: 'Problems', count: lines.filter((l) => l.level !== 'info').length }, { id: 'all', label: 'All lines', count: lines.length }]} />
        <label className="search mini"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter lines…" aria-label="Filter log lines" /></label>
      </div>
      {rows.length === 0 ? <EmptyState icon="check" title={lv === 'problems' && !n ? 'No problems found' : 'Nothing matches'} hint={empty} /> : (
        <div className="log-list">
          {rows.slice(0, 400).map((l, i) => (
            <div key={i} className={`jl ${l.level === 'error' ? 'err' : l.level === 'warn' ? 'warn' : ''}`}>
              <span className="muted">{fmtTs(l.ts)}</span>
              <span>{kindBadge(l.kind, l.level)}</span>
              <span className="muted jl-unit" title={l.unit}>{l.unit}</span>
              <span className="msg" title={l.message}>{tidy(l.message)}</span>
            </div>
          ))}
          {rows.length > 400 && <p className="muted small pad">Showing the newest 400 of {rows.length} lines.</p>}
        </div>
      )}
    </div>
  );
}

/** Repeated problems collapsed into one row each. */
export function RecurringTable({ rows }: { rows: Recurring[] }) {
  if (!rows.length) return <Card><EmptyState icon="check" title="No recurring problems" hint="Nothing failed more than once in this range." /></Card>;
  return (
    <div className="card table">
      <div className="dt-row dt-rec g-head"><span>Problem</span><span>Type</span><span>Count</span><span>First seen</span><span>Last seen</span></div>
      {rows.map((r, i) => (
        <div key={i} className="dt-row dt-rec">
          <span className="rec-msg"><b>{r.unit || 'system'}</b><small className="mono">{tidy(r.sample)}</small></span>
          <span>{kindBadge(r.kind, r.level)}</span>
          <span><b className={r.count >= 10 ? 'err-t' : ''}>{r.count}×</b></span>
          <span className="muted">{fmtTs(r.first)}</span>
          <span className="muted">{fmtTs(r.last)}</span>
        </div>
      ))}
    </div>
  );
}
