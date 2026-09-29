# Phase 21 — Container runtime hardening

**Scope:** two LOW findings from the independent Phase 20 review —
P20-L-01 (the documented Prisma migration command does not work as written)
and P20-L-03 (API image application files are writable by the runtime user).

**Status:** implementation and verification complete locally. Independent
review required. No commit, no push, no Phase 22 work.

---

## 1. Scope

In scope, and nothing else:

1. Correct the operator-facing Prisma migration procedure so the published
   command actually works and is unambiguous.
2. Harden the API image's filesystem permissions so application/runtime files
   are not writable by uid 1000, while `STORAGE_DIR` remains writable.
3. Add behavioural regression checks for both.
4. Rebuild both images and re-run the Phase 20 gate plus the application
   test/typecheck/build/lint suites.

Out of scope is listed in §16. No application source, Prisma schema,
migration, auth or authorization code was touched; §3 and §7 show exactly
which three files changed.

---

## 2. L-01 root cause

Phase 20 shipped the Prisma CLI, schema and migrations inside the runtime
image and documented the step as `prisma migrate deploy`. The capability was
real; the *invocation* was wrong.

`node:*-alpine` ships `/usr/local/bin/docker-entrypoint.sh` as the image
`ENTRYPOINT`:

```sh
if [ "${1#-}" != "${1}" ] || [ -z "$(command -v "${1}")" ] || { [ -f "${1}" ] && ! [ -x "${1}" ]; }; then
  set -- node "$@"
fi
exec "$@"
```

`prisma` is not on `PATH` in this image, so `command -v prisma` is empty and
the first condition fires. Any `docker run <image> prisma …` is therefore
silently rewritten to `node prisma …`.

`/app/prisma` is the **migration directory**, not a program, so Node resolves
the argument as a module path and fails.

Reproduced against the Phase 20 image before any change
(`ecc-api:p21-baseline`):

```
$ docker run --rm -e DATABASE_URL=… ecc-api:p21-baseline prisma migrate deploy
Error: Cannot find module '/app/prisma'
  code: 'MODULE_NOT_FOUND'
exit 1

$ docker run --rm --entrypoint sh ecc-api:p21-baseline -c \
    'set -- prisma migrate deploy; if [ "${1#-}" != "${1}" ] || [ -z "$(command -v "${1}")" ]; then set -- node "$@"; fi; echo $1'
node            # ← argv rewritten

$ docker run --rm --entrypoint sh ecc-api:p21-baseline -c 'command -v prisma'
NOT ON PATH

$ docker run --rm --entrypoint sh ecc-api:p21-baseline -c 'ls -ln node_modules/.bin'
-rwxr-xr-x 1 1000 1000 1934 prisma
```

So this was a documentation defect, not an application-runtime defect and not
a broken image. The image is `ENTRYPOINT`-inheriting by design, and Phase 21
deliberately did **not** change the entrypoint: rewriting it would alter
startup semantics for every command and is a much larger change than the
defect warrants.

## 3. L-01 remediation

The published procedure now states the path-qualified invocation and explains
why. Three places, so the command cannot drift:

| Location | Change |
| --- | --- |
| `apps/api/Dockerfile` (comment above `CMD`) | States the working command, the equivalent `--entrypoint node` form, and the exact reason the bare form fails (`Cannot find module '/app/prisma'`) |
| `scripts/verify-docker-images.mjs` | `MIGRATION_COMMAND` is a single constant used by every migration check, so the gate runs the *published* syntax rather than a private shortcut |
| `docs/PHASE_20_CONTAINER_BUILD_VERIFICATION.md` | Two clearly-marked "Phase 21 correction" notes, because that document is where an operator would look first (§5 and §11) |

`scripts/verify-env-contract.mjs` and the CI workflow needed no change: they do
not reference the migration command.

## 4. Exact working migration command

```bash
docker run --rm \
  -e DATABASE_URL="$DATABASE_URL" \
  <image> \
  node_modules/.bin/prisma migrate deploy
```

Equivalent form, bypassing the argv rewrite entirely (also verified):

```bash
docker run --rm \
  --entrypoint node \
  -e DATABASE_URL="$DATABASE_URL" \
  <image> \
  node_modules/prisma/build/index.js migrate deploy
```

**Do not use** `docker run <image> prisma migrate deploy`. It is *not* broken
by accident — `prisma` is deliberately absent from `PATH` — and it will fail
with `Error: Cannot find module '/app/prisma'`.

