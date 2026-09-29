# SECURITY REVIEW — PHASE 21 (INDEPENDENT)

**Subject:** Phase 21 — Container Runtime Hardening
**Reviewer role:** Independent security / reliability reviewer
**Repository:** KinCare-Connect (`/home/tarang/Desktop/Projects/ElderlyCareCoordinationPlatform`)
**HEAD at review start and end:** `d0cd0dd` — "Complete Phase 17 testing CI and reliability"
**Verdict:** see §18.

---

## 1. Executive summary

I independently re-verified every material claim in the Phase 21 implementation report by
building the images from the current tree, running real containers against a fresh
throwaway PostgreSQL, and attempting the failure cases myself. I did not accept the report's
numbers at face value; where they disagreed with observed behaviour I report the observed
behaviour.

**Both Phase 21 objectives are genuinely fixed, and I reproduced the fixes from scratch.**

* **P20-L-01 (migration command).** The published command
  `docker run --rm -e DATABASE_URL=… <image> node_modules/.bin/prisma migrate deploy`
  works. I built `review-api:p21` with `--no-cache`, created a brand-new database, proved it
  had **0 tables**, ran the exact documented command (exit 0, 2 migrations applied), confirmed
  the resulting schema (37 public tables, 2 finished / 0 rolled back, `migrate status` =
  "Database schema is up to date!"), and re-ran it (exit 0, "No pending migrations to
  apply"). The alternate `--entrypoint node … node_modules/prisma/build/index.js` form also
  works on its own fresh database. The database password never appeared in the CLI output or
  in the API container's logs. The old broken form still fails with
  `Cannot find module '/app/prisma'`, and **no document instructs an operator to use it**.
* **P20-L-03 (filesystem writable by UID 1000).** The shipped image is genuinely
  root-owned and read-only to the runtime user. I walked the whole tree: **8330 regular
  files, 1106 directories, 418 symlinks, 0 paths not root-owned, 0 paths group/other
  writable, 0 directories not 0555, 0 files not 0444/0555, 0 broken symlinks, 0 absolute
  and 0 escaping symlinks.** I then attempted **20 distinct write operations as UID 1000**
  in a live production container — append, overwrite, create, `mkdir`, `unlink`, `chmod`,
  `chown` and a symlink swap across `dist/`, `package.json`, `prisma/` (including a new
  migration directory and an existing `migration.sql`), `node_modules/` and `/app` itself.
  **All 20 were denied.** Legitimate writes to `STORAGE_DIR` succeed.
* **The container gate is real and it is not vacuous.** I ran
  `scripts/verify-docker-images.mjs --skip-build` against my own `--no-cache` images:
  **35 PASS, 0 FAIL, exit 0** — and 35 + 2 build checks = the claimed **37**, which I
  confirmed both by execution and by static accounting. I then ran **six** mutations; the
  gate correctly failed with exit 1 on five of them, and I identified precisely the one
  defect class it does not catch (§14, P21-01).
* **No regression.** Every application gate reproduced the Phase 20/19 baseline exactly:
  API unit **153**, integration **60**, all-with-DB **213**, mobile **32**, web **1**, root
  lanes **11/11**, typecheck clean, build **7/7**, `build:verify` PASSED, API lint **55
  errors / 127 warnings** (unchanged advisory baseline), `git diff --check` clean.
* **No Phase 22 contamination, no git tampering.** Exactly five files carry a post-Phase-20
  mtime. HEAD is unmoved, nothing is staged, nothing was pushed, and `PROJECT_PLAN.md`,
  `PROJECT_PLAN-old.md` and every prior `SECURITY_REVIEW_*` artifact are untouched.

**Findings: 0 Critical, 0 High, 3 Low, 5 Info.** All three Low findings are documentation
completeness / gate-coverage observations. **None of them blocks the Phase 21 checkpoint**,
because none of them is a defect in either of the two controls Phase 21 set out to fix, and
neither introduces a regression against Phase 16–20.

I did not fix anything, did not modify any production or application file, did not create a
commit, and did not start Phase 22.

---

## 2. Scope reviewed

In scope:

1. The two Phase-20 findings Phase 21 claims to close: **P20-L-01** (misleading Prisma
   migration command) and **P20-L-03** (API image application files writable by the runtime
   user).
2. The container verification gate `scripts/verify-docker-images.mjs` (claim: 21 → 37 checks).
3. The resulting image permission model and its interaction with the Phase 18 storage
   controls.
4. The application regression baseline.
5. Phase 16–20 security-control survival.
6. Git integrity and Phase 22 contamination.

Out of scope (per instruction, and not started): Kubernetes, Helm, Terraform, AWS, Redis rate
limiting, MinIO/S3, WebSockets/realtime, push notifications, SMS/email, AI/LLM, OCR, EHR,
GPS, payments/subscriptions, dashboards/mobile features, metrics/tracing/structured logging,
Prisma schema or migration feature work.

Files I treated as "Phase 21 changes" — established by filesystem mtime against the Phase 20
review's write time (`SECURITY_REVIEW_PHASE_20.md`, 13:07), not by trusting the report:

| File | Phase 21? |
| --- | --- |
| `apps/api/Dockerfile` | yes |
| `scripts/verify-docker-images.mjs` | yes |
| `docs/PHASE_20_CONTAINER_BUILD_VERIFICATION.md` | yes (correction notes only) |
| `docs/PHASE_21_CONTAINER_RUNTIME_HARDENING.md` | yes (new) |
| `docs/PHASE_21_FINAL_REPORT.md` | yes (new) |
| everything else in `git status` | no — pre-existing uncommitted Phase 18–20 work |

This matches the report's own §16 claim of "three files changed" plus two new documents. It
also matches the report's statement that no application source, Prisma schema, migration,
auth or authorization code was touched — **I confirmed that independently by mtime: no file
under `apps/*/src`, `packages/*/src` or any `apps/*/config` has a post-Phase-20 mtime.**

---

## 3. Environment / setup

| Item | Value |
| --- | --- |
| Docker | 29.8.1 |
| Host | 12 vCPU, 14 GB RAM, Linux |
| Node (host) | 24.x, `pnpm@11.25.0` |
| Base images | `node:24-alpine`, `postgres:16-alpine` |

Isolation of the review database, as required:

* I created a **dedicated** `postgres:16-alpine` container (`p21-review-postgres`, port
  13621) for the application test suites, and a **second** dedicated container
  (`p21-rev-pg2`, private Docker network `p21-rev-net`) for the migration-command
  verification, so the "database is genuinely empty" precondition could be proved
  literally.
* **The developer database `ecc` was never connected to, migrated, or modified.** The
  `ecc-postgres` container was only read, and only at the start and end of the review. It
  contained and still contains exactly `ecc`, `postgres`, `template0`, `template1`.
  Verified after all review activity:

  ```
  $ docker exec ecc-postgres psql … -c "select datname from pg_database order by 1"
  ecc
  postgres
  template0
  template1
  ```

All review containers, networks, volumes, images and temporary directories were destroyed at
the end of the review (§17, Limitations and Cleanup). The pre-existing `ecc-api:p20-verify`
and `ecc-web:p20-verify` images left by Phase 20 were **not** removed — they are not my
scratch state. I used my own `review-*` image tags throughout so Phase 20's artifacts were
never clobbered.

---

## 4. Git state

| Assertion | Result |
| --- | --- |
| `HEAD` is `d0cd0dd` | **confirmed** — `git rev-parse --short HEAD` = `d0cd0dd` |
| No commit created by Phase 21 | **confirmed** — `git log -1` unchanged; reflog's newest entry is the pre-existing `d0cd0dd` commit; the only other reflog entries are four `reset: moving to HEAD` from the earlier Phase 16/17 work |
| Nothing pushed | **confirmed** — `git log origin/main..HEAD --oneline` = 2 commits, both pre-existing (`c615e2b` Phase 16, `d0cd0dd` Phase 17). No force-push, no new remote ref. `origin/main` is still at `1727829` |
| No reset / rebase / amend / history rewrite | **confirmed** — no `rebase`, `merge` or `pull` entry in the reflog; the four `reset: moving to HEAD` entries all predate `d0cd0dd` and move to the same commit (no-op) |
| Nothing staged | **confirmed** — `git diff --cached --name-only` = 0 files |
| No stash | **confirmed** — `git stash list` = 0 |
| `PROJECT_PLAN.md` untouched | **confirmed** — it *is* modified in the working tree, but its mtime is `09-26 16:32`, i.e. **two days before** the Phase 20 review and before any Phase 21 activity. This is the pre-existing user change the report discloses, and Phase 21 did not touch it |
| `PROJECT_PLAN-old.md` untouched | **confirmed** — mtime `09-26 16:32` |
| `SECURITY_REVIEW_PHASE_16..20.md` untouched | **confirmed** — latest mtime is `SECURITY_REVIEW_PHASE_20.md` at `09-28 13:07`, the review that predates Phase 21. None has a post-13:08 mtime |
| `docker-compose.yml` untouched | **confirmed** — mtime `09-04 02:28` |
| No dependency changes in Phase 21 | **confirmed** — `pnpm-lock.yaml` (09-26 12:47), `package.json` (09-26 16:37), `apps/api/package.json` (09-28 01:02), `apps/web/package.json` (09-04), `apps/mobile/package.json` (09-26) all predate Phase 21. The single `apps/api/package.json` diff line is Phase 20's `build:verify` script, not a dependency |
| Working tree unchanged by this review | **confirmed** — `git status --short` after the review is byte-identical to before it, plus the one new `SECURITY_REVIEW_PHASE_21.md` |

---

## 5. Docker build verification

Both images rebuilt from the current tree with `--no-cache`, as separate steps (sequentially —
see §17 on the concurrency note in the report).

### API image

```
$ docker build --no-cache -f apps/api/Dockerfile -t review-api:p21 .
… DONE
```

| Property | Observed | Report claim | Verdict |
| --- | --- | --- | --- |
| Build result | exit 0 | exit 0 | ✅ |
| Image size | 447 155 520 B | 447 155 442 B | ✅ (Δ 78 B — see P21-07) |
| Layers | 8 | 8 | ✅ |
| `Config.User` | `1000:1000` | `1000:1000` | ✅ |
| `Config.Entrypoint` | `[docker-entrypoint.sh]` (inherited, unmodified) | deliberately unchanged | ✅ |
| `Config.Cmd` | `[node dist/main.js]` | unchanged | ✅ |
| `Config.WorkingDir` | `/app` | `/app` | ✅ |
| `HEALTHCHECK` | liveness-only probe on `/api/v1/health` | unchanged | ✅ |

Structure and hygiene:

| Check | Result |
| --- | --- |
| `/app` contents | exactly `dist  node_modules  package.json  prisma` |
| `src` / `test` / `coverage` in `/app` | none |
| `*.spec.js` / `*.test.js` / `*.e2e-spec.js` in `/app/dist` | none |
| `.env`, `.env.*` | none |
| real `.git` **directories** | none |
| `*.pem`, `*.key`, `id_rsa*`, `*.p12` | none |
| `.claude` in image | not present |
| Broken symlinks | 0 (independently walked; also 0 symlinks resolving outside `/app`, 0 absolute symlinks) |
| Runtime dependency resolution | self-contained — the tree loads with no dangling `.pnpm` references |
| Prisma engines present | `libquery_engine-linux-musl-openssl-3.0.x.so.node`, `schema-engine-linux-musl-openssl-3.0.x` |
| Prisma client loads | `typeof PrismaClient === 'function'` |
| Prisma **engine actually runs** | **yes** — `migrate deploy` (schema engine) and `GET /health/ready` (`SELECT 1` via the query engine) both succeeded against a real database |
| argon2 loads and **works** | `hash()` returned a real `$argon2id$v=…` hash (97 chars). Not just a `require()` — an actual native call |
| Runtime user effective | `uid=1000(node) gid=1000(node) groups=1000(node)` |

A note on the `.git*` search: a naive `find /app -name ".git*"` returns hits, but they are
`node_modules/**/.github/` CI metadata directories and one `.gitkeep` that npm packages ship
in their tarballs. There is no VCS metadata in the image, which the precise
`find /app -type d -name .git` confirms.

### Web image

```
$ docker build --no-cache -f apps/web/Dockerfile -t review-web:p21 .
… DONE
```

| Property | Observed | Report claim | Verdict |
| --- | --- | --- | --- |
| Build result | exit 0 | exit 0 | ✅ |
| Image size | 271 662 795 B | 271 662 862 B | ✅ (Δ 67 B — see P21-07) |
| Layers | 8 | 8 | ✅ |
| `Config.User` | `1000:1000` | `1000:1000` | ✅ |
| `Config.Cmd` | `[node apps/web/server.js]` | unchanged | ✅ |
| `/app` contents | `apps  node_modules  package.json` | standalone output | ✅ |
| `.env` / `.git` / keys | none | none | ✅ |
| `src` / `test` / `*.spec.ts` | none | none | ✅ |
| `HEALTHCHECK` | **absent** | absent, disclosed as pre-existing P20-L-04 | ✅ (honest disclosure) |

---

## 6. Prisma migration-command verification (P20-L-01)

This is the claim I treated as least trustworthy, since it is a documentation claim. I
verified it by execution only.

### 6.1 Freshness of the target database — proved, not assumed

```
$ docker run -d --name p21-rev-pg2 --network p21-rev-net \
    -e POSTGRES_USER=p21mig -e POSTGRES_PASSWORD=p21-mig-secret postgres:16-alpine
$ docker exec p21-rev-pg2 psql -U p21mig -d postgres -qc 'CREATE DATABASE p21_fresh'
$ docker exec p21-rev-pg2 psql -U p21mig -d p21_fresh -tAc \
    "select count(*) from information_schema.tables where table_schema='public'"
0
```

### 6.2 The exact documented command

```
$ docker run --rm --network p21-rev-net \
    -e DATABASE_URL='postgresql://p21mig:p21-mig-secret@p21-rev-pg2:5432/p21_fresh' \
    review-api:p21 node_modules/.bin/prisma migrate deploy

Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "p21_fresh", schema "public" at "p21-rev-pg2:5432"

2 migrations found in prisma/migrations

Applying migration `20260904042815_init`
Applying migration `20260915000000_phase13_emergency_alerts`
…
All migrations have been successfully applied.
EXIT=0
```

### 6.3 Resulting schema

| Assertion | Expected (report §5) | Observed | Verdict |
| --- | --- | --- | --- |
| Migrations shipped in the image | 2 | 2 (`20260904042815_init`, `20260915000000_phase13_emergency_alerts`) | ✅ |
| `_prisma_migrations` finished | 2 | 2 | ✅ |
| `_prisma_migrations` rolled back | 0 | 0 | ✅ |
| Rows with `applied_steps_count > 0` | — | 2 | ✅ |
| Public tables created | 37 | **37** | ✅ |
| `prisma migrate status` | up to date | `Database schema is up to date!`, exit 0 | ✅ |

### 6.4 Idempotency

Re-running the identical command against the now-migrated database:

```
2 migrations found in prisma/migrations

No pending migrations to apply.
EXIT=0
```

Table count after the re-run: still **37** (nothing was re-applied or duplicated). ✅

### 6.5 Credential leakage

* Password occurrences in the migration command's stdout+stderr: **0**.
* Password occurrences in the running API container's full log: **0**. The Nest startup
  banner and every mapped route line were scanned.

The CLI does echo the *host, port and database name* (`at "p21-rev-pg2:5432"`) but not
credentials. That is the CLI's own output, not this project's, and it is on a deployment-time
step whose output is read by the operator, not on an unauthenticated HTTP endpoint. Noted as
context, not as a finding.

### 6.6 The alternate documented form

```
$ docker run --rm --network p21-rev-net \
    -e DATABASE_URL='…@p21-rev-pg2:5432/p21_entrypoint' \
    --entrypoint node review-api:p21 node_modules/prisma/build/index.js migrate deploy
All migrations have been successfully applied.
EXIT=0
→ 37 tables
```

Verified on its **own** previously-empty database, so it is not passing by inheriting state. ✅

### 6.7 Root cause of the old failure — reproduced, and correctly left unfixed

The report claims the inherited `docker-entrypoint.sh` rewrites an unresolvable `argv[0]`. I
reproduced that mechanism directly:

```
$ docker run --rm --entrypoint sh review-api:p21 -c \
  'set -- prisma migrate deploy; if [ "${1#-}" != "${1}" ] || [ -z "$(command -v "${1}")" ] …; then set -- node "$@"; fi; echo "argv0 becomes: $1"'
argv0 becomes: node

$ docker run --rm --entrypoint sh review-api:p21 -c 'command -v prisma'
NOT ON PATH

$ docker run --rm --entrypoint sh review-api:p21 -c 'ls -ln /app/node_modules/.bin/prisma'
-r-xr-xr-x    1 0        0             1934 /app/node_modules/.bin/prisma
```

And the broken form still fails, exactly as the report says:

```
$ docker run --rm … review-api:p21 prisma migrate deploy
Error: Cannot find module '/app/prisma'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1564:15)
EXIT=1
```

The claim that leaving `ENTRYPOINT` alone was the right call is, in my judgement, correct:
`docker-entrypoint.sh` is what makes `docker run <image> <anything>` work uniformly across
every image in this repo, and overriding it would be a broader behavioural change than the
defect warrants. The defect was a *documentation* defect and it is now a *documentation*
fix. **Confirmed as a genuine fix, not a workaround that hides a broken image** — the
capability (Prisma CLI + schema + migrations in the runtime tree) was always real; only the
invocation was wrong.

### 6.8 No operator-facing document still instructs the broken form

I searched every `.md`, `Dockerfile`, `.mjs`, `.yml`, `.ts` and `.json` in the repository
for `prisma migrate deploy` and inspected each hit:

* `apps/api/Dockerfile:134` — "**Do NOT use** the bare form", followed by the correct
  path-qualified form and the reason. ✅
* `docs/PHASE_21_CONTAINER_RUNTIME_HARDENING.md:112`, `docs/PHASE_21_FINAL_REPORT.md:153` —
  both explicitly "**Do not use**" / "**Must not be used**". ✅
* `docs/PHASE_20_CONTAINER_BUILD_VERIFICATION.md:123` — a clearly-marked "Phase 21
  correction" note, placed in the document an operator would look at first. ✅
* `docs/DATABASE.md:199`, `.github/workflows/ci.yml:57`, `apps/api/package.json:19` — these
  are the **host/pnpm** invocation (`pnpm … exec prisma migrate deploy`), which resolves the
  binary through node_modules and is correct. They are not the container form. ✅
* All remaining hits are historical narrative in Phase 18/19 documents and prior security
  reviews, i.e. records of what was true at the time, not instructions. ✅

**Conclusion: no document instructs an operator to use the broken form. Finding resolved.**

---

## 7. Filesystem hardening verification (P20-L-03)

### 7.1 Does anything in the application need to write to `/app`?

I re-derived this rather than trusting the report. A repository-wide search of
`apps/api/src` for write primitives (`writeFileSync|mkdirSync|appendFileSync|createWriteStream|rmSync|unlinkSync|openSync|copyFileSync|renameSync|chmodSync|chownSync|symlinkSync`) returns hits in exactly **two** files:

* `apps/api/src/storage/storage.service.ts` — lines 47, 113, 115 (and `unlinkSync` at 136).
  Every one resolves under `this.baseDir`, which is `STORAGE_DIR`.
* `apps/api/src/storage/storage.service.spec.ts` — a test file, not shipped.

`main.ts` contains no write primitive. The Prisma generator output is produced at **build**
time in the image, not at runtime; the query and schema engines only *read* the schema and
migrations. **The read-only `/app` costs nothing.** The report's premise is correct.

### 7.2 Whole-tree permission model (independent walk)

Walked `/app` with a Node script using `lstat` on every entry (not `ls`, not the report's
numbers):

```
files=8330 dirs=1105 symlinks=418        (dirs excludes /app itself; find -type d = 1106)
NOT_ROOT_OWNED            = 0
GROUP_OTHER_WRITABLE      = 0
DIRS_NOT_0555             = 0
FILES_NOT_0444_or_0555    = 0
ABSOLUTE_SYMLINKS         = 0
ESCAPING_SYMLINKS         = 0
BROKEN_SYMLINKS           = 0
```

Spot check of the representative paths:

```
dr-xr-xr-x  1 0 0   /app
dr-xr-xr-x  8 0 0   /app/dist
-r--r--r--  1 0 0   /app/dist/main.js
dr-xr-xr-x  6 0 0   /app/node_modules
-r-xr-xr-x  1 0 0   /app/node_modules/.bin/prisma
-r--r--r--  1 0 0   /app/package.json
dr-xr-xr-x  3 0 0   /app/prisma
-r--r--r--  1 0 0   /app/prisma/schema.prisma
```

This matches the report's §8 table exactly, including the counts (8330 / 1106 / 418) and the
classification rule (files keep `0555` iff they had the original execute bit — so
`.bin/prisma` and the native engines are `0555` while sources are `0444`).

### 7.3 Behavioural write attempts as UID 1000 in a live container

I started the image the documented way (production `NODE_ENV`, real `DATABASE_URL`, a
32+ char non-placeholder `JWT_ACCESS_SECRET`, `STORAGE_DIR` on a `1000:1000 0700` volume)
and, as `uid=1000(node)`, attempted **20** operations:

| # | Attempt | Result |
| --- | --- | --- |
| 1 | `echo x >> /app/dist/main.js` | **denied** |
| 2 | `echo x > /app/dist/main.js` (truncate) | **denied** |
| 3 | `echo x > /app/dist/evil.js` | **denied** |
| 4 | `echo x >> /app/package.json` | **denied** |
| 5 | `echo x >> /app/prisma/schema.prisma` | **denied** |
| 6 | `echo x > /app/prisma/migrations/20260101_evil/migration.sql` | **denied** |
| 7 | `mkdir /app/prisma/migrations/evil` | **denied** |
| 8 | `echo x >> /app/prisma/migrations/20260904042815_init/migration.sql` | **denied** |
| 9 | `echo x >> /app/node_modules/.bin/prisma` | **denied** |
| 10 | `echo x > /app/node_modules/evil.js` | **denied** |
| 11 | `echo x > /app/node_modules/@nestjs/core/index.js` (overwrite a real dep) | **denied** |
| 12 | `mkdir /app/dist/evil` | **denied** |
| 13 | `mkdir /app/evil` | **denied** |
| 14 | `touch /app/probe` | **denied** |
| 15 | `rm /app/package.json` | **denied** |
| 16 | `rm /app/dist/main.js` | **denied** |
| 17 | `chmod 777 /app/dist` | **denied** |
| 18 | `chown 1000:1000 /app/dist/main.js` | **denied** |
| 19 | `echo x > /app/dist/x.sh; chmod +x /app/dist/x.sh` | **denied** |
| 20 | `ln -sf /tmp/evilprisma /app/node_modules/.bin/prisma` (symlink swap) | **denied** |

`RESULT: ALL-DENIED`. This is a **superset** of the gate's 7 probes, and it covers the
`unlink`, `chmod`, `chown` and symlink-swap classes the gate does not test. All denied. ✅

### 7.4 Writable paths outside `/app` (documented)

```
ALLOWED (expected, documented): /home/node      (drwxr-sr-x 2755, uid 1000 — base image's own home)
ALLOWED (expected, documented): /tmp            (drwxrwxrwt 1777 — Prisma's schema engine needs it)
ok  STORAGE_DIR writable
```

Both are disclosed in the report §15. Neither contains application files, and nothing in the
application writes to either. `/tmp` at 1777 is a deliberate requirement of Prisma's schema
engine; `/home/node` is inherited from `node:24-alpine` and holds nothing. **Correctly
disclosed, and correctly not "fixed".**

### 7.5 The application still works on the hardened tree

This is the important part — a read-only tree is only a win if the application still runs.

| Requirement | Result |
| --- | --- |
| Container starts in production | ✅ `Nest application successfully started` / `[api] listening on :3000` |
| Liveness | ✅ `200 {"status":"ok","service":"api"}` |
| Readiness (real DB round-trip) | ✅ `200 {"status":"ok","service":"api","database":{"status":"ok"}}` |
| Docker `HEALTHCHECK` | ✅ `healthy` |
| All routes mapped | ✅ full Nest router table emitted with no error |
| Prisma operates | ✅ schema engine (migrate) and query engine (SELECT 1) both functioned |
| Logs / output | ✅ written to stdout; no file writes required |
| SIGTERM | ✅ exit **0** in 239 ms, `OOMKilled=false` (not 143) |
| DB connections released | ✅ `pg_stat_activity` for the database: **0** rows after shutdown (observed from a different database so the observer does not count itself) |

**Conclusion: P20-L-03 is genuinely fixed with no functional cost. The fix is real, not
cosmetic.**

---

## 8. No permission regression (Phase 18 survival)

Driven through the **application's own `StorageService` loaded from `/app/dist`** in the
hardened container, not a shell approximation:

| Assertion | Expected | Observed | Verdict |
| --- | --- | --- | --- |
| Document file mode | `0600` | `600` | ✅ |
| Created subdirectory mode | `0700` | `700` | ✅ |
| Modes are explicit, not umask-derived | — | container umask would give `644`; the service forced `600` | ✅ |
| Subdirectory mode after a second upload | `0700` | `700` (not relaxed) | ✅ |
| Content round-trip | byte-identical | `PHI-content-xyz` returned intact | ✅ |
| SHA-256 `contentHash` | correct | matched an independent `crypto` hash | ✅ |
| Delete removes the object | yes | `exists()` → `false` afterwards | ✅ |

**Path-traversal containment**, same container, six hostile keys through `retrieve()`:

| Key | Result |
| --- | --- |
| `../../../etc/pwned` | denied (`InternalServerErrorException`) |
| `/etc/pwned` (absolute) | denied |
| `a/../../escape` | denied |
| `..` | denied |
| `x/..` | denied |
| `%2e%2e/etc` (unencoded — a literal filename, correctly not a traversal) | denied |

**`STORAGE_DIR` contract enforcement**, all in production mode:

| Case | Result | Verdict |
| --- | --- | --- |
| `STORAGE_DIR` unset | exit 1, `STORAGE_DIR is required when NODE_ENV=production. Document contents are protected health information and must not default to the application directory.` | ✅ |
| `STORAGE_DIR` at `0755` (`--tmpfs …,mode=0755`) | exit 1, `STORAGE_DIR has permissions 0755; documents are protected health information and must not be accessible to group or other users. Restrict it, e.g. chmod 700 <STORAGE_DIR>.` | ✅ |
| `STORAGE_DIR` set to `0700 uid 1000` | starts and serves | ✅ |

**`storageKey` not exposed**: the document serializer
(`document.service.ts:38-41`) destructures `storageKey`/`contentHash`/`sizeBytes` out of every
response. In-container spot check of a protected route without a token returned
`{"error":{"code":"UNAUTHENTICATED",…}}` with no `storageKey` field; the `documents.security.e2e-spec.ts`
suite (part of the 213 passing) asserts it directly. ✅

**No application source can bypass the storage boundary**: `resolveContainment` is the single
choke point, called by `upload`, `retrieve`, `delete` and `exists`
(`storage.service.ts:110,126,134,141`). Every write in the service is
`resolveContainment`-derived, and Phase 21's only file change is the Dockerfile — it cannot
influence this logic. ✅

**Conclusion: no Phase 18 permission regression. The hardening is strictly additive — it
removed write access the storage controls never needed.**

---

## 9. Container gate verification (37 checks)

### 9.1 The count, established two independent ways

**By execution.** I ran the real script against my own `--no-cache` images:

```
$ P20_API_IMAGE=review-api:p21 P20_WEB_IMAGE=review-web:p21 \
    node scripts/verify-docker-images.mjs --skip-build
…
  PASS lines: 35
  FAIL lines: 0
  All container build and runtime checks passed.
GATE_EXIT=0
```

I listed all 35 PASS lines and counted them individually. The `--skip-build` mode omits
exactly the two `${dockerfile} builds` checks (it logs `(--skip-build: using existing
images)` and skips the build loop). **35 + 2 = 37.** ✅

**By static accounting.** I deliberately did not trust the execution count alone:

* `grep -c "await check("` = **33** `await check(` call sites.
* Four of those sites are inside `for` loops with 2 iterations each: line 161 (the build
  loop) and lines 183 / 187 (the API/Web image loop) and line 229 (the non-root-user loop).
* 33 − 4 = 29 unconditional sites, plus 4 sites × 2 iterations = 8, giving
  **29 + 8 = 37**.

Both methods agree. The claim of 37 is **correct**. (`node --check scripts/verify-docker-images.mjs`
also passes, so the file is syntactically valid.)

### 9.2 The check inventory, as actually run

Grouping the 37 executions by purpose, and comparing with the report's §14 table:

| Group | Report claims | Observed | Verdict |
| --- | --- | --- | --- |
| Image construction / inspection | 8 | **10** (2 builds, 2 broken-symlink, 2 secrets/VCS, 1 API-no-test-material, 1 Web-no-source, 2 non-root-user) | ⚠ count differs, see P21-06 |
| Migration (L-01) | 7 | **7** — clean-DB-empty, documented-command-applies, expected-state, re-run-no-op, cli-by-path, entrypoint-form, api-database | ✅ |
| Fail-closed configuration | 4 | **4** — no `STORAGE_DIR`, placeholder JWT, non-postgres `DATABASE_URL`, `0755 STORAGE_DIR` | ✅ |
| Liveness / readiness / HEALTHCHECK | 3 | **3** | ✅ |
| Filesystem (L-03) + storage modes | 4 + 2 = 6 | **6** — no-path-writable, no-tamper-trace, `STORAGE_DIR` writable, 0600/0700 in image | ✅ |
| Web | 5 | **5** | ✅ |
| Shutdown | 4 | **4** | ✅ |
| **Total** | **37** | **37** | ✅ |

### 9.3 Failure conditions actually cause exit 1 — demonstrated, not asserted

The script's own bookkeeping (`failures += 1` → `process.exit(1)` in a `finally` block) is
correct on inspection, and I did not rely on that: §14 shows the gate exiting **1** on five
independent real defects, each of which I injected. **Exit-1 propagation is empirically
confirmed.**

The gate also has a genuinely fail-closed design detail worth crediting: `check()` wraps every
assertion in `try/catch` and `await`s the result, so a rejected HTTP wait is reported as a
`FAIL` rather than surfacing as an unhandled rejection that could let a broken image through.
`docker()` throws on any non-zero exit rather than returning an empty string that a later
`=== ''` assertion might accidentally pass.

---

## 10. Container smoke tests (independent of the gate)

I ran these myself, against my own images, on my own network, ports and database — not via
the gate.

### API

| Test | Result |
| --- | --- |
| Start with valid production configuration | ✅ `[api] listening on :3000` |
| Liveness `GET /api/v1/health` | ✅ `200 {"status":"ok","service":"api"}` |
| Readiness `GET /api/v1/health/ready` | ✅ `200 {"status":"ok","service":"api","database":{"status":"ok"}}` |
| Docker `HEALTHCHECK` | ✅ `healthy` |
| Startup **fails** without `STORAGE_DIR` | ✅ exit 1, message names `STORAGE_DIR` |
| Startup **fails** with placeholder JWT secret | ✅ exit 1, `JWT_ACCESS_SECRET is missing or set to a placeholder value` |
| Startup **fails** with invalid `DATABASE_URL` | ✅ exit 1, `DATABASE_URL must be a postgres:// or postgresql:// connection string` |
| …and the refusal does not echo the value | ✅ I supplied `mysql://leakeduser:leakedpass@somewhere/db`; occurrences of `leakedpass` in the output: **0**; of `somewhere`: **0** |
| Startup **fails** with `0755` `STORAGE_DIR` | ✅ exit 1 |
| SIGTERM graceful shutdown | ✅ exit **0** in 239 ms, `OOMKilled=false` (143 would mean the handler never ran) |
| DB connection cleanup | ✅ 0 remaining `pg_stat_activity` rows for the database |
| Stops serving after shutdown | ✅ connection refused |

### Web

| Test | Result |
| --- | --- |
| `/` | ✅ 200, body contains `Elderly Care Coordination` |
| `/dashboard` | ✅ 200 |
| static hashed asset | ✅ `/_next/static/css/dadbf0da28fc961b.css` → 200 |
| `/health` | ✅ 200, `Status: ok` |
| 404 route | ✅ `/no-such-route-xyz` → 404 |
| clean shutdown | ✅ exit **0** in 192 ms, then connection refused |

### Web → API → PostgreSQL end-to-end

I ran this explicitly rather than inferring it. The web container was configured with
`NEXT_PUBLIC_API_URL=http://p21-rev-api:3000` on the shared Docker network. Its `/health`
page reported `Status: ok` while, at the same moment, the API's own readiness endpoint
reported `database: {status: "ok"}` against a real migrated database. That is the full chain
web → API → Prisma → PostgreSQL, working, exercised over the container network. The health
page also did **not** leak `ECONNREFUSED` or an internal `127.0.0.1:3000` address. ✅

---

## 11. Application regression tests

Run independently against my own fresh database (`p21-review-postgres`, port 13621), which
was migrated from scratch. Not the developer `ecc` database.

| Gate | Report claim | Observed | Baseline match |
| --- | --- | --- | --- |
| API unit | 16 files, **153 passed** | `Test Files 16 passed (16)`, `Tests 153 passed (153)` | ✅ |
| API integration (real PostgreSQL) | 5 files, **60 passed** | `Test Files 5 passed (5)`, `Tests 60 passed (60)` | ✅ |
| API all, with DB | 21 files, **213 passed** | `Test Files 21 passed (21)`, `Tests 213 passed (213)` | ✅ |
| API all, no DB (CI shape) | **109 passed + 104 skipped** (213) | 109 + 104 = **213** — internally consistent | ✅ |
| Mobile | 6 files, **32 passed** | `Test Files 6 passed (6)`, `Tests 32 passed (32)` | ✅ |
| Web | 1 file, **1 passed** | `Test Files 1 passed (1)`, `Tests 1 passed (1)` | ✅ |
| Root `pnpm test` | 11/11 | `Tasks: 11 successful, 11 total` | ✅ |
| Root `pnpm test:integration` | 5/5 | `5 total`, all successful | ✅ |
| Root `pnpm test:all` | 5/5 | `5 total`, all successful | ✅ |

**No count changed. I am reporting no differences because there are none to explain.** Every
figure matches the Phase 20/19 baseline exactly.

The no-DB figure I could only verify by internal consistency (109 + 104 = 213) rather than
by a second run, because the `test:all` run I performed used a live database and therefore
exercised all 213. Given that 109 + 104 = 213 and the with-DB run is 213, the claim is
arithmetically sound; I did not independently re-run the DB-less variant.

---

## 12. Typecheck / build / lint

| Gate | Report claim | Observed | Verdict |
| --- | --- | --- | --- |
| Root `pnpm typecheck` | 11/11 (API main+seed+test, mobile, web) | `11 successful, 11 total`, exit 0 | ✅ |
| Root `pnpm build` | 7/7 | `Tasks: 7 successful, 7 total`, exit 0 | ✅ |
| API `build:verify` | PASSED, 248 files, 0 spec/test in dist | `Build determinism check PASSED`; `no spec/test files in dist (found 0)`; `no src/testing helpers in dist (found 0)`; `dist is not empty (248 files)`; warm-build artifact checks ok | ✅ |
| API lint | **55 errors / 127 warnings** | `✖ 182 problems (55 errors, 127 warnings)` | ✅ unchanged |
| Mobile lint | 0 errors / 18 warnings | `✖ 18 problems (0 errors, 18 warnings)` | ✅ |
| Web lint | clean | `✔ No ESLint warnings or errors` | ✅ |
| `git diff --check` | clean, exit 0 | exit 0, no output | ✅ |
| `node --check scripts/verify-docker-images.mjs` | syntax OK | OK | ✅ |
| `prisma validate` | schema valid | `The schema at prisma/schema.prisma is valid 🚀` | ✅ |
| `pnpm format:check` | already failing before this phase | exit 1, 101 files — all pre-existing Markdown (`SECURITY.md`, `THREAT_MODEL.md`, `ARCHITECTURE.md`, all prior `SECURITY_REVIEW_*.md`, the Phase 18/19 docs) | ✅ see P21-06 |

The API lint baseline is identical to the pre-existing advisory baseline: same error count,
same warning count, nothing suppressed. `apps/api/package.json` sets
`eslint … --max-warnings 0`, so `pnpm --filter @ecc/api lint` exits non-zero — that is the
pre-existing state and is unchanged by Phase 21. No new lint debt was introduced.

---

## 13. Security regression audit (Phase 16–20)

Every control was re-verified. Where I could, I verified it **behaviourally in the hardened
production container**, not by reading source.

### Verified behaviourally, in the running container

| Control | Probe | Result |
| --- | --- | --- |
| HS256 algorithm pinning | forged **HS384** token signed with the *correct* secret, `sub` present | ✅ `401 Access token invalid or expired.` — the algorithm is pinned, so a same-secret HS384 token is rejected |
| `alg=none` rejection | unsigned `{"alg":"none"}` token with a valid-looking body | ✅ `401` |
| Mandatory JWT `sub` | HS256 token signed with the correct secret but **no `sub`** | ✅ `401 Access token invalid or expired.` |
| Unauthenticated access denied | `GET /api/v1/notifications` with no token | ✅ `401 UNAUTHENTICATED` |
| Production rate limiting | 12 rapid `POST /auth/login` | ✅ `400 ×10` then `403 403` — the limiter is live in `NODE_ENV=production` and cuts off at 10 attempts in the window |
| Production JWT fail-fast | placeholder `change-me-in-production` | ✅ exit 1 |
| `STORAGE_DIR` production requirement | unset | ✅ exit 1 |
| `DATABASE_URL` production requirement | `mysql://…` | ✅ exit 1, no value echoed |
| 0600/0700 storage permissions | real `StorageService` round-trip | ✅ `600` / `700` |
| 0755 `STORAGE_DIR` rejection | `--tmpfs …,mode=0755` | ✅ exit 1 |
| Path traversal containment | 6 hostile keys | ✅ all denied |
| Liveness/readiness separation | liveness 200 with DB up; readiness asserts `SELECT 1` | ✅ genuinely separate — `HealthController.liveness()` takes no dependency, `readiness()` performs a parameterised `$queryRaw` |
| No internal detail on readiness failure | source + behaviour | ✅ the driver error's `detail` is **not** returned; only `{status:"error"}` / 503. Confirmed in `health.controller.ts` and by design of the catch block |
| Request-ID sanitization | `x-request-id` variants | ✅ valid UUID `550e8400-…` **echoed**; `evil<script>alert(1)</script>` **replaced** with a minted UUID; a 200-char value **replaced** — the `^[A-Za-z0-9._:-]{1,64}$` guard works |
| Graceful shutdown | `docker stop` on both containers | ✅ exit 0 (not 143), `OOMKilled=false` |
| Docker runtime hardening | §7 | ✅ root-owned tree, 0555/0444, `USER 1000:1000`, `STORAGE_DIR` the only writable path |

### Verified by source inspection, unchanged, with passing regression suites

| Control | Location | Status |
| --- | --- | --- |
| Refresh rotation | `auth.service.ts` — refresh issues a new token in the same family | unchanged, `auth.service.ts` untouched |
| Refresh reuse detection | `auth.service.ts:192-199` — a revoked/superseded token revokes the whole family and throws `Refresh token reused — family revoked`; `:212-229` also covers the concurrent-request race | unchanged |
| Account lockout | `auth.service.ts:21,105-143` — `MAX_FAILED_LOGINS = 10`; lockout is checked **before** password verification; `lockedUntil` set on the 10th failure; cleared on success and on password reset (`:261`) | unchanged |
| Inactive / deleted account | `auth.service.ts:134,204,279` — `!user.isActive \|\| user.deletedAt !== null` on login, refresh and password change | unchanged |
| Membership `endsAt` enforcement | `emergency.service.ts:96` — `OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }]`, plus `status: 'ACTIVE'` and `deletedAt: null` | unchanged |
| OBSERVER restrictions | `emergency.service.ts:59` — `assertRole(…, ['FAMILY_ADMIN','FAMILY_MEMBER','CAREGIVER','DOCTOR'])`, OBSERVER excluded from creation | unchanged |
| Document authorization | `document.service.ts` — ownership/access-grant checks on read, download, archive | unchanged; `documents.security.e2e-spec.ts` passes |
| `storageKey` stripping | `document.service.ts:38-41` | unchanged |
| Rate-limit opt-out is test-only | `rate-limit.guard.ts` — `isTestBypassActive()` requires `NODE_ENV === 'test'` **AND** `ECC_TEST_DISABLE_RATE_LIMIT === '1'`. The image sets `NODE_ENV=production`, so it is unreachable in the container | unchanged, and I confirmed behaviourally that the limiter fires in the container |
| Prisma dependency hygiene | `prisma validate` passes; engines load; no `src`/`test` in `dist` | unchanged |

**No Phase 16–20 control was weakened, bypassed, or removed. Phase 21's only functional change
is strictly subtractive in permissions. Nothing was modified by me.**

---

## 14. Mutation / failure-detection testing

The critical question for any gate is not "does it print PASS" but "would it print PASS on a
broken image". I built six derivative images and ran the real gate against each.

| # | Mutation | Gate result | Exit | Detected? |
| --- | --- | --- | --- | --- |
| **Control** | shipped `review-api:p21` + `review-web:p21` | **35 PASS, 0 FAIL** | **0** | — |
| **M1** | Phase-20 model restored: `chown -R 1000:1000 /app && chmod -R u+w /app` | **3 FAIL** | **1** | ✅ |
| **M2** | a *single* file made writable: `chown 1000:1000 /app/dist/main.js && chmod 0644` | **2 FAIL** | **1** | ✅ |
| **M3** | migrations deleted: `rm -rf /app/prisma/migrations` | **3 FAIL** | **1** | ✅ |
| **M4** | dangling symlink: `ln -sf /app/node_modules/does-not-exist /app/node_modules/.bin/broken` | **1 FAIL** | **1** | ✅ |
| **M5** | build-time guard defeated: guard kept, `COPY --chown=0:0` → `--chown=1000:1000` | **build fails**, no image produced | **1** | ✅ |
| **M6** | runtime dependency silently broken: `argon2/index.js` replaced with `module.exports={}` | **35 PASS, 0 FAIL** | **0** | ❌ **not detected** |

Detail, from the real output:

**M1** (Phase-20 filesystem model):
```
FAIL  no application path is writable by the runtime user
      WRITABLE:  dist/main.js prisma/schema.prisma node_modules/.bin/prisma
                 node_modules/tampered.js dist/tampered.js package.json dist/main.js-changed
FAIL  the tamper probes left no trace in the running container
      running container diverged from the image: 792a63a692cbb58daa5cde53fb6f0817  /app/dist/main.js
FAIL  Phase 18 0600/0700 storage modes are still enforced in the image
```
Matches the report's mutation A (my derivative kept `/app` itself at `0555`, so
`mkdir /app/tampered` was denied and the list has 7 entries rather than the report's 8 — a
difference in *my mutation*, not in the control; both exit 1).

