# PHASE 21 — FINAL REPORT

**Repository:** KinCare-Connect
**HEAD at start and at finish:** `d0cd0dd` — "Complete Phase 17 testing CI and reliability"
**Working tree at start:** Phase 18 + 19 + 20 uncommitted (24 modified, 16 untracked)
**Working tree at finish:** same, plus Phase 21 (3 modified, 2 created)
**Date:** 2026-09-28
**Environment:** Docker 29.8.1, Node v24.18.0, pnpm 11.25.0, linux/amd64

**Verdict: implementation and verification complete. Stopping for independent
review. No commit, no push, no Phase 22 work.**

---

## A. Scope implemented

Exactly the two Phase 21 items requested, both LOW findings from the Phase 20
independent review:

| Finding | Task | Status |
| --- | --- | --- |
| **P20-L-01** | Make the documented Prisma migration procedure actually work and be unambiguous | Done — Dockerfile comment, gate constant, and a Phase 20-doc correction; exact command proven against a real image and a fresh throwaway database |
| **P20-L-03** | Harden API image filesystem permissions where safely possible, without weakening anything from Phases 16–20 | Done — `/app` is root-owned and non-writable by uid 1000; `STORAGE_DIR` still writable; Phase 18 modes still enforced and now verified inside the hardened image |

Nothing else. No application source, no Prisma schema, no migrations, no
auth/authorization code, no entrypoint, no CI job, no dependency change.

**Files touched by Phase 21 — 3 modified, 2 created:**

| File | Change |
| --- | --- |
| `apps/api/Dockerfile` | L-01: corrected migration comment. L-03: `--chown=0:0`, build-stage mode normalisation, post-copy guard, `chmod 0555 /app` |
| `scripts/verify-docker-images.mjs` | 21 → **37** checks; 9 new behavioural checks for L-01/L-03 and 2 extra fail-closed checks |
| `docs/PHASE_20_CONTAINER_BUILD_VERIFICATION.md` | Two clearly-marked "Phase 21 correction" notes + two one-line clarifications, because an operator would look there first |
| `docs/PHASE_21_CONTAINER_RUNTIME_HARDENING.md` | **created** |
| `docs/PHASE_21_FINAL_REPORT.md` | **created** (this file) |

## B. Files created

1. `docs/PHASE_21_CONTAINER_RUNTIME_HARDENING.md` — the 17 required sections:
   scope, L-01 root cause, L-01 remediation, exact working migration command,
   L-01 verification, L-03 root cause, L-03 remediation, filesystem permission
   model, `STORAGE_DIR` behaviour, L-03 verification, Docker build
   verification, runtime smoke tests, security-control regression checks, full
   test matrix, known limitations, out-of-scope items, reproducibility.

2. `docs/PHASE_21_FINAL_REPORT.md` — this file.

No new source file, no new test file, no new script. The regression checks live
in the existing gate, which is the file CI already runs.

## C. Files modified

### `apps/api/Dockerfile`

Four changes, all in the runtime story:

1. **Build stage** — a new `RUN` after the tree is assembled:
   ```dockerfile
   RUN find /app -type f -perm /111 -exec chmod 0555 {} + \
    && find /app -type f ! -perm /111 -exec chmod 0444 {} + \
    && find /app -type d -exec chmod 0555 {} +
   ```
   Placed **before** the `COPY` deliberately. A first attempt put it in the
   runtime stage after the `COPY`; that rewrote every inode, so buildkit stored
   the whole 154 MB tree a second time and the image grew from 447 MB to
   647 MB. Measured, then fixed.

2. **Runtime stage** — `COPY --from=build --chown=1000:1000` → `--chown=0:0`.

3. **Runtime stage** — a guard `RUN` that re-walks the *shipped* tree and
   fails the build if any path is not root-owned or has a group/other write
   bit, plus `chmod 0555 /app` (`COPY` copies the source directory's
   *contents*, so the destination `/app` kept the mode `WORKDIR` gave it).
   Metadata only: ~4 kB, no duplicated content.

4. **Comment above `CMD`** — L-01: the working migration command, the
   equivalent `--entrypoint node` form, and the exact reason the bare form
   fails.

Unchanged: the `ENTRYPOINT` (inherited, and the cause of L-01 — not touched,
see D), `USER 1000:1000`, `CMD`, `EXPOSE`, `HEALTHCHECK`, `STORAGE_DIR`
left unset, `node:24-alpine`, `openssl`, the broken-symlink assertion, the
`@ecc/*` removal, `pnpm deploy --legacy --prod`.

