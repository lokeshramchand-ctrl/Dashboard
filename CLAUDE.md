# CLAUDE.md

SPL Console (homelab dashboard): a React UI plus a Fastify backend that controls Proxmox guests and shows nginx, Grafana and Uptime Kuma data. Single user. All auth state lives in MongoDB.

## Layout

```
/                  React + Vite + TS UI  (npm run dev | build | build:prod)
  src/api.ts       the only place the UI calls the backend (/api/..., relative URLs)
  src/mock.ts      in-browser mock of the whole API (fetch + EventSource patch)
  src/pages/       Overview, Guests, GuestDetail (+ guest/ tabs: Options, Snapshots, Backups, Tasks), Nginx, Grafana, Kuma, Login
  src/components/Terminal.tsx   xterm.js shell (lazy-loaded) over the shell WebSocket
  public/config.json   runtime config (kumaStatusUrl, grafanaUrl), edit without rebuilding
server/            Fastify backend (TypeScript, compiled on the dev PC)
  src/auth.ts      login/logout/me, session hook, origin check, rate limit
  src/db.ts        Mongo connection, indexes, typed collections
  src/guests.ts    guest list/actions, task status, SSE /api/events
  src/guest-detail.ts  per-guest config, rrd, tasks, snapshots, backups; `audited()` wraps every write
  src/shell.ts     WebSocket shell via Proxmox termproxy (SHELL_ENABLED)
  src/{nginx,grafana,kuma,overview}.ts
  src/create-user.ts   CLI to create a user or reset a password
API_NOTES.md       units/format contract between UI and backend
mobile/            Expo / React Native app (same /api contract; cookie session)
AGENTS.md          tool-neutral agent rules (keep in sync with this file)
docker-compose.yml app + MongoDB; Dockerfile builds UI + backend into one image
```

## Commands

- UI: `npm install`, `npm run dev`, `npm run build` (mock API ON, standalone demo, password `demo`), `npm run build:prod` (mock OFF, real backend)
- Backend: `cd server && npm install && npm run build`; `npm run create-user -- <name>`; `npm start` (needs `server/.env`, copy from `.env.example`)
- Mobile: `cd mobile && npm install && npm run typecheck`; `npm start` (Expo). It signs in with the same cookie session; the server URL is entered on the login screen.
- Docker: `cp .env.example .env && docker compose up -d --build`, then `docker compose run --rm app node build/create-user.js <name>`.
- Node >= 20.6 (uses `--env-file`). Ship `server/` as `build/` + `node_modules` + `package.json`; no build tools on the server.

## Rules that must not break

- **Auth state is in MongoDB only**: collections `users` (scrypt hash), `sessions` (sha256 of the cookie token, TTL on `expiresAt`), `login_attempts` (TTL), `audit`, `kuma_samples` (TTL 31 d). Never store tokens or passwords in plaintext, never log the cookie.
- Every `/api/*` route except `/api/auth/login` requires a session (hook in `auth.ts`). New routes are protected automatically; keep them under `/api/`.
- State-changing requests are refused if `Origin` host differs from `Host` / `X-Forwarded-Host`. Cookie is `httpOnly`, `SameSite=Strict`, `Secure` in prod.
- Guest actions: vmid must be in `ALLOWED_VMIDS` (if set), `PROTECTED_VMIDS` are refused for every action, and every attempt (accepted, refused or error) is written to `audit`. Task ids are regex-validated before use in a Proxmox URL.
- Errors are always `{error, code}` with a real HTTP status. Missing integration config returns `503 NOT_CONFIGURED`, except `/api/overview`, which degrades to zeros.
- The Grafana token is read-only. The Proxmox token has only the privileges listed in `.env.example`; give it fewer to switch features off. The backend never writes to nginx.
- **Guest writes** (config, snapshots, rollback, backups, shell) go through `audited()` in `guest-detail.ts`: protected guests refused, `ALLOWED_VMIDS` honoured, every attempt in `audit`. Config edits are limited to the whitelist in `editable()`; snapshot names, storage names and task ids are regex-validated before they reach a Proxmox URL.
- **Shell** is off unless `SHELL_ENABLED=true`. The WebSocket route checks `Origin` itself (the GET hook skips it), needs a running non-protected guest, caps sessions and idle time, and audits open/close. Never log the termproxy ticket.
- UI uses root-relative `/api/...` and `base: './'` assets. No hardcoded hosts. Every data panel needs loading, error and empty states.

## Contract notes

Units and behaviour (including the guest detail routes and the shell frame protocol) are in `API_NOTES.md` (cpu is a 0..1 fraction, memory in bytes, uptime in seconds, uptimeNd in percent). Change that file whenever a field changes. The gaming VM is vmid 100 in the UI (`GAMING_VMID` in `src/pages/Guests.tsx`).

## Design

Same design system as the company site (`C:\Code\spl-homepage`, splsystems.com): Instrument Sans (bundled), ink `#181818` on `#fbfbfb`, black/white dark theme, hairline rules, soft modern layer at the end of `src/styles.css` (16px cards, pill buttons and badges, floating shadows, glass header; was sharp 3-4px radii). Colours are the CSS variables at the top of `src/styles.css`. Charts and status use only the logo colours: red `#ed272e`, blue `#0870b9`, green `#3eb850`, periwinkle `#8499e2` (brighter variants in dark theme; use the `--red/--blue/--green/--peri` vars, never raw hex). WebGL in `src/webgl/` is ported from the site: `hero-liquid` (login) and `metallic-swirl` (Overview hero, gaming card; `BrandSwirl` multiplies it with a logo-colour gradient). Motion comes from the site too: `Reveal.tsx` (rise/fade-up, `InView`), clip-path wipe on `.btn`, row nudge on hover, dropdown menu sheet on mobile. Logo and favicon live in `public/brand/` (copied from the site). Icons are inline SVG paths in `src/components/ui.tsx` (no icon library).

## Gotchas

- Kuma `/metrics` has no monitor ids, uptime history or messages. The backend scrapes every `KUMA_POLL_MS`, stores samples in Mongo, and derives uptime, heartbeats and incident `since` from them (so uptime figures build up over time after first start).
- Proxmox with a self-signed cert needs `PVE_INSECURE_TLS=true`.
- Bash heredocs with certain quoting failed in this environment; prefer the Write tool for files.
- The shell route goes through nginx, so the proxy must forward `Upgrade`/`Connection` headers. Proxmox termproxy with an API token has not been verified against a real node.
- `dist/` and `server/build/` are git-ignored build output.