**M2** (one file):
```
FAIL  no application path is writable by the runtime user
      WRITABLE:  dist/main.js dist/main.js-changed
FAIL  the tamper probes left no trace in the running container
```
This is the sensitivity result that matters: a **single file's mode** is enough to fail the
gate, so the check is not passing because of a coarse aggregate. The `Phase 18 0600/0700`
check correctly still passed, confirming the checks are independent rather than
trip-wired. Matches the report's mutation B.

**M3** (migrations deleted) — 3 FAIL, exit 1. Matches the report's mutation D.

**M4** (dangling symlink):
```
FAIL  API image has no broken symlinks
      /app/node_modules/.bin/broken -> /app/node_modules/does-not-exist
```

**M5** (build-time guard) — the real, full `--no-cache` build of a variant that keeps the
guard and restores `--chown=1000:1000`:
```
#19 0.422 NOT ROOT-OWNED OR GROUP/OTHER-WRITABLE: /app/dist uid=1000 gid=1000 mode=555
     /app/dist/app.module.d.ts uid=1000 gid=1000 mode=444 … (10 paths listed)
#19 ERROR: … did not complete successfully: exit code: 1
ERROR: failed to build: …
```
No image was produced. The guard is live, runs **after** the `COPY` (so it validates what
actually ships, not what was staged), and fails the build. Matches the report's mutation C.

