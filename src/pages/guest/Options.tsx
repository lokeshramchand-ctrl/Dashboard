import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Async, Badge, Card, CardHead, Icon, Spinner } from '../../components/ui';
import { useQuery, useToast } from '../../hooks';
import type { Guest, GuestConfigPatch } from '../../types';
import type { Track } from '../GuestDetail';

interface Form {
  name: string; description: string; tags: string; onboot: boolean; startup: string;
  cores: string; sockets: string; memory: string; swap: string; balloon: string; cpulimit: string;
}

const num = (v: unknown, d = '') => (v === undefined || v === null || v === '' ? d : String(v));
const flag = (v: unknown) => v === 1 || v === '1' || v === true;

function fromConfig(g: Guest, c: Record<string, string | number>): Form {
  return {
    name: num(g.type === 'lxc' ? c.hostname : c.name), description: num(c.description), tags: num(c.tags).split(/[;,]/).filter(Boolean).join(', '),
    onboot: flag(c.onboot), startup: num(c.startup), cores: num(c.cores, '1'), sockets: num(c.sockets, '1'),
    memory: num(c.memory), swap: num(c.swap, '0'), balloon: num(c.balloon, '0'), cpulimit: num(c.cpulimit, '0'),
  };
}

/** Keys that are shown read-only: anything that is not an editable field. */
const HIDDEN = new Set(['digest', 'description', 'tags', 'onboot', 'startup', 'cores', 'sockets', 'memory', 'swap', 'balloon', 'cpulimit', 'name', 'hostname']);

export default function Options({ g }: { g: Guest; track?: Track }) {
  const q = useQuery(() => api.guestConfig(g.vmid), [g.vmid]);
  return (
    <Async q={q} rows={4} h={56}>
      {(d) => <OptionsForm g={g} config={d.config} pending={d.pending} reload={q.reload} />}
    </Async>
  );
}

