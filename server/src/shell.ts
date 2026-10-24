import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { cfg } from './config.js';
import { col } from './db.js';
import { HttpError } from './errors.js';
import { audited } from './guest-detail.js';
import { pve, pveAuthHeader } from './proxmox.js';

const MAX_SESSIONS = 4;
const IDLE_MS = 30 * 60_000;
const MAX_INPUT = 64 * 1024;

/**
 * Browser <-> backend protocol (the Proxmox termproxy framing stays on the server):
 *   client -> server  text JSON  {t:'i', d:string} input | {t:'r', cols, rows} resize
 *   server -> client  binary     terminal output
 *                     text JSON  {t:'ready'} | {t:'exit'} | {t:'error', message}
 */
export async function registerShell(app: FastifyInstance) {
  await app.register(websocket, { options: { maxPayload: MAX_INPUT + 1024 } });
  let open = 0;

  app.get<{ Params: { vmid: string }; Querystring: { cols?: string; rows?: string } }>('/api/guests/:vmid/shell', { websocket: true }, async (socket, req) => {
    const send = (o: object) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(o)); };
    const fail = (message: string) => { send({ t: 'error', message }); socket.close(); };
    let upstream: WebSocket | undefined;

    try {
      // GET upgrades skip the state-changing Origin check in auth.ts, and a shell is the most sensitive route we have.
      let host = '';
      try { host = new URL(String(req.headers.origin)).host; } catch { /* missing or malformed */ }
      if (!host || ![req.headers.host, req.headers['x-forwarded-host']].includes(host)) throw new HttpError(403, 'BAD_ORIGIN', 'Cross-site request refused');
      if (!cfg.shellEnabled) throw new HttpError(503, 'NOT_CONFIGURED', 'Shell access is disabled. Set SHELL_ENABLED=true on the server.');
      if (open >= MAX_SESSIONS) throw new HttpError(429, 'TOO_MANY', 'Too many open shells');

      const t0 = Date.now();
      const term = await audited(req, req.params.vmid, 'shell', undefined, async (g) => {
        const path = `/nodes/${encodeURIComponent(cfg.pveNode)}/${g.type}/${g.vmid}`;
        if (g.status !== 'running') throw new HttpError(409, 'NOT_RUNNING', `${g.name} is not running`);
        const r = await pve<{ port: number | string; ticket: string; user: string }>('POST', `${path}/termproxy`, g.type === 'qemu' ? { serial: 'serial0' } : {});
        return { ...r, path, g };
      });

      if (socket.readyState !== WebSocket.OPEN) return; // tab closed while the ticket was being issued

      const url = `${cfg.pveUrl.replace(/^http/, 'ws')}/api2/json${term.path}/vncwebsocket?port=${encodeURIComponent(String(term.port))}&vncticket=${encodeURIComponent(term.ticket)}`;
      const up = (upstream = new WebSocket(url, { headers: { Authorization: pveAuthHeader() }, rejectUnauthorized: !cfg.pveInsecureTls }));
      open++;

      let ready = false;
      let ping: NodeJS.Timeout | undefined;
      let idle: NodeJS.Timeout | undefined;
      const bump = () => { clearTimeout(idle); idle = setTimeout(() => fail('Shell closed after 30 minutes of inactivity'), IDLE_MS); };
      bump();

      up.on('open', () => up.send(`${term.user}:${term.ticket}\n`));
      up.on('message', (data: Buffer) => {
        let chunk = data;
        if (!ready) {
          if (!chunk.subarray(0, 2).equals(Buffer.from('OK'))) return fail('Proxmox refused the terminal session');
          ready = true;
          chunk = chunk.subarray(2);
          send({ t: 'ready' });
          ping = setInterval(() => up.readyState === WebSocket.OPEN && up.send('2'), 30_000);
          const cols = Math.min(500, Math.max(10, Number(req.query.cols) || 80));
          const rows = Math.min(200, Math.max(2, Number(req.query.rows) || 24));
          up.send(`1:${cols}:${rows}:`);
        }
        if (chunk.length && socket.readyState === WebSocket.OPEN) socket.send(chunk, { binary: true });
      });
      up.on('error', (e) => { req.log.warn({ vmid: term.g.vmid, err: e.message }, 'shell upstream error'); fail(`Cannot reach the Proxmox terminal: ${e.message}`); });
      up.on('close', () => { send({ t: 'exit' }); socket.close(); });

      socket.on('message', (raw: Buffer) => {
        if (!ready || up.readyState !== WebSocket.OPEN) return;
        let m: { t?: string; d?: unknown; cols?: unknown; rows?: unknown };
        try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.t === 'i' && typeof m.d === 'string' && m.d.length <= MAX_INPUT) {
          bump();
          up.send(`0:${Buffer.byteLength(m.d)}:${m.d}`);
        } else if (m.t === 'r' && Number.isInteger(m.cols) && Number.isInteger(m.rows)) {
          const cols = Math.min(500, Math.max(10, m.cols as number)), rows = Math.min(200, Math.max(2, m.rows as number));
          up.send(`1:${cols}:${rows}:`);
        }
      });

      socket.on('close', () => {
        open--;
        clearInterval(ping); clearTimeout(idle);
        upstream?.close();
        void col.audit().insertOne({
          ts: new Date(), user: req.user!.username, ip: req.ip, vmid: term.g.vmid, name: term.g.name, action: 'shell-close',
          result: 'accepted', detail: `${Math.round((Date.now() - t0) / 1000)}s`,
        });
      });
    } catch (e) {
      upstream?.close();
      fail(e instanceof HttpError ? e.message : 'Could not open the shell');
      if (!(e instanceof HttpError)) req.log.error(e);
    }
  });
}