`apps/web/Dockerfile`, `apps/web/next.config.mjs`, `.dockerignore` and
`.github/workflows/ci.yml` are **unmodified by Phase 21** (their working-tree
changes are Phase 20's and were left exactly as they were; the CI job invokes
the gate by path, so the new checks run without a workflow change).

### `scripts/verify-docker-images.mjs`

21 → 37 checks. Nine new behavioural checks for L-01/L-03, two added
fail-closed checks, and one fixture change (F). Full detail in E/F.

### `docs/PHASE_20_CONTAINER_BUILD_VERIFICATION.md`

Additive corrections only; no Phase 20 content was removed or reworded:

- §5: two blockquoted "Phase 21 correction" notes (the migration command must
  be path-qualified; the runtime tree is no longer owned by the runtime user).
- §5: "copy `/app` owned by 1000:1000" → "root-owned since Phase 21 … see the
  correction note".
- §11 table row: the migration check now names the actual invocation.
- §15 limitation: records that the gate's `STORAGE_DIR` fixture is now a
  volume, not a host temp directory, and why.

## D. L-01 remediation

**Root cause.** `node:*-alpine` ships
`ENTRYPOINT ["docker-entrypoint.sh"]`, which rewrites an `argv[0]` it cannot
resolve to `node "$@"`. `prisma` is not on `PATH` in this image, so
`docker run <image> prisma migrate deploy` silently became
`node prisma migrate deploy`; `/app/prisma` is the migration *directory*, so
Node failed with `Error: Cannot find module '/app/prisma'` (exit 1).

Reproduced on the Phase 20 image before any change — including the argv
rewrite itself:

```
$ docker run --rm … ecc-api:p21-baseline prisma migrate deploy
Error: Cannot find module '/app/prisma'   code: 'MODULE_NOT_FOUND'   exit 1
$ docker run --rm --entrypoint sh ecc-api:p21-baseline -c 'command -v prisma'   # → nothing
$ docker run --rm --entrypoint sh ecc-api:p21-baseline -c 'ls -ln node_modules/.bin'
-rwxr-xr-x 1 1000 1000 1934 prisma
```

**This is a documentation defect, not an application-runtime defect and not a
broken image.** The CLI, schema and migrations were all present and working.

**Fix — the smallest safe correction.** Document the path-qualified command
wherever an operator would look, and make the gate execute that exact published
string so the three cannot drift. The entrypoint was deliberately **not**
changed: rewriting it would alter startup semantics for every command, which
is a far larger change than a one-line operator instruction, and the task
explicitly said not to change it blindly. Nothing in the image changed for
L-01 — only the three places that state the procedure.

**The exact working command:**

```bash
docker run --rm -e DATABASE_URL="$DATABASE_URL" \
  <image> node_modules/.bin/prisma migrate deploy
```

Equivalent, bypassing the argv rewrite entirely (also verified):

```bash
docker run --rm --entrypoint node -e DATABASE_URL="$DATABASE_URL" \
  <image> node_modules/prisma/build/index.js migrate deploy
```

**Must not be used:** `docker run <image> prisma migrate deploy`. This is
documented explicitly, including why.

The gate additionally asserts the *cause* (`command -v prisma` finds nothing;
`node_modules/.bin/prisma` is executable), so a future `PATH` or entrypoint
change that would silently invalidate the published command fails CI.

## E. L-03 remediation

**Root cause.** `COPY --from=build --chown=1000:1000` made uid 1000 the
*owner* of all 8330 files, and the build tools' default modes give the owner
write. Measured on the Phase 20 image before any change:

| | Phase 20 |
| --- | --- |
| `/app/dist` | `drwxr-xr-x 1000:1000` |
| `/app/dist/main.js` | `-rw-r--r-- 1000:1000` |
| Files writable by the owner | **8330** |
| `echo x >> /app/dist/main.js` as uid 1000 | **succeeded** |

`/app` itself was already root-owned (because `WORKDIR` creates it before the
`COPY` applies), so a directory-level probe would have passed vacuously while
the contents were fully writable. The check in F therefore probes files, not
directories.

**Investigation before changing anything.** A repository-wide search of
`apps/api/src` for `writeFileSync|mkdirSync|appendFileSync|createWriteStream|rmSync`
returns **three** hits, all in `storage.service.ts` (lines 47, 113, 115), all
resolving under `STORAGE_DIR`. Prisma's schema/query engines only read the
schema and migrations and use `/tmp`. So nothing in the application needs to
write into `/app` — the hardening costs nothing.

