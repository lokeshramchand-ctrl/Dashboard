import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Async, Badge, Card, CardHead, Icon, Spinner } from '../../components/ui';
import { fmtBytes } from '../../format';
import { useQuery } from '../../hooks';
import type { Guest } from '../../types';
import type { Track } from '../GuestDetail';

const MODES = [
  { id: 'snapshot', label: 'Snapshot', hint: 'No downtime. Recommended.' },
  { id: 'suspend', label: 'Suspend', hint: 'Briefly pauses the guest.' },
  { id: 'stop', label: 'Stop', hint: 'Shuts the guest down during the backup.' },
];

export default function Backups({ g, track }: { g: Guest; track: Track }) {
  const q = useQuery(() => api.backups(g.vmid), [g.vmid]);
  const [storage, setStorage] = useState('');
  const [mode, setMode] = useState('snapshot');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!storage && q.data?.defaultStorage) setStorage(q.data.defaultStorage); }, [q.data, storage]);

  async function backup() {
    setBusy(true);
    await track(`${g.name}: backup`, () => api.createBackup(g.vmid, { storage, mode, notes: notes || undefined }));
    setBusy(false);
    q.reload();
  }

  return (
    <Async q={q} rows={3} h={56}>
      {(d) => (
        <>
          <Card>
            <CardHead title="Back up now" sub="Runs a vzdump job for this guest. Large guests can take a while." />
            {d.storages.length === 0 ? (
              <div className="callout warn"><Icon name="alert" size={16} /><span>No storage on this node allows backups.</span></div>
            ) : (
              <div className="form three">
                <label className="field"><span>Storage</span>
                  <select className="input" value={storage} onChange={(e) => setStorage(e.target.value)}>
                    {d.storages.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select></label>
                <label className="field"><span>Mode <small className="muted">{MODES.find((m) => m.id === mode)?.hint}</small></span>
                  <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
                    {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select></label>
                <label className="field"><span>Notes</span>
                  <input className="input" value={notes} maxLength={256} onChange={(e) => setNotes(e.target.value)} placeholder="optional" /></label>
              </div>
            )}
            <div className="save-bar flat">
              <button className="btn btn-primary" disabled={busy || g.protected || !storage} onClick={backup}>
                {busy ? <Spinner size={14} /> : <Icon name="disk" size={15} />}Back up now
              </button>
            </div>
          </Card>

          <h3 className="section-title">Existing backups</h3>
          {d.items.length === 0 ? (
            <Card><p className="muted small">No backups of this guest were found on the available storages.</p></Card>
          ) : (
            <Card pad={false} className="table">
              <div className="b-row g-head"><span>Backup</span><span>Taken</span><span>Size</span><span>Storage</span></div>
              {d.items.map((b) => (
                <div key={b.volid} className="b-row">
                  <span className="c-name"><b className="ellip">{b.volid.split('/').pop()}</b><small className="muted ellip">{b.notes || b.format}</small></span>
                  <span className="muted">{new Date(b.time * 1000).toLocaleString()}</span>
                  <span>{fmtBytes(b.size)}</span>
                  <span><Badge tone="gray">{b.storage}</Badge></span>
                </div>
              ))}
            </Card>
          )}
          <p className="muted small">Restoring or deleting backups is done in Proxmox.</p>
        </>
      )}
    </Async>
  );
}
