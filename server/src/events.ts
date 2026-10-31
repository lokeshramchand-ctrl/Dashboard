import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { cfg, pveConfigured } from './config.js';
import { col, dbHealth } from './db.js';
import type { EventDoc } from './db.js';
import { HttpError } from './errors.js';
import { listGuests } from './guests.js';
import { alertFromEvent } from './notify.js';
import { pve } from './proxmox.js';

const run = promisify(execFile);
const DAY = 86_400_000;
type Level = EventDoc['level'];
type Source = EventDoc['source'];

// Events raised while Mongo is unreachable are held here and written once it is back.
const pending: EventDoc[] = [];
let flushing = false;

async function flush() {
  if (flushing || !pending.length) return;
  flushing = true;
  try {
    while (pending.length) {
      await col.events().insertOne({ ...pending[0] });
      pending.shift();
    }
  } catch { /* still down; retried on the next event or heartbeat */ } finally { flushing = false; }
}

export function logEvent(level: Level, source: Source, message: string, data?: Record<string, unknown>) {
  const ts = new Date();
  if (pending.length >= 500) pending.shift();
  pending.push({ ts, level, source, message, data, expireAt: new Date(ts.getTime() + cfg.eventRetentionDays * DAY) });
  void flush();
  alertFromEvent(level, source, message);
}

const setState = (id: string, value: Record<string, unknown>) =>
  col.state().updateOne({ _id: id }, { $set: { value } }, { upsert: true });
const getState = async (id: string) => (await col.state().findOne({ _id: id }))?.value;

const fmtAgo = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};

/** Called once at startup: records the start and works out whether the last run ended cleanly. */
async function recordStart() {
  const hb = await getState('heartbeat');
  const stop = await getState('clean-stop');
  const lastSeen = typeof hb?.ts === 'string' ? new Date(hb.ts) : null;
  const stoppedAt = typeof stop?.ts === 'string' ? new Date(stop.ts) : null;
  if (lastSeen && (!stoppedAt || stoppedAt < lastSeen)) {
    const gap = Date.now() - lastSeen.getTime();
    logEvent('error', 'app', `Dashboard did not shut down cleanly. Last heartbeat ${fmtAgo(gap)} ago (crash, kill, or host power loss)`, { lastSeen: lastSeen.toISOString() });
  }
  logEvent('info', 'app', 'Dashboard started', { pid: process.pid, node: process.version });
}

async function hostWatch() {
  if (!pveConfigured()) return;
  try {
    const n = await pve<{ uptime?: number }>('GET', `/nodes/${encodeURIComponent(cfg.pveNode)}/status`);
    const bootedAt = Date.now() - Number(n.uptime ?? 0) * 1000;
    const prev = await getState('host-boot');
    if (typeof prev?.bootedAt === 'number' && Math.abs(bootedAt - prev.bootedAt) > 120_000 && bootedAt > prev.bootedAt) {
      logEvent('error', 'host', 'Proxmox host rebooted', { previousBoot: new Date(prev.bootedAt).toISOString(), bootedAt: new Date(bootedAt).toISOString() });
    }
    if (!prev || Math.abs(bootedAt - Number(prev.bootedAt)) > 120_000) await setState('host-boot', { bootedAt });
  } catch { /* guest watcher reports Proxmox being unreachable */ }
}

let guestState = new Map<number, string>();
let pveDown = false;
async function guestWatch() {
  if (!pveConfigured()) return;
  try {
    const next = new Map<number, string>();
    for (const g of await listGuests()) {
      next.set(g.vmid, g.status);
      const was = guestState.get(g.vmid);
      if (was && was !== g.status) {
        // A stop nobody asked the dashboard for is the interesting case.
        const recent = await col.audit().findOne({ vmid: g.vmid, result: 'accepted', ts: { $gt: new Date(Date.now() - 5 * 60_000) } });
        const unexpected = g.status === 'stopped' && !recent;
        logEvent(unexpected ? 'error' : 'info', 'guest', `${g.name} (${g.vmid}) ${was} → ${g.status}${unexpected ? ' (not requested via the dashboard)' : ''}`, { vmid: g.vmid, from: was, to: g.status });
      }
    }
    guestState = next;
    if (pveDown) { pveDown = false; logEvent('info', 'host', 'Proxmox API reachable again'); }
  } catch (e) {
    if (!pveDown) { pveDown = true; logEvent('error', 'host', `Proxmox API unreachable: ${(e as Error).message}`); }
  }
}