**M6 — the one gap.** Replacing `argon2/index.js` with a valid-but-empty module leaves the
image able to `require()` the module graph, serve liveness and readiness, and pass all 35
checks. I then determined exactly how wide this gap is, because "not detected" is only
meaningful alongside "what *is* detected":

| Realistic native-dependency failure | `require("argon2")` | `.hash()` | Caught by the gate? |
| --- | --- | --- | --- |
| module removed entirely (`rm -rf argon2`) | **throws** `Cannot find module 'argon2'` | n/a | ✅ **yes** — `auth.service.js` does `require("argon2")` at module top level, so the app fails to boot and the liveness check times out |
| native binding missing / wrong-libc prebuild selected (musl `.node` removed) | **throws** `No native build was found for platform=linux arch=x64 … libc=musl node=24.21.0` | n/a | ✅ **yes** — same path: the binding is loaded eagerly, so startup fails |
| JS wrapper present but semantically wrong (M6) | loads | returns garbage | ❌ no |

So the realistic failure modes of a native dependency — the ones that actually occur in
practice (wrong libc prebuild, missing prebuild, module dropped by a bad `pnpm deploy`) — are
all caught, because the dependency is in the startup require graph. The residual gap is
narrow: a module that loads but computes the wrong thing, which no startup probe can detect.
Recorded as **P21-01**, Low, non-blocking.

