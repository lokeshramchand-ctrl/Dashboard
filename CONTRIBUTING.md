# Contributing

## Workflow

1. Branch from `master`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
2. Keep commits small and use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `refactor:`, `build:`).
3. Make sure the checks below pass, then open a pull request using the template.

## Checks

```sh
npm ci && npm run build                    # web
cd server && npm ci && npm run build       # backend
cd mobile && npm ci && npm run typecheck   # mobile
```

CI runs the same commands (`.github/workflows/ci.yml`).

## Rules

- Read `AGENTS.md`: the auth, audit and API-contract rules apply to humans too.
- Changing an API field means updating `API_NOTES.md`, `src/types.ts`, `mobile/src/types.ts` and `src/mock.ts` in the same PR.
- Every data view needs loading, error and empty states.
- Never commit `.env` files or secrets.
