import { api } from '../api';
import { BrandSwirl } from '../components/Brand';
import { InView, Reveal, RevealWords } from '../components/Reveal';
import { AreaCard } from '../components/AreaCard';
import { Async, Badge, Card, CardHead, ErrorState, Icon, Meter, PageHeader, Skeleton } from '../components/ui';
import type { IconName, Tone } from '../components/ui';
import { fmtBytes, fmtPct, fmtUptime, timeAgo } from '../format';
import { useQuery } from '../hooks';
import type { Overview as Ov } from '../types';

function Tile({ icon, label, value, sub, tone, href }: { icon: IconName; label: string; value: string | number; sub: string; tone: Tone; href: string }) {
  return (
    <a className={`tile ic-${tone}`} href={href}>
      <div className="tile-top"><span className="tile-label">{label}</span><span className="tile-ic"><Icon name={icon} size={20} /></span></div>
      <div>
        <p className="tile-value">{value}</p>
        <p className="tile-sub">{sub}</p>
      </div>
    </a>
  );
}

interface Attn { key: string; tone: 'red' | 'amber'; label: string; value: string; text: string; href: string }

function attention(o: Ov, incidents: { monitorId: number; name: string; status: string; message: string }[]): Attn[] {
  const out: Attn[] = [];
  const m = o.host.memUsed / o.host.memTotal, d = o.host.diskUsed / o.host.diskTotal;
  if (o.host.cpu > 0.75) out.push({ key: 'cpu', tone: 'red', label: 'CPU', value: fmtPct(o.host.cpu), text: 'High CPU on the Proxmox host', href: '#/grafana' });
  if (m > 0.8) out.push({ key: 'mem', tone: 'red', label: 'Memory', value: fmtPct(m), text: 'Memory pressure on the Proxmox host', href: '#/grafana' });
  if (d > 0.8) out.push({ key: 'disk', tone: 'red', label: 'Disk', value: fmtPct(d), text: 'Disk usage warning on the Proxmox host', href: '#/grafana' });
  for (const i of incidents) {
    if (i.status === 'maintenance') continue;
    out.push({ key: `m${i.monitorId}`, tone: i.status === 'down' ? 'red' : 'amber', label: 'Monitor', value: i.status, text: `${i.name} is ${i.status}`, href: '#/kuma' });
  }
  return out;
}