---

## 15. Findings

### P21-01 — Container gate does not exercise a working authenticated round-trip; a loadable-but-semantically-broken dependency passes all 37 checks

* **Severity:** Low
* **Affected file:** `scripts/verify-docker-images.mjs`
* **Root cause:** The gate proves the API image *starts and serves health*, and separately
  that `migrate deploy` works. It never performs a login, never calls `argon2.hash`/`verify`,
  and never touches a database-backed application route. The startup `require` graph catches
  missing and unloadable native modules, but not a module that loads and returns wrong
  values.
* **Reproduction:**
  ```bash
  printf 'FROM review-api:p21\nUSER 0\nRUN printf "module.exports={};" > /app/node_modules/argon2/index.js\nUSER 1000:1000\n' > mut.Dockerfile
  docker build -f mut.Dockerfile -t review-mut-broken-dep:t21 .
  P20_API_IMAGE=review-mut-broken-dep:t21 P20_WEB_IMAGE=review-web:p21 \
    node scripts/verify-docker-images.mjs --skip-build
  # → 35 PASS, 0 FAIL, exit 0
  ```
  Every password hash and verify in that container would be wrong, and the gate is green.
* **Impact:** Reliability. A green container gate does not by itself prove authentication
  works inside the image. Not a security weakening: the Phase 21 change is subtractive
  (removing write access), and a stubbed module is not an attacker-reachable state in the
  shipped model. This is a **pre-existing Phase 20 gate limitation**, not a Phase 21
  regression, and the Phase 21 report does not claim the gate covers it — its §11 "argon2
  loadable PASS" row is labelled as a manual measurement, which is accurate.