This syntax is required, not incidental: the gate now asserts
`command -v prisma` finds nothing and that
`node_modules/.bin/prisma` is executable, so a future `PATH` or entrypoint
change that would silently invalidate the published command fails the gate.

## 5. L-01 verification

Against a **fresh, throwaway** PostgreSQL (a dedicated `postgres:16-alpine`
container on its own Docker network, database `p21_fresh` created after the
container started; the developer `ecc` database was never connected to).

**Freshness proved first** — the target database had 0 tables in
`information_schema.tables` before migrating.

Exact documented command, from a clean database:

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

Resulting state:

| Assertion | Observed |
| --- | --- |
| Migrations in image | 2 (`find /app/prisma/migrations -name migration.sql`) |
| `_prisma_migrations` rows with `finished_at` | 2 |
| `_prisma_migrations` rows with `rolled_back_at` | 0 |
| Public tables created | 37 |
| `prisma migrate status` | `Database schema is up to date!` |
| Second run of the same command | `No pending migrations to apply.` (exit 0) |
| `--entrypoint node … index.js migrate deploy` on a second clean DB | `All migrations have been successfully applied.` |
| Bare `prisma migrate deploy` | still `Cannot find module '/app/prisma'` (documented as unsupported) |

Prisma CLI in the image: **5.22.0**, `binaryTarget linux-musl-openssl-3.0.x`.

These same five checks are now part of `scripts/verify-docker-images.mjs` and
run in CI (see §11 and §14).

---

## 6. L-03 root cause

Phase 20 copied the runtime tree with `COPY --from=build --chown=1000:1000`.
That made uid 1000 the *owner* of every file, and the build tools' default
modes (`0644` files, `0755` directories) give the owner write. So the tree
looked read-only in an `ls` of a wrong-owner root, but was fully writable by
exactly the user the process runs as.

Measured on the Phase 20 image before any change:

| Path / count | Phase 20 |
| --- | --- |
| `/app/dist` | `drwxr-xr-x 1000:1000` |
| `/app/dist/main.js` | `-rw-r--r-- 1000:1000` |
| `/app/package.json` | `-rw-r--r-- 1000:1000` |
| `/app/prisma` | `drwxr-xr-x 1000:1000` |
| Files writable by the owner | **8330** |
| Append to `/app/dist/main.js` as uid 1000 | **succeeded** |

(`/app` itself was already root-owned, because `WORKDIR` creates it before the
`COPY` applies. That is why a naive `touch /app/probe` probe *failed* on the
Phase 20 image while `>> /app/dist/main.js` succeeded — the top directory was
protected but everything under it was not. A check that only probed the
directory would have passed vacuously.)

Impact is post-exploitation self-tampering and in-container persistence:
`dist/`, `package.json`, `prisma/schema.prisma`, `prisma/migrations/*` and
`node_modules/**` are all attacker-writable for the life of the container.
Bounded (the container is ephemeral, the host is unaffected), which is why the
reviewer rated it LOW — but it is pure defence-in-depth with no upside.

## 7. L-03 remediation

The application was checked first to establish that nothing needs to write
into `/app`. A repository-wide search of `apps/api/src` for
`writeFileSync|mkdirSync|appendFileSync|createWriteStream|rmSync` returns
**three** hits, all in `storage.service.ts` (lines 47, 113, 115), and all of
them resolve under `STORAGE_DIR`. Prisma's schema and query engines only
*read* the schema and migrations and write their temporary files under
`/tmp`. So a read-only `/app` costs nothing.

Change (`apps/api/Dockerfile` only):

1. `COPY --from=build --chown=0:0 /app ./` — root-owned instead of
   runtime-user-owned.
2. The mode normalisation (`find` + `chmod`) moved into the **build** stage,
   immediately after the runtime tree is assembled. It was first written in the
   runtime stage; that rewrote every inode *after* the `COPY`, so buildkit
   stored the whole 154 MB tree a second time and the image grew from
   447 MB to 647 MB. Doing it before the copy achieves the same result with a
   single copy.
3. A guard `RUN` after the `COPY` re-walks the shipped tree and fails the
   build if any path is not root-owned or has a group/other write bit. It only
   reads (plus `chmod 0555 /app`, metadata only), so it adds ~4 kB to the
   image, not another copy.

