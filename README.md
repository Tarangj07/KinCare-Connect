# Elderly Care Coordination Platform

A secure, family-and-caregiver coordination platform for elderly
relatives. See `PROJECT_PLAN.md`, `ARCHITECTURE.md`, `THREAT_MODEL.md`,
and `SECURITY.md` for the design.

> **Status:** Phase 1 — monorepo foundation complete. Three apps
> (web, mobile, api) and four shared packages compile, lint, test, and
> build clean. Local infrastructure (Postgres, Redis, MinIO) is
> defined in `docker-compose.yml`. No business logic yet.

## Quick start

```bash
# 1. Activate pnpm via Corepack (Node 20+ required).
corepack enable

# 2. Install dependencies.
pnpm install

# 3. Run the four validation gates.
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -r build

# 4. Bring up local infrastructure (Postgres, Redis, MinIO).
docker compose up -d

# 5. Run the apps (in separate terminals).
pnpm --filter @ecc/api dev
pnpm --filter @ecc/web dev
pnpm --filter @ecc/mobile dev
```

## Workspace layout

```
apps/
  api/         NestJS HTTP API (port 3000)
  web/         Next.js 14 (port 3001)
  mobile/      Expo / React Native
packages/
  config/      Shared ESLint and TypeScript configurations
  types/       Cross-app TypeScript types and zod schemas
  validation/  Reusable zod validation schemas
  ui/          Design tokens and shared component primitives
```