export default function Overview() {
  const ov = useQuery(api.overview, [], 8000);
  const inc = useQuery(api.incidents, [], 10000);
  const pct = (v: number) => `${v.toFixed(0)}%`;

  const items = ov.data && inc.data ? attention(ov.data, inc.data) : null;

  return (
    <>
      <Hero items={items} ov={ov.data} />

      <Card className="attn-card">
        {items === null ? (
          ov.error || inc.error
            ? <ErrorState error={(ov.error ?? inc.error) as Error} onRetry={() => { ov.reload(); inc.reload(); }} />
            : <Skeleton rows={2} h={64} />
        ) : (
          <>
            <div className="attn-head">
              <div>
                <h3 className={`attn-title ${items.length ? '' : 'ok'}`}><Icon name={items.length ? 'alert' : 'check'} size={20} />{items.length ? 'Needs Attention' : 'All systems healthy'}</h3>
                <p className="muted small" style={{ marginTop: 6 }}>{items.length ? 'Issues requiring immediate action' : 'Nothing needs your attention right now.'}</p>
              </div>
              {items.length > 0 && <span className="count-pill">{items.length}</span>}
            </div>
            {items.length > 0 && (
              <div className="attn-grid">
                {items.map((a) => (
                  <a key={a.key} href={a.href} className={`attn ${a.tone}`}>
                    <span className="attn-top"><span>{a.label}</span><b>{a.value}</b></span>
                    <span>{a.text}</span>
                  </a>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      <div className="grid-3">
        <AreaCard icon="cpu" title="CPU Usage" sub="Processor utilization over time" color="var(--blue)" format={pct}
          query={'100 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100'} />
        <AreaCard icon="pulse" title="Memory Usage" sub="RAM consumption trends" color="var(--green)" format={pct}
          query={'(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100'} />
        <AreaCard icon="network" title="Network Traffic" sub="Network bandwidth utilization" color="var(--peri)" format={(v) => `${(v / 1e6).toFixed(0)} MB/s`}
          query={'rate(node_network_receive_bytes_total{device="vmbr0"}[5m])'} />
      </div>

      <Async q={ov} rows={1} h={110}>
        {(o) => (
          <>
            <div className="tiles">
              <Tile href="#/guests" icon="server" tone="gray" label="Guests" value={o.guests.total} sub={`${o.guests.running} running · ${o.guests.stopped} stopped`} />
              <Tile href="#/guests" icon="power" tone="green" label="Running" value={o.guests.running} sub={`${o.guests.stopped} stopped`} />
              <Tile href="#/nginx" icon="globe" tone="blue" label="Nginx sites" value={o.nginx.sites} sub="sites-enabled" />
              <Tile href="#/kuma" icon="pulse" tone="green" label="Monitors up" value={o.kuma.up} sub={`${o.kuma.pending} pending`} />
              <Tile href="#/kuma" icon="alert" tone={o.kuma.down ? 'red' : 'gray'} label="Monitors down" value={o.kuma.down} sub={o.kuma.down ? 'Needs attention' : 'All clear'} />
            </div>
            <div className="grid-3">
              <Card>
                <CardHead title="Host resources" sub={`Uptime ${fmtUptime(o.host.uptime)}`} />
                <div className="res">
                  <Res icon="cpu" label="CPU" pct={o.host.cpu} text={fmtPct(o.host.cpu)} />
                  <Res icon="memory" label="Memory" pct={o.host.memUsed / o.host.memTotal} text={`${fmtBytes(o.host.memUsed)} / ${fmtBytes(o.host.memTotal, 0)}`} />
                  <Res icon="disk" label="Disk" pct={o.host.diskUsed / o.host.diskTotal} text={`${fmtBytes(o.host.diskUsed, 0)} / ${fmtBytes(o.host.diskTotal, 0)}`} />
                </div>
              </Card>
              <Card className="span-2">
                <CardHead title="Recent incidents" sub="From Uptime Kuma" right={<a className="link" href="#/kuma">All monitors</a>} />
                <Async q={inc} rows={3} h={56} isEmpty={(d) => d.length === 0} empty={{ title: 'No incidents', hint: 'Every monitor is healthy.' }}>
                  {(list) => (
                    <ul className="incidents">
                      {list.map((i) => (
                        <li key={i.monitorId}>
                          <span className={`inc-dot d-${i.status}`} />
                          <div className="grow">
                            <strong>{i.name}</strong>
                            <p className="muted small">{i.message}</p>
                          </div>
                          <Badge tone={i.status === 'down' ? 'red' : i.status === 'pending' ? 'amber' : 'blue'}>{i.status}</Badge>
                          <span className="muted small nowrap">{timeAgo(i.since)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Async>
              </Card>
            </div>
          </>
        )}
      </Async>
    </>
  );
}

function Res({ icon, label, pct, text }: { icon: IconName; label: string; pct: number; text: string }) {
  return (
    <div className="res-row">
      <div className="res-top"><span><Icon name={icon} size={15} />{label}</span><b>{text}</b></div>
      <Meter value={pct} />
    </div>
  );
}

function Hero({ items, ov }: { items: Attn[] | null; ov?: Ov }) {
  const bad = !!items?.length;
  return (
    <InView>
      <section className="hero">
        <BrandSwirl />
        <div className="hero-meta">
          <span>SPL Console</span>
          <span>{new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </div>
        <h1><RevealWords text="Everything, at a glance." /></h1>
        <Reveal stagger={5} className="hero-sub">
          <i className={`hero-dot ${bad ? 'bad' : ''}`} />
          <span>{items === null ? 'Checking systems…' : bad ? `${items.length} ${items.length === 1 ? 'item needs' : 'items need'} attention` : 'All systems healthy'}</span>
          {ov && <><span className="sep" /><span>{ov.guests.running} of {ov.guests.total} guests running</span></>}
        </Reveal>
      </section>
    </InView>
  );
}