No entrypoint, user, `CMD`, `HEALTHCHECK`, `STORAGE_DIR` requirement or
fail-closed rule was changed.

## 8. Filesystem permission model

Measured on the shipped image (`ecc-api:p20-verify`, 447 154 537 bytes,
8 layers, `User=1000:1000`):

| Path | Mode | Owner |
| --- | --- | --- |
| `/app` | `dr-xr-xr-x` (0555) | `0:0` |
| `/app/dist` | `dr-xr-xr-x` (0555) | `0:0` |
| `/app/node_modules` | `dr-xr-xr-x` (0555) | `0:0` |
| `/app/prisma` | `dr-xr-xr-x` (0555) | `0:0` |
| `/app/package.json` | `-r--r--r--` (0444) | `0:0` |
| `/app/dist/main.js` | `-r--r--r--` (0444) | `0:0` |
| `/app/prisma/schema.prisma` | `-r--r--r--` (0444) | `0:0` |
| `/app/node_modules/.bin/prisma` | `-r-xr-xr-x` (0555) | `0:0` |
| `/tmp` | `drwxrwxrwt` (1777) | `0:0` — still world-writable for Prisma's schema engine |
| `/home/node` | `drwxr-xr-x` (2755) | `1000:1000` — base image's own home, not application files |

Whole-tree counts:

| Metric | Value |
| --- | --- |
| Regular files | 8330 |
| Directories | 1106 |
| Symlinks (all relative, all resolving inside `/app`) | 418 |
| Paths **not** root-owned (symlinks excluded) | **0** |
| Group/other-writable paths (symlinks excluded) | **0** |
| Directories not 0555 | **0** |
| Executable files not 0555 | **0** |
| Non-executable files not 0444 | **0** |

The mode model is uniform: directories `0555`, non-executable files `0444`,
executable files `0555`, all `root:root`. Files are classified by their
*original* execute bit, so `node_modules/.bin/prisma` and the native
`libquery_engine-linux-musl-openssl-3.0.x.so.node` / `schema-engine-*`
binaries keep the +x they need while sources become `0444`.

Symlinks are deliberately skipped. On Linux a symlink's mode is always `0777`
and is ignored, so `find -perm /022` reports 418 "writable" symlinks in both
the old and the new image; the guard skips them for that reason, and a
recursive `chmod` was avoided because it would dereference them.

**Not** done deliberately: `--read-only` on the whole container was not
introduced. It would be a larger operational change (an orchestrator-level
`readOnlyRootFilesystem` plus explicit `emptyDir` mounts for `/tmp`) and is
outside a narrow phase. The image-level ownership/mode model delivers the
same protection against in-container tampering without changing how the
container is run.

## 9. STORAGE_DIR behaviour

Unchanged in intent, unchanged in enforcement:

- `STORAGE_DIR` is still deliberately **not** set in the image, and production
  start is still **refused** without it (Phase 18).
- The path is expected to be an operator-provisioned mount, not a directory
  inside `/app`. With `/app` at `0555 root:root`, a `STORAGE_DIR` inside the
  image that is *not* a mount is correctly unusable — which is the intended
  outcome for protected health information.
- The volume must be owned by uid 1000 and mode `0700`; the image still does
  no `chown` and no init wrapper, so the Phase 18 check governs the mount.
- Phase 18's enforcement is unchanged and now verified *inside* the hardened
  image (see §10).

One change in the **verification script only** (not the images): STORAGE_DIR
is now a disposable Docker volume chowned to `1000:1000` and `chmod` 700
rather than a host `mkdtemp` directory. A host directory at `0700` is usable
by the container's uid 1000 only when the *invoking* user happens to be uid
1000; a GitHub runner is uid 1001, so the Phase 20 fixture would have made the
new writability check report a fixture problem as an image problem. The
script asserts the provisioned mode is exactly `node:node 700` before using
it, which also documents the contract an operator must satisfy.

## 10. L-03 verification

Behavioural, not `chmod`-column inspection. All of these run as uid 1000 in
the **live** API container, and all are permanent checks in
`scripts/verify-docker-images.mjs`.

**Protected application/runtime files** — seven real write attempts, every one
of which must fail:

