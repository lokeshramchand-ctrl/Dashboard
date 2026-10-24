# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot, etc.) working in this repo. Humans: see `README.md` and `CONTRIBUTING.md`. Claude Code also reads `CLAUDE.md`, which holds the detailed architecture rules; this file is the tool-neutral summary.

## What this is

Single-user homelab dashboard (SPL Console). Three deployable parts:

| Path | What | Stack |
|---|---|---|
| `/` (root) | Web UI | React 18, Vite, TypeScript |
| `server/` | Backend API | Fastify 5, MongoDB, TypeScript, Node >= 20.6 |
| `mobile/` | Mobile app | Expo / React Native, TypeScript |

The backend controls Proxmox guests and reads nginx, Grafana and Uptime Kuma. The UI and the mobile app are both clients of the same `/api/*` contract in `API_NOTES.md`.

## Setup and verification

Run these before declaring work done. All must pass.

```sh
npm ci && npm run build            # web UI: typecheck + build (mock API on)
cd server && npm ci && npm run build   # backend typecheck + compile
cd mobile && npm ci && npm run typecheck   # mobile typecheck
```

`npm run dev` starts the web UI with the in-browser mock API (login password `demo`), so UI work needs no backend.

## Hard rules (do not break)

1. **Auth is MongoDB only.** Never store or log tokens, passwords or the session cookie. Never weaken `Origin` checks, cookie flags, or the session hook in `server/src/auth.ts`.
2. **All routes live under `/api/`** so the session hook protects them. Only `/api/auth/login` is public.
3. **Guest actions** must honour `ALLOWED_VMIDS` and `PROTECTED_VMIDS` and write an `audit` document for every attempt.
4. **Errors are `{error, code}`** with a real HTTP status. Missing integration config is `503 NOT_CONFIGURED` (except `/api/overview`, which degrades to zeros).
5. **No hardcoded hosts.** Web uses root-relative `/api/...`; mobile takes the server URL from user settings.
6. **Contract changes** (field names, units) must update `API_NOTES.md`, `src/types.ts`, `mobile/src/types.ts` and `src/mock.ts` together.
7. **Every data panel** has loading, error and empty states (web and mobile).
8. **Never commit secrets.** `.env` files are git-ignored; only `.env.example` is tracked.

## Conventions

- TypeScript strict. No `any` unless parsing untrusted JSON at a boundary.
- Match surrounding style; keep comments rare and about *why*.
- Web icons are inline SVG paths in `src/components/ui.tsx`; no icon library.
- Web follows the SPL Systems site design (see the Design section of `CLAUDE.md`): colours are CSS variables at the top of `src/styles.css`, charts and status use only the four logo colours. Mobile colours live in `mobile/src/theme.ts` and have not been aligned to it yet.
- Units: cpu is a 0..1 fraction, memory/disk in bytes, uptime in seconds, uptimeNd in percent.
- Prefer small, focused commits using Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `refactor:`).
- Windows is a supported dev OS. Prefer the file-writing tool over tricky shell heredocs.

## Do not touch without being asked

- `server/` auth, audit, and guest-action logic (working and security-sensitive).
- `dist/`, `server/build/`, `mobile/.expo/` (generated, git-ignored).
- `package-lock.json` files, except via `npm install`.
