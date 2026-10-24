# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Expo / React Native mobile app (`mobile/`).
- Docker image and `docker-compose.yml` (app + MongoDB).
- `AGENTS.md`, README, CONTRIBUTING, SECURITY, LICENSE, CI workflows, issue and PR templates.
- Web UI: command palette.
- Guest detail page (`#/guests/:vmid`): summary charts, editable resources and options, snapshots, backups, task log, and an xterm.js shell (`SHELL_ENABLED`, off by default). New settings `SHELL_ENABLED` and `PVE_BACKUP_STORAGE`; new Proxmox token privileges (see `.env.example`).

## [1.0.0]

### Added
- React web UI, Fastify backend with MongoDB-backed auth, Proxmox guest control, nginx/Grafana/Kuma views.
