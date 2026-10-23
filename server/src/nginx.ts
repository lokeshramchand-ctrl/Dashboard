import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { cfg } from './config.js';
import { HttpError } from './errors.js';

export interface Site {
  file: string; serverNames: string[]; listen: string[]; ssl: boolean;
  upstream: string | null; root: string | null; url: string;
}

/** Returns the bodies of every top-level `server { ... }` block (brace matched). */
function serverBlocks(src: string): string[] {
  const out: string[] = [];
  const re = /(^|[\s;}])server\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (i < src.length && depth) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
    re.lastIndex = i;
  }
  return out;
}

export function parseSite(file: string, raw: string): Site | null {
  const src = raw.replace(/#.*$/gm, '');
  const blocks = serverBlocks(src);
  if (!blocks.length) return null;

  const names = new Set<string>();
  const listen = new Set<string>();
  let ssl = false;
  let upstream: string | null = null;
  let root: string | null = null;

  for (const b of blocks) {
    for (const m of b.matchAll(/(?:^|[\s;{}])server_name\s+([^;]+);/g)) m[1].split(/\s+/).filter((n) => n && n !== '_').forEach((n) => names.add(n));
    for (const m of b.matchAll(/(?:^|[\s;{}])listen\s+([^;]+);/g)) {
      const l = m[1].trim().replace(/\s+/g, ' ');
      listen.add(l);
      if (/\bssl\b/.test(l)) ssl = true;
    }
    if (/(?:^|[\s;{}])ssl_certificate\s/.test(b)) ssl = true;
    upstream ??= b.match(/(?:^|[\s;{}])proxy_pass\s+([^;\s]+);/)?.[1] ?? null;
    root ??= b.match(/(?:^|[\s;{}])root\s+([^;]+);/)?.[1].trim() ?? null;
  }

  const serverNames = [...names];
  const primary = serverNames.find((n) => !n.includes('*') && !n.startsWith('~'));
  return { file, serverNames, listen: [...listen], ssl, upstream, root, url: primary ? `${ssl ? 'https' : 'http'}://${primary}` : '' };
}

export async function listSites(): Promise<Site[]> {
  let files: string[];
  try {
    files = await readdir(cfg.nginxDir);
  } catch (e) {
    throw new HttpError(500, 'NGINX_DIR', `Cannot read ${cfg.nginxDir}: ${(e as NodeJS.ErrnoException).code ?? 'error'}`);
  }
  const sites: Site[] = [];
  for (const f of files.sort()) {
    if (f.startsWith('.') || /\.(bak|old|orig|dpkg-\w+|swp)$|~$/.test(f)) continue;
    const p = join(cfg.nginxDir, f);
    try {
      if (!(await stat(p)).isFile()) continue; // stat follows the symlinks sites-enabled uses
      const s = parseSite(f, await readFile(p, 'utf8'));
      if (s) sites.push(s);
    } catch { /* unreadable file: skip it, don't break the whole list */ }
  }
  return sites;
}

export function registerNginx(app: FastifyInstance) {
  app.get('/api/nginx/sites', () => listSites());
}
