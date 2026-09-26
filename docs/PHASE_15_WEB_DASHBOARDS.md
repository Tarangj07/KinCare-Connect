# Phase 15 — Web Dashboards

## Scope

Web dashboards (per-role: senior / family / caregiver / org / admin) — PROJECT_PLAN.md phase 15.

## What was implemented

- `apps/web/src/app/dashboard/page.tsx` — main dashboard with role-aware navigation cards
- `apps/web/src/app/dashboard/senior/page.tsx` — senior role view
- `apps/web/src/app/dashboard/family/page.tsx` — family role view
- `apps/web/src/app/dashboard/caregiver/page.tsx` — caregiver role view
- `apps/web/src/app/dashboard/org/page.tsx` — organization role view
- `apps/web/src/app/dashboard/admin/page.tsx` — admin role view
- Updated `apps/web/src/app/page.tsx` — references Phase 15 and links to dashboard
- Updated `apps/web/src/app/layout.tsx` — metadata reflects Phase 15

## Architecture

- Next.js App Router (existing Phase 1 architecture preserved).
- No database schema changes (no new tables, no migrations).
- No new backend endpoints required; dashboard pages are UI-level only and rely on the existing REST API (`/api/v1/health` and feature endpoints) for any data.
- Authorization remains server-side: the web pages display role labels for clarity, but any data access through the API requires the backend's `JwtAuthGuard` + `CareCircleMember` ACL.

## Security

- No client-side authorization bypass: pages do not enforce access; the backend enforces it independently.
- No secrets or tokens exposed in source.
- No `console.log` of PHI or sensitive data.
- No TLS bypass or insecure transport changes.
- Safe error states: no raw server errors exposed in UI text.

## Tests / Verification

- `pnpm --filter @ecc/web typecheck` — checked (pre-existing errors only; no new Phase 15 errors).
- `pnpm --filter @ecc/web lint` — passes.
- `pnpm --filter @ecc/web build` — passes.
- No vitest failures introduced by Phase 15.
- No database drift.

## Known limitations / deferred

- Real-time data binding is deferred (Phase 8 event bus not yet integrated into web).
- Per-role data fetching is stubbed; real endpoint integration requires server-side session/auth wiring (Phase 3+ complete for auth, but full dashboard data integration is future work).
- No AI service boundary added (Phase 20).
- No push notification integration (Phase 8).
- No web admin interface beyond the basic admin page stub (full admin features deferred).

## Phase 16+ confirmation

Phase 16 (security hardening: headers, rate limits, dependency audit, secret scanning) was NOT started. No Phase 16 stubs added.
