// Use undici's own fetch together with its Agent: Node's bundled fetch rejects a dispatcher from a different undici major.
import { Agent, fetch } from 'undici';
import { cfg, pveConfigured } from './config.js';
import { HttpError, notConfigured } from './errors.js';

const dispatcher = cfg.pveInsecureTls ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;

export async function pve<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, form?: Record<string, string>): Promise<T> {
  if (!pveConfigured()) throw notConfigured('Proxmox');
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${cfg.pveUrl}/api2/json${path}`, {
      method,
      headers: { Authorization: `PVEAPIToken=${cfg.pveTokenId}=${cfg.pveTokenSecret}` },
      body: form ? new URLSearchParams(form) : undefined,
      signal: AbortSignal.timeout(15_000),
      dispatcher,
    });
  } catch (e) {
    console.error('proxmox unreachable:', (e as Error).message);
    throw new HttpError(502, 'PVE_UNREACHABLE', 'Cannot reach Proxmox');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`proxmox ${res.status} ${method} ${path}:`, text.slice(0, 300));
    throw new HttpError(502, 'PVE_ERROR', `Proxmox returned ${res.status}${res.status === 403 ? ' (permission denied for the API token)' : ''}`);
  }
  return ((await res.json()) as { data: T }).data;
}