* **Blocks checkpoint:** **No.**
* **Recommended remediation (for a future phase, not now):** add one in-container probe that
  performs a real `argon2.hash` + `argon2.verify` round-trip, and ideally one register +
  login + `GET /auth/me` HTTP round-trip. Both are cheap and would close the class entirely.

### P21-02 — Symlink check detects broken symlinks but not escaping ones

* **Severity:** Low
* **Affected file:** `scripts/verify-docker-images.mjs` (broken-link probe) and
  `apps/api/Dockerfile` (build-time guard, which deliberately `continue`s on symlinks)
* **Root cause:** The broken-link walk flags a symlink whose target does not resolve. A
  symlink that *does* resolve — to somewhere outside `/app` — passes. Symlinks are skipped by
  the build-time ownership guard for the correct reason (a symlink's mode is always `0777` on
  Linux and is ignored), but nothing checks symlink *targets*.
* **Reproduction:** my M4 mutation added both a dangling link and
  `ln -sf ../../../../etc/passwd /app/node_modules/escape`. The gate reported only:
  ```
  FAIL  API image has no broken symlinks
        /app/node_modules/.bin/broken -> /app/node_modules/does-not-exist
  ```
  `/app/node_modules/escape` was not flagged.
* **Impact:** Defence-in-depth completeness only. I independently verified the **shipped
  image has 0 absolute symlinks and 0 symlinks resolving outside `/app`**, so there is no
  current exposure. The realistic risk would be a future dependency shipping an escaping
  link, which would let a `require()` escape the application tree.
