import { useState } from 'react';
import { api } from '../api';
import { Async, Chips, PageHeader } from '../components/ui';
import { LogList, RecurringTable, SINCE, TaskTable } from '../components/Pve';
import { AskAI, buildPrompt } from '../components/AskAI';
import { useQuery } from '../hooks';
import type { Query } from '../hooks';
import type { PveTask } from '../types';

const KINDS: [string, string, string][] = [
  ['crash', 'Crashes', 'Processes or services that exited abnormally'],
  ['start-failed', 'Start failures', 'Guests or services that failed to start'],
  ['oom', 'Out of memory', 'Processes killed by the OOM killer'],
  ['gpu', 'GPU faults', 'Passthrough or driver errors'],
  ['hardware', 'Hardware', 'PCIe AER, machine checks, disk I/O errors'],
  ['error', 'Other errors', 'Critical journal messages'],
];

export default function Diagnostics() {
  const [since, setSince] = useState('7d');
  const q = useQuery(() => api.diagnostics(since), [since], 30_000);
  const tasks: Query<PveTask[]> = { ...q, data: q.data?.failedTasks, mutate: () => {} };
  return (
    <>
      <PageHeader eyebrow="Monitoring" title="Diagnostics" sub="Everything that failed on the host and its guests: crashes, failed starts, OOM kills, GPU and hardware errors, grouped so repeat offenders stand out."
        actions={<><AskAI subject={`Host-wide failures (last ${since})`} build={() => diagPrompt(since, q.data)} /><Chips value={since} onChange={setSince} options={SINCE} /></>} />
      <Async q={q} rows={2} h={110}>
        {(d) => (
          <>
            <div className="tiles tiles-6">
              {KINDS.map(([k, label, hint]) => {
                const n = d.byKind[k] ?? 0;
                return (
                  <div key={k} className={`tile ic-${n ? (k === 'gpu' ? 'blue' : 'red') : 'gray'}`} title={hint}>
                    <div className="tile-top"><span className="tile-label">{label}</span></div>
                    <div><p className="tile-value">{n}</p><p className="tile-sub">{hint}</p></div>
                  </div>
                );
              })}
            </div>
            {Object.keys(d.guestHits).length > 0 && (
              <div className="chipline">
                <span className="muted small">Guests involved:</span>
                {Object.entries(d.guestHits).sort((a, b) => b[1] - a[1]).map(([v, n]) => <a key={v} className="link small" href={`#/guests/${v}/logs`}>#{v} ({n})</a>)}
              </div>
            )}
            <span className="section-label">Recurring problems</span>
            <RecurringTable rows={d.recurring} />
            <span className="section-label">Failed Proxmox tasks ({d.failedTasks.length})</span>
            <TaskTable q={tasks} />
            <span className="section-label">Failure log</span>
            <LogList lines={d.lines} />
          </>
        )}
      </Async>
    </>
  );
}

function diagPrompt(since: string, d?: { byKind: Record<string, number>; recurring: { unit: string; kind: string; count: number; sample: string }[]; failedTasks: { message: string }[]; lines: { level: string; ts: string; unit: string; message: string }[] }): string {
  if (!d) return `# Host failures\n\n(no data loaded yet)`;
  return buildPrompt(`Proxmox host — failures across the node, last ${since}`,
    Object.fromEntries(Object.entries(d.byKind).map(([k, v]) => [k, v])),
    [
      { title: 'Recurring problems (by count)', body: d.recurring.slice(0, 20).map((r) => `${r.count}x [${r.kind}] ${r.unit}: ${r.sample}`) },
      { title: 'Failed Proxmox tasks', body: d.failedTasks.slice(0, 20).map((t) => t.message) },
      { title: 'Failure log (newest first)', body: d.lines.slice(0, 100).map((l) => `${l.ts} [${l.level}] ${l.unit}: ${l.message}`) },
    ]);
}
