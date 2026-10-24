import { useState } from 'react';
import { api } from '../../api';
import { Async, Badge, Card, CardHead, HoldButton, Icon, Modal, Spinner } from '../../components/ui';
import { useQuery } from '../../hooks';
import type { Guest, Snapshot } from '../../types';
import type { Track } from '../GuestDetail';

const NAME = /^[A-Za-z][A-Za-z0-9_-]{1,39}$/;
const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `snap-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

export default function Snapshots({ g, track }: { g: Guest; track: Track }) {
  const q = useQuery(() => api.snapshots(g.vmid), [g.vmid]);
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<{ s: Snapshot; op: 'rollback' | 'delete' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', vmstate: false });

  const run = async (label: string, id: string, start: () => Promise<{ taskId: string }>) => {
    setBusy(id);
    await track(`${g.name}: ${label}`, start);
    setBusy(null);
    q.reload();
  };

  return (
    <>
      <div className="toolbar">
        <p className="muted">Snapshots capture the guest’s disks{g.type === 'qemu' ? ' and optionally RAM' : ''} so you can roll back later.</p>
        <button className="btn btn-primary" disabled={g.protected || !!busy} onClick={() => { setForm({ name: stamp(), description: '', vmstate: false }); setCreating(true); }}>
          <Icon name="check" size={15} />Take snapshot
        </button>
      </div>
      <Async q={q} rows={3} h={56} isEmpty={(d) => d.length === 0} empty={{ title: 'No snapshots', hint: 'Take one before making risky changes.' }}>
        {(list) => (
          <Card pad={false} className="table">
            <div className="s-row g-head"><span>Name</span><span>Taken</span><span>Description</span><span /></div>
            {[...list].sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).map((s) => (
              <div key={s.name} className={`s-row ${busy === s.name ? 'is-pending' : ''}`}>
                <span className="c-name"><b>{s.name}</b><small className="muted">{s.parent ? `after ${s.parent}` : 'first snapshot'}{s.vmstate && <em className="tag">RAM</em>}</small></span>
                <span className="muted">{s.time ? new Date(s.time * 1000).toLocaleString() : '–'}</span>
                <span className="muted ellip">{s.description || '–'}</span>
                <span className="row-actions">
                  {busy === s.name ? <Badge tone="amber"><Spinner size={11} />Working</Badge> : (
                    <>
                      <button className="btn" disabled={g.protected || !!busy} onClick={() => setTarget({ s, op: 'rollback' })}><Icon name="rotate" size={15} />Rollback</button>
                      <button className="icon-btn" aria-label={`Delete ${s.name}`} disabled={g.protected || !!busy} onClick={() => setTarget({ s, op: 'delete' })}><Icon name="x" size={16} /></button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </Card>
        )}
      </Async>

      {creating && (
        <Modal title="Take snapshot" onClose={() => setCreating(false)} footer={
          <>
            <button className="btn" onClick={() => setCreating(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!NAME.test(form.name)} onClick={() => {
              setCreating(false);
              void run(`snapshot ${form.name}`, form.name, () => api.createSnapshot(g.vmid, { name: form.name, description: form.description, vmstate: form.vmstate }));
            }}>Take snapshot</button>
          </>
        }>
          <div className="form">
            <label className="field"><span>Name <small className="muted">letters, digits, - and _, starting with a letter</small></span>
              <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field"><span>Description</span>
              <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            {g.type === 'qemu' && g.status === 'running' && (
              <label className="field check"><input type="checkbox" checked={form.vmstate} onChange={(e) => setForm({ ...form, vmstate: e.target.checked })} /><span>Include RAM (slower, resumes exactly where it was)</span></label>
            )}
          </div>
        </Modal>
      )}

      {target && (
        <Modal title={`${target.op === 'rollback' ? 'Roll back to' : 'Delete'} ${target.s.name}?`} onClose={() => setTarget(null)} footer={
          <>
            <button className="btn" onClick={() => setTarget(null)}>Cancel</button>
            <HoldButton danger onConfirm={() => {
              const { s, op } = target;
              setTarget(null);
              void run(`${op} ${s.name}`, s.name, () => (op === 'rollback' ? api.rollbackSnapshot(g.vmid, s.name) : api.deleteSnapshot(g.vmid, s.name)));
            }}>{target.op === 'rollback' ? 'Roll back' : 'Delete'}</HoldButton>
          </>
        }>
          <div className="callout warn"><Icon name="alert" size={16} /><span>
            {target.op === 'rollback'
              ? 'Everything written since this snapshot is lost, and the guest is stopped during the rollback.'
              : 'The snapshot is removed permanently. Newer snapshots stay.'}
          </span></div>
        </Modal>
      )}
    </>
  );
}