* **Blocks checkpoint:** **No.**
* **Recommended remediation:** in the existing tree walk, additionally
  `path.resolve(dirname(link), readlink(link))` and assert the result starts with `/app/`.
  Two lines; reuses the walk that already runs.

### P21-03 — Gate check-count provenance in the Phase 21 report does not reconcile with itself

* **Severity:** Low
* **Affected file:** `docs/PHASE_21_FINAL_REPORT.md` (§ "21 → 37 checks" prose, §F table,
  §14 group table); `docs/PHASE_21_CONTAINER_RUNTIME_HARDENING.md` §10, §12, §14
* **Root cause:** Three figures in the same report disagree about *where the 16 new checks
  came from*, while all agree on the total:
  * prose: "21 → 37 checks. **Nine** new behavioural checks for L-01/L-03, **two** added
    fail-closed checks" = 11 new, but 37 − 21 = 16;
  * the §F "Tests/checks added" table lists **14** new checks;
  * the §14 group table sums correctly to 37, but assigns only **8** to image
    construction/inspection where the script actually executes **10** (2 builds + 2
    broken-symlink + 2 secrets/VCS + 1 API-no-test + 1 Web-no-source + 2 non-root-user).
* **Reproduction:** `grep -c "await check(" scripts/verify-docker-images.mjs` = 33, with four
  sites inside 2-iteration loops (lines 161, 183, 187, 229) ⇒ 29 + 8 = 37 executions.
  Listing the 35 `--skip-build` PASS lines and adding the 2 build checks also gives 37.
  Grouping the 35 as I actually observed them gives 10 + 7 + 4 + 3 + 6 + 5 + 4 = 37.
