# API_NOTES — deviations, additions and clarifications

The UI implements the contract as given. Everything below is either a **clarification of units/formats the UI assumes** or a **small addition**. Nothing in the original contract was removed or renamed.

## Units and formats the UI assumes

| Field | Format |
|---|---|
| `guests[].cpu`, `overview.host.cpu` | **fraction 0..1** (Proxmox style), not percent |
| `memUsed`, `memMax`, `memTotal`, `diskUsed`, `diskTotal` | **bytes** |
| `uptime`, `host.uptime` | **seconds** |
| `kuma/monitors[].uptime24h`, `uptime30d` | **percent 0..100** |
| `avgPing`, `heartbeats[].ping` | milliseconds, `null` when down |
| `lastCheck`, `heartbeats[].time`, `incidents[].since` | ISO-8601 strings |
| `GET /tasks/:taskId` | `{status:"running"|"ok"|"error", message}`; `message` holds the Proxmox task error text on failure |
| `POST /metrics/query` `start`/`end` | unix **seconds** (numbers); `step` in seconds. Response is the raw Prometheus `query_range` body (`{status, data:{resultType:"matrix", result:[{metric, values:[[ts,"v"],…]}]}}`) |
| `embedUrl` | may be absolute (Grafana) or relative; used verbatim as iframe `src` |

## Behaviour the UI relies on

- **401 anywhere (except `/auth/login`)** → UI returns to the login screen. Login failure should be `401 {error, code}` and the `error` text is shown to the user.
- **Guest actions** (`start|shutdown|stop|reboot`) return `{taskId}` immediately. The UI polls `GET /tasks/:id` every 1 s, then polls `GET /guests` until the status matches (`running` after start, `stopped` after shutdown/stop). Reboot only waits for the task.
- **Error responses** the UI displays verbatim via `error`:
  - `403 PROTECTED` — action refused for a protected guest
  - `409` — e.g. start on an already-running guest, shutdown on a stopped one
  - `404 NOT_FOUND`
- **SSE `GET /events`**: optional. Messages are unnamed `data:` lines containing `{"type":"guest","vmid":100,"status":"running"}`. If absent, the 7 s polling covers it.
- **Auto-refresh**: guests 7 s, Kuma monitors 8 s, incidents 10 s, overview 8 s (paused while the tab is hidden).
- **Gaming VM** is identified by `vmid === 100`. GPU conflicts come from `conflicts: number[]` on that guest; the UI warns when any listed vmid is currently `running`.
- **Nginx ↔ Kuma matching** is client-side: a monitor matches a site if the hostname of `monitor.url` equals any `serverNames[]` entry, or `monitor.name` equals the first label of a server name (case-insensitive). No extra field needed.
- Grafana dashboard detail loads `GET /grafana/panels/:uid` only when opened.

## Additions (not in the original contract)

1. **`config.json`** (static file next to `index.html`, optional, fetched as `config.json`):
   ```json
   { "kumaStatusUrl": "https://kuma.home.lan/status/homelab", "grafanaUrl": "https://grafana.home.lan" }
   ```
   `kumaStatusUrl` enables the "Status page" button and embed on the Uptime page. Edit it on the server without rebuilding. If you would rather have it from the API, add `GET /kuma/status-page -> {url}` and I'll switch the UI to it.
2. Build flag: `npm run build` ships with the **mock API enabled** (standalone demo, login password `demo`). `npm run build:prod` sets `VITE_MOCK=false` and talks to the real `/api`.

## Guest management (detail page)

All routes need a session. Write routes refuse protected guests (`403 PROTECTED`), guests outside `ALLOWED_VMIDS` (`404`) and write an `audit` document (`action`, `detail`) for every attempt. Long-running calls return `{taskId}`; the UI waits with `GET /tasks/:id` exactly like power actions.

