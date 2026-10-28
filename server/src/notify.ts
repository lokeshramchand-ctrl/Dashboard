// Push alerts to ntfy. Fed by logEvent() (every warn/error and recovery) plus a watcher for
// host resources, failed Proxmox tasks, disk health and stopped PVE services.
import type { FastifyInstance } from 'fastify';
import { cfg, ntfyConfigured, pveConfigured } from './config.js';
import { col } from './db.js';
import type { EventDoc } from './db.js';
import { HttpError, notConfigured } from './errors.js';
import { logEvent } from './events.js';
import { pve } from './proxmox.js';

export const CATEGORIES = ['monitor', 'guest', 'host', 'resources', 'tasks', 'disks', 'services', 'db', 'app', 'auth'] as const;
type Category = (typeof CATEGORIES)[number];
interface Settings { enabled: boolean; categories: Record<Category, boolean>; recoveries: boolean; mutedUntil: string | null }
const DEFAULTS: Settings = { enabled: true, categories: Object.fromEntries(CATEGORIES.map((c) => [c, true])) as Record<Category, boolean>, recoveries: true, mutedUntil: null };

let settings: Settings = DEFAULTS;
interface Sent { ts: string; title: string; message: string; priority: number; category: Category; ok: boolean; error?: string }
const sent: Sent[] = [];
const lastByKey = new Map<string, number>();
let hourStart = Date.now(), hourCount = 0;
const DEDUPE_MS = 10 * 60_000, MAX_PER_HOUR = 40;

async function loadSettings() {
  try {
    const v = (await col.state().findOne({ _id: 'notify-settings' }))?.value as Partial<Settings> | undefined;
    if (v) settings = { ...DEFAULTS, ...v, categories: { ...DEFAULTS.categories, ...(v.categories ?? {}) } };
  } catch { /* keep defaults while Mongo is down */ }
}

async function publish(title: string, message: string, priority: number, tags: string[]) {
  const res = await fetch(`${cfg.ntfy.url}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.ntfy.token ? { Authorization: `Bearer ${cfg.ntfy.token}` } : {}) },
    body: JSON.stringify({ topic: cfg.ntfy.topic, title, message, priority, tags, ...(cfg.ntfy.clickUrl ? { click: cfg.ntfy.clickUrl } : {}) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`);
}

/** Queue one alert. Duplicate keys within 10 minutes and anything past the hourly cap are dropped. */
export function alert(category: Category, level: EventDoc['level'], title: string, message: string, key = `${category}|${title}|${message}`) {
  if (!ntfyConfigured() || !settings.enabled || !settings.categories[category]) return;
  if (level === 'info' && !settings.recoveries) return;
  if (settings.mutedUntil && new Date(settings.mutedUntil).getTime() > Date.now()) return;
  const now = Date.now();
  if ((lastByKey.get(key) ?? 0) > now - DEDUPE_MS) return;
  if (now - hourStart > 3600_000) { hourStart = now; hourCount = 0; }
  if (++hourCount > MAX_PER_HOUR) return;
  lastByKey.set(key, now);
  const priority = level === 'error' ? 5 : level === 'warn' ? 4 : 2;
  const tags = level === 'error' ? ['rotating_light'] : level === 'warn' ? ['warning'] : ['white_check_mark'];
  const rec: Sent = { ts: new Date().toISOString(), title, message, priority, category, ok: true };
  void publish(title, message, priority, tags).catch((e) => { rec.ok = false; rec.error = (e as Error).message; }).finally(() => {
    sent.unshift(rec);
    if (sent.length > 100) sent.pop();
  });
}

const TITLES: Record<EventDoc['source'], string> = { app: 'Dashboard', db: 'MongoDB', host: 'Proxmox host', guest: 'Guest', monitor: 'Uptime monitor', auth: 'Sign-in' };
/** Called by logEvent for every system event. */
export function alertFromEvent(level: EventDoc['level'], source: EventDoc['source'], message: string) {
  if (level === 'info') {
    // Only recoveries are worth a push; routine info (starts, requested guest actions) is not.
    const recovery = /reachable again|down → up$/.test(message);
    if (!recovery) return;
  }
  if (source === 'monitor' && level === 'warn') return; // pending = Kuma retrying; the down that may follow is what matters
  const title = `${level === 'error' ? 'DOWN' : level === 'warn' ? 'Warning' : 'Recovered'} · ${TITLES[source]}`;
  alert(source, level, title, message);
}

// ---- watcher: thresholds and health Proxmox only exposes by polling ----
const over = new Map<string, number>(); // metric → first time seen over threshold
const raised = new Set<string>();
let seenTasks = new Set<string>();
let firstTaskPoll = true;

function threshold(key: string, label: string, value: number, limit: number, text: string) {
  const now = Date.now();
  if (value >= limit) {
    if (!over.has(key)) over.set(key, now);
    if (now - over.get(key)! >= 5 * 60_000 && !raised.has(key)) {
      raised.add(key);
      logEvent('warn', 'host', `${label} high: ${text}`);
      alert('resources', 'warn', `High ${label} on ${cfg.pveNode}`, `${text} for over 5 minutes`, `res|${key}`);
    }
  } else if (value < limit - 0.05) {
    over.delete(key);
    if (raised.delete(key)) alert('resources', 'info', `${label} back to normal on ${cfg.pveNode}`, text, `res|${key}|ok`);
  }
}
const pct = (f: number) => `${(f * 100).toFixed(0)}%`;