| Attempt | Result |
| --- | --- |
| `echo tampered >> /app/dist/main.js` | denied |
| `echo tampered >> /app/prisma/schema.prisma` | denied |
| `echo tampered >> /app/node_modules/.bin/prisma` | denied |
| `echo tampered > /app/node_modules/tampered.js` | denied |
| `echo tampered > /app/dist/tampered.js` | denied |
| `echo tampered >> /app/package.json` | denied |
| `mkdir /app/tampered` | denied |
| `dist/main.js` byte count before vs. after | unchanged |

`uid=1000 denied every write under /app`

**Non-persistence** — the running container's `md5sum` of
`/app/dist/main.js`, `/app/package.json`, `/app/prisma/schema.prisma` and
`/app/node_modules/.bin/prisma` must equal a fresh container's, and
`find /app -name 'tampered*'` must return nothing.

**Required writable path** — as uid 1000, with `umask 000` so success cannot
be an accident of the umask:

```
mkdir -p $STORAGE_DIR/writable && printf probe > $STORAGE_DIR/writable/probe
test "$(cat …)" = probe
→ wrote and read back under /app/storage as uid 1000
```

**Phase 18 storage modes still enforced in the hardened image** — this drives
the *application's own* `StorageService` from `/app/dist`, not a shell
approximation, so it proves the read-only `/app` did not force the storage
hardening to be relaxed:

```
file=600 dir=700 roundtrip=ok
```

(upload → mode 0600; created subdirectory → 0700; read back byte-identical;
delete removes it.)

**Fail-closed storage mode** — a `--tmpfs /app/storage:rw,mode=0755` mount
must still be refused in production:

```
exit 1 … STORAGE_DIR has permissions 0755; documents are protected health
information and must not be accessible to group or other users.
```

### The checks are not vacuous — mutation evidence

| Mutation | Gate outcome | Exit |
| --- | --- | --- |
| **A** — derivative restoring the Phase 20 model (`chown -R 1000:1000 /app && chmod -R u+w /app`) | FAIL `no application path is writable by the runtime user` (`WRITABLE: dist/main.js prisma/schema.prisma node_modules/.bin/prisma node_modules/tampered.js dist/tampered.js package.json mkdir:/app/tampered dist/main.js-changed`), FAIL `the tamper probes left no trace`, FAIL `Phase 18 0600/0700 storage modes` (collateral: the appended text corrupted `package.json`, so `require` raised `ERR_INVALID_PACKAGE_CONFIG`) | **1** |
| **B** — a *single* file made writable (`chown 1000:1000 /app/dist/main.js && chmod 0644`) | FAIL `no application path is writable…` (`WRITABLE: dist/main.js dist/main.js-changed`) and FAIL `the tamper probes left no trace`; the storage check correctly still passes | **1** |
| **C** — build-time guard exercised by building a variant that keeps the guard but restores `--chown=1000:1000` | build **fails**: `NOT ROOT-OWNED OR GROUP/OTHER-WRITABLE: /app/dist uid=1000 gid=1000 mode=555 …` | **1** |
| **D** — derivative with `rm -rf /app/prisma/migrations` | FAIL `the documented migration command applies every migration to a clean database`, FAIL `the migrated database is at the expected migration state`, FAIL `migrations also apply through the documented --entrypoint node form` | **1** |
| Control | 37/37 PASS | **0** |

Mutation B is the important one for sensitivity: a single file's mode is
enough to fail the gate, so the check is not passing because of some coarse
aggregate.

---

## 11. Docker build verification

Both images built from a clean context, `--no-cache`:

| Image | Result | Time | Size | Layers | `User` |
| --- | --- | --- | --- | --- | --- |
| API (`node:24-alpine`, Node 24.21.0) | exit 0 | 5 m 45 s | 447 155 442 B (427 MB) | 8 | `1000:1000` |
| Web (`node:24-alpine`) | exit 0 | 1 m 36 s | 271 662 862 B (259 MB) | 8 | `1000:1000` |

> One environment note, reported rather than hidden: an earlier attempt to run
> both `--no-cache` builds **concurrently** failed the web build with
> `TimeoutError: The operation was aborted due to timeout` after npm registry
> fetches took 72–196 s (curl error 23, repeated retries). That is registry
> network contention from running two heavy builds at once, not a Dockerfile
> defect; the web `--no-cache` build re-run on its own succeeded, and it also
> built cleanly inside the full gate.

The API image gained one 4 kB metadata-only layer (the guard) versus Phase 20's
7. The base image is `node:24-alpine`, unchanged.

API image:

