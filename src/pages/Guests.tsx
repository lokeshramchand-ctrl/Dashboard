import { useMemo, useState } from 'react';
import { api } from '../api';
import { BrandSwirl } from '../components/Brand';
import { Async, Badge, Chips, Icon, Menu, Meter, Modal, PageHeader, SearchBox, Spinner } from '../components/ui';
import { fmtBytes, fmtPct, fmtUptime, sleep } from '../format';
import { useGuestEvents, useQuery, useSearch, useToast } from '../hooks';
import type { Guest, GuestAction } from '../types';

const GAMING_VMID = 100;
const VERB: Record<GuestAction, string> = { start: 'Start', shutdown: 'Shutdown', stop: 'Force stop', reboot: 'Reboot' };
const WANT: Record<GuestAction, Guest['status'] | null> = { start: 'running', shutdown: 'stopped', stop: 'stopped', reboot: null };

type Filter = 'all' | 'running' | 'stopped' | 'lxc' | 'qemu';

export default function Guests() {
  const q = useQuery(api.guests, [], 7000);
  const toast = useToast();
  const [pending, setPending] = useState<Record<number, GuestAction>>({});
  const [confirm, setConfirm] = useState<{ g: Guest; action: GuestAction; warn?: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const { q: search } = useSearch();

  useGuestEvents((e) => q.mutate((list) => list.map((g) => (g.vmid === e.vmid ? { ...g, status: e.status } : g))));

  async function run(g: Guest, action: GuestAction) {
    setPending((p) => ({ ...p, [g.vmid]: action }));
    try {
      const { taskId } = await api.guestAction(g.vmid, action);
      let ok = false;
      for (let i = 0; i < 120 && !ok; i++) {
        await sleep(1000);
        const t = await api.task(taskId);
        if (t.status === 'error') throw new Error(t.message || 'Task failed');
        ok = t.status === 'ok';
      }
      if (!ok) throw new Error('Timed out waiting for the task to finish');
      const want = WANT[action];
      for (let i = 0; i < 20; i++) {
        const list = await api.guests();
        q.mutate(() => list);
        if (!want || list.find((x) => x.vmid === g.vmid)?.status === want) break;
        await sleep(1000);
      }
      toast.success(`${g.name}: ${VERB[action].toLowerCase()} completed`);
    } catch (e) {
      toast.error(`${g.name}: ${VERB[action].toLowerCase()} failed — ${(e as Error).message}`);
      q.reload();
    } finally {
      setPending((p) => { const n = { ...p }; delete n[g.vmid]; return n; });
    }
  }

  const conflictsFor = (g: Guest, list: Guest[]) => list.filter((x) => g.conflicts.includes(x.vmid) && x.status === 'running');

  function toggle(g: Guest, list: Guest[]) {
    if (g.status === 'running') return setConfirm({ g, action: 'shutdown' });
    const c = conflictsFor(g, list);
    if (c.length) return setConfirm({ g, action: 'start', warn: `Starting ${g.name} may conflict with running guests sharing the GPU: ${c.map((x) => `${x.name} (${x.vmid})`).join(', ')}.` });
    run(g, 'start');
  }

  return (
    <>
      <PageHeader title="Guests" sub="Containers and virtual machines on your Proxmox node." />
      <Async q={q} rows={6} h={60} isEmpty={(d) => d.length === 0} empty={{ title: 'No guests found', hint: 'Proxmox returned no containers or VMs.' }}>
        {(list) => {
          const gaming = list.find((g) => g.vmid === GAMING_VMID);
          const counts: Record<Filter, number> = {
            all: list.length, running: list.filter((g) => g.status === 'running').length,
            stopped: list.filter((g) => g.status !== 'running').length, lxc: list.filter((g) => g.type === 'lxc').length,
            qemu: list.filter((g) => g.type === 'qemu').length,
          };
          const s = search.trim().toLowerCase();
          const rows = list.filter((g) => {
            if (filter === 'running' && g.status !== 'running') return false;
            if (filter === 'stopped' && g.status === 'running') return false;
            if ((filter === 'lxc' || filter === 'qemu') && g.type !== filter) return false;
            return !s || `${g.vmid} ${g.name} ${g.tags.join(' ')}`.toLowerCase().includes(s);
          });
          return (
            <>
              {gaming && <GamingCard g={gaming} list={list} pending={pending[gaming.vmid]} onToggle={() => toggle(gaming, list)} conflicts={conflictsFor(gaming, list)} />}
              <div className="toolbar">
                <Chips value={filter} onChange={setFilter} options={[
                  { id: 'all', label: 'All', count: counts.all }, { id: 'running', label: 'Running', count: counts.running },
                  { id: 'stopped', label: 'Stopped', count: counts.stopped }, { id: 'lxc', label: 'LXC', count: counts.lxc }, { id: 'qemu', label: 'VM', count: counts.qemu },
                ]} />
              </div>
              <div className="card table">
                <div className="g-row g-head">
                  <span /><span>Guest</span><span>Type</span><span>Status</span><span>CPU</span><span>Memory</span><span>Uptime</span><span />
                </div>
                {rows.length === 0 && <div className="pad"><div className="empty"><div className="empty-ic"><Icon name="search" size={22} /></div><strong>No guests match</strong><p className="muted small">Try a different search or filter.</p></div></div>}
                {rows.map((g) => {
                  const p = pending[g.vmid];
                  const on = p ? WANT[p] === 'running' || (p === 'reboot') : g.status === 'running';
                  const running = g.status === 'running';
                  return (
                    <div key={g.vmid} className={`g-row ${p ? 'is-pending' : ''}`}>
                      <span className="c-tog">
                        <Switch on={on} busy={!!p} disabled={g.protected} label={`${running ? 'Shut down' : 'Start'} ${g.name}`} onClick={() => toggle(g, list)} />
                      </span>
                      <span className="c-name">
                        <b>{g.name}</b>
                        <small className="muted">#{g.vmid}{g.tags.slice(0, 3).map((t) => <em key={t} className="tag">{t}</em>)}</small>
                      </span>
                      <span className="c-type"><Badge tone={g.type === 'qemu' ? 'blue' : 'gray'}>{g.type === 'qemu' ? 'VM' : 'LXC'}</Badge></span>
                      <span className="c-status">
                        {p ? <Badge tone="amber"><Spinner size={11} />{p === 'start' ? 'Starting' : p === 'reboot' ? 'Rebooting' : 'Stopping'}</Badge>
                          : <Badge tone={running ? 'green' : g.status === 'paused' ? 'amber' : 'gray'} dot>{g.status}</Badge>}
                        {g.protected && <Badge tone="violet"><Icon name="lock" size={11} />Protected</Badge>}
                      </span>
                      <span className="c-cpu"><span className="mv">{running ? fmtPct(g.cpu, 1) : '–'}</span><Meter value={running ? g.cpu : 0} /></span>
                      <span className="c-mem"><span className="mv">{running ? `${fmtBytes(g.memUsed)} / ${fmtBytes(g.memMax, 0)}` : fmtBytes(g.memMax, 0)}</span><Meter value={running ? g.memUsed / g.memMax : 0} /></span>
                      <span className="c-up muted">{running ? fmtUptime(g.uptime) : '–'}</span>
                      <span className="c-menu">
                        <Menu label={`More actions for ${g.name}`} disabled={g.protected || !!p || !running} items={[
                          { label: 'Reboot', icon: 'rotate', onClick: () => setConfirm({ g, action: 'reboot' }) },
                          { label: 'Force stop', icon: 'stop', danger: true, onClick: () => setConfirm({ g, action: 'stop' }) },
                        ]} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          );
        }}
      </Async>

      {confirm && (
        <Modal title={`${VERB[confirm.action]} ${confirm.g.name}?`} onClose={() => setConfirm(null)} footer={
          <>
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className={`btn ${confirm.action === 'stop' ? 'btn-danger' : 'btn-primary'}`} autoFocus
              onClick={() => { const c = confirm; setConfirm(null); run(c.g, c.action); }}>
              {confirm.warn ? 'Start anyway' : VERB[confirm.action]}
            </button>
          </>
        }>
          {confirm.warn && <div className="callout warn"><Icon name="alert" size={16} /><span>{confirm.warn}</span></div>}
          <p className="muted">
            {confirm.action === 'stop' && 'Force stop cuts power immediately and may corrupt data inside the guest. Prefer a graceful shutdown.'}
            {confirm.action === 'shutdown' && 'The guest will be asked to shut down gracefully. This can take a little while.'}
            {confirm.action === 'reboot' && 'The guest will be restarted.'}
            {confirm.action === 'start' && !confirm.warn && 'The guest will be started.'}
          </p>
        </Modal>
      )}
    </>
  );
}

function Switch({ on, busy, disabled, label, onClick }: { on: boolean; busy: boolean; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} title={disabled ? 'Protected guest' : label} disabled={disabled || busy}
      className={`switch ${on ? 'on' : ''} ${busy ? 'busy' : ''}`} onClick={onClick}>
      <i>{busy && <Spinner size={11} />}</i>
    </button>
  );
}

function GamingCard({ g, pending, onToggle, conflicts }: { g: Guest; list: Guest[]; pending?: GuestAction; onToggle: () => void; conflicts: Guest[] }) {
  const running = g.status === 'running';
  const busy = !!pending;
  return (
    <section className={`gaming ${running ? 'live' : ''}`}>
      <BrandSwirl calm />
      <div className="gaming-main">
        <div className="gaming-ic"><Icon name="gamepad" size={26} /></div>
        <div>
          <p className="eyebrow">Gaming VM · #{g.vmid} · Windows · QEMU</p>
          <h2>{g.name}</h2>
          <div className="gaming-meta">
            {busy ? <Badge tone="amber"><Spinner size={11} />{pending === 'start' ? 'Starting' : 'Shutting down'}</Badge> : <Badge tone={running ? 'green' : 'gray'} dot>{g.status}</Badge>}
            <span><Icon name="clock" size={14} />{running ? `Up ${fmtUptime(g.uptime)}` : 'Powered off'}</span>
            {running && <span><Icon name="cpu" size={14} />{fmtPct(g.cpu, 0)} CPU</span>}
            {running && <span><Icon name="memory" size={14} />{fmtBytes(g.memUsed)} RAM</span>}
          </div>
          <p className="gaming-hint"><b>Gaming mode:</b> GPU passthrough is dedicated to this VM while it runs. Other GPU guests are paused from starting.</p>
          {!running && conflicts.length > 0 && (
            <div className="callout warn"><Icon name="alert" size={16} /><span>Conflicts with running {conflicts.map((c) => c.name).join(', ')} — they share the GPU.</span></div>
          )}
        </div>
      </div>
      <button className={`gaming-btn ${running ? 'off' : ''}`} disabled={busy || g.protected} onClick={onToggle}>
        {busy ? <Spinner size={18} /> : <Icon name="power" size={20} />}
        {busy ? (pending === 'start' ? 'Starting…' : 'Shutting down…') : running ? 'Shut down' : 'Start gaming'}
      </button>
    </section>
  );
}
