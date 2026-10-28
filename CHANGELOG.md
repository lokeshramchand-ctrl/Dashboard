# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Expo / React Native mobile app (`mobile/`).
- Docker image and `docker-compose.yml` (app + MongoDB).
- `AGENTS.md`, README, CONTRIBUTING, SECURITY, LICENSE, CI workflows, issue and PR templates.
- Web UI: command palette.
- `GET /api/guests/:vmid/windows?since=` and a **Windows** tab on VM pages: findings (agent ping timeouts, shutdown timeouts, restart loops, passthrough errors/reset counts, OOM, crashes), config health checks, per-run history (length, CPU time, peak RAM, what ended it), guest-agent probe, resource summary, copy/download report and live refresh.

### Fixed
- `/api/guests/:vmid/logs` returned 502 for guests with no matching journal lines (journalctl `-g` exits 1 on no match).

## [1.0.0]

### Added
- React web UI, Fastify backend with MongoDB-backed auth, Proxmox guest control, nginx/Grafana/Kuma views.