| Check | Result |
| --- | --- |
| Builds clean (`--no-cache`) | PASS |
| No broken symlinks | PASS (418 symlinks, 0 broken) |
| Production dependencies self-contained | PASS |
| Prisma client + engine | PASS (`libquery_engine-linux-musl-openssl-3.0.x`, `schema-engine-musl-openssl-3.0.x`, `binaryTarget linux-musl-openssl-3.0.x`) |
| argon2 loadable | PASS (musl prebuild) |
| No `.env` / `.git` / `*.pem` / `*.key` | PASS (0) |
| No test or source material | PASS (`/app` = `dist node_modules package.json prisma`) |
| Runtime user effective | PASS (`uid=1000(node) gid=1000(node)`) |
| Ownership/modes as intended | PASS (§8) |
| `STORAGE_DIR` writable | PASS |
| Application files not writable by uid 1000 | PASS (§10) |
| Application starts | PASS |
| Liveness | `200 {"status":"ok","service":"api"}` |
| Readiness | `200 {"status":"ok","service":"api","database":{"status":"ok"}}` |
| Docker `HEALTHCHECK` | `healthy` |
| SIGTERM | exit **0** in ~0.2 s, `OOMKilled=false` (not 143) |
| Database pool released | PASS (`/health/ready` fails afterwards; connection refused) |
| Fail closed: missing `STORAGE_DIR` | exit 1, `STORAGE_DIR is required when NODE_ENV=production` |
| Fail closed: placeholder JWT secret | exit 1, `JWT_ACCESS_SECRET is missing or set to a placeholder value` |
| Fail closed: non-postgres `DATABASE_URL` | exit 1, `DATABASE_URL must be a postgres:// or postgresql:// connection string`, and the message does **not** echo the supplied value |
| Documented migration command | PASS (§5) |
| Phase 18 0600/0700 in the image | PASS (`file=600 dir=700 roundtrip=ok`) |
| Fail closed: 0755 `STORAGE_DIR` | exit 1 |

Web image:

| Check | Result |
| --- | --- |
| Builds clean (`--no-cache`) | PASS |
| No broken symlinks | PASS |
| Standalone output serves | PASS (`apps/web/server.js` present) |
| Runtime user | `1000:1000` |
| `/` | 200 with expected content |
| `/dashboard` | 200 |
| `/_next/static/css/<hash>.css` | 200 |
| `/health` against the live API | 200, `Status: ok`; does not leak an internal address |
| Unknown route | 404 |
| SIGTERM | exit 0, then connection refused |
| `HEALTHCHECK` | still **absent** — pre-existing (P20-L-04), not in Phase 21 scope |

Web → API → PostgreSQL: `/health` reported `ok` while the API's own
readiness response reported `database: ok`, so the full path is live.

## 12. Runtime smoke tests

Every row is a check in `scripts/verify-docker-images.mjs`, executed against
real containers. **37 checks, 37 PASS, exit 0.**

## 13. Existing security-control regression checks

Phase 21 changed no application source. The controls below were re-verified
either in the running container (behavioural) or by source inspection, and
none was modified.

| Control | Verified |
| --- | --- |
| HS256 pinning | `auth.guard.ts:36` `algorithms: ['HS256']` |
| Mandatory JWT `sub` | `auth.guard.ts:34-39` (`{ sub: string; … }`); app serves only with a valid token |
| Production JWT fail-fast | **container-verified**: exit 1, no default secret |
| Refresh-token rotation / reuse detection | `auth.service.ts` unchanged; unit + HTTP integration suites pass |
| Account lockout | `auth.service.ts` unchanged; `H7/A7` and HTTP lockout tests pass |
| Inactive/deleted account checks | `auth.service.ts` unchanged; suite passes |
| Membership `endsAt` enforcement | `emergency.service.ts:96` unchanged |
| OBSERVER restrictions | `emergency.service.ts:59` unchanged; emergency security e2e passes |
| Document authorization | `document.service.ts` unchanged; `documents.security.e2e-spec.ts` passes |
| `storageKey` stripping | `document.service.ts` unchanged; suite passes |
| 0600/0700 storage permissions | **container-verified**: `file=600 dir=700`; unit spec + in-image check |
| `STORAGE_DIR` production requirement | **container-verified**: exit 1 |
| Storage path traversal containment | `storage.service.ts:87-99` unchanged; unit spec passes |
| Request-ID sanitization | `request-id.middleware.ts` unchanged; dedicated spec passes |
| Production rate-limit behaviour | `rate-limit.guard.ts:60` — the opt-out needs `NODE_ENV=test` **and** `ECC_TEST_DISABLE_RATE_LIMIT=1`; the image sets `NODE_ENV=production`, so it is unreachable |
| Liveness/readiness separation | **container-verified**: liveness does not consult the database; readiness does |
| Graceful shutdown | **container-verified**: SIGTERM → exit 0 for both containers |

