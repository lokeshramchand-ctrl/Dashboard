import { Agent } from 'undici';
import { cfg, pveConfigured } from './config.js';
import { HttpError, notConfigured } from './errors.js';

const dispatcher = cfg.pveInsecureTls ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;

export async function pve<T>(method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<T> {
  if (!pveConfigured()) throw notConfigured('Proxmox');
  let res: Response;
  try {
    res = await fetch(`${cfg.pveUrl}/api2/json${path}`, {
      method,
      headers: { Authorization: `PVEAPIToken=${cfg.pveTokenId}=${cfg.pveTokenSecret}` },
      body: form ? new URLSearchParams(form) : undefined,
      signal: AbortSignal.timeout(15_000),
      // @ts-expect-error undici dispatcher is not in the DOM fetch typings
      dispatcher,
    });
  } catch (e) {
    throw new HttpError(502, 'PVE_UNREACHABLE', `Cannot reach Proxmox: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(502, 'PVE_ERROR', `Proxmox ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  return ((await res.json()) as { data: T }).data;
}