* **Impact:** Documentation accuracy only. The **operative claims are correct** — the gate has
  37 checks, all 37 pass, exit 0 — which is what I verified by execution and by static
  accounting. Only the "where did they come from" narrative is wrong, and it slightly
  overstates the tidiness of the accounting.
* **Blocks checkpoint:** **No.**
* **Recommended remediation:** correct the prose to "fourteen new checks and one modified
  check" (or state the derivation explicitly), and correct the §14 image-construction row to
  10, letting the migration/fail-closed/other rows absorb the difference so the column still
  sums to 37.

### P21-04 — `/home/node` and `/tmp` remain writable by the runtime user

* **Severity:** Info
* **Root cause / reproduction:** `ls -lnd` shows `/home/node` as `drwxr-sr-x 2755 1000:1000`
  and `/tmp` as `drwxrwxrwt 1777`; both accept writes from UID 1000 (verified).
* **Impact:** None identified. `/home/node` is the base image's own home and contains no
  application files; nothing in the application writes there. `/tmp` at 1777 is a hard
  requirement of Prisma's schema engine. Making `/tmp` non-writable would break migrations.
* **Blocks checkpoint:** **No.** Correctly disclosed in the report §15 rather than silently
  "fixed" into a broken state.

### P21-05 — `.dockerignore` still ships `.claude/` in the build context (pre-existing P20-L-02)

* **Severity:** Info
* **Affected file:** `.dockerignore`
* **Reproduction:** `tar -cf - .dockerignore .claude | tar -tf -` lists
  `.claude/settings.local.json`, and `.dockerignore` has no `.claude` entry, so the file is
  still transferred to the build daemon. Neither `COPY` in either Dockerfile references the
  repository root generically, and I confirmed `/app/.claude` does **not** exist in the API
  image and the web image has no `.claude` either — so nothing leaks into a shipped artifact.
* **Impact:** Local tooling metadata reaches the daemon's build cache; it is not baked into
  an image. Pre-existing and explicitly out of Phase 21 scope.
* **Blocks checkpoint:** **No.**

### P21-06 — `pnpm format:check` remains failing (pre-existing)

* **Severity:** Info
* **Reproduction:** `pnpm format:check` → exit 1, 101 files, all Markdown, including
  `SECURITY.md`, `THREAT_MODEL.md`, `ARCHITECTURE.md`, every prior `SECURITY_REVIEW_*.md`
  and the Phase 18/19 documents — none of which Phase 21 touched.
* **Impact:** None. Verified pre-existing and unchanged.
* **Blocks checkpoint:** **No.** The report's decision *not* to reformat another phase's
  documentation was the right call — reformatting would have buried the Phase 21 diff.

### P21-07 — Reported image sizes differ from observed by 67–78 bytes

* **Severity:** Info
* **Reproduction:** report §11 says API `447 155 442 B`, web `271 662 862 B`. I measured
  API `447 155 520 B` (+78), web `271 662 795 B` (−67), via `docker image inspect .Size`.
* **Root cause:** `.Size` is the sum of layer sizes and includes nondeterministic buildkit
  metadata. The report itself notes this in §15. Layer *content* is identical (8 layers both,
  and the 447 MB magnitude — not the 647 MB regression the chmod placement avoided — is
  confirmed).
* **Impact:** None. Not treated as a discrepancy in substance.
* **Blocks checkpoint:** **No.**

### P21-08 — Pre-existing CI toolchain findings still open