The L-03 change is a *tightening*: it removed write access that the Phase 18
storage modes never needed. It did not relax a single control, and the
Phase 18 storage enforcement is now verified inside the hardened image.

## 14. Full test matrix

`scripts/verify-docker-images.mjs` went from 21 to **37** checks:

| Group | Phase 20 | Phase 21 |
| --- | --- | --- |
| Image construction / inspection | 8 | 8 |
| Migration (L-01) | 1 | 7 |
| Fail-closed configuration | 2 | 4 |
| API liveness / readiness / healthcheck | 3 | 3 |
| Filesystem (L-03) | 0 | 4 |
| Storage modes in the hardened image | 0 | 2 |
| Web | 5 | 5 |
| Shutdown | 2 | 4 |

Application gates (unchanged from the Phase 19/20 baseline; exact counts):

| Gate | Result |
| --- | --- |
| API unit | 16 files, **153 passed** |
| API integration (real PostgreSQL) | 5 files, **60 passed** |
| API all, with DB | 21 files, **213 passed** |
| API all, no DB (CI shape) | **109 passed, 104 skipped** (213) |
| Mobile tests | 6 files, **32 passed** |
| Web tests | 1 file, **1 passed** |
| Root `pnpm test` | 11/11 |
| Root `pnpm test:integration` | 5/5 |
| Root `pnpm test:all` | 5/5 |
| Root `pnpm typecheck` | 11/11 (API main+seed+test, mobile, web) |
| Root `pnpm build` | 7/7 |
| API `build:verify` | PASSED — "every build emitted the production artifacts", 248 files, 0 spec/test in dist |
| API lint | **55 errors / 127 warnings** — identical to the pre-existing advisory baseline, nothing hidden or suppressed |
| Mobile lint | 0 errors / 18 warnings — baseline |
| Web lint | clean |
| `git diff --check` | clean (exit 0) |
| Container gate | **37/37 PASS, exit 0** |

Database-backed suites ran against a dedicated `postgres:16-alpine` container
(`ecc_p21_test` on `localhost:13599`). The developer `ecc` database was never
connected to, migrated or modified — verified before and after: `ecc-postgres`
still contains only `ecc`, `postgres`, `template0`, `template1`.

## 15. Known limitations

- **The `containers` CI job has still never run on GitHub Actions.** It was
  validated end to end locally; this environment has no remote runner. The
  hosted-run result is unverified, and this report does not claim otherwise.
- **The storage fixture was made uid-independent, not a real host bind
  mount.** A Docker volume is used instead of a host directory so the check
  works on any runner uid. A real `docker run -v /host/dir:/app/storage`
  deployment is therefore exercised only by the human procedure in §17, not
  by the gate.
- **Single platform verified:** linux/amd64. arm64 was not built.
- **In-container home directory is still uid 1000-owned.** `/home/node` comes
  from the base image and is writable by the runtime user. It holds no
  application files and nothing in the application writes there, but it is
  not part of the hardened surface.
- **`/tmp` is still 1777**, which Prisma's schema engine needs. A fully
  read-only container (`--read-only` plus an explicit `/tmp` mount) is
  possible but is an orchestrator-level change, out of scope here.
- **The build guard requires strict root ownership.** A 0444 file owned by
  uid 1000 is technically non-writable but is still rejected by the guard.
  This is intentional: the documented model is root ownership, and it is
  stricter than the minimum the runtime needs.
- **Node 20 vs pnpm 11.25 in CI (P20-M-01) and the `engines` mismatch
  (P20-M-02) remain unfixed** by instruction.
- **P20-L-02** (`.dockerignore` does not exclude `.claude/`) and **P20-L-04**
  (no web `HEALTHCHECK`) were **not** addressed; they are outside this
  phase's scope.
