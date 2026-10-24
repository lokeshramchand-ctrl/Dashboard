# SPL Console

A single-user dashboard for a homelab: start/stop Proxmox guests, see nginx sites, browse Grafana dashboards and watch Uptime Kuma, from the browser or a phone.

| Part | Path | Stack |
|---|---|---|
| Web UI | `/` | React 18, Vite, TypeScript |
| Backend | `server/` | Fastify 5, MongoDB, TypeScript |
| Mobile app | `mobile/` | Expo, React Native, TypeScript |

## Features

- **Overview**: host CPU/memory/disk, guest counts, and a "needs attention" list.
- **Guests**: start, shutdown, stop, reboot with live task status, audit log and GPU-conflict warnings for the gaming VM.
- **Nginx**: read-only view of sites, matched to Uptime Kuma monitors.
- **Grafana**: dashboard browser with embedded panels and a metrics explorer.
- **Uptime**: monitors, heartbeats and incidents derived from Kuma `/metrics`.
- Light and dark themes, responsive down to phone width, command palette (`Ctrl/Cmd + K`).

## Quick start (demo, no backend)

```sh
npm install
npm run dev        # http://localhost:5173, password: demo
```

The web build ships with an in-browser mock of the whole API.

## Run with Docker

```sh
cp .env.example .env      # fill in Proxmox / Grafana / Kuma values
docker compose up -d --build
docker compose run --rm app node build/create-user.js admin
```

Open `http://localhost:3000`. The compose file runs the app next to MongoDB. Put it behind an HTTPS reverse proxy and set `COOKIE_SECURE=true` for anything beyond a trusted LAN.

> Note: the Docker setup has been validated with `docker compose config` but the image build has not been run in CI yet.

## Run without Docker

```sh
npm install && npm run build:prod          # UI -> dist/
cd server && npm install && npm run build
cp .env.example .env                       # edit
npm run create-user -- admin
npm start
```

Requires Node >= 20.6 and a reachable MongoDB. Set `SERVE_DIST=../dist` to let the backend serve the UI.

## Mobile app

```sh
cd mobile
npm install
npm start          # scan the QR code with Expo Go
```

Enter your dashboard URL (for example `https://dash.home.lan`) on the login screen. See [`mobile/README.md`](mobile/README.md).

## Security model

Auth state lives only in MongoDB (scrypt password hashes, hashed session tokens, rate-limit counters, audit log). The cookie is `httpOnly` and `SameSite=Strict`. Guest actions are checked against `ALLOWED_VMIDS` / `PROTECTED_VMIDS` and every attempt is audited. Report vulnerabilities per [`SECURITY.md`](SECURITY.md).

## Docs

- [`API_NOTES.md`](API_NOTES.md): units and API contract
- [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md): guidance for AI coding agents
- [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CHANGELOG.md`](CHANGELOG.md)

## License

[MIT](LICENSE)