/** Kuma status transitions, fed from the scraper. */
const monitorState = new Map<string, string>();
export function noteMonitors(items: { key: string; name: string; status: string }[]) {
  for (const i of items) {
    const was = monitorState.get(i.key);
    monitorState.set(i.key, i.status);
    if (!was || was === i.status) continue;
    const bad = i.status === 'down';
    logEvent(bad ? 'error' : i.status === 'up' ? 'info' : 'warn', 'monitor', `${i.name}: ${was} → ${i.status}`, { monitor: i.name, from: was, to: i.status });
  }
}

export function startEvents(app: FastifyInstance) {
  dbHealth.on('change', (ok: boolean, detail?: string) => {
    app.log.warn({ ok, detail }, ok ? 'mongo reachable again' : 'mongo unreachable');
    logEvent(ok ? 'info' : 'error', 'db', ok ? 'MongoDB reachable again' : `MongoDB unreachable: ${detail ?? 'heartbeat failed'}`);
  });
  process.on('uncaughtException', (e) => { app.log.fatal(e, 'uncaughtException'); logEvent('error', 'app', `Uncaught exception: ${e.message}`); });
  process.on('unhandledRejection', (e) => { app.log.error(e, 'unhandledRejection'); logEvent('error', 'app', `Unhandled rejection: ${(e as Error)?.message ?? e}`); });

  void recordStart();
  const beat = () => { void setState('heartbeat', { ts: new Date().toISOString() }).catch(() => {}); void flush(); };
  beat();
  setInterval(beat, 30_000).unref();
  setInterval(() => void guestWatch(), 15_000).unref();
  setInterval(() => void hostWatch(), 60_000).unref();
  void guestWatch();
  void hostWatch();
}

