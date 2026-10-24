import { useState } from 'react';
import { api } from '../../api';
import { Async, Badge, Card, Modal, Spinner } from '../../components/ui';
import { fmtUptime } from '../../format';
import { useQuery } from '../../hooks';
import type { Guest, TaskRow } from '../../types';

export default function Tasks({ g, refreshKey }: { g: Guest; refreshKey: number }) {
  const q = useQuery(() => api.guestTasks(g.vmid), [g.vmid, refreshKey], 10_000);
  const [open, setOpen] = useState<TaskRow | null>(null);
  return (
    <>
      <Async q={q} rows={4} h={52} isEmpty={(d) => d.length === 0} empty={{ title: 'No recent tasks', hint: 'Power actions, snapshots and backups appear here.' }}>
        {(list) => (
          <Card pad={false} className="table">
            <div className="t-row g-head"><span>Started</span><span>Task</span><span>User</span><span>Duration</span><span>Status</span></div>
            {list.map((t) => (
              <button key={t.upid} className="t-row t-btn" onClick={() => setOpen(t)}>
                <span className="muted">{new Date(t.start * 1000).toLocaleString()}</span>
                <span><b>{t.type}</b></span>
                <span className="muted ellip">{t.user}</span>
                <span className="muted">{t.end ? fmtUptime(Math.max(1, t.end - t.start)) : '–'}</span>
                <span>
                  {t.status === 'running' ? <Badge tone="amber"><Spinner size={11} />Running</Badge>
                    : t.status === 'ok' ? <Badge tone="green" dot>OK</Badge>
                      : <Badge tone="red" dot title={t.message}>Error</Badge>}
                </span>
              </button>
            ))}
          </Card>
        )}
      </Async>
      {open && <LogModal task={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function LogModal({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const q = useQuery(() => api.taskLog(task.upid), [task.upid], task.status === 'running' ? 2000 : 0);
  return (
    <Modal title={`Task: ${task.type}`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <Async q={q} rows={3} h={20} isEmpty={(d) => d.lines.length === 0} empty={{ title: 'No log output' }}>
        {(d) => <pre className="log">{d.lines.join('\n')}</pre>}
      </Async>
    </Modal>
  );
}