**Fix:** `--chown=0:0` + a uniform mode model + a build-time guard. `chmod -R
everything read-only` was **not** done and `chmod -R go-w` was explicitly
avoided (BusyBox `chmod` has no `-h`, so a recursive chmod dereferences
symlinks; 418 relative symlinks live under `/app` and one pointing outside
would have let the chmod escape the tree). Modes are set by `find` passes
that never follow symlinks, classifying each file by its **original** execute
bit so `.bin/prisma` and the native engines keep their `+x`.

**Resulting model (measured on the shipped image):**

| Class | Mode | Owner |
| --- | --- | --- |
| every directory (1106) | `0555` | `root:root` |
| non-executable files | `0444` | `root:root` |
| executable files | `0555` | `root:root` |
| `STORAGE_DIR` | `0700` | operator-provisioned, uid 1000 |
| `/tmp` | `1777` | root — still needed by Prisma's schema engine |

| Whole-tree metric | Value |
| --- | --- |
| Regular files | 8330 |
| Directories | 1106 |
| Symlinks (all relative, all resolving inside `/app`) | 418 |
| Paths not root-owned | **0** |
| Group/other-writable paths | **0** |
| Directories not 0555 | **0** |
| Executable files not 0555 | **0** |
| Non-executable files not 0444 | **0** |

Note on the 418 symlinks: on Linux a symlink's mode is always `0777` and is
ignored, so `find /app -perm /022` reports 418 "writable" symlinks in the old
*and* new image. The guard skips them deliberately. This is stated in the
Dockerfile and the documentation so a later auditor is not misled.

