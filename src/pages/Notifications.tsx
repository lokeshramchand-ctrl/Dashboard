import { useState } from 'react';
import { api } from '../api';
import { Async, Badge, Card, CardHead, EmptyState, Icon, PageHeader, Spinner } from '../components/ui';
import { KV } from '../components/Pve';
import { timeAgo } from '../format';
import { useQuery, useToast } from '../hooks';
import type { NotifySettings } from '../types';

const LABEL: Record<string, [string, string]> = {
  monitor: ['Uptime monitors', 'A Kuma monitor goes down or recovers'],
  guest: ['Guests', 'A VM or container stops without a dashboard action'],
  host: ['Proxmox host', 'API unreachable, host reboot, stopped PVE services'],
  resources: ['Resource pressure', 'CPU, RAM or root disk above threshold for 5 minutes'],
  tasks: ['Failed tasks', 'Any Proxmox task ends with an error'],
  gpu: ['GPU & passthrough', 'vfio, amdgpu or NVIDIA driver faults in the kernel log'],
  hardware: ['Hardware errors', 'PCIe AER, machine checks, disk I/O errors, process crashes'],
  disks: ['Disk health', 'S.M.A.R.T. failure or SSD wearout under 10%'],
  services: ['System services', 'An enabled PVE service is not running'],
  db: ['MongoDB', 'Database connection lost or restored'],
  app: ['Dashboard', 'Crash, unclean shutdown, uncaught errors'],
  auth: ['Sign-in', 'Refused single sign-on attempts'],
};

export default function Notifications() {
  const q = useQuery(api.notify, [], 10_000);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  async function save(s: Partial<NotifySettings>) {
    setSaving(true);
    try {
      const next = await api.notifySettings(s);
      q.mutate((d) => ({ ...d, settings: next }));
    } catch (e) { toast.error(`Couldn't save: ${(e as Error).message}`); } finally { setSaving(false); }
  }
  async function test() {
    setTesting(true);
    try { await api.notifyTest(); toast.success('Test notification sent'); q.reload(); } catch (e) { toast.error(`Test failed: ${(e as Error).message}`); } finally { setTesting(false); }
  }

  return (
    <>
      <PageHeader eyebrow="Settings" title="Notifications" sub="Push alerts to your phone through ntfy whenever something goes down, and again when it recovers."
        actions={q.data?.configured && <button className="btn btn-primary" onClick={test} disabled={testing}>{testing ? <Spinner size={14} /> : <Icon name="bell" size={15} />}Send test</button>} />
      <Async q={q} rows={3} h={120}>
        {(d) => !d.configured ? (
          <Card><EmptyState icon="bell" title="ntfy is not configured" hint="Set NTFY_URL and NTFY_TOPIC in server/.env and restart the dashboard." /></Card>
        ) : (
          <div className="settings-grid">
            <div className="stack">
              <Card>
                <CardHead title="Delivery" sub="Subscribe to this topic in the ntfy app on your phone." right={
                  <Toggle on={d.settings.enabled} disabled={saving} label="Alerts enabled" onChange={(v) => save({ enabled: v })} />
                } />
                <KV rows={[
                  ['Server', <span className="mono">{d.server}</span>],
                  ['Topic', <span className="mono">{d.topic}</span>],
                  ['Subscribe', <a className="link" href={d.subscribeUrl} target="_blank" rel="noopener noreferrer">Open topic<Icon name="external" size={13} /></a>],
                  ['Status', d.settings.mutedUntil && new Date(d.settings.mutedUntil) > new Date()
                    ? <Badge tone="amber">Muted until {new Date(d.settings.mutedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Badge>
                    : <Badge tone={d.settings.enabled ? 'green' : 'gray'} dot>{d.settings.enabled ? 'Active' : 'Disabled'}</Badge>],
                ]} />
                <div className="btn-row">
                  <button className="btn" disabled={saving} onClick={() => save({ mutedUntil: new Date(Date.now() + 3600_000).toISOString() })}>Mute 1 hour</button>
                  <button className="btn" disabled={saving} onClick={() => save({ mutedUntil: new Date(Date.now() + 8 * 3600_000).toISOString() })}>Mute 8 hours</button>
                  {d.settings.mutedUntil && <button className="btn btn-ghost" disabled={saving} onClick={() => save({ mutedUntil: null })}>Unmute</button>}
                </div>
              </Card>
              <Card>
                <CardHead title="Alert rules" sub={`Thresholds: CPU ${d.thresholds.cpu * 100}% · RAM ${d.thresholds.mem * 100}% · disk ${d.thresholds.disk * 100}%`} />
                <ul className="rules">
                  {d.categories.map((c) => (
                    <li key={c}>
                      <div className="grow"><b>{LABEL[c]?.[0] ?? c}</b><p className="muted small">{LABEL[c]?.[1]}</p></div>
                      <Toggle on={d.settings.categories[c] !== false} disabled={saving || !d.settings.enabled} label={LABEL[c]?.[0] ?? c}
                        onChange={(v) => save({ categories: { ...d.settings.categories, [c]: v } })} />
                    </li>
                  ))}
                  <li>
                    <div className="grow"><b>Recovery messages</b><p className="muted small">Also notify when something comes back up</p></div>
                    <Toggle on={d.settings.recoveries} disabled={saving || !d.settings.enabled} label="Recovery messages" onChange={(v) => save({ recoveries: v })} />
                  </li>
                </ul>
              </Card>
            </div>
            <Card pad={false}>
              <div className="pad"><CardHead title="Recently sent" sub="Since the dashboard last started" /></div>
              {d.sent.length === 0 ? <EmptyState icon="inbox" title="Nothing sent yet" hint="Alerts appear here as they go out." /> : (
                <ul className="feed">
                  {d.sent.map((s, i) => (
                    <li key={i}>
                      <span className={`inc-dot ${s.priority >= 5 ? 'd-down' : s.priority >= 4 ? 'd-pending' : ''}`} />
                      <div className="grow"><b>{s.title}</b><p className="muted small">{s.message}</p>{!s.ok && <p className="small err-t">Delivery failed: {s.error}</p>}</div>
                      <span className="muted small nowrap">{timeAgo(s.ts)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </Async>
    </>
  );
}

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button>;
}
