import { useState } from 'react';
import { api } from '../api';
import { Async, Badge, Card, CardHead, Chips, EmptyState, Icon, Meter } from '../components/ui';
import type { Tone } from '../components/ui';
import { AskAI, buildPrompt } from '../components/AskAI';
import { KV, LogList, RecurringTable, SINCE, TaskTable, tidy } from '../components/Pve';
import { fmtBytes, fmtPct, fmtUptime } from '../format';
import { useQuery, useToast } from '../hooks';
import type { Finding, Severity, Stat, WindowsReport } from '../types';

const TONE: Record<Severity, Tone> = { critical: 'red', warn: 'amber', info: 'blue', ok: 'green' };
const LABEL: Record<Severity, string> = { critical: 'Problem', warn: 'Warning', info: 'Note', ok: 'OK' };
const VERDICT: Record<Severity, string> = {
  critical: 'Needs attention', warn: 'Warnings found', info: 'Notes only', ok: 'Healthy',
};
const AGENT_TEXT: Record<WindowsReport['agent']['state'], string> = {
  ok: 'Responding', unreachable: 'Not responding', 'no-permission': 'Blocked by permissions', 'vm-stopped': 'VM is stopped',
};
const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dur = (s: number | null) => (s === null ? '–' : fmtUptime(s));
const stat = (s: Stat | null, f: (n: number) => string) => (s ? `${f(s.avg)} avg · ${f(s.p95)} p95 · ${f(s.max)} max` : 'no data');

function FindingRow({ f }: { f: Finding }) {
  return (
    <li className={`win-finding sev-${f.severity}`}>
      <Badge tone={TONE[f.severity]}>{LABEL[f.severity]}</Badge>
      <div className="grow">
        <b>{f.title}</b>
        {f.detail && <p className="small muted">{f.detail}</p>}
        {f.advice && <p className="small win-advice"><Icon name="check" size={13} /> {f.advice}</p>}
      </div>
    </li>
  );
}

/** Plain-text report for pasting into a ticket or forum post. */
export function reportText(r: WindowsReport): string {
  const out: string[] = [];
  out.push(`# ${r.name} (VM ${r.vmid}) — ${VERDICT[r.verdict]}`, `Generated ${new Date().toISOString()} · window ${r.since.slice(1)} · status ${r.status} · uptime ${dur(r.uptime)} · ostype ${r.ostype}`, '');
  out.push('## Findings', ...r.findings.map((f) => `- [${f.severity}] ${f.title}${f.detail ? ` — ${f.detail}` : ''}${f.advice ? `\n    fix: ${f.advice}` : ''}`), '');
  out.push('## Config health', ...r.health.filter((h) => h.severity !== 'ok').map((f) => `- [${f.severity}] ${f.title}${f.detail ? ` — ${f.detail}` : ''}`), '');
  out.push(`## Guest agent: ${AGENT_TEXT[r.agent.state]}${r.agent.error ? ` (${r.agent.error})` : ''}`);
  if (r.agent.os) out.push(`- ${r.agent.os.name} ${r.agent.os.version} (${r.agent.os.kernel}) host ${r.agent.hostname ?? '?'} tz ${r.agent.timezone ?? '?'} skew ${r.agent.timeSkewSec ?? '?'}s`);
  out.push('', '## Runs (newest first)', ...r.sessions.map((s) => `- ${s.start} → ${s.end ?? 'now/unknown'} (${dur(s.durationSec)}, cpu ${dur(s.cpuSec)}, peak ${s.memPeak ?? '?'}) ended by: ${s.endedBy}`), '');
  out.push('## Recent power tasks', ...r.taskHistory.slice(0, 30).map((t) => `- ${new Date(t.start * 1000).toISOString()} ${t.type} ${t.status}${t.status === 'error' ? ` — ${t.message}` : ''}`), '');
  out.push('## Problem log lines', ...r.lines.filter((l) => l.level !== 'info').slice(0, 100).map((l) => `${l.ts} [${l.level}/${l.kind}] ${l.unit}: ${tidy(l.message)}`));
  return out.join('\n');
}

