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

## Backend storage — MongoDB (implemented in `server/`)

- `users` — username + scrypt password hash (created with `npm run create-user`)
- `sessions` — sha256 of the session token, TTL index on `expiresAt`
- `login_attempts` — 5 failures per ip+username per 15 min, then `429 RATE_LIMITED`
- `audit` — one document per guest action `{ts, user, ip, vmid, name, action, result, taskId, reason}`
- `kuma_samples` — scraped Kuma status/ping per monitor (31-day TTL); source of uptime %, heartbeats and incident `since`

Backend deviations from the contract: Kuma `incidents[].message` is generic (`Monitor is down`) because `/metrics` carries no message; monitor `id` is a stable hash of name+type+url.

## Cookies / hosting

- All requests use root-relative `/api/...` with `credentials: 'same-origin'`; serve `dist/` and `/api` from the same origin (nginx fronting both). Assets use relative paths (`base: './'`).
- Grafana needs `allow_embedding = true`, and if Grafana is on another origin, cookies/anonymous access must permit iframes (`cookie_samesite = none` or a reverse proxy on the same site).
- Uptime Kuma's status page iframe needs no `X-Frame-Options: DENY` from the proxy.

## Logs and Keycloak (additions)

- `GET /logs/events?level=&source=&q=&before=&limit=` → `[{id, ts, level: info|warn|error, source: app|db|host|guest|monitor|auth, message, data}]`, newest first. Written by the backend: start/stop (and "did not shut down cleanly" when the previous run left no clean-stop marker), MongoDB up/down, Proxmox API reachable/unreachable, host reboot, guest status changes (a stop with no dashboard action is an error), Kuma monitor transitions, refused SSO logins. Events raised while MongoDB is down are buffered in memory (500 max) and written on reconnect. TTL `EVENT_RETENTION_DAYS`.
- `GET /logs/journal?priority=&unit=&since=&boot=&kernel=&q=&limit=` → `[{ts, priority 0..7, unit, message, pid}]`, newest first. Read-only `journalctl` via execFile (no shell), every argument validated. Needs the service user in `systemd-journal`; otherwise 502/503 with `{error, code}`.
- `GET /logs/summary` → `{boots[{index, bootId, first, last, clean: bool|null, endReason}], journalError, errors24h, lastHeartbeat, pendingEvents, processUptime}`. `clean=false` means that boot's journal ends without a shutdown sequence (power loss, reset, crash, hang).
- `GET /auth/sso/config` (public) → `{enabled, label}`. `GET /auth/sso/login` redirects to Keycloak (authorization code + PKCE + nonce); `GET /auth/sso/callback` verifies the ID token (RS256 via JWKS, iss/aud/exp/nonce), checks `KEYCLOAK_ALLOWED_USERS` / `KEYCLOAK_REQUIRED_ROLE`, creates the normal session and redirects to `/` (failures go to `/?sso_error=<CODE>`). SSO users are stored as `kc:<username>` in `users`.

## Windows VM diagnostics (addition)

`GET /guests/:vmid/windows?since=24h|7d|30d` (QEMU guests only; LXC -> `400 UNSUPPORTED`) -> `{vmid, name, since, ostype, status, verdict, uptime, agent, findings[], health[], sessions[], taskHistory[], metrics, metricsTimeframe, counts, recurring[], lines[]}`.

- `findings[]` / `health[]`: `{id, severity: critical|warn|info|ok, title, detail, advice?, count?}`, most severe first. `findings` come from the journal and task log; `health` is a static config review.
- `agent.state`: `ok | unreachable | no-permission | vm-stopped`. `no-permission` means the API token lacks `VM.GuestAgent.Audit`. `timeSkewSec` is guest clock minus host clock.
- `sessions[]`: one per run of the VM, newest first, from the systemd `<vmid>.scope` lines. `durationSec`/`cpuSec` are seconds, `memPeak` is systemd's string (e.g. `17.1G`); `endedBy` is the matching Proxmox task type or `from inside the guest (or crash)`.
- `metrics.*`: `{avg, p95, max, samples}`; cpu is a 0..1 fraction, memory/net/disk in bytes (per second for net/disk). `cpuSaturatedPct` is a 0..1 fraction of samples at >=95% CPU.
- Journal retention limits the window; `since` beyond what the journal keeps returns what exists. Read-only: only agent GET endpoints are called.

