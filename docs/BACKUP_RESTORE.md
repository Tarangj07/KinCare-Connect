# Backup and Restore — KinCare-Connect

**Created:** Phase 27 (2026-09-29)
**Corrected:** Phase 28 (2026-09-29) — see §0.
**Corrected:** Phase 29 (2026-09-29) — see §0.1.
**Applies to:** the deployment model this repository actually supports —
one API container, one web container, one PostgreSQL 16 instance, and a
persistent `STORAGE_DIR` volume.

**The database half of this procedure has been executed end-to-end on a
throwaway PostgreSQL instance (Phase 27). The storage half has been executed
on throwaway filesystem fixtures (Phase 28). See §14 for exactly what was
tested and what was not.**

---

## 0. Corrections in Phase 28

Phase 27 wrote the storage half of this document but never executed it.
Reading it against the repository before executing it exposed four defects.
All four are corrected below. Anyone who read the Phase 27 text should treat
those parts as superseded.

| # | Defect in the Phase 27 text | Consequence if followed | Correction |
|---|----------------------------|------------------------|------------|
| D-1 | §4/§5 used `docker compose stop api web`, `docker compose exec -T api`, and `docker compose start api web`. **`docker-compose.yml` defines only `postgres`, `redis`, `minio` and `minio-bootstrap`** — there is no `api` or `web` service, and `docker compose stop api web` fails with `no such service: api`. | The restore procedure's "stop the writers" step could not be executed as written. An operator would have to improvise, at the exact moment they are restoring. | The restore procedure is now **storage-backend and orchestration agnostic**; it is §5, and §5.1 states the requirement ("no writer connected") together with a table of how to satisfy it per deployment style, instead of naming services this repository does not define. |
| D-2 | The storage archive command mounted the **`ecc_postgres_data` volume** and tared `/var/lib/postgresql/data` into a file named `storage-<ts>.tar.gz`. | It archived the raw PostgreSQL data directory and **mislabelled it as the document backup**. A raw `PGDATA` tar is not a document backup and is not a `pg_dump`; a restore of it would be neither. | The storage command now archives `STORAGE_DIR` and nothing else. §4 states explicitly that the two backups are different artifacts. |
| D-3 | The same command ended in `\|\| true`, discarding `tar`'s exit status. | `tar` **still creates the output file when it fails** (measured: exit 2, 20-byte file created). With `\|\| true` the operator saw a file appear and no error, so a failed backup was indistinguishable from a successful one. This is the exact failure mode §13 warns about. | `\|\| true` is removed. The procedure requires a zero exit status, and §7's verification is specified so a vacuous backup is detectable. |
| D-4 | §4 said "`STORAGE_DIR` lives on the host (default `./uploads`)". **No such host path or volume is defined** — `.gitignore` ignores `apps/api/uploads/`, and `docker-compose.yml` declares only `postgres_data`, `redis_data` and `minio_data`. | An operator would look for a volume that does not exist. | The procedure is written against `$STORAGE_DIR` as the operator supplies it, and §4.1 states plainly that **this repository does not provide the storage backend**: durable storage is a deployment responsibility. |

D-3 is worth dwelling on, because it is the most dangerous class of defect in
this document: a backup command that cannot fail visibly. A backup that
silently produced nothing is worse than no backup at all, because it is
believed in.

### 0.1 Phase 29 correction (F-1)

The independent review of Phase 28 recorded a documentation defect in this
file: **§5 did not exist.** The document ran `## 0` … `## 4`, then `## 6`.
Two places pointed at it — the D-1 row above ("§4/§5 used …") and the RTO row
in §9 ("Time to run §5 plus §8") — so an operator computing an RTO, or
reading the D-1 correction, was directed at a section that was not there.

Phase 28 had not deleted the restore procedure; it had dropped it while
rewriting the "stop the writers" step, and the two references outlived it.
The substantive requirement it carried — that writers must be stopped during a
restore — survived only obliquely, inside §6's read-only-window
recommendation, which is about `pg_dump` rather than about a restore.

**§5 is restored** in full: §5.1 stop the writers, §5.2 restore the database
dump, §5.3 restore the storage archive, §5.4 resume and validate. It was
written against `docker-compose.yml` as it actually is, so it names only the
`postgres` service, and it reintroduces none of D-1 through D-4. Both
cross-references now resolve to real sections.

