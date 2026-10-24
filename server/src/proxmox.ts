import { Agent } from 'undici';
import { cfg, pveConfigured } from './config.js';
import { HttpError, notConfigured } from './errors.js';

export const pveDispatcher = cfg.pveInsecureTls ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
export const pveAuthHeader = () => `PVEAPIToken=${cfg.pveTokenId}=${cfg.pveTokenSecret}`;

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Proxmox expects form-encoded bodies; booleans become 1/0, undefined is dropped. */
function form(body: Record<string, string | number | boolean | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) if (v !== undefined) p.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  return p;
}

export async function pve<T>(method: Method, path: string, body?: Record<string, string | number | boolean | undefined>): Promise<T> {
  if (!pveConfigured()) throw notConfigured('Proxmox');
  let res: Response;
  try {
    res = await fetch(`${cfg.pveUrl}/api2/json${path}`, {
      method,
      headers: { Authorization: pveAuthHeader(), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: body ? form(body) : undefined,
      signal: AbortSignal.timeout(15_000),
      // @ts-expect-error undici dispatcher is not in the DOM fetch typings
      dispatcher: pveDispatcher,
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