* **Severity:** Info
* **Items:** **P20-M-01** (CI runs Node 20 against `pnpm@11.25.0`, whose engines require
  ≥ 22.13) and **P20-M-02** (`engines.node: >=20.18.0` in the root `package.json` does not
  match pnpm's requirement). Both were left unfixed by instruction and are disclosed in
  report §15.
* **Blocks checkpoint:** **No** — explicitly out of scope.

### P21-09 — P20-L-04 (no web `HEALTHCHECK`) still open

* **Severity:** Info
* **Reproduction:** `docker image inspect review-web:p21` → `Config.Healthcheck` is `null`.
* **Impact:** The web container must be health-gated externally. Pre-existing, disclosed in
  report §15, out of Phase 21 scope.
* **Blocks checkpoint:** **No.**

### Findings explicitly checked and dismissed (false positives)

I want to be explicit about things that looked like findings and are not:

* **"Prisma is not on `PATH`, so the migration command is fragile."** Not a finding. It is
  the *documented, gated* reason the command is path-qualified. The gate asserts both facts
  (`command -v prisma` finds nothing; `.bin/prisma` is `0555` and executable), so a future
  `PATH` or entrypoint change that would silently invalidate the published command fails the
  gate. This is a design strength, not a weakness.
* **"Not setting the image `ENV STORAGE_DIR` makes the container unstartable."** Not a
  finding. It is the Phase 19 hardening: production start is *supposed* to fail without an
  explicit `STORAGE_DIR`, because documents are PHI and must not default inside the
  application directory. Verified as an intentional, correct fail-closed behaviour.
* **"An operator bind-mounting a host directory will not be `1000:1000`."** Not a finding
  against Phase 21. The gate's use of a Docker *volume* instead of a host `mkdtemp` is a
  deliberate fix for a real uid-portability defect (a GitHub runner is uid 1001, where a
  `0700` host directory is unusable by the container's uid 1000), and the script asserts the
  provisioned mode is exactly `node:node 700` before using it. The report discloses the
  residual limitation (a real `-v /host/dir` deployment is only covered by the human
  procedure) rather than hiding it.
* **"8330 application files being `0444` root-owned is over-strict."** Not a finding. The
  runtime needs read and execute only. The guard's insistence on root ownership is stricter
  than the runtime minimum, which the report states as intentional.

---

## 16. Severity summary

| Severity | Count | Finding IDs |
| --- | --- | --- |
| **Critical** | **0** | — |
| **High** | **0** | — |
| **Medium** | **0** | — |
| **Low** | **3** | P21-01, P21-02, P21-03 |
| **Info** | **6** | P21-04, P21-05, P21-06, P21-07, P21-08, P21-09 |

*(P21-04 … P21-09 are six Info entries; the table above is the authoritative count.)*

**Blocking findings: none.** No Critical, High or Medium finding. No finding blocks the
Phase 21 checkpoint.

---

## 17. Phase 22 contamination assessment

I scanned the Phase 21 change set (5 files) for every prohibited workstream.

| Workstream | Present? | Evidence |
| --- | --- | --- |
| WebSockets / realtime | **No** | no matches in the Phase 21 diff or files |
| Push notifications | **No** | no matches |
| SMS / email providers | **No** | no matches |
| AI / LLM | **No** | no matches |
| OCR | **No** | no matches |
| EHR integration | **No** | no matches |
| GPS / location | **No** | no matches |
| Payments / subscriptions | **No** | no matches |
| Dashboards / mobile feature work | **No** | no `apps/web/src` or `apps/mobile` file has a post-Phase-20 mtime |
| Redis rate-limit replacement | **No** | `rate-limit.guard.ts` is an in-memory `Map`, unchanged by Phase 21 |
| MinIO / S3 implementation | **No** | no matches |
| Kubernetes / Helm / Terraform | **No** | no manifests added; no such files in the repo |
| AWS / cloud deployment | **No** | no references beyond the exclusion list |
| Backups | **No** | no references beyond the exclusion list |
| Metrics / tracing / structured logging | **No** | no references beyond the exclusion list |
| Prisma schema / migration feature work | **No** | `prisma/schema.prisma` and `prisma/migrations/` have no post-Phase-20 mtime; the migrations shipped in the image are the same 2 as before; `prisma validate` passes |

The keyword hits I did find (`websocket`, `redis`, `minio`, `kubernetes`, `terraform`, `s3`,
`ocr`, `ehr`, `payments`, `backup`, `tracing`, …) appear in exactly two places: the
report's own "**Not implemented in Phase 21**" exclusion lists
(`PHASE_21_CONTAINER_RUNTIME_HARDENING.md:553-561`, `PHASE_21_FINAL_REPORT.md:556-561`) and
nowhere else. I confirmed each hit's surrounding context individually.

**Phase 22 contamination: NONE.** Phase 21 is confined to `apps/api/Dockerfile`,
`scripts/verify-docker-images.mjs` and three documentation files. It contains no
application source, no schema change, no dependency change, and no new infrastructure. **I did
not start any Phase 22 work.**

---

## 18. Limitations of this review

Honest scoping of what I could and could not establish:

1. **No CI execution.** The `containers` job in `.github/workflows/ci.yml:208-222` has never
   run on GitHub Actions and I have no remote runner. I confirmed the job invokes
   `node scripts/verify-docker-images.mjs` by path, so the new checks *will* run in CI without
   a workflow change, but the hosted-run result is unverified. The implementer reported this
   limitation too; I confirm it rather than contradicting it.
2. **Single platform.** `linux/amd64` only. No `arm64` build. `argon2` ships a
   `linux-arm64` prebuild and Prisma ships `linux-arm64-openssl-*` engines, so arm64 is
   plausible, but it is unbuilt and unverified.
3. **Host bind-mount not exercised.** The gate (and I) used Docker volumes for `STORAGE_DIR`.
   A real `docker run -v /host/dir:/app/storage` deployment is covered only by the documented
   human procedure, not by an automated check.
4. **No authenticated end-to-end journey through the web UI.** I proved web → API →
   PostgreSQL liveness/readiness. I did not drive a browser login through the dashboards.
5. **No SCA / SBOM / CVE scan.** I verified the images contain no secrets, no VCS metadata, no
   keys and no test material, and that the dependency tree is self-contained. I did **not**
   run a vulnerability scanner against the shipped dependency versions, so this review makes
   no statement about known CVEs in the image.
6. **The `p20-verify-secret` / `p21-review-secret` values in the gate and my harness are
   throwaway literals for disposable containers.** They are not credentials for anything real.
   I confirmed the gate's own output contains none of them (0 occurrences).
7. **The `--no-cache` builds were run sequentially, not concurrently.** The report discloses
   that a concurrent pair failed once with npm-registry timeouts and attributes it to network
   contention. I did not attempt to reproduce that concurrency failure, so I neither confirm
   nor dispute the attribution — I simply did not hit it.
8. **Storage-fixture uid independence.** Like the implementer, I provisioned `STORAGE_DIR` as a
   Docker volume at `1000:1000 0700`. I did not test a host directory owned by a different uid.
9. **`docker image inspect .Size` is a sum of layer sizes** and includes buildkit overhead, so
   the 67–78 byte deltas in P21-07 are not meaningfully comparable to a different build
   machine's figure.
10. **The `109 passed + 104 skipped` no-DB figure** was verified by arithmetic consistency
    (109 + 104 = 213) rather than by a separate DB-less run.

### Cleanup performed

Everything I created has been destroyed:

* Containers `p21-review-postgres`, `p21-rev-pg2`, `p21-rev-api`, `p21-rev-api2`,
  `p21-rev-web` — all removed (`docker ps -a` shows no review containers).
* Networks `p21-rev-net`, `p20-verify-net` — removed.
* Volumes `p21-rev-storage`, `p20-verify-storage` — removed.
* Images `review-api:p21`, `review-web:p21` and all ten `review-mut-*` derivatives — removed
  (`docker images | grep review-` → none). Phase 20's `ecc-api:p20-verify` /
  `ecc-web:p20-verify` were left intact, as they are not my scratch state.
* `/tmp/opencode/p21/` including the mutated-Dockerfile scratch tree — removed except for
  the logs cited in this report.
* The developer database `ecc` was never touched; verified before and after.
* No application, configuration, Docker or documentation file was modified. The only file I
  created is `SECURITY_REVIEW_PHASE_21.md`.
* No commit, no push, no reset, no rebase, no amend. HEAD is `d0cd0dd` and the index is empty.

---

## 19. Verdict

Phase 21 did what it claimed to do, and it did it correctly.

I built the images from scratch with `--no-cache`, ran real containers against a database I
created and proved was empty, reproduced both the original defects and their fixes, and
attempted the failure cases myself rather than reading about them. Every substantive claim in
the implementation report held up:

* The Prisma migration command works exactly as published, is idempotent, applies to a
  literally-empty database, leaks no credentials, and the broken bare form is documented as
  unsupported everywhere it appears.
* The API image is genuinely root-owned and read-only to the runtime user. Twenty independent
  write attempts as UID 1000 across `dist/`, `package.json`, `prisma/` (including a forged
  migration), `node_modules/` and `/app` itself were all denied — while the application
  still starts, Prisma still operates, and `STORAGE_DIR` remains the one writable path.
* Phase 18's `0600`/`0700` storage controls, traversal containment and `STORAGE_DIR`
  fail-closed rules all survive, verified by driving the application's own `StorageService`
  inside the hardened image.
* The gate has 37 real, behavioural checks; all pass; and it exits non-zero on five of the six
  defects I injected, including the subtle one (a single writable file).
* Every application regression figure matches the Phase 20/19 baseline exactly.
* Phase 16–20 controls are intact, several re-proved behaviourally inside the running
  container, including HS256 pinning (a same-secret HS384 token is rejected) and production
  rate limiting (cuts off at 10 attempts).
* Exactly five files changed. No Phase 22 contamination. Git integrity intact.

The three Low findings are gate-coverage and documentation-accuracy observations, not defects
in either control Phase 21 set out to fix, and neither introduces a regression. None of them
blocks the checkpoint. I recommend addressing P21-01 and P21-02 opportunistically in a future
phase, since both are cheap, and correcting the count arithmetic in P21-03.

---

**APPROVED FOR PHASE 21 CHECKPOINT**