/** Marks a deliberate stop so the next start is not reported as a crash. */
export async function recordCleanStop() {
  logEvent('info', 'app', 'Dashboard stopping (signal)');
  try {
    await Promise.race([
      (async () => { await flush(); await setState('clean-stop', { ts: new Date().toISOString() }); })(),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
  } catch { /* db already gone */ }
}

// ---------- host journal (read-only, journalctl via execFile: no shell) ----------

const PRIORITIES = new Set(['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']);
const UNIT = /^[\w@.:\\-]{1,100}$/;
const SINCE = /^(\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?|-?\d+(s|m|h|d|min|hour|day|week)s?( ago)?|today|yesterday)$/i;

interface JournalLine { ts: string; priority: number; unit: string; message: string; pid?: string }

export async function journal(args: string[]): Promise<JournalLine[]> {
  if (!cfg.journalEnabled) throw new HttpError(503, 'NOT_CONFIGURED', 'Host journal access is disabled (JOURNAL_ENABLED=false)');
  let stdout: string;
  try {
    ({ stdout } = await run('journalctl', ['--no-pager', '-q', '-o', 'json', ...args], { maxBuffer: 16 * 1024 * 1024, timeout: 15_000 }));
  } catch (e) {
    const err = e as Error & { code?: string | number; stdout?: string; stderr?: string };
    if (err.code === 'ENOENT') throw new HttpError(503, 'NOT_CONFIGURED', 'journalctl is not available on this host');
    // systemd >= 255 exits 1 with no output when -g matches nothing; that is an empty result, not a failure.
    if (err.code === 1 && !err.stderr?.trim()) stdout = err.stdout ?? '';
    else throw new HttpError(502, 'JOURNAL_ERROR', `journalctl failed: ${err.message.split('\n')[0]}`);
  }
  const lines: JournalLine[] = [];
  for (const raw of stdout.split('\n')) {
    if (!raw) continue;
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      const msg = j.MESSAGE;
      lines.push({
        ts: new Date(Number(j.__REALTIME_TIMESTAMP) / 1000).toISOString(),
        priority: Number(j.PRIORITY ?? 6),
        unit: String(j._SYSTEMD_UNIT ?? j.SYSLOG_IDENTIFIER ?? (j._TRANSPORT === 'kernel' ? 'kernel' : '')),
        message: typeof msg === 'string' ? msg.slice(0, 2000) : Array.isArray(msg) ? '[binary message]' : String(msg ?? ''),
        pid: j._PID ? String(j._PID) : undefined,
      });
    } catch { /* skip a malformed line */ }
  }
  return lines;
}

interface Boot { index: number; bootId: string; first: string; last: string; clean: boolean | null; endReason: string }

const CLEAN_END = /(Reached target (Power-Off|Reboot|System Power Off|System Reboot|Final Step)|systemd-shutdown|Journal stopped|Shutting down|Stopped target)/i;

async function boots(): Promise<Boot[]> {
  const { stdout } = await run('journalctl', ['--list-boots', '-o', 'json', '--no-pager', '-q'], { timeout: 15_000 });
  const list = JSON.parse(stdout) as { index: number; boot_id: string; first_entry: number; last_entry: number }[];
  const recent = list.slice(-8).reverse();
  return Promise.all(recent.map(async (b): Promise<Boot> => {
    const base = { index: b.index, bootId: b.boot_id, first: new Date(b.first_entry / 1000).toISOString(), last: new Date(b.last_entry / 1000).toISOString() };
    if (b.index === 0) return { ...base, clean: null, endReason: 'current boot' };
    try {
      const tail = await journal(['-b', String(b.index), '-n', '25', '-r']);
      const ended = tail.find((l) => CLEAN_END.test(l.message));
      return ended
        ? { ...base, clean: true, endReason: `clean shutdown (${ended.message.slice(0, 80)})` }
        : { ...base, clean: false, endReason: `log stops with no shutdown sequence: power loss, hard reset, crash or hang${tail.some((l) => /Power key pressed/i.test(l.message)) ? ' (power button was pressed just before)' : ''}` };
    } catch {
      return { ...base, clean: null, endReason: 'unknown' };
    }
  }));
}

export function registerLogs(app: FastifyInstance) {
  app.get<{ Querystring: { level?: string; source?: string; before?: string; q?: string; limit?: string } }>('/api/logs/events', async (req) => {
    const { level, source, before, q } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? '100', 10) || 100, 1), 500);
    const f: Record<string, unknown> = {};
    if (level && ['info', 'warn', 'error'].includes(level)) f.level = level;
    if (source && /^[a-z]{2,10}$/.test(source)) f.source = source;
    if (before && !Number.isNaN(Date.parse(before))) f.ts = { $lt: new Date(before) };
    if (q) f.message = { $regex: q.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const rows = await col.events().find(f).sort({ ts: -1 }).limit(limit).toArray();
    return rows.map((r) => ({ id: String(r._id), ts: r.ts.toISOString(), level: r.level, source: r.source, message: r.message, data: r.data ?? null }));
  });

  app.get<{ Querystring: { priority?: string; unit?: string; since?: string; boot?: string; q?: string; kernel?: string; limit?: string } }>('/api/logs/journal', async (req) => {
    const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? undefined : (() => { throw new HttpError(400, 'BAD_REQUEST', 'Query parameters must be single values'); })());
    const priority = str(req.query.priority), unit = str(req.query.unit), since = str(req.query.since), boot = str(req.query.boot), q = str(req.query.q), kernel = str(req.query.kernel);
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? '200', 10) || 200, 1), 1000);
    const args = ['-n', String(limit), '-r'];
    if (priority) {
      if (!PRIORITIES.has(priority)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid priority');
      args.push('-p', priority);
    }
    if (unit) {
      if (!UNIT.test(unit)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid unit name');
      args.push('-u', unit);
    }
    if (since) {
      if (!SINCE.test(since)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid since value');
      args.push('--since', since);
    }
    if (boot !== undefined && boot !== '') {
      const n = Number(boot);
      if (!Number.isInteger(n) || n > 0 || n < -50) throw new HttpError(400, 'BAD_REQUEST', 'boot must be 0 or a negative offset');
      args.push('-b', String(n));
    }
    if (kernel === 'true') args.push('-k');
    if (q) args.push(`--grep=${q.slice(0, 100)}`, '--case-sensitive=false');
    return journal(args);
  });

  // One-call answer to "why did it go offline": boot history + what the last boots ended with + current watch state.
  app.get('/api/logs/summary', async () => {
    const [bootList, errs24h] = await Promise.all([
      boots().catch((e) => ({ error: (e as Error).message })),
      col.events().countDocuments({ level: 'error', ts: { $gt: new Date(Date.now() - DAY) } }),
    ]);
    const hb = await getState('heartbeat');
    return {
      boots: Array.isArray(bootList) ? bootList : [],
      journalError: Array.isArray(bootList) ? null : bootList.error,
      errors24h: errs24h,
      lastHeartbeat: typeof hb?.ts === 'string' ? hb.ts : null,
      pendingEvents: pending.length,
      processUptime: Math.round(process.uptime()),
    };
  });
}
