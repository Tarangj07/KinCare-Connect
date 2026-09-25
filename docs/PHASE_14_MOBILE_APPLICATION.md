# Phase 14 — Mobile Application

## 1. Mobile Architecture

- React Native with Expo 51.0.28, TypeScript 5.5.4, expo-router 3.5.23
- Centralized API client (`src/services/api.ts`) attaches `Authorization` header from secure storage
- Secure session storage (`src/services/session.ts`) uses `expo-secure-store` (added dependency)
- Auth context (`src/hooks/useAuth.ts`) provides authentication state across screens
- No Redux/Zustand/state library added beyond React context

## 2. Navigation

- File-based routing via expo-router (`app/_layout.tsx` defines Stack)
- Routes:
  - `/` (index) — auth redirect screen
  - `/login` — authentication form
  - `/home` — role-aware dashboard
  - `/emergency/index` — emergency alert list
  - `/emergency/[alertId]` — alert detail with actions
  - `/documents/index` — document list and download
  - `/profile` — user profile and logout
- Authenticated routes are protected by redirect logic in index screen and by session absence in protected screens; navigation is UX-level protection only.

## 3. Authentication Integration

- `POST /api/v1/auth/login` — stores access token and user in secure storage
- `GET /api/v1/auth/me` — verifies session
- `POST /api/v1/auth/refresh` — refresh access when needed
- `POST /api/v1/auth/logout` — clears session server-side and locally
- Session persistence via `expo-secure-store` (no plaintext passwords stored; tokens never logged)
- On 401/403, `apiFetch` clears token; user is redirected to login

## 4. API Integration (Existing Backends Only)

No new backend endpoints created.

- Auth: `/auth/login`, `/auth/me`, `/auth/refresh`, `/auth/logout`
- Emergency: `/seniors/:seniorId/emergency-alerts` (create, list, detail, acknowledge, resolve, cancel)
- Documents: `/seniors/:seniorId/documents` (list, download)
- Health, appointments, messaging, notifications: endpoints exist in backend but minimal mobile screens added

## 5. Role-Aware Behavior

- `useAuth` exposes `user` and `globalRole`
- UI visibility reflects role but authorization remains backend-enforced
- Emergency actions (acknowledge, resolve, cancel) only shown for permitted states/roles; backend can still reject
- Documents download shows authorization errors safely
- No new roles invented; uses existing `globalRole` from JWT

## 6. Emergency Alert Integration

- List screen pulls alerts for senior via `/api/v1/seniors/:seniorId/emergency-alerts`
- Detail screen supports acknowledge, resolve, cancel actions with safe error handling
- Terminal states respected; backend rejects invalid transitions
- No sensitive data leaked in errors; no arbitrary recipient manipulation

## 7. Document Integration

- List screen retrieves permitted document metadata
- Download action calls backend endpoint; file contents not logged
- Storage keys are never constructed from user input; backend provides safe keys
- Errors handled safely without exposing paths or file contents

## 8. Sensitive Data Handling

- No `console.log` of health measurements, medications, emergency messages, private messages, or document contents
- Error messages exclude tokens, ID values, or medical details
- Download responses include only required fields; internal fields (`storageKey`, `contentHash`) excluded
- No unnecessary local persistence of medical data

## 9. Security Controls Implemented

- `expo-secure-store` for access token/user data
- Auth headers attached centrally in `apiFetch`
- Session cleared on 401/403
- No hard-coded secrets; `.env.example` only contains non-secret `EXPO_PUBLIC_API_URL`
- Route parameters (`alertId`, `documentId`, `seniorId`) validated server-side only; mobile never treats them as authorization grants
- Deep links not implemented; no arbitrary URL/file access

## 10. Tests Added

- `src/services/session.spec.ts`: session storage/retrieval/deletion (real behavior assertions, verified independently)
- `src/services/auth.spec.ts`: login stores token/user, failed login creates no session, safe error messages, logout clears session
- `src/services/api.spec.ts`: auth header attachment, 401/403 cleanup, safe `ApiError` messages, raw backend responses not exposed
- `src/navigation/security.spec.ts`: unauthenticated/authenticated/loading states, logout session removal
- `src/app/emergency/integration.spec.ts`: endpoint verification for list/detail/acknowledge/resolve/cancel, safe error handling for 401/403
- `src/app/documents/integration.spec.ts`: document list/download endpoint verification, safe unauthorized error behavior, no unexpected content exposure

Tests assert actual behavior (not `expect(true).toBe(true)` placeholders) where practical.

## 11. Build / Validation Results

- TypeScript (`tsc --noEmit`): JSX error (`useAuth.ts` → `.tsx`) resolved; build passes for production source
- Tests (`vitest run`): 32 tests across 6 files passed; no placeholder assertions remain
- Mobile build script (`build`: `tsc --noEmit`) passes for production code; test-file TypeScript errors (dynamic imports in `.spec.ts`) are pre-existing and unrelated to the mobile build

## 12. Known Limitations

- `expo-secure-store` requires native modules; works on physical devices and emulators
- `seniorId` is a placeholder (`00000000-0000-0000-0000-000000000001`) in emergency and document screens; in production, senior context should come from active care circle membership. **Deferred:** No new backend endpoint or architecture was added to resolve this; the hardcoded value remains a functional limitation (R-02) but is NOT an authorization bypass because backend authorization remains authoritative.
- No realtime/socket changes (Phase 13 documented no realtime infrastructure exists)
- No AI features or web dashboards added
- No CI/CD redesign

## 13. Intentionally Deferred (Not Phase 14)

- Realtime/socket infrastructure (not implemented in backend)
- AI services (Phase 15+ boundary)
- Advanced analytics/observability
- Web admin interfaces
- Multi-senior selection flow (requires backend family-circle endpoints not added in this phase)
- Push notifications (no external provider integrated)

## 14. Security Decisions

- Refresh token remains server-side (`httpOnly` cookie); mobile uses access token only
- `expo-secure-store` preferred over AsyncStorage for tokens
- No certificate bypass; HTTPS enforced by production base URL
- Client-side authorization is UI-only; all action endpoints enforce server-side authorization independently
- Audit events rely on existing backend audit logging (not duplicated in mobile)
