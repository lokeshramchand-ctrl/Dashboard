# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Security
- **Critical:** the `/api` auth hook tested the raw URL, but Fastify decodes percent-escapes before routing, so `/%61pi/guests` (and every other route, including POST actions) skipped authentication. The guard now checks the decoded path and the matched route.
- Login throttling also counts failures per IP (spraying many usernames), failed-login usernames are sanitised before logging.
- API rate limiter (600 reads / 60 writes per minute per IP), `Sec-Fetch-Site: cross-site` refused on writes, SSE stream cap (50), repeated query params rejected with 400 on the journal route.
- Upstream (Proxmox, Loki, AI endpoint) error bodies and internal hostnames are logged server-side, not returned to the browser.
- Guest list is cached for 1.5 s and de-duplicated in flight (every guest route re-fetched it from Proxmox).

### Added (VM management)
- **Manage** tab on VM pages: guest-agent facts (hostname, OS, IPs, volumes), CPU/RAM/balloon/name/notes/autostart/agent editing, ISO mount/eject, virtual NIC unplug/plug, full clone. Routes `/api/guests/:vmid/vm/{agent,isos,media,config,nic,clone}`.
- `scripts/bench.mjs`: security probes and latency/throughput benchmark.

### Changed
- bencho.dev-inspired skin (warm paper neutrals, Inter, glass cards, pill tabs, spring motion); new and corrected icons.

### Removed
- Unused `SearchBox` component and dead imports/variables.

### Added
- QEMU: **QEMU** tab on VM pages (structured disks, NICs, passthrough, platform checks such as missing TPM/EFI disk, backups with Back up now, send Ctrl+Alt+Del); snapshot create, roll back (typed confirmation) and delete on the Snapshots tab. Routes in `API_NOTES.md`.
- Loki: read-only `/api/loki/*` routes and a **Loki** tab on the Logs page (label picker, LogQL box, time range, histogram, 5 s live refresh). Queries Loki directly; nothing is copied into MongoDB.
- Expo / React Native mobile app (`mobile/`).
- Docker image and `docker-compose.yml` (app + MongoDB).
- `AGENTS.md`, README, CONTRIBUTING, SECURITY, LICENSE, CI workflows, issue and PR templates.
- Web UI: command palette.
- `GET /api/guests/:vmid/windows?since=` and a **Windows** tab on VM pages: findings (agent ping timeouts, shutdown timeouts, restart loops, passthrough errors/reset counts, OOM, crashes), config health checks, per-run history (length, CPU time, peak RAM, what ended it), guest-agent probe, resource summary, copy/download report and live refresh.

### Fixed
- `/api/guests/:vmid/logs` returned 502 for guests with no matching journal lines (journalctl `-g` exits 1 on no match).

## [1.0.0]

### Added
- Loki: read-only `/api/loki/*` routes and a **Loki** tab on the Logs page (label picker, LogQL box, time range, histogram, 5 s live refresh). Queries Loki directly; nothing is copied into MongoDB.
- React web UI, Fastify backend with MongoDB-backed auth, Proxmox guest control, nginx/Grafana/Kuma views.