**One numbering inconsistency was deliberately left alone.** §7's only
subsection is numbered `7.3`, with no `7.1` and no `7.2`. That looks like the
same defect, but `docs/PHASE_28_FINAL_REPORT.md` cites "§7.3", and historical
phase reports are not editable. Renumbering it to `7.1` would trade a broken
reference for a different broken reference, in a file Phase 29 is not allowed
to change. It is recorded here instead.

---

## 1. What must be backed up

The system has exactly **two** stateful stores. Anything not in this list is
reconstructible from source and needs no backup.

| Store | What it holds | Why it is irreplaceable |
| ----- | ------------- | ------------------------ |
| **PostgreSQL** | 36 Prisma models: users, organizations, care circles, senior and caregiver profiles, medications and schedules, appointments, care tasks, health measurements and devices, document metadata, conversations and messages, notifications, emergency alerts, audit logs, consent, invitations, subscriptions | The system of record. Includes the audit log and the refresh-token hashes |
| **`STORAGE_DIR`** | Uploaded document blobs, written `0600` inside `0700` directories | File content. PostgreSQL holds only metadata and hashes |

**Not required and not present:** Redis, MinIO/S3, object storage, message
broker. The compose file still defines `redis` and `minio`, but nothing
connects to them. Do **not** include them in a backup plan — backing up an
unused service is misleading, and the documents explicitly discourage
migrating to them.

## 2. PostgreSQL version compatibility

The schema targets **PostgreSQL 16** (`docker-compose.yml` and every CI
service use `postgres:16-alpine`).

- **pg_dump/pg_restore is forward-compatible**: dump with a server at the same
  or newer major version, restore into the same or newer.
- **Never restore a pg_dump 16 archive into PostgreSQL 15 or earlier** —
  it will fail.
- The custom format (`-Fc`) is the only format that supports parallel restore
  and `pg_restore --list`; it is not readable by `psql` alone.

## 3. Backup format

**`pg_dump` custom format (`-Fc`)** — compressed, restorable table-by-table,
inspectable with `pg_restore --list`, and supports `--jobs` for parallel
restore.

Do **not** use plain SQL (`-Fp`) as the primary artifact: it cannot be
restored selectively, and it is slow to load. Plain SQL remains acceptable as
a long-term archival copy because it is version-portable in the other
direction.

## 4. Backup command

**There are two separate artifacts. They are not interchangeable, and one is
not a substitute for the other.**

| Artifact | Contains | Produced by |
| -------- | -------- | ----------- |
| Database dump | Table data, schema, migrations | `pg_dump` |
| Storage archive | Document file bytes | `tar` (or the platform's volume/object-store snapshot) |

Set these once, to the real values in your deployment:

```bash
# How to reach PostgreSQL. In this repository's local Compose setup that is
# `docker compose exec -T postgres …`; in a managed or orchestrated deployment
# it is whatever your platform provides.
PG="docker compose exec -T postgres"

# The document storage root, as the API process sees it.
STORAGE_DIR=/srv/ecc/uploads
```

### 4.1 The storage backend is a deployment responsibility

**This repository does not provide persistent document storage.**
`docker-compose.yml` provisions PostgreSQL, Redis and MinIO for *local
development only*, and it defines **no storage volume** — `postgres_data`,
`redis_data` and `minio_data` are the only volumes it creates. Nothing in the
application connects to Redis or MinIO (§1).

A production deployment must therefore supply durable storage for
`STORAGE_DIR` itself: a mounted volume, a block device, a network filesystem,
or an object-store mount. **Which one you choose determines how you take the
storage backup**, and that choice is outside this repository. The `tar`
command below is correct for a filesystem you can point `tar` at — a volume,
a bind mount, or a path inside a helper container. For a managed block device
or an object store, use the platform's snapshot mechanism *instead*; the
requirements in §7 and §8 are the same either way, because they are stated in
terms of the restored result and not in terms of `tar`.

`STORAGE_DIR` must be mode `0700` and its contents `0600`; the API refuses to
start in production otherwise (`docs/PHASE_22_CI_DEPLOYMENT_RUNBOOK.md` §4).

### 4.2 Database backup

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)

# Logical dump. The custom format (-Fc) is compressed, restorable
# table-by-table, inspectable with `pg_restore --list`, and supports parallel
# restore.
$PG pg_dump -U ecc -d ecc -Fc -f "/tmp/ecc-$TS.dump"