function OptionsForm({ g, config, pending, reload }: { g: Guest; config: Record<string, string | number>; pending: string[]; reload: () => void }) {
  const initial = fromConfig(g, config);
  const [f, setF] = useState<Form>(initial);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const lxc = g.type === 'lxc';
  const locked = g.protected;
  useEffect(() => { setF(fromConfig(g, config)); }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const patch = (): GuestConfigPatch => {
    const p: GuestConfigPatch = {};
    if (f.name !== initial.name) p[lxc ? 'hostname' : 'name'] = f.name;
    if (f.description !== initial.description) p.description = f.description;
    if (f.tags !== initial.tags) p.tags = f.tags.split(/[,;\s]+/).filter(Boolean);
    if (f.onboot !== initial.onboot) p.onboot = f.onboot;
    if (f.startup !== initial.startup) p.startup = f.startup;
    for (const k of ['cores', 'memory', 'cpulimit'] as const) if (f[k] !== initial[k]) p[k] = Number(f[k]);
    if (lxc && f.swap !== initial.swap) p.swap = Number(f.swap);
    if (!lxc) {
      if (f.sockets !== initial.sockets) p.sockets = Number(f.sockets);
      if (f.balloon !== initial.balloon) p.balloon = Number(f.balloon);
    }
    return p;
  };
  const changes = patch();
  const dirty = Object.keys(changes).length > 0;
  const numeric = ['cores', 'sockets', 'memory', 'swap', 'balloon', 'cpulimit'] as const;
  const invalid = numeric.some((k) => (lxc ? k !== 'sockets' && k !== 'balloon' : k !== 'swap') && !/^\d+$/.test(f[k]));

  async function save() {
    setSaving(true);
    try {
      await api.setGuestConfig(g.vmid, changes);
      toast.success(`${g.name}: settings saved`);
    } catch (e) {
      toast.error(`${g.name}: could not save settings — ${(e as Error).message}`);
    } finally {
      setSaving(false);
      reload();
    }
  }

  const rest = Object.entries(config).filter(([k]) => !HIDDEN.has(k)).sort(([a], [b]) => a.localeCompare(b));
  const dis = locked || saving;

  return (
    <>
      {locked && <div className="callout warn"><Icon name="lock" size={16} /><span>This guest is protected; settings are read-only.</span></div>}
      {pending.length > 0 && <div className="callout warn"><Icon name="alert" size={16} /><span>Pending until the next restart: {pending.join(', ')}.</span></div>}

      <div className="grid-2">
        <Card>
          <CardHead title="General" sub={lxc ? 'Container identity and start-up behaviour.' : 'VM identity and start-up behaviour.'} />
          <div className="form">
            <label className="field"><span>{lxc ? 'Hostname' : 'Name'}</span>
              <input className="input" value={f.name} disabled={dis} onChange={(e) => set('name', e.target.value)} /></label>
            <label className="field"><span>Tags <small className="muted">comma separated</small></span>
              <input className="input" value={f.tags} disabled={dis} onChange={(e) => set('tags', e.target.value)} /></label>
            <label className="field"><span>Start order <small className="muted">e.g. order=1,up=30</small></span>
              <input className="input" value={f.startup} disabled={dis} onChange={(e) => set('startup', e.target.value)} placeholder="not set" /></label>
            <label className="field check">
              <input type="checkbox" checked={f.onboot} disabled={dis} onChange={(e) => set('onboot', e.target.checked)} />
              <span>Start at boot</span>
            </label>
            <label className="field"><span>Notes</span>
              <textarea className="input area-in" rows={4} value={f.description} disabled={dis} onChange={(e) => set('description', e.target.value)} /></label>
          </div>
        </Card>

        <Card>
          <CardHead title="Resources" sub="CPU and memory. Running guests may need a restart to apply some changes." />
          <div className="form two">
            <label className="field"><span>Cores</span>
              <input className="input" inputMode="numeric" value={f.cores} disabled={dis} onChange={(e) => set('cores', e.target.value)} /></label>
            {!lxc && <label className="field"><span>Sockets</span>
              <input className="input" inputMode="numeric" value={f.sockets} disabled={dis} onChange={(e) => set('sockets', e.target.value)} /></label>}
            <label className="field"><span>CPU limit <small className="muted">0 = unlimited</small></span>
              <input className="input" inputMode="numeric" value={f.cpulimit} disabled={dis} onChange={(e) => set('cpulimit', e.target.value)} /></label>
            <label className="field"><span>Memory <small className="muted">MiB</small></span>
              <input className="input" inputMode="numeric" value={f.memory} disabled={dis} onChange={(e) => set('memory', e.target.value)} /></label>
            {lxc && <label className="field"><span>Swap <small className="muted">MiB</small></span>
              <input className="input" inputMode="numeric" value={f.swap} disabled={dis} onChange={(e) => set('swap', e.target.value)} /></label>}
            {!lxc && <label className="field"><span>Minimum memory <small className="muted">MiB, 0 = no ballooning</small></span>
              <input className="input" inputMode="numeric" value={f.balloon} disabled={dis} onChange={(e) => set('balloon', e.target.value)} /></label>}
          </div>
        </Card>
      </div>

      <div className="save-bar">
        <span className="muted small">{dirty ? `${Object.keys(changes).length} unsaved change${Object.keys(changes).length === 1 ? '' : 's'}` : 'No changes'}</span>
        <button className="btn" disabled={!dirty || saving} onClick={() => setF(initial)}>Reset</button>
        <button className="btn btn-primary" disabled={!dirty || dis || invalid} onClick={save}>{saving ? <Spinner size={14} /> : <Icon name="check" size={15} />}Save</button>
      </div>

      <Card>
        <CardHead title="Hardware & other settings" sub="Read-only here. Change disks and network in Proxmox." right={<Badge tone="gray">{rest.length}</Badge>} />
        {rest.length === 0 ? <p className="muted small">No further settings.</p> : (
          <dl className="kv">
            {rest.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>))}
          </dl>
        )}
      </Card>
    </>
  );
}