**`STORAGE_DIR` behaviour is unchanged and still enforced:** still not set in
the image; production start still refused without it; still no `chown` and no
init wrapper, so the Phase 18 check governs the mount; the mount must be
uid 1000 and `0700`. A `STORAGE_DIR` inside the image that is not a mount is
now correctly unusable (Phase 18's intent, not a regression).

**Not done deliberately:** `--read-only` on the whole container. It would be
an orchestrator-level `readOnlyRootFilesystem` plus explicit `/tmp` mounts —
larger than a narrow phase, and it changes how the container is *run*. The
image-level model delivers the same anti-tampering property without it.

## F. Tests/checks added

All in `scripts/verify-docker-images.mjs`, all behavioural, all against real
containers. No placeholder assertions; every check asserts a concrete value
(HTTP status, exact JSON, file mode, md5, exit code, SQL count, or a specific
error-message substring). No application test was added, because no
application code changed.

| # | New check | Proves |
| --- | --- | --- |
| 1 | `a clean database really is empty before migrating` | 0 tables in `information_schema.tables` before migrating — "clean database" is literal |
| 2 | `the documented migration command applies every migration to a clean database` | the **published** `MIGRATION_COMMAND` string works, exit 0, `All migrations have been successfully applied` |
| 3 | `the migrated database is at the expected migration state` | finished-migration count equals the `migration.sql` count **found in the image** (not a hard-coded number), 0 rolled back, tables created, and `prisma migrate status` says `Database schema is up to date!` |
| 4 | `re-running the documented migration command is a no-op` | idempotent |
| 5 | `the prisma CLI is reached by path, not by name` | `prisma` is not on `PATH`, `.bin/prisma` is executable — pins *why* the command is path-qualified |
| 6 | `migrations also apply through the documented --entrypoint node form` | the second published form works, on its own clean database |
| 7 | `no application path is writable by the runtime user` | **7 real write attempts as uid 1000 in the live container** — append to `dist/main.js`, append to `prisma/schema.prisma`, append to `node_modules/.bin/prisma`, create `node_modules/tampered.js`, create `dist/tampered.js`, append to `package.json`, `mkdir /app/tampered` — all must fail, and `dist/main.js`'s byte count must be unchanged |
| 8 | `the tamper probes left no trace in the running container` | the live container's `md5sum` of 4 paths equals a fresh container's, and `find /app -name 'tampered*'` is empty — non-persistence, not just "the write returned an error" |
| 9 | `STORAGE_DIR is writable by the runtime user` | as uid 1000 **with `umask 000`** (so success cannot be an umask accident): create dir, write, read back, remove |
| 10 | `Phase 18 0600/0700 storage modes are still enforced in the image` | drives the **application's own** `StorageService` from `/app/dist` — upload → file `0600`, subdirectory `0700`, byte-identical read-back, delete works |
| 11 | `production start is still refused for a group/other-readable STORAGE_DIR` | `--tmpfs …mode=0755` → exit 1 with `STORAGE_DIR has permissions 0755` |
| 12 | `production start is refused with a non-postgres DATABASE_URL` | exit 1, correct message, and the message does **not** echo the supplied value |
| 13 | `the web container also stops cleanly on SIGTERM` | exit 0, not 143, not OOM-killed |
| 14 | `web stops serving after shutdown` | connection refused afterwards |

Modified existing check: `migrations apply from inside the image` → now uses
`MIGRATION_COMMAND` (the published syntax) instead of a private
`--entrypoint node` shortcut.

**Fixture change (F).** `STORAGE_DIR` is now a disposable Docker volume
`chown`ed to `1000:1000` and `chmod` 700 (the script asserts the resulting
mode is exactly `node:node 700` before use), instead of a host `mkdtemp`
directory. A host directory at `0700` is usable by the container's uid 1000
only when the *invoking* user happens to be uid 1000; a GitHub runner is
uid 1001, so the Phase 20 fixture would have made the new writability check
report a fixture problem as an image problem. This is a change to the test
harness only — no image, no application, no operator contract.

### Proof the new checks are not vacuous

| Mutation | Gate result | Exit |
| --- | --- | --- |
| **A** — derivative restoring the Phase 20 model (`chown -R 1000:1000 /app && chmod -R u+w /app`) | FAIL ×3: `no application path is writable…` (`WRITABLE: dist/main.js prisma/schema.prisma node_modules/.bin/prisma node_modules/tampered.js dist/tampered.js package.json mkdir:/app/tampered dist/main.js-changed`), `the tamper probes left no trace…`, and `Phase 18 0600/0700…` (collateral: the appended text corrupted `package.json`, so `require` raised `ERR_INVALID_PACKAGE_CONFIG` — a genuine consequence, reported after the root-cause check) | **1** |
| **B** — a *single* file made writable (`chown 1000:1000 /app/dist/main.js && chmod 0644`) | FAIL ×2: `no application path is writable…` (`WRITABLE: dist/main.js dist/main.js-changed`), `the tamper probes left no trace…`; the storage check correctly still passes | **1** |
| **C** — build-time guard: a variant keeping the guard but restoring `--chown=1000:1000` | build **fails**: `NOT ROOT-OWNED OR GROUP/OTHER-WRITABLE: /app/dist uid=1000 gid=1000 mode=555 …` | **1** |
| **D** — derivative with `rm -rf /app/prisma/migrations` | FAIL ×3: `the documented migration command applies every migration to a clean database`, `the migrated database is at the expected migration state`, `migrations also apply through the documented --entrypoint node form` | **1** |
| Control (shipped images) | 37/37 PASS | **0** |

Mutation B is the one that matters for sensitivity: changing a **single** file's
mode is enough to fail the gate, so the check is not passing because of some
coarse aggregate.

## G. Exact Docker verification results

Both images built `--no-cache` from a clean context:

| Image | Base | Result | Time | Size | Layers | `User` |
| --- | --- | --- | --- | --- | --- | --- |
| `apps/api/Dockerfile` | `node:24-alpine` (Node 24.21.0) | **exit 0** | 5 m 45 s | 447 155 442 B (427 MB) | 8 | `1000:1000` |
| `apps/web/Dockerfile` | `node:24-alpine` | **exit 0** | 1 m 36 s | 271 662 862 B (259 MB) | 8 | `1000:1000` |

> One environment note, reported rather than hidden: an earlier attempt to run
> both `--no-cache` builds **concurrently** failed the web build with
> `TimeoutError: The operation was aborted due to timeout` after npm registry
> fetches took 72–196 s (curl error 23, repeated retries). That is registry
> network contention from running two heavy builds at once, not a Dockerfile
> defect; the web `--no-cache` build re-run on its own succeeded (exit 0,
> 1 m 36 s), and it also built cleanly inside the full gate twice.

The API image gained **one 4 kB metadata-only layer** versus Phase 20's 7; no
file content is duplicated. The gate's own images (built with cache) measured
447 154 537 B for the API and 271 662 799 B for the web.

**API image checks:**

| Check | Result |
| --- | --- |
| Builds clean, `--no-cache` | PASS |
| No broken symlinks | PASS (418 symlinks, 0 broken) |
| Production dependencies self-contained | PASS |
| Prisma client + engine | PASS — `libquery_engine-linux-musl-openssl-3.0.x.so.node`, `schema-engine-linux-musl-openssl-3.0.x`, `binaryTarget linux-musl-openssl-3.0.x`; Prisma CLI 5.22.0 / client 5.22.0 |
| argon2 loadable | PASS (musl prebuild) |
| No `.env` / `.git` / `*.pem` / `*.key` | PASS (0) |
| No test or source material | PASS (`/app` = `dist node_modules package.json prisma`) |
| Runtime user effective | PASS — `uid=1000(node) gid=1000(node)` |
| Ownership/modes as intended | PASS (table in E) |
| Application files not writable by uid 1000 | PASS |
| `STORAGE_DIR` writable | PASS |
| Application starts | PASS |
| Liveness | `200 {"status":"ok","service":"api"}` |
| Readiness | `200 {"status":"ok","service":"api","database":{"status":"ok"}}` |
| Docker `HEALTHCHECK` | `healthy` |
| SIGTERM | exit **0** in ~0.2 s, `OOMKilled=false` (not 143) |
| Stops serving afterwards | connection refused |
| Fail closed: missing `STORAGE_DIR` | exit 1, `STORAGE_DIR is required when NODE_ENV=production` |
| Fail closed: placeholder JWT secret | exit 1, `JWT_ACCESS_SECRET is missing or set to a placeholder value` |
| Fail closed: non-postgres `DATABASE_URL` | exit 1, `DATABASE_URL must be a postgres:// or postgresql:// connection string`; value not echoed |
| Fail closed: 0755 `STORAGE_DIR` | exit 1, `STORAGE_DIR has permissions 0755 …` |
| Phase 18 0600/0700 in the image | `file=600 dir=700 roundtrip=ok` |
| Documented migration command | PASS (H) |

**Web image checks:** builds clean `--no-cache`; no broken symlinks;
standalone output serves; `1000:1000`; `/` → 200 with expected content;
`/dashboard` → 200; `/_next/static/css/dadbf0da28fc961b.css` → 200; `/health`
against the live API → 200 `Status: ok` with no internal address leaked;
unknown route → 404; SIGTERM → exit 0, then connection refused. `HEALTHCHECK`
is still **absent** — pre-existing (P20-L-04), not in Phase 21's scope.

**Web → API → PostgreSQL:** `/health` reported `ok` while the API's own
readiness response reported `database: ok`, so the full path is live.

**Phase 20 gate regression:** `node scripts/verify-docker-images.mjs` —
**37 PASS, 0 FAIL, exit 0** (21 PASS in Phase 20). Re-run against the two
`--no-cache` images with `--skip-build`: 35 PASS, 0 FAIL, exit 0 (35 = 37 −
the 2 build checks). No secret appears anywhere in the gate's output: 0
occurrences of the database password, 0 of the JWT secret.

## H. Migration verification

Fresh, throwaway infrastructure: a dedicated `postgres:16-alpine` container
(`p21-mig-postgres`) on its own Docker network, with database `p21_fresh`
created after the container started. **The developer `ecc` database was never
connected to, migrated or modified** — verified before and after: `ecc-postgres`
still contains only `ecc`, `postgres`, `template0`, `template1`.

Freshness proved first, not assumed:

```
select count(*) from information_schema.tables where table_schema='public'  →  0
```

**1–3. The exact documented command, from a clean database, exits 0:**

```
$ docker run --rm --network p21-mig-net \
    -e DATABASE_URL='postgresql://…@p21-mig-postgres:5432/p21_fresh' \
    ecc-api:p21 node_modules/.bin/prisma migrate deploy

Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "p21_fresh"

2 migrations found in prisma/migrations
Applying migration `20260904042815_init`
Applying migration `20260915000000_phase13_emergency_alerts`
All migrations have been successfully applied.
exit=0
```

**4. The database is left at the expected migration state:**

| Assertion | Observed |
| --- | --- |
| Migrations shipped in the image | 2 |
| `_prisma_migrations` with `finished_at` | 2 |
| `_prisma_migrations` with `rolled_back_at` | 0 |
| Public tables created | 37 |
| `prisma migrate status` | `Database schema is up to date!` |
| Re-run of the same command | `No pending migrations to apply.` (exit 0) |
| `--entrypoint node … index.js migrate deploy`, second clean DB | `All migrations have been successfully applied.` |
| `docker run <image> prisma migrate deploy` (bare) | `Cannot find module '/app/prisma'` — documented as unsupported |

All of this is now a permanent check in the gate (checks 1–6 in F) and
therefore runs in CI.

## I. Filesystem verification

Not a `chmod`-column inspection. Actual write attempts as uid 1000 in the
**live** API container, from `scripts/verify-docker-images.mjs`:

**Protected application/runtime files** — 7 attempts, all denied:

| Attempt (as uid 1000) | Result |
| --- | --- |
| `echo tampered >> /app/dist/main.js` | denied |
| `echo tampered >> /app/prisma/schema.prisma` | denied |
| `echo tampered >> /app/node_modules/.bin/prisma` | denied |
| `echo tampered > /app/node_modules/tampered.js` | denied |
| `echo tampered > /app/dist/tampered.js` | denied |
| `echo tampered >> /app/package.json` | denied |
| `mkdir /app/tampered` | denied |
| `dist/main.js` byte count before vs. after | unchanged |

→ `uid=1000 denied every write under /app`

**Non-persistence:** the live container's `md5sum` of `/app/dist/main.js`,
`/app/package.json`, `/app/prisma/schema.prisma`,
`/app/node_modules/.bin/prisma` equals a fresh container's;
`find /app -name 'tampered*'` returns nothing. → `md5 of 4 paths unchanged, no
tampered* files`

**Required writable `STORAGE_DIR`** — as uid 1000 with `umask 000`:

```
mkdir -p $STORAGE_DIR/writable && printf probe > $STORAGE_DIR/writable/probe
test "$(cat …)" = probe
→ wrote and read back under /app/storage as uid 1000
```

**Phase 18 modes still enforced in the hardened image** — the application's own
`StorageService` from `/app/dist/storage/storage.service.js`:
`file=600 dir=700 roundtrip=ok`

**Fail-closed on a loose mode** — `--tmpfs /app/storage:rw,mode=0755` → exit 1.

**Static corroboration** (secondary, not the proof): 0 non-root-owned paths,
0 group/other-writable paths, 0 directories not 0555, 0 executable files not
0555, 0 non-executable files not 0444.

**Effective sensitivity:** mutations A, B and C in F each fail the gate; a
single-file mutation is enough.

## J. Application test results

Run against a dedicated `postgres:16-alpine` container (`p21-testpg`,
database `ecc_p21_test`, published on `127.0.0.1:13599`). The developer `ecc`
database was never used. No application test was added or modified in Phase
21.

| Suite | Result | Phase 19/20 baseline |
| --- | --- | --- |
| API unit (`vitest.config.unit.ts`) | 16 files, **153 passed** | 153 ✓ |
| API integration (`vitest.config.e2e.ts`, real PostgreSQL) | 5 files, **60 passed** | 60 ✓ |
| API all, with DB (`test:all`) | 21 files, **213 passed** | 213 ✓ |
| API all, no `DATABASE_URL` (CI shape) | 10 files / 11 skipped; **109 passed, 104 skipped** (213) | 109 + 104 ✓ |
| Mobile | 6 files, **32 passed** | 32 ✓ |
| Web | 1 file, **1 passed** | 1 ✓ |
| Root `pnpm test` | **11/11** | ✓ |
| Root `pnpm test:integration` | **5/5** | ✓ |
| Root `pnpm test:all` | **5/5** | ✓ |

## K. Typecheck / build / lint results

| Gate | Result |
| --- | --- |
| Root `pnpm typecheck` | **11/11** (API main + seed + test projects, mobile, web) |
| Root `pnpm build` | **7/7** |
| API `build:verify` (clean + warm + stale tsbuildinfo) | **PASSED** — "every build emitted the production artifacts"; 248 files in `dist`, 0 spec/test files, 0 `src/testing` helpers |
| Web production build (`next build`) | PASS |
| API lint | **55 errors / 127 warnings** — identical to the pre-existing advisory baseline. Nothing suppressed, hidden or `--max-warnings`-adjusted. The command still exits 1, as it did before. |
| Mobile lint | 0 errors / 18 warnings — baseline |
| Web lint | clean |
| `git diff --check` | **clean, exit 0** |
| Prisma schema validation | `The schema at prisma/schema.prisma is valid` |
| `node --check scripts/verify-docker-images.mjs` | syntax OK |

Not a regression and not fixed here, reported honestly:
`pnpm format:check` was **already failing before this phase** —
`docs/PHASE_18_…md` and `docs/PHASE_19_…md`, both untouched here, already fail
Prettier's Markdown formatting. The repository's glob
(`**/*.{ts,tsx,js,jsx,json,md,yml,yaml}`) does not cover `.mjs`, so
`scripts/verify-docker-images.mjs` is outside it. No reformatting was done,
because reformatting another phase's documentation would bury the Phase 21
changes in noise.

## L. Security regression verification

No Phase 16–20 control was modified. Phase 21 changed no application source
(confirmed: no file under `apps/*/src`, `packages/*/src` or `apps/*/config`
has a post-checkpoint mtime; only `.turbo` build logs moved). Controls were
re-verified, several **behaviourally inside the running container**:

| Control | Verified | How |
| --- | --- | --- |
| HS256 pinning | ✓ | `auth.guard.ts:36` `algorithms: ['HS256']` |
| Mandatory JWT `sub` | ✓ | `auth.guard.ts:34-39`; app serves only with a valid token |
| Production JWT fail-fast | ✓ | **container**: exit 1, no default secret |
| Refresh-token rotation / reuse detection | ✓ | `auth.service.ts` unchanged; unit + HTTP integration suites pass |
| Account lockout | ✓ | `auth.service.ts` unchanged; `H7/A7` and HTTP lockout tests pass |
| Inactive/deleted account checks | ✓ | `auth.service.ts` unchanged; suite passes |
| Membership `endsAt` enforcement | ✓ | `emergency.service.ts:96` unchanged |
| OBSERVER restrictions | ✓ | `emergency.service.ts:59`; emergency security e2e passes |
| Document authorization | ✓ | `document.service.ts` unchanged; `documents.security.e2e-spec.ts` passes |
| `storageKey` stripping | ✓ | `document.service.ts` unchanged; suite passes |
| 0600/0700 storage permissions | ✓ | **container**: `file=600 dir=700 roundtrip=ok`; unit spec + in-image check |
| `STORAGE_DIR` production requirement | ✓ | **container**: exit 1 |
| Storage path traversal containment | ✓ | `storage.service.ts:87-99` unchanged; unit spec passes |
| Request-ID sanitization | ✓ | `request-id.middleware.ts` unchanged; dedicated spec passes |
| Production rate-limit behaviour | ✓ | `rate-limit.guard.ts:60` — the opt-out requires `NODE_ENV=test` **and** `ECC_TEST_DISABLE_RATE_LIMIT=1`; the image sets `NODE_ENV=production`, so it is unreachable |
| Liveness/readiness separation | ✓ | **container**: liveness does not consult the database, readiness does |
| Graceful shutdown | ✓ | **container**: SIGTERM → exit 0 for **both** images, pool drained |

The L-03 change is a **tightening**: it removed write access the Phase 18
storage modes never needed. It relaxed nothing, and the Phase 18 storage
enforcement is now verified *inside* the hardened image — which is a stronger
position than before, since previously nothing in the image could have written
to `/app` and so a storage-mode regression would have been masked by a
permission error rather than reported.

## M. Known limitations

1. **The `containers` CI job has still never run on GitHub Actions.** It was
   validated end to end locally; this environment has no remote runner. The
   hosted-run result is **unverified** and is not claimed.
2. **The gate's `STORAGE_DIR` fixture is a Docker volume, not a real host bind
   mount.** Chosen for uid-independence (see F). A real
   `docker run -v /host/dir:/app/storage` deployment is exercised by the manual
   procedure in the documentation, not by CI.
3. **Single platform verified: linux/amd64.** arm64 was not built.
4. **`/home/node` is still owned by uid 1000** (base image). It holds no
   application files and nothing writes there, but it is outside the hardened
   surface.
5. **`/tmp` is still `1777`**, which Prisma's schema engine requires. A
   fully read-only container is possible but is an orchestrator-level change
   (`--read-only` plus explicit mounts) and out of scope.
6. **The build guard is stricter than the minimum**: a `0444` file owned by
   uid 1000 is technically non-writable but is still rejected. Intentional —
   the documented model is root ownership.
7. **P20-L-02** (`.dockerignore` does not exclude `.claude/`) and **P20-L-04**
   (no web `HEALTHCHECK`) were **not** addressed; out of scope.
8. **P20-M-01 / P20-M-02** (CI `node-version: 20` vs pnpm 11.25 requiring
   Node ≥ 22.13; root `engines.node: ">=20.18.0"` vs the pinned package
   manager) remain unfixed, by instruction.
9. **`pnpm format:check` was already failing** before this phase; see K.
10. **The documented migration command is not the idiomatic one.** It is
    required because `prisma` is absent from `PATH`. If a future phase adds a
    `prisma` shim to the image, the published command should be updated in the
    same change — and gate check 5 will fail until it is.
11. **One no-cache build failed on registry network timeouts** when two builds
    ran concurrently (see G). Not reproducible on its own; documented rather
    than hidden.
12. **`docker history` shows the guard layer as ~4 kB, but
    `docker image inspect .Size` sums layer sizes**, so a small block-layer
    overhead is included in the 447 MB figure. No file content is duplicated.

## N. Out-of-scope confirmation

Not implemented: Kubernetes, Helm, Terraform, AWS or any cloud deployment,
infrastructure provisioning, Docker Compose application deployment, registry
publishing, image signing, SBOM or vulnerability scanning, TLS termination,
autoscaling, Redis-backed rate limiting, MinIO/S3, backup automation, metrics,
tracing, structured logging, WebSockets/realtime, push notifications,
SMS/email providers, AI/LLM, OCR, EHR, GPS, payments/subscriptions, new
dashboards, mobile features, authentication redesign, authorization redesign,
Prisma schema changes, database migration creation, Node/pnpm version changes,
dependency upgrades.

Untouched files, confirmed: `PROJECT_PLAN.md` (already modified before this
phase began — a pre-existing user change; not edited here),
`PROJECT_PLAN-old.md`, `SECURITY_REVIEW_PHASE_16..20.md`, `docker-compose.yml`,
`apps/web/Dockerfile`, `apps/web/next.config.mjs`, `.dockerignore`,
`.github/workflows/ci.yml`, every `apps/*/src/**` file, every spec file.

The only Dockerfile modified is `apps/api/Dockerfile`. The only script modified
is `scripts/verify-docker-images.mjs`. No placeholder test was added; no
lint/typecheck/build failure was suppressed.

## O. Git status

```
 M .dockerignore
 M .env.example
 M .github/workflows/ci.yml
 M PROJECT_PLAN.md
 M apps/api/.env.example
 M apps/api/Dockerfile
 M apps/api/package.json
 M apps/api/src/auth/guards/rate-limit.guard.spec.ts
 M apps/api/src/auth/guards/rate-limit.guard.ts
 M apps/api/src/common/middleware/request-id.middleware.ts
 M apps/api/src/main.ts
 M apps/api/src/modules/documents/services/document.service.ts
 M apps/api/src/modules/emergency/services/emergency.service.ts
 M apps/api/src/modules/health/health.controller.spec.ts
 M apps/api/src/modules/health/health.controller.ts
 M apps/api/src/storage/storage.service.ts
 M apps/api/src/testing/setup-env.ts
 M apps/api/test/documents.security.e2e-spec.ts
 M apps/api/test/emergency.security.e2e-spec.ts
 M apps/api/tsconfig.build.json
 M apps/mobile/.env.example
 M apps/web/Dockerfile
 M apps/web/next.config.mjs
 M apps/web/src/app/health/page.tsx
?? PROJECT_PLAN-old.md
?? SECURITY_REVIEW_PHASE_16.md
?? SECURITY_REVIEW_PHASE_17.md
?? SECURITY_REVIEW_PHASE_18.md
?? SECURITY_REVIEW_PHASE_19.md
?? SECURITY_REVIEW_PHASE_20.md
?? apps/api/scripts/
?? apps/api/src/common/middleware/request-id.middleware.spec.ts
?? apps/api/src/config/build-config.spec.ts
?? apps/api/src/config/runtime-config.spec.ts
?? apps/api/src/config/runtime-config.ts
?? apps/api/src/storage/storage.service.spec.ts
?? apps/web/public/
?? docs/PHASE_18_PRODUCTION_HARDENING.md
?? docs/PHASE_19_DEPLOYMENT_OPERATIONAL_READINESS.md
?? docs/PHASE_20_CONTAINER_BUILD_VERIFICATION.md
?? docs/PHASE_21_CONTAINER_RUNTIME_HARDENING.md
?? scripts/
```

Identical to the pre-Phase-21 status except that
`docs/PHASE_21_CONTAINER_RUNTIME_HARDENING.md` and this report are new.
**The dirty tree is intentional** — Phases 18–20 were uncommitted at the start
and nothing was reverted.

`git diff --stat` (Phase 20 baseline → Phase 21 finish): 24 files,
2273 insertions / 429 deletions. Phase 20's baseline was 2215 / 429, so the
tracked delta is +58 lines, all in `apps/api/Dockerfile` (comments, `find`
passes, guard). `scripts/` and `docs/PHASE_21_*.md` are untracked and do not
appear in `git diff --stat`.

## P. Commit status

**No commit created. No push performed. No existing commit modified, amended,
reset, rebased or force-pushed. Nothing was staged.** `git diff --check` is
clean (exit 0), so the working tree is ready to be committed by a human
reviewer if they choose to.

## Q. Phase 22 confirmation

**Phase 22 was not started.** No Phase 22 file, branch, script, test or
configuration was created. This phase is limited to P20-L-01 and P20-L-03 plus
their regression checks, the re-verification of the Phase 20 gate, and
documentation.

---

## Final statement

- **Phase 21 complete.**
- **Independent review required** — `SECURITY_REVIEW_PHASE_21.md` has not been
  written and is the reviewer's to produce.
- **No Phase 22 started.**
- **No commit created.**
- **No push performed.**