# Move the artifact off the database host, to the backup location.
#   (In this repository's local setup: docker compose cp postgres:/tmp/ecc-$TS.dump ./backups/)
```

### 4.3 Storage backup

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)

# Archive the document storage root. Note:
#   - it archives $STORAGE_DIR and NOTHING else;
#   - the previous revision of this document mounted the PostgreSQL volume
#     here and wrote the result to a file named storage-*.tar.gz. That
#     archived a raw PGDATA directory, not documents (defect D-2);
#   - there is no `|| true`. `tar` creates the output file even when it
#     fails, so the exit status is the ONLY evidence of success and it must
#     be checked (defect D-3).
set -euo pipefail

# NOTE ON FLAG FORM. Always pass the archive with an explicit -f. On the
# machine this procedure was developed and tested on (GNU tar 1.35, gzip
# 1.14), `tar cz ARCHIVE …` and `tar xz ARCHIVE` — the short forms that omit
# -f — do not bind ARCHIVE as the archive operand at all. Measured, 8/8
# reproducible:
#
#     tar xz  backups/storage-….tar.gz -C DIR   -> exit 2, "gzip: stdin:
#                                                   unexpected end of file",
#                                                   nothing extracted
#     tar xzf backups/storage-….tar.gz -C DIR   -> exit 0, extracted
#     tar -xz -f backups/storage-….tar.gz -C DIR -> exit 0, extracted
#
# The first form reads the default archive device instead of the named file,
# so it can produce a *partial* extraction or none at all while appearing to
# be a normal command. The long form `tar -czf` / `tar -xzf` is used
# throughout this document for that reason. This is an observation about one
# host's tooling, not a claim about GNU tar in general — but the safe form
# costs nothing and removes the question.
tar -czf "backups/storage-$TS.tar.gz" -C "$STORAGE_DIR" .

# Fail loudly. Do not proceed on a non-zero status, and do not rotate the
# previous good archive out.
tar -tzf "backups/storage-$TS.tar.gz" > /dev/null
```

> **Note the ordering.** The storage archive must be taken at a moment
> consistent with the database dump. See §6.


## 5. Restore command

The mirror of §4, and the step an RTO is actually made of. Two artifacts are
restored, and the order matters: **the database first, then the storage
archive.** The database must exist and be complete before the application is
pointed at it, or the first query fails on a missing table and the failure
looks like a schema problem rather than a restore that was started wrong.

**Nothing in this section is automated in this repository.** It is a
procedure an operator runs by hand. §12 records that scheduling, rotation,
retention and encryption are not implemented; §10 records that the artifact
still has to be moved off-host by hand.

### 5.1 Stop the writers

This is the step that is easiest to get wrong, and the one the Phase 27 text
got wrong (defect D-1).

`pg_dump` does not need the writers stopped — it takes a transactionally
consistent snapshot (§6). A **restore** is different. Restoring into a
database that is still accepting connections, or extracting into a
`STORAGE_DIR` that is still being written to, produces a result that can pass
every check in §8 and is still wrong.

The requirement is a property, not a command:

> **No process may hold a connection to the database being restored, and no
> process may write to `STORAGE_DIR`, from the start of the restore until the
> end of the validation in §8.**

How you satisfy it depends on how you deployed the API, and this repository
does not define that. `docker-compose.yml` provisions `postgres`, `redis`,
`minio` and `minio-bootstrap` and **nothing else** — there is no `api` and no
`web` service in it, so `docker compose stop api web` fails with
`no such service: api`. The compose file is local development infrastructure;
it is not a description of your deployment.

| How the API is deployed | What "stop the writers" means |
| ----------------------- | ------------------------------ |
| A compose file of your own that defines the API | Stop that service, and stop the web tier if it can write |
| A container orchestrator | Scale the API deployment to zero and wait for the pods to terminate |
| A managed platform | Use the platform's maintenance / read-only mode |
| A VM or bare metal | Stop the API under whatever service manager supervises it |

Whichever you choose, **confirm it took effect** before restoring. A `stop`
command that was accepted but did not drain connections is the failure this
step exists to prevent.

If you cannot stop the writers, do not restore over the live database. Restore
into a **new** database and cut over to it — that is the path §5.2 uses, and
it is the one Phase 27 actually exercised.