export default function GuestWindows({ vmid }: { vmid: number }) {
  const [since, setSince] = useState('7d');
  const [live, setLive] = useState(false);
  const toast = useToast();
  const q = useQuery(() => api.windows(vmid, since), [vmid, since], live ? 15_000 : 0);

  const copy = async (r: WindowsReport) => {
    try { await navigator.clipboard.writeText(reportText(r)); toast.success('Report copied'); } catch { toast.error('Clipboard not available'); }
  };
  const download = (r: WindowsReport) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([reportText(r)], { type: 'text/plain' }));
    a.download = `vm${r.vmid}-${r.name}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="toolbar">
        <span className="section-label grow">Windows diagnostics</span>
        <label className="live-toggle"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live (15 s)</label>
        {q.data && <button className="btn" onClick={() => copy(q.data!)}><Icon name="copy" size={15} />Copy report</button>}
        {q.data && <button className="btn" onClick={() => download(q.data!)}><Icon name="list" size={15} />Download</button>}
        <AskAI subject={`Windows VM ${vmid} diagnostics`} build={() => (q.data ? buildPrompt(`Windows VM ${vmid} diagnostics`, { verdict: q.data.verdict }, [{ title: 'Report', body: reportText(q.data) }]) : '(no data yet)')} />
        <Chips value={since} onChange={setSince} options={SINCE} />
      </div>
      <Async q={q} rows={3} h={90}>
        {(r) => (
          <>
            <Card className={`verdict ${r.verdict === 'ok' ? 'good' : 'bad'}`}>
              <CardHead title={VERDICT[r.verdict]} sub={`${r.name} · ${r.status}${r.status === 'running' ? ` for ${dur(r.uptime)}` : ''} · ${r.counts.problems} problem line${r.counts.problems === 1 ? '' : 's'} in ${since}`} />
              <ul className="win-findings">{r.findings.map((f) => <FindingRow key={f.id} f={f} />)}</ul>
            </Card>

            <div className="grid-3">
              <Card>
                <CardHead title="Guest agent" sub={AGENT_TEXT[r.agent.state]} right={<Badge tone={r.agent.state === 'ok' ? 'green' : r.agent.state === 'vm-stopped' ? 'gray' : 'amber'} dot>{r.agent.state === 'ok' ? 'up' : r.agent.state === 'vm-stopped' ? 'n/a' : 'down'}</Badge>} />
                {r.agent.state !== 'ok' ? (
                  <p className="small muted">{r.agent.error ?? 'Start the VM to query the agent.'}{r.agent.state === 'no-permission' && ' Grant it with: pveum role modify <role> -privs +VM.GuestAgent.Audit (or add the privilege to the API token role).'}</p>
                ) : (
                  <KV rows={[
                    ['OS', `${r.agent.os?.name ?? '–'} ${r.agent.os?.version ?? ''}`], ['Build', r.agent.os?.kernel || '–'], ['Hostname', r.agent.hostname ?? '–'], ['Timezone', r.agent.timezone ?? '–'],
                    ['Clock vs host', r.agent.timeSkewSec === null ? '–' : <b className={Math.abs(r.agent.timeSkewSec) > 5 ? 'err-t' : ''}>{r.agent.timeSkewSec > 0 ? '+' : ''}{r.agent.timeSkewSec}s</b>],
                    ['Signed in', r.agent.users.length ? r.agent.users.join(', ') : 'nobody'],
                    ...r.agent.nics.map((n) => [n.name, <span className="mono small">{n.ips.join(', ') || n.mac}</span>] as [string, JSX.Element]),
                  ]} />
                )}
                {r.agent.disks.length > 0 && (
                  <div className="win-disks">
                    {r.agent.disks.map((d) => (
                      <div key={d.mount} className="res-row">
                        <div className="res-top"><span>{d.mount}</span><b>{fmtBytes(d.used)} / {fmtBytes(d.total)}</b></div>
                        <Meter value={d.total ? d.used / d.total : 0} />
                      </div>
                    ))}
                  </div>
                )}
              </Card>
              <Card>
                <CardHead title="Resource use" sub={`Last ${r.metricsTimeframe} · ${r.metrics.samples} samples`} />
                <KV rows={[
                  ['CPU', stat(r.metrics.cpu, (n) => fmtPct(n))], ['Memory', stat(r.metrics.mem, (n) => fmtBytes(n))],
                  ['Net in', stat(r.metrics.netIn, (n) => `${fmtBytes(n)}/s`)], ['Net out', stat(r.metrics.netOut, (n) => `${fmtBytes(n)}/s`)],
                  ['Disk read', stat(r.metrics.diskRead, (n) => `${fmtBytes(n)}/s`)], ['Disk write', stat(r.metrics.diskWrite, (n) => `${fmtBytes(n)}/s`)],
                  ['CPU pinned ≥95%', <b className={r.metrics.cpuSaturatedPct > 0.1 ? 'err-t' : ''}>{fmtPct(r.metrics.cpuSaturatedPct, 1)}</b>],
                  ['Idle while running', `${r.metrics.idleSamples} samples`],
                ]} />
              </Card>
              <Card>
                <CardHead title="Configuration health" sub={`${r.health.filter((h) => h.severity === 'ok').length} of ${r.health.length} checks pass`} />
                <ul className="win-findings compact">{[...r.health].sort((a, b) => ['critical', 'warn', 'info', 'ok'].indexOf(a.severity) - ['critical', 'warn', 'info', 'ok'].indexOf(b.severity)).map((h) => <FindingRow key={h.id} f={h} />)}</ul>
              </Card>
            </div>

            <span className="section-label">Runs · {r.sessions.length}</span>
            {r.sessions.length === 0 ? <Card><EmptyState icon="clock" title="No runs in this window" /></Card> : (
              <div className="card table">
                <div className="dt-row win-run g-head"><span>Started</span><span>Ended</span><span>Length</span><span>CPU time</span><span>Peak RAM</span><span>Ended by</span></div>
                {r.sessions.map((s, i) => (
                  <div key={i} className="dt-row win-run">
                    <span>{when(s.start)}</span><span className="muted">{s.end ? when(s.end) : 'running'}</span><span>{dur(s.durationSec)}</span>
                    <span className="muted">{dur(s.cpuSec)}</span><span className="muted">{s.memPeak ?? '–'}</span>
                    <span>{s.endedBy.startsWith('from inside') ? <Badge tone="amber">{s.endedBy}</Badge> : s.endedBy}</span>
                  </div>
                ))}
              </div>
            )}

            {r.recurring.length > 0 && <><span className="section-label">Recurring problems</span><RecurringTable rows={r.recurring} /></>}
            <span className="section-label">Power and start/stop tasks</span>
            <TaskTable q={{ ...q, data: r.taskHistory, mutate: () => {} }} compact />
            <span className="section-label">Host log for this VM</span>
            <LogList lines={r.lines} empty="QEMU, systemd scope, Proxmox and passthrough device lines (reset chatter is counted, not listed)." />
          </>
        )}
      </Async>
    </>
  );
}