- **`pnpm format:check` was already failing before this phase** and still is:
  `docs/PHASE_18_…md` and `docs/PHASE_19_…md` (both untouched here) already
  fail Prettier's Markdown formatting. The repository's glob does not cover
  `.mjs`, so `scripts/verify-docker-images.mjs` is outside it. No
  reformatting was performed, because reformatting another phase's
  documentation would bury the Phase 21 changes in noise.
- **`docker history` shows the guard layer as ~4 kB**, but image *size* is
  reported by `docker image inspect .Size`, which is the sum of layer sizes;
  a small block-layer overhead is included. No file content is duplicated.

## 16. Out-of-scope items

Not implemented in Phase 21: Kubernetes, Helm, Terraform, AWS or any cloud
deployment, Docker Compose application deployment, registry publishing, image
signing, SBOM or vulnerability scanning, TLS termination, autoscaling,
Redis-backed rate limiting, MinIO/S3 integration, backup automation, metrics,
tracing, structured logging, WebSockets/realtime, push notifications,
SMS/email providers, AI/LLM, OCR, EHR integration, GPS, payments or
subscriptions, new dashboards, mobile features, authentication or
authorization redesign, Prisma schema or migration changes, Node/pnpm version
changes, dependency upgrades.

`PROJECT_PLAN.md`, `PROJECT_PLAN-old.md`, the `SECURITY_REVIEW_PHASE_*.md`
artifacts and `docker-compose.yml` were not modified. `PROJECT_PLAN.md` shows
in `git status` because it was already modified before this phase began
(pre-existing user change, untouched here).

## 17. Reproducibility

Prerequisites: Docker 29.8.1, Node 24.x, `pnpm@11.25.0`.

```bash
# 1. Build both images from a clean context
docker build --no-cache -f apps/api/Dockerfile -t ecc-api:p21 .
docker build --no-cache -f apps/web/Dockerfile -t ecc-web:p21 .

# 2. Run the full behavioural gate (this also builds both images unless
#    --skip-build is passed)
node scripts/verify-docker-images.mjs
echo "exit=$?"          # expected: 37 PASS, exit 0
node scripts/verify-docker-images.mjs --skip-build   # re-run against existing images

# 3. The documented migration procedure, by hand, on a throwaway database
docker network create p21-mig-net
docker run -d --name p21-mig-postgres --network p21-mig-net \
  -e POSTGRES_USER=p21mig -e POSTGRES_PASSWORD=p21-mig-secret \
  -e POSTGRES_DB=p21_fresh postgres:16-alpine
#    wait for pg_isready, then:
docker run --rm --network p21-mig-net \
  -e DATABASE_URL='postgresql://p21mig:p21-mig-secret@p21-mig-postgres:5432/p21_fresh' \
  ecc-api:p21 node_modules/.bin/prisma migrate deploy
#    expect: "All migrations have been successfully applied." and exit 0

# 4. Inspect the permission model
docker run --rm --entrypoint sh ecc-api:p21 -c \
  'ls -lnd /app /app/dist /app/package.json; id; (echo x >> /app/dist/main.js) || echo "denied"'

# 5. Run the API the documented way
docker volume create ecc-storage
docker run --rm --user 0 -v ecc-storage:/mnt/storage ecc-api:p21 \
  chown 1000:1000 /mnt/storage
docker run --rm --user 0 -v ecc-storage:/mnt/storage ecc-api:p21 \
  chmod 700 /mnt/storage
docker run --d --name ecc-api --network p21-mig-net -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL='postgresql://…@p21-mig-postgres:5432/p21_fresh' \
  -e JWT_ACCESS_SECRET='<32+ random characters, not a placeholder>' \
  -e STORAGE_DIR=/app/storage \
  -v ecc-storage:/app/storage \
  ecc-api:p21
curl -s localhost:3000/api/v1/health        # liveness
curl -s localhost:3000/api/v1/health/ready  # readiness
docker stop ecc-api                          # exit 0, clean shutdown

# 6. Application gates
pnpm --filter @ecc/api test
pnpm --filter @ecc/api test:integration   # needs DATABASE_URL
pnpm --filter @ecc/api test:all
pnpm --filter @ecc/mobile test
pnpm --filter @ecc/web test
pnpm typecheck && pnpm build
pnpm --filter @ecc/api build:verify
git diff --check
```

The gate tears down its own containers, network and volume in a `finally()`
block, including on failure. `P20_API_IMAGE` / `P20_WEB_IMAGE` can point the
gate at pre-built images; they are not set in CI.