### 5.2 Restore the database dump

```bash
# A NEW database, not the live one. `createdb` fails if the name already
# exists, which is the behaviour you want: restoring over the database you are
# restoring TO destroys the only remaining copy if the dump is bad.
docker compose exec -T postgres createdb -U ecc ecc_restored

# --exit-on-error: without it, pg_restore logs errors, continues, and can
# still exit 0 with a partially loaded schema. This is the restore-side
# counterpart of the `|| true` defect in D-3 — a check that cannot fail
# visibly. Do not proceed if this command fails.
docker compose exec -T postgres pg_restore -U ecc -d ecc_restored \
  --exit-on-error /tmp/ecc-<TS>.dump
```

The restore is complete only when `pg_restore` exits zero. The `pg_restore
--list` check in §7 and the readiness check in §8 then decide whether the dump
was *good*, which is a different question.

### 5.3 Restore the storage archive

The archive holds `$STORAGE_DIR` and nothing else (§4.3, defect D-2). It
restores the same way:

```bash
set -euo pipefail

# Restore into an EMPTY directory. Extracting over a populated STORAGE_DIR
# merges two states and leaves the previous backup's blobs visible to the
# application as orphans, which is the "orphaned blob is harmless" case in §6
# arriving in the wrong place.
RESTORE_DIR=/srv/ecc/uploads-restored
mkdir -p "$RESTORE_DIR"

# The long `-xzf` form, for the reason measured and recorded in §4.3: the
# short `xz` form did not bind the archive operand on the host this procedure
# was tested on.
tar -xzf "backups/storage-$TS.tar.gz" -C "$RESTORE_DIR"

# The API refuses to start in production on a STORAGE_DIR that is group- or
# other-accessible (docs/PHASE_22_CI_DEPLOYMENT_RUNBOOK.md §4). The archive
# should have preserved the modes; assert it rather than assume it (§7).
chmod 700 "$RESTORE_DIR"
```

If your storage backend is a managed volume, a block device or an object
store, use the platform's own restore mechanism instead. The requirement is
unchanged: the restored tree must contain the same files, at the same relative
paths, with the same permission bits, and nothing else (§7.3).

### 5.4 Resume the writers, then validate

Point the API at the restored database and the restored `STORAGE_DIR`, and
then follow **§8** exactly, in order. Do not cut over to traffic on the
strength of the restore command having exited zero: §8's checks are what
distinguish a database that loaded from a database that loaded *correctly*,
and the first of them — readiness — is the one that catches a schema that did
not fully load.

If any check in §8 fails, do not serve. Return to §13.


## 6. Handling application writes during backup

This is the property most often assumed and least often true.

- `pg_dump -Fc` takes a **transactionally consistent snapshot**. Rows written
  *during* the dump are either fully in or fully out; the dump is never torn.
- It does **not** block or fail application writes. The application can
  continue serving during the dump.
- The consequence: a document **file** written after the snapshot will have
  metadata in the *next* backup, not this one. If the file archive is taken at
  a different instant from the database dump, a document can be referenced but
  missing (or orphaned).
- **Mitigation for a consistent pair:** either
  (a) put the application in a read-only/maintenance window while both
  captures are taken — the simplest correct answer for this system size, or
  (b) take the `STORAGE_DIR` archive **immediately after** the database dump
  completes, and accept that documents created in that window will be
  re-captured by the next run. A missing blob is a user-visible 404; an
  orphaned blob is harmless and cleaned up on the next archive.
- Neither the API nor the web container must be stopped for a `pg_dump`.

## 7. How integrity is verified

Immediately after taking a backup, **before trusting it**:

```bash
# 1. The archive must be structurally readable.
docker compose exec -T postgres pg_restore --list /tmp/ecc-<ts>.dump | tail -3

# 2. Count the table-data entries. A truncated dump has far fewer.
docker compose exec -T postgres pg_restore --list /tmp/ecc-<ts>.dump \
  | grep -c "TABLE DATA"

# 3. Record a content fingerprint, not just a file size.
docker compose exec -T postgres psql -U ecc -d ecc -tAc \
  "select md5(string_agg(email, '|' order by email)) from users"
```

A file that exists, is non-zero, and passes `--list` is **not** sufficient: a
backup that restores to an empty database passes all three. The content
fingerprint is what distinguishes a good backup from a vacuous one.