| Route | Notes |
|---|---|
| `GET /guests/:vmid/config` | `{config, pending}`. `config` is the raw Proxmox config (keys containing pass, secret, key or token are masked); `pending` lists keys applied at the next restart |
| `PUT /guests/:vmid/config` | JSON patch of whitelisted keys only: `hostname` (lxc) / `name` (qemu), `description`, `tags` (string[]), `onboot` (bool), `startup`, `cores`, `sockets` (qemu), `memory` (MiB), `swap` (lxc, MiB), `balloon` (qemu, MiB), `cpulimit`. Any other key is `400`. Returns `{ok:true}` |
| `GET /guests/:vmid/rrd?timeframe=` | `hour`, `day`, `week`, `month` or `year`. `[{time, cpu, mem, maxmem, netin, netout, diskread, diskwrite}]`: `time` unix **seconds**, `cpu` **fraction 0..1**, `mem`/`maxmem` **bytes**, `net*`/`disk*` **bytes per second**; any value may be `null` |
| `GET /guests/:vmid/tasks` | last 50 tasks for the guest: `{upid, type, user, start, end or null, status: running/ok/error, message}` (`start`/`end` unix seconds) |
| `GET /tasks/:taskId/log` | `{lines: string[]}` (first 500 lines) |
| `GET /guests/:vmid/snapshots` | `[{name, description, time (unix s) or null, vmstate, parent or null}]` (the `current` pseudo entry is dropped) |
| `POST /guests/:vmid/snapshots` | `{name, description?, vmstate?}` -> `{taskId}`. `name` matches `^[A-Za-z][A-Za-z0-9_-]{1,39}$` |
| `POST /guests/:vmid/snapshots/:name/rollback`, `DELETE /guests/:vmid/snapshots/:name` | -> `{taskId}` |
| `GET /guests/:vmid/backups` | `{storages, defaultStorage, items:[{volid, storage, size (bytes), time (unix s), format, notes}]}` from storages that allow backups |
| `POST /guests/:vmid/backups` | `{storage, mode: snapshot/suspend/stop, notes?}` -> `{taskId}` (vzdump, zstd). Restore and delete are not offered |
| `GET /guests/:vmid/shell` (WebSocket) | needs `SHELL_ENABLED=true`, a running non-protected guest and a same-origin `Origin` header. Client sends JSON text frames `{t:"i",d:string}` (input) and `{t:"r",cols,rows}` (resize). Server sends binary frames (terminal output) and JSON text frames `{t:"ready"}`, `{t:"exit"}`, `{t:"error",message}`. 30 minutes idle closes it; at most 4 shells at once. Open and close are audited as `shell` / `shell-close` |

The shell is a root shell inside an LXC container, or the serial console of a QEMU VM (needs `serial0: socket` and a getty on it; graphical guests such as Windows are not reachable). The reverse proxy in front of the app must pass WebSocket upgrades (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).

Not implemented (use Proxmox): network and disk editing, backup restore/delete, migration, clone, firewall, node-level shell. The mobile app does not use these routes yet.

## Backend storage — MongoDB (implemented in `server/`)

- `users` — username + scrypt password hash (created with `npm run create-user`)
- `sessions` — sha256 of the session token, TTL index on `expiresAt`
- `login_attempts` — 5 failures per ip+username per 15 min, then `429 RATE_LIMITED`
- `audit` — one document per guest action `{ts, user, ip, vmid, name, action, result, taskId, reason, detail}`; `action` is `start`, `shutdown`, `stop`, `reboot`, `config`, `snapshot`, `rollback`, `snapshot-delete`, `backup`, `shell` or `shell-close`
- `kuma_samples` — scraped Kuma status/ping per monitor (31-day TTL); source of uptime %, heartbeats and incident `since`

Backend deviations from the contract: Kuma `incidents[].message` is generic (`Monitor is down`) because `/metrics` carries no message; monitor `id` is a stable hash of name+type+url.

## Cookies / hosting

- All requests use root-relative `/api/...` with `credentials: 'same-origin'`; serve `dist/` and `/api` from the same origin (nginx fronting both). Assets use relative paths (`base: './'`).
- Grafana needs `allow_embedding = true`, and if Grafana is on another origin, cookies/anonymous access must permit iframes (`cookie_samesite = none` or a reverse proxy on the same site).
- Uptime Kuma's status page iframe needs no `X-Frame-Options: DENY` from the proxy.

## Mock data included

LXC guests (101–107, 109, 120), the Windows QEMU gaming VM (vmid 100, conflicts with 101/106), protected guest 120 (dashboard), a simulated shell for running guests (VM 108 has a serial port, the gaming VM does not), a snapshot on guest 101, sample backups for 101/103/104, an SSL nginx site (several), a non-SSL site, a **down** Kuma monitor (Legacy Wiki), pending and maintenance monitors, and a **failed task** (starting vmid 109 fails with `storage 'local-zfs' is not available`).
