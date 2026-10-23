import type { FastifyInstance } from 'fastify';
import { cfg } from './config.js';
import { listGuests } from './guests.js';
import { kumaCounts } from './kuma.js';
import { listSites } from './nginx.js';
import { pve } from './proxmox.js';

const ok = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

export function registerOverview(app: FastifyInstance) {
  // Each source is optional: a missing integration yields zeros rather than failing the whole page.
  app.get('/api/overview', async () => {
    const [guests, sites, kuma, node] = (await Promise.allSettled([
      listGuests(), listSites(), kumaCounts(), pve<any>('GET', `/nodes/${encodeURIComponent(cfg.pveNode)}/status`),
    ])) as [PromiseSettledResult<Awaited<ReturnType<typeof listGuests>>>, PromiseSettledResult<unknown[]>, PromiseSettledResult<{ up: number; down: number; pending: number }>, PromiseSettledResult<any>];

    const g = ok(guests) ?? [];
    const running = g.filter((x) => x.status === 'running').length;
    const n = ok(node);
    return {
      guests: { total: g.length, running, stopped: g.length - running },
      nginx: { sites: ok(sites)?.length ?? 0 },
      kuma: ok(kuma) ?? { up: 0, down: 0, pending: 0 },
      host: {
        cpu: Number(n?.cpu ?? 0), memUsed: Number(n?.memory?.used ?? 0), memTotal: Number(n?.memory?.total ?? 0),
        diskUsed: Number(n?.rootfs?.used ?? 0), diskTotal: Number(n?.rootfs?.total ?? 0), uptime: Number(n?.uptime ?? 0),
      },
    };
  });
}