### 7.3 Verifying a STORAGE backup

The same principle applies, and the same false-negative applies: an archive
that restores to an empty directory looks exactly like a good one. Size alone
proves nothing — a directory of zero-byte files compresses to almost nothing.

```bash
# 1. The archive must be readable and non-trivial.
tar -tzf backups/storage-<TS>.tar.gz | head

# 2. Count the entries. Compare against the live tree.
find "$STORAGE_DIR" -type f | wc -l
tar -tzf backups/storage-<TS>.tar.gz | grep -vc '/$'

# 3. Content fingerprint, not size. This is the check that catches a
#    truncated or partially written archive.
( cd "$STORAGE_DIR" && find . -type f -print0 | sort -z \
    | xargs -0 sha256sum ) | sha256sum

# 4. Confirm the modes survived. The API refuses to start in production on a
#    0700-less STORAGE_DIR, so a mode-stripped archive is an unusable backup.
tar -tzvf backups/storage-<TS>.tar.gz | head
```

Step 3 is the one that matters. A fingerprint of the live tree, recorded at
backup time and re-derived from the archive after a restore, is what actually
distinguishes a restorable backup from a plausible-looking file.

**This repository can run steps 1–4 for you**, on throwaway data, without
touching any real storage or the developer database:

```bash
node scripts/verify-storage-backup-restore.mjs
```

It creates a representative fixture tree, archives it, destroys it, restores
it, and compares file count, relative paths, SHA-256 digests, sizes and
permission bits — then loads the **real compiled** `StorageService` and
confirms the restored tree is usable and still contained. See §14.2.

## 8. How a restore is validated

A restore is not proven until the **application** has used it. Minimum
sequence:

1. `/api/v1/health/ready` returns 200 with `"database":{"status":"ok"}` —
   proves the schema is complete enough for the app to query.
2. **Log in as a user who existed before the backup.** Proves identity rows,
   password hashes, and the session tables survived.
3. Fetch `/api/v1/auth/me` with the issued token.
4. Confirm a wrong password is still refused (401) — proves the password hash
   was restored as a **hash**, not as plaintext.
5. Read one document and confirm its blob is present in `STORAGE_DIR`.
6. Check the audit log still has its rows.

## 9. RPO / RTO assumptions

**These are engineering estimates, not measured values.** No RPO/RTO has been
tested under load, and no failure drill has been run.

| Quantity | Assumption | Basis |
| -------- | ---------- | ----- |
| Backup duration | Seconds to low tens of seconds at current data volume | Not measured at production volume |
| Restore duration | Minutes at current data volume | Not measured at production volume |
| RPO | **One backup interval** | If backups run nightly, up to 24 h of data can be lost |
| RTO | Time to run §5 (restore: quiesce writers, restore the dump, restore the archive) plus §8 (validate) | Untested |
| Growth | Linear in rows + blob bytes | The dominant term will be documents |

**Before production, backups must run far more often than nightly.** With a
nightly schedule the RPO is 24 hours, which is almost certainly unacceptable
for an emergency-alert system holding health data. A daily full plus
frequent `pg_dump` is the minimum sensible starting point, but the real
schedule is a clinical/operational decision, not an engineering one.

## 10. Storage of backups

- Backups contain **protected health information** in exactly the same sense
  the live database does: user emails, full names, measurement values, and
  document content.
- They must be stored **off-host**. A backup on the same disk as the database
  is not a backup.
- They must have **access control at least as strict as the live database**.
- Retention is a policy decision with a legal dimension; see §13.

## 11. Encryption expectations

**Not implemented in this repository.** `pg_dump` output is **plaintext** and
contains PHI in the clear.

Required before production, at the storage layer (this repository has no
opinion on which):

- Backups at rest encrypted (volume or object-store level).
- Backups in transit encrypted.
- Backup storage access logged and reviewed.

The live database has the same gap: the application does not configure TLS to
PostgreSQL, so a deployment must terminate TLS in front of it or the
connection is plaintext. See `docs/RELEASE_READINESS.md`.

## 12. Retention policy

**No retention policy is implemented.** This is a gap, not a design.

A starting point to put in front of whoever owns the data-protection
decision:

- Daily full, retained 30 days.
- Weekly full, retained 1 year.
- Monthly full, retained per applicable regulation — **this is a legal
  determination, not an engineering one.**