async function watch() {
  if (!pveConfigured()) return;
  const n = `/nodes/${encodeURIComponent(cfg.pveNode)}`;
  const [status, tasks, disks, services] = await Promise.allSettled([
    pve<any>('GET', `${n}/status`),
    pve<any[]>('GET', `${n}/tasks?errors=1&limit=20&source=all`),
    pve<any[]>('GET', `${n}/disks/list`),
    pve<any[]>('GET', `${n}/services`),
  ]);
  if (status.status === 'fulfilled') {
    const s = status.value;
    const mem = s.memory?.total ? s.memory.used / s.memory.total : 0;
    const root = s.rootfs?.total ? s.rootfs.used / s.rootfs.total : 0;
    threshold('cpu', 'CPU', Number(s.cpu ?? 0), cfg.ntfy.cpuLimit, `CPU at ${pct(Number(s.cpu ?? 0))}`);
    threshold('mem', 'memory', mem, cfg.ntfy.memLimit, `RAM at ${pct(mem)}`);
    threshold('disk', 'disk usage', root, cfg.ntfy.diskLimit, `root filesystem at ${pct(root)}`);
  }
  if (tasks.status === 'fulfilled') {
    const ids = new Set(tasks.value.map((t) => String(t.upid)));
    for (const t of tasks.value) {
      if (firstTaskPoll || seenTasks.has(t.upid) || !t.endtime || t.status === 'OK') continue;
      const what = `${t.type}${t.id ? ` ${t.id}` : ''}`;
      logEvent('error', 'host', `Proxmox task failed: ${what}: ${t.status}`, { upid: t.upid });
      alert('tasks', 'error', `Task failed · ${what}`, `${t.status} (by ${t.user})`, `task|${t.upid}`);
    }
    seenTasks = ids;
    firstTaskPoll = false;
  }
  if (disks.status === 'fulfilled') {
    for (const d of disks.value) {
      const h = String(d.health ?? 'UNKNOWN');
      if (h !== 'PASSED' && h !== 'OK' && h !== 'UNKNOWN') alert('disks', 'error', `Disk health ${h}`, `${d.devpath} (${d.model ?? 'disk'}) reports S.M.A.R.T. ${h}`, `disk|${d.devpath}|${h}`);
      if (typeof d.wearout === 'number' && d.wearout <= 10) alert('disks', 'warn', 'SSD nearly worn out', `${d.devpath} has ${d.wearout}% life left`, `wear|${d.devpath}`);
    }
  }
  if (services.status === 'fulfilled') {
    for (const s of services.value) {
      const name = String(s.name ?? s.service);
      const key = `svc|${name}`;
      const down = s['unit-state'] === 'enabled' && s.state !== 'running';
      if (down && !raised.has(key)) { raised.add(key); logEvent('error', 'host', `Service ${name} is ${s.state}`); alert('services', 'error', `Service down · ${name}`, `${s.desc ?? name} is ${s.state} on ${cfg.pveNode}`, key); }
      else if (!down && raised.delete(key)) { logEvent('info', 'host', `Service ${name} running again`); alert('services', 'info', `Service recovered · ${name}`, `${name} is running again`, `${key}|ok`); }
    }
  }
}

export function startNotify(app: FastifyInstance) {
  void loadSettings();
  if (!ntfyConfigured()) { app.log.warn('ntfy not configured; push alerts disabled'); return; }
  const t = setInterval(() => { watch().catch((e) => app.log.warn({ err: (e as Error).message }, 'notify watch failed')); }, 60_000);
  t.unref();
  setTimeout(() => void watch().catch(() => {}), 5_000).unref();
}

export function registerNotify(app: FastifyInstance) {
  app.get('/api/notify', async () => ({
    configured: ntfyConfigured(),
    server: cfg.ntfy.publicUrl || cfg.ntfy.url,
    topic: ntfyConfigured() ? cfg.ntfy.topic : '',
    subscribeUrl: ntfyConfigured() ? `${cfg.ntfy.publicUrl || cfg.ntfy.url}/${cfg.ntfy.topic}` : '',
    thresholds: { cpu: cfg.ntfy.cpuLimit, mem: cfg.ntfy.memLimit, disk: cfg.ntfy.diskLimit },
    settings, categories: CATEGORIES, sent,
  }));

  app.post<{ Body: Partial<Settings> }>('/api/notify/settings', async (req) => {
    const b = req.body ?? {};
    const next: Settings = { ...settings };
    if (typeof b.enabled === 'boolean') next.enabled = b.enabled;
    if (typeof b.recoveries === 'boolean') next.recoveries = b.recoveries;
    if (b.mutedUntil === null || (typeof b.mutedUntil === 'string' && !Number.isNaN(Date.parse(b.mutedUntil)))) next.mutedUntil = b.mutedUntil;
    if (b.categories && typeof b.categories === 'object') {
      next.categories = { ...next.categories };
      for (const c of CATEGORIES) if (typeof b.categories[c] === 'boolean') next.categories[c] = b.categories[c];
    }
    await col.state().updateOne({ _id: 'notify-settings' }, { $set: { value: next as unknown as Record<string, unknown> } }, { upsert: true });
    settings = next;
    req.log.info({ user: req.user?.username }, 'notify settings changed');
    return next;
  });

  app.post('/api/notify/test', async (req) => {
    if (!ntfyConfigured()) throw notConfigured('ntfy');
    try {
      await publish('SPL Console test', `Test notification sent by ${req.user?.username ?? 'admin'}. Alerts reach this topic.`, 3, ['bell']);
    } catch (e) {
      throw new HttpError(502, 'NTFY_ERROR', (e as Error).message);
    }
    sent.unshift({ ts: new Date().toISOString(), title: 'SPL Console test', message: 'Test notification', priority: 3, category: 'app', ok: true });
    return { ok: true };
  });
}
