import type { FastifyInstance } from 'fastify';
import { cfg } from './config.js';
import { col } from './db.js';
import { HttpError, notConfigured } from './errors.js';
import { pve } from './proxmox.js';

// Kill switch: gracefully powers off the whole Proxmox node (all guests are shut down first by Proxmox).
export function registerHost(app: FastifyInstance) {
  app.get('/api/host/power', () => ({ enabled: cfg.hostPowerEnabled, node: cfg.pveNode }));

  app.post<{ Body: { confirm?: string } }>('/api/host/shutdown', async (req) => {
    const user = req.user!.username;
    const base = { ts: new Date(), user, ip: req.ip, vmid: 0, name: cfg.pveNode, action: 'host-shutdown' };
    if (!cfg.hostPowerEnabled) throw notConfigured('Host power control');
    // The caller must type the node name, so a stray or scripted request cannot power the host off.
    if (req.body?.confirm !== cfg.pveNode) {
      await col.audit().insertOne({ ...base, result: 'refused', reason: 'BAD_CONFIRM' });
      req.log.warn({ user }, 'host shutdown refused');
      throw new HttpError(400, 'BAD_CONFIRM', 'Confirmation does not match the node name');
    }
    try {
      const taskId = await pve<string>('POST', `/nodes/${encodeURIComponent(cfg.pveNode)}/status`, { command: 'shutdown' });
      await col.audit().insertOne({ ...base, result: 'accepted', taskId });
      req.log.warn({ user, node: cfg.pveNode }, 'host shutdown requested');
      return { ok: true };
    } catch (e) {
      await col.audit().insertOne({ ...base, result: 'error', reason: (e as Error).message });
      throw e;
    }
  });
}