- Restore drills at least quarterly, recorded.

Deleting a backup is a destructive act; automate it explicitly rather than
letting it happen by neglect.

## 13. Failure handling

| Failure | Detection | Response |
| ------- | --------- | -------- |
| `pg_dump` non-zero exit | exit code | **Treat as no backup.** Do not rotate the previous good copy out. Alert. |
| Dump file present but empty / tiny | size + `pg_restore --list` | Same as above |
| Dump structurally valid but restores empty | §7 content fingerprint | The classic silent failure. Fingerprint comparison is the only defence |
| Backup container/volume full | disk monitoring | **Not implemented.** Disk exhaustion is an open gap |
| Restore fails part-way | `pg_restore` exit code | Do **not** start the application. Restore into a fresh database and retry |
| Restore succeeds, app fails readiness | §8 step 1 | Schema incomplete — investigate before serving |
| Restore succeeds, login fails | §8 step 2 | Identity rows missing — the dump is wrong, not the procedure |

**Disk exhaustion is the unmitigated failure mode.** Nothing in this repository
monitors free space on the database volume or on the backup volume, and a full
disk produces a partially-written dump that may still look like a file.

## 14. What was actually tested (Phase 27)

A real backup and restore was executed against a **throwaway** PostgreSQL 16
container. The developer `ecc` database was never involved.

| Step | Result |
| ---- | ------ |
| Seeded via the **real application** (register + login), not synthetic SQL | user, hashed refresh token, 2 audit rows created |
| `pg_dump -Fc` | 292 TOC entries, 37 `TABLE DATA` entries, 117 KB |
| `pg_restore --list` (integrity) | archive structurally readable |
| **Destructive step** | `DROP DATABASE ecc_p27_review WITH (FORCE)` — confirmed absent |
| `pg_restore` into a fresh database | exit 0, no errors |
| Schema after restore | **37 tables** (36 Prisma + `_prisma_migrations`) |
| Row counts after restore | `users=1 refresh_tokens=1 audit_logs=2` — matches pre-backup |
| **Content fingerprint** | `md5(string_agg(email…))` = `c12a604425d0ca4cbeb71e41812698cd` — **identical before and after** |
| Secret handling | refresh token restored as a 64-character **hash**, not a raw token |
| App boots against restored DB | `/health/ready` → 200, `database.status = ok` |
| **Pre-backup user can log in** | HTTP 201 — the decisive test |
| Authenticated request | `/auth/me` → 200, correct user id |
| Wrong password on restored data | HTTP 401 — hash integrity preserved |
| Cleanup | throwaway container removed; developer `ecc` untouched (37 tables) |

### 14.1 What was NOT tested (database)

Stated plainly, because the test above is genuinely good and easy to
over-read:

- **Restore at production data volume.** Tested at 3 rows. Duration and
  behaviour at millions of rows and gigabytes of documents are unknown.
- **Restore into a *newer* PostgreSQL major version.** Not tested.
- **Parallel restore (`--jobs`).** Not tested.
- **Encryption of backups.** Not implemented, therefore not tested.
- **Retention / rotation / deletion.** Not implemented.
- **Backup scheduling or automation.** Not implemented — §4 is a manual command.
- **Restore under concurrent application writes.** Not tested; §6 recommends a
  read-only window rather than proving one is unnecessary.
- **A failed backup followed by a bad rotation.** Not tested.
- **RPO/RTO under real conditions.** Not measured.

### 14.2 What was tested for STORAGE (Phase 28)

Phase 27 documented the storage procedure but never executed it. Phase 28
executed it against a throwaway filesystem tree — created with
`mkdtemp`, removed in a `finally`, containing no real documents and no PHI.
The developer `ecc` database was not involved at any point.

Run it with `node scripts/verify-storage-backup-restore.mjs`.

| Property | Result |
| -------- | ------ |
| Fixture is representative | 8 files / 12 directories, including deep nesting, a filename with spaces, shell-significant characters, a zero-byte file, a 512 KB binary blob, an empty directory, and a realistic `<documentId>/<random><ext>` layout |
| Source modes are the ones the app requires | 0700 directories, 0600 files, no group/other bits |
| Archive captures only `STORAGE_DIR` | 21 entries; no PostgreSQL path, no out-of-tree canary file |
| **The old D-2 defect is gone** | the archive provably contains no `postgres` / `PG_VERSION` / `ecc_postgres_data` entry |
| **The old D-3 defect is gone** | a failing `tar` is detectable: measured exit 2 — and it *still creates a 20-byte output file*, which is precisely why `\|\| true` was dangerous |
| Tree genuinely destroyed before restore | confirmed absent |
| **Restore is byte-identical** | 21 entries compared, **0 differences** in SHA-256, size, mode and relative path |
| Empty subdirectory survived | yes — a classic archive casualty |
| Zero-byte file survived | still 0 bytes |
| Permission modes survived | `STORAGE_DIR` root 0700, all contents 0600 |
| **Application can use the restored tree** | the **real compiled** `StorageService` from `dist` starts against it in `NODE_ENV=production` and retrieves a document whose digest matches the pre-backup value |
| Traversal containment on the RESTORED tree | `../`, `doc/../../canary`, absolute path, and trailing `..` are **all refused**; the out-of-tree canary was never read |
| A write stays inside | a post-restore upload lands inside `STORAGE_DIR` at mode 0600 |
| Nothing escaped `STORAGE_DIR` | the canary file, created outside the root, was never included in the archive and never read through the service |

**The harness was itself fault-injected, and two real defects in it were
found and fixed.** This is recorded because "the verification passed" is
worth little without it:

- It initially compared only *entries below* the root, never the root's own
  mode. A restore left at 0755 produced a manifest identical to the source and
  the mode check reported **ok** — a false green on the one permission the
  application actually enforces at startup. Now fixed and explicitly checked.
- Its cleanup ran `rmSync` on a tree whose modes a fault had changed, and
  failed with `EACCES`, **leaving the fixture directory on disk**. Cleanup
  now repairs ownership first and reports whether removal actually succeeded.

Both were found by injecting realistic faults (a restore that dropped a file;
a restore that dropped the modes), not by inspection.

### 14.3 What was NOT tested for STORAGE

- **Production volume and scale.** 8 files. Not a test of gigabytes.
- **Any real storage backend.** A local filesystem only. No volume, no network
  filesystem, no object-store mount, no platform snapshot API. §4.1 exists
  precisely because this repository does not provide one.
- **Encryption, retention, rotation, scheduling.** Not implemented.
- **Consistency of a database dump and a storage archive taken at different
  instants.** §6 describes the problem and recommends a read-only window; it
  is not proven that a window is necessary, and it is not proven that a
  mismatch is harmless.
- **A real document round trip through HTTP.** Upload and download against a
  running API backed by a restored tree. The storage service was exercised
  directly, which is a narrower claim.
- **Symlink handling during backup/restore.** A storage tree containing
  symlinks is archived and restored as symlinks; the Phase 28 run observed
  that `StorageService` will *follow* a symlink planted inside `STORAGE_DIR`
  (see §14.4). No fixture contains a symlink, so symlink round-tripping is
  untested.

### 14.4 Observation: `STORAGE_DIR` containment is lexical, not `realpath`

Measured, not assumed, and deliberately **not** changed in Phase 28.

`StorageService.resolveContainment` normalises the key and prefix-checks it
against the resolved base directory. It does **not** call `realpath`. A
symlink placed inside `STORAGE_DIR` and pointing outside it is therefore
followed, and its target is read.

**This is not client-reachable.** `storageKey` is always
`<documentId>/<random-hex><ext>` produced by `generateSafeKey`, `retrieve` is
called with the value read back from the database, and `upload` uses
`writeFileSync` — no code path creates a symlink. Exploiting this would
require an attacker who can already write inside a `0700` directory owned by
the application uid, at which point they can read the files directly and have
gained nothing.

It is recorded as a defence-in-depth observation. It is **not** treated as a
finding requiring a fix in this phase, because switching containment to
`realpath`-based resolution would break deployments where `STORAGE_DIR` is
itself a symlinked mount path — a common and legitimate configuration. If
this is ever revisited, that trade-off has to be decided explicitly rather
than discovered during an incident.

---

**Conclusion: the database backup and restore path is proven at small scale on
throwaway infrastructure, and the document-storage archive/restore path is
now proven at small scale on throwaway infrastructure. Backup automation,
encryption, retention, production volume, and the choice of a real storage
backend remain unproven or absent.**

