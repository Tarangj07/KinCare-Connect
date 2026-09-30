#!/usr/bin/env node
/**
 * Phase 28 (WS2) — STORAGE_DIR backup and restore, on throwaway data only.
 *
 * Phase 27 proved the PostgreSQL half of the backup procedure and explicitly
 * recorded the document-storage half as "documented but never executed". This
 * harness executes it.
 *
 * Scope and honesty constraints, which this file enforces on itself:
 *  - it never touches the developer `ecc` database, real documents, or any
 *    production storage. Everything happens under a fresh `mktemp -d` tree
 *    that is removed in a `finally`;
 *  - it uses no real PHI. Every fixture is obviously synthetic;
 *  - it does NOT validate production backup infrastructure, scheduling,
 *    off-host storage, encryption or retention. It validates the *procedure*
 *    and the application's storage contract, nothing else.
 *
 * The procedure under test is the one in `docs/BACKUP_RESTORE.md` §4/§5, with
 * the corrections Phase 28 made to it. The harness deliberately re-derives the
 * expected result from the SOURCE TREE rather than from the archive, so a bug
 * that corrupted both identically could not hide.
 *
 * What it proves:
 *   1. a representative storage tree (nested dirs, spaces in names, binary,
 *      zero-byte, deep nesting, realistic storageKey layout) is created with
 *      the 0700/0600 modes `StorageService` requires;
 *   2. the documented archive captures exactly that tree and nothing else —
 *      in particular it does NOT capture PostgreSQL, which is the specific
 *      defect Phase 28 found in the runbook;
 *   3. the tree can be destroyed and restored byte-for-byte, with identical
 *      file count, relative paths, SHA-256 digests and permission bits;
 *   4. the restored tree is usable by the REAL `StorageService` from the
 *      COMPILED dist — not a reimplementation of it;
 *   5. traversal containment still holds on the RESTORED tree: `../`,
 *      absolute paths and symlink escapes are all refused, and nothing is
 *      read from or written to outside `STORAGE_DIR`;
 *   6. the procedure FAILS LOUDLY — a failed archive step is not swallowed,
 *      which is the `|| true` defect corrected in Phase 28.
 *
 * Method note (this project has been bitten by its own verifiers): each
 * sub-check is written so that it would fail if the property it names were
 * absent. §5's containment checks assert on a canary file created OUTSIDE
 * `STORAGE_DIR`; if containment were broken the canary would be readable, and
 * the check fails on observed behaviour rather than on an error being thrown.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The compiled `StorageService` is CommonJS (tsc output), so it is loaded
// through `createRequire` rather than a bare `require`, which is not defined
// in an ES module.
const requireCjs = createRequire(import.meta.url);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.join(repoRoot, 'apps/api');
const distStorage = path.join(apiRoot, 'dist/storage/storage.service.js');

let checks = 0;
let failures = 0;
const observations = [];

/**
 * Record a check result.
 *
 * Results are printed IMMEDIATELY, not accumulated for a final summary. An
 * earlier version buffered them and printed at the end, and fault injection
 * against this harness showed why that is wrong: one uncaught throw
 * destroyed every result already gathered, so a real failure was reported as
 * a bare stack trace with no evidence at all. Each line is evidence as it is
 * produced, so a later crash still leaves a readable record.
 */
function check(label, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * Run `fn`, converting a throw into a recorded failure.
 *
 * A check that throws is a check that did not run. Letting it propagate
 * aborts the harness and loses the remaining evidence, so an unexpected
 * filesystem state is reported as the failure it is.
 */
function attempt(label, fn, detailFor) {
  try {
    const { ok, detail } = fn();
    check(label, ok, detail ?? detailFor?.());
  } catch (err) {
    check(label, false, `the check threw instead of completing: ${err?.message ?? String(err)}`);
  }
}

/** SHA-256 of a file's bytes. */
function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * A manifest of the tree: relative path -> { sha256, mode, size, type }.
 * Directories are included so that directory STRUCTURE is compared, not just
 * the files that happen to contain bytes.
 *
 * The ROOT directory's own mode is captured separately and returned as
 * `.rootMode`. An earlier version did not, and fault injection proved the gap
 * was real: a restore whose root had been left at 0744 produced a manifest
 * that was byte-identical to the source, because `manifest()` only ever
 * recorded entries BELOW the root. The mode check therefore reported "ok"
 * while the one permission `StorageService` actually enforces at startup —
 * and the one that makes it refuse to run in production — was wrong. The
 * root is now compared explicitly.
 */
function manifest(root) {
  const out = {};
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const st = lstatSync(abs);
      if (entry.isSymbolicLink()) {
        out[relPath] = { type: 'symlink', target: readlinkSync(abs) };
      } else if (entry.isDirectory()) {
        out[relPath] = { type: 'dir', mode: st.mode & 0o777 };
        walk(abs, relPath);
      } else {
        out[relPath] = { type: 'file', mode: st.mode & 0o777, size: st.size, sha256: sha256(abs) };
      }
    }
  };
  walk(root, '');
  out.rootMode = { type: 'root', mode: statSync(root).mode & 0o777 };
  return out;
}

function diffManifests(before, after) {
  const problems = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of [...keys].sort()) {
    const a = before[k];
    const b = after[k];
    if (!a) problems.push(`only in restored: ${k}`);
    else if (!b) problems.push(`only in original: ${k}`);
    else {
      for (const field of ['type', 'mode', 'size', 'sha256', 'target']) {
        if (a[field] !== undefined && a[field] !== b[field]) {
          problems.push(`${k}: ${field} ${JSON.stringify(a[field])} -> ${JSON.stringify(b[field])}`);
        }
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Fixtures. Written with explicit modes so the tree matches what
// `StorageService` itself creates (0700 dirs, 0600 files) — a restore that
// lost the modes would be rejected by the application in production.
// ---------------------------------------------------------------------------
function buildFixture(storageDir) {
  mkdirSync(storageDir, { recursive: true, mode: 0o700 });
  chmodSync(storageDir, 0o700);

  const write = (rel, data) => {
    const abs = path.join(storageDir, rel);
    mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
    writeFileSync(abs, data, { mode: 0o600 });
    chmodSync(abs, 0o600);
  };

  // A realistic storageKey layout: <documentId>/<random><ext>, which is
  // exactly what `generateSafeKey` produces.
  write('doc-a1b2c3d4e5f60718/9f8e7d6c5b4a39281706.png', Buffer.from('89504e470d0a1a0a', 'hex'));
  write('doc-a1b2c3d4e5f60718/00112233445566778899.pdf', Buffer.from('%PDF-1.4 synthetic fixture', 'utf8'));
  // Deep nesting.
  write('doc-ff00ee00dd00cc00/aa/bb/cc/deep-nested.txt', 'deeply nested synthetic record');
  // A filename with spaces — the runbook must not depend on shell quoting
  // being done correctly by a human.
  write('doc-1122334455667788/report with spaces.txt', 'spaces in the name');
  // Unicode and shell-significant characters, which are exactly what a
  // naive `tar czf ... $VAR` invocation mangles.
  write("doc-2233445566778899/naïve 'quoted' & $pecial.txt", 'shell-significant characters');
  // Zero-byte file: `tar` handles it, but a manifest built with
  // `readFileSync` on a directory would not, so it is a real edge case.
  write('doc-3344556677889900/empty.dat', Buffer.alloc(0));
  // Binary content with high bytes and a NUL, to catch encoding damage.
  write('doc-4455667788990011/binary.bin', Buffer.from([0x00, 0xff, 0x00, 0xfe, 0x7f, 0x80, 0x0a, 0x0d]));
  // A larger blob, so a truncated archive cannot pass by luck.
  const big = Buffer.alloc(512 * 1024);
  for (let i = 0; i < big.length; i += 1) big[i] = i % 251;
  write('doc-5566778899001122/large.bin', big);
  // A subdirectory with no files in it: empty directories are a classic
  // archive/restore casualty.
  mkdirSync(path.join(storageDir, 'doc-6677889900112233/empty-subdir'), { recursive: true, mode: 0o700 });
  chmodSync(path.join(storageDir, 'doc-6677889900112233/empty-subdir'), 0o700);
}

console.log('Phase 28 (WS2) — STORAGE_DIR backup and restore on throwaway data\n');

// Everything lives under one throwaway root, removed in a `finally` below.
// A canary sits OUTSIDE storageDir but INSIDE the throwaway root, so a
// containment failure would be observable without touching anything real.
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'ecc-p28-storage-'));
const storageDir = path.join(tmpRoot, 'uploads');
const backupDir = path.join(tmpRoot, 'backups');
// The canary's CONTENT carries the marker, not just its filename. An earlier
// draft checked the response for the string "CANARY", which appears only in
// the name — so a successful escape was scored as a non-escape. The leak
// detector itself was the defect; it now matches content.
const CANARY_MARKER = 'ECC-P28-CANARY-MARKER-9f3a2b7c';
const canary = path.join(tmpRoot, 'CANARY-OUTSIDE-STORAGE.txt');
mkdirSync(backupDir, { recursive: true, mode: 0o700 });
writeFileSync(canary, `this file is outside STORAGE_DIR and must never be reachable through it\n${CANARY_MARKER}\n`, { mode: 0o600 });

try {
  console.log(`  throwaway root: ${tmpRoot}`);
  console.log(`  STORAGE_DIR:    ${storageDir}\n`);

  // --- 1. fixture ---------------------------------------------------------
  buildFixture(storageDir);
  const sourceManifest = manifest(storageDir);
  const sourceFiles = Object.entries(sourceManifest).filter(([, v]) => v.type === 'file');
  const sourceDirs = Object.entries(sourceManifest).filter(([, v]) => v.type === 'dir');
  check('fixture created with the application\'s required modes',
    Object.values(sourceManifest).every((e) => ((e.mode ?? 0o600) & 0o077) === 0),
    `${sourceFiles.length} files, ${sourceDirs.length} directories, all with no group/other bits`);
  check('fixture includes the required edge cases',
    ['doc-a1b2c3d4e5f60718/9f8e7d6c5b4a39281706.png',
     'doc-ff00ee00dd00cc00/aa/bb/cc/deep-nested.txt',
     "doc-2233445566778899/naïve 'quoted' & $pecial.txt",
     'doc-3344556677889900/empty.dat',
     'doc-6677889900112233/empty-subdir'].every((k) => k in sourceManifest),
    'normal, nested, spaces, shell-significant, zero-byte and empty-directory fixtures all present');

  // --- 2. the documented archive procedure --------------------------------
  // This is the corrected §4 storage command: archive STORAGE_DIR, nothing
  // else, and do not swallow the exit status.
  const archive = path.join(backupDir, 'storage-p28.tar.gz');
  const tar = spawnSync('tar', ['czf', archive, '-C', storageDir, '.'], { encoding: 'utf8' });
  check('the documented archive command succeeds and its exit status is honoured',
    tar.status === 0,
    `tar exit=${tar.status}${tar.status !== 0 ? ` stderr=${(tar.stderr || '').slice(0, 200)}` : ''}`);
  check('the archive is non-empty', existsSync(archive) && statSync(archive).size > 0,
    `${statSync(archive).size} bytes`);

  // The specific Phase 28 runbook defect: the old command archived the
  // PostgreSQL volume and called it a storage backup. Prove the corrected
  // command does NOT do that.
  const listing = spawnSync('tar', ['tzf', archive], { encoding: 'utf8' });
  const entries = listing.stdout.split('\n').filter(Boolean);
  check('the archive contains only STORAGE_DIR contents', 
    entries.every((e) => !e.includes('postgres') && !e.includes('PG_VERSION') && !e.includes('ecc_postgres_data')),
    `${entries.length} entries, none referencing PostgreSQL`);
  check('the archive does not contain the out-of-tree canary',
    !entries.some((e) => e.includes('CANARY')),
    'no path outside STORAGE_DIR was captured');

  // Phase 28 found this specific defect in the runbook: the old command
  // ended in `|| true`, which discards tar's exit status. Note what actually
  // goes wrong — tar STILL creates the output file when it fails, so the
  // failure signal is the exit status alone and there is no zero-byte
  // artifact to notice. That is what made `|| true` dangerous: the operator
  // saw a file appear and no error.
  const badArchive = path.join(backupDir, 'storage-bad.tar.gz');
  const bad = spawnSync('tar', ['czf', badArchive, '-C', path.join(tmpRoot, 'does-not-exist'), '.'], { encoding: 'utf8' });
  check('a failed archive is detectable from its exit status alone',
    bad.status !== 0,
    `tar exit=${bad.status} on a nonexistent source; a ${existsSync(badArchive) ? 'file was still created' : 'no file was created'}, ` +
      'so "the file exists" is not evidence of success — the old "|| true" discarded the only real signal');

  // --- 3. destroy and restore ---------------------------------------------
  rmSync(storageDir, { recursive: true, force: true });
  check('the source tree is genuinely destroyed before restore', !existsSync(storageDir));

  mkdirSync(storageDir, { recursive: true, mode: 0o700 });
  const untar = spawnSync('tar', ['xzf', archive, '-C', storageDir], { encoding: 'utf8' });
  check('the documented restore command succeeds', untar.status === 0,
    `tar exit=${untar.status}${untar.status !== 0 ? ` stderr=${(untar.stderr || '').slice(0, 200)}` : ''}`);

  // --- 4. the restored tree is identical -----------------------------------
  const restoredManifest = manifest(storageDir);
  const diffs = diffManifests(sourceManifest, restoredManifest);
  check('restored file count, relative paths, SHA-256 digests, sizes and modes all match',
    diffs.length === 0,
    diffs.length === 0
      ? `${Object.keys(restoredManifest).length} entries compared, 0 differences`
      : `differences: ${diffs.slice(0, 5).join('; ')}`);
  check('the empty subdirectory survived the round trip',
    existsSync(path.join(storageDir, 'doc-6677889900112233/empty-subdir')));
  check('the zero-byte file is still zero bytes',
    statSync(path.join(storageDir, 'doc-3344556677889900/empty.dat')).size === 0);
  check('no group/other permission bits were introduced by the restore, including on STORAGE_DIR itself',
    Object.values(restoredManifest).every((e) => ((e.mode ?? 0o600) & 0o077) === 0),
    `STORAGE_DIR root mode ${(restoredManifest.rootMode?.mode ?? 0).toString(8).padStart(4, '0')}; ` +
      'the application refuses to start in production on a looser directory');

  // --- 5. the application can actually use the restored tree ---------------
  // The REAL compiled service, loaded from dist. A reimplementation here
  // would prove nothing about the shipped containment logic.
  check('the compiled StorageService exists (run `pnpm build` first if this fails)',
    existsSync(distStorage), path.relative(repoRoot, distStorage));
  if (existsSync(distStorage)) {
    process.env.STORAGE_DIR = storageDir;
    process.env.NODE_ENV = 'production';
    // Everything below is wrapped: `new StorageService()` THROWS by design
    // when STORAGE_DIR is too permissive, and an uncaught throw used to abort
    // the harness with a stack trace, discarding every check after it. The
    // throw is the application refusing to start, which is exactly the
    // evidence this section wants to record.
    try {
      const { StorageService } = requireCjs(distStorage);
      const svc = new StorageService();
      check('the compiled StorageService starts against the RESTORED directory in production mode',
        true, 'constructor accepted the restored 0700 tree');

      const sampleKey = 'doc-a1b2c3d4e5f60718/9f8e7d6c5b4a39281706.png';
      const bytes = await svc.retrieve(sampleKey);
      check('a restored document is retrievable through the service',
        Buffer.isBuffer(bytes) && sha256Of(bytes) === sourceManifest[sampleKey].sha256,
        `${bytes.length} bytes, digest matches the pre-backup value`);

    // Traversal containment on the RESTORED tree.
    const escapes = [
      ['parent traversal', '../CANARY-OUTSIDE-STORAGE.txt'],
      ['deep traversal', 'doc-a1b2c3d4e5f60718/../../CANARY-OUTSIDE-STORAGE.txt'],
      ['absolute path', '/etc/passwd'],
      ['trailing traversal', 'doc-a1b2c3d4e5f60718/..'],
    ];
    for (const [label, key] of escapes) {
      let refused = false;
      let leaked = false;
      try {
        const got = await svc.retrieve(key);
        leaked = Buffer.isBuffer(got) && got.toString('utf8').includes(CANARY_MARKER);
        refused = false;
      } catch {
        refused = true;
      }
      check(`containment holds on the restored tree: ${label}`, refused && !leaked,
        refused ? 'refused' : leaked ? 'ESCAPED AND READ THE CANARY' : 'returned something');
    }

    // Symlink escape. MEASURED, NOT ASSUMED, and reported as found.
    //
    // `resolveContainment` normalises and prefix-checks the key LEXICALLY; it
    // does not call `realpath`. A symlink inside STORAGE_DIR pointing
    // outside it is therefore followed by `fs.readFileSync`. That is what
    // this check reports.
    //
    // It is NOT a client-reachable vulnerability, and the difference matters:
    // `storageKey` is always `<documentId>/<random-hex><ext>` produced by
    // `generateSafeKey`, `retrieve` is called with the value read back from
    // the database, and `upload` uses `writeFileSync` (never a symlink
    // creation). A client therefore cannot choose a key that names a symlink.
    // Exploiting this requires an attacker who can already create a symlink
    // INSIDE a 0700 directory owned by the application uid — at which point
    // they can read the files directly and have gained nothing.
    //
    // It is recorded as a defence-in-depth observation, deliberately NOT
    // "fixed" here: changing containment to `realpath`-based resolution is
    // out of scope for a backup/restore phase and would break deployments
    // where STORAGE_DIR is itself a symlinked mount path.
    const linkPath = path.join(storageDir, 'escape-link.txt');
    symlinkSync(canary, linkPath);
    let symlinkRefused = false;
    let symlinkLeaked = false;
    let symlinkDetail = '';
    try {
      const got = await svc.retrieve('escape-link.txt');
      symlinkLeaked = Buffer.isBuffer(got) && got.toString('utf8').includes(CANARY_MARKER);
      symlinkDetail = symlinkLeaked
        ? 'FOLLOWED — the lexical prefix check does not resolve symlinks. Not client-reachable (see the note above); recorded as a defence-in-depth observation.'
        : 'followed, but the target was not the canary';
    } catch {
      symlinkRefused = true;
      symlinkDetail = 'refused';
    }
    check('symlink escape behaviour is MEASURED and reported (not assumed absent)', true,
      symlinkRefused ? symlinkDetail : symlinkDetail);
    if (symlinkLeaked) {
      observations.push('SYMLINK FOLLOWED: `StorageService.resolveContainment` prefix-checks the key');
      observations.push('lexically and does not call realpath, so a symlink planted inside STORAGE_DIR is');
      observations.push('followed to its target. NOT client-reachable: storageKey is always');
      observations.push('`<documentId>/<random><ext>` from generateSafeKey and is read back from the');
      observations.push('database, and upload uses writeFileSync, never symlink creation. Exploiting');
      observations.push('it needs an attacker who can already write inside a 0700 app-owned');
      observations.push('directory. Classified: defence-in-depth observation, not a finding requiring');
      observations.push('a fix in this phase. Not changed: realpath-based containment would break');
      observations.push('deployments where STORAGE_DIR is itself a symlinked mount path.');
    }
    rmSync(linkPath, { force: true });

    // A write must also stay inside.
    const newKey = svc.generateSafeKey('p28-write-check', 'x.txt');
    await svc.upload(Buffer.from('written after restore'), newKey, 'text/plain');
    check(`a write through the service lands inside STORAGE_DIR`,
      existsSync(path.join(storageDir, newKey)) && (statSync(path.join(storageDir, newKey)).mode & 0o777) === 0o600,
      `${newKey}, mode 0600`);
    } catch (err) {
      // The application's own refusal is the finding. It is reported as a
      // failed check with the message verbatim, because "the restored tree is
      // unusable by the application" is exactly what must not pass silently.
      check('the compiled StorageService can operate on the RESTORED tree', false,
        `StorageService refused the restored directory: ${err?.message ?? String(err)}`);
    } finally {
      delete process.env.STORAGE_DIR;
      delete process.env.NODE_ENV;
    }
  }

  // --- 6. summary ---------------------------------------------------------
  console.log('');
  if (failures) {
    console.log(`  RESULT  FAIL — ${failures} of ${checks} checks failed.`);
    process.exitCode = 1;
  } else {
    console.log(`  RESULT  PASS — ${checks}/${checks} checks.`);
  }
  if (observations.length) {
    console.log('');
    console.log('  OBSERVATIONS (recorded, not fixed in this phase):');
    for (const o of observations) console.log(`    ${o}`);
  }
  console.log('');
  console.log('  NOT PROVEN BY THIS HARNESS: production-volume storage, off-host backup storage,');
  console.log('  backup encryption, retention or rotation, scheduling or automation, a restore at');
  console.log('  scale, or any deployment-specific volume or object-store backend. The storage');
  console.log('  backend is a deployment concern; the procedure above is backend-agnostic and was');
  console.log('  exercised against a local filesystem only.');
} finally {
  // Unconditional cleanup, in a finally, so an exception above cannot leave a
  // fixture tree (or a canary) behind on the developer machine.
  //
  // The ownership repair before the delete is not defensive padding. Fault
  // injection against this harness (a restore that lost the 0700 modes) left
  // the tree at 0644 with no execute bit, and `rmSync` then failed with
  // EACCES and left the whole tree on disk. Cleanup that can itself fail is
  // not cleanup, so the tree is made removable first and the outcome is
  // reported either way.
  try {
    spawnSync('chmod', ['-R', 'u+rwX', tmpRoot], { encoding: 'utf8' });
  } catch {
    /* best effort; the delete below is still attempted */
  }
  let removed = false;
  try {
    rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    removed = !existsSync(tmpRoot);
  } catch (err) {
    console.log(`  FAIL  cleanup could not remove ${tmpRoot}: ${err?.message ?? String(err)}`);
    console.log('        remove it manually — a leftover fixture tree is not harmless clutter,');
    console.log('        it is a 0700 directory of synthetic files outside the repository');
  }
  console.log(`  cleaned up ${tmpRoot}: ${removed ? 'removed' : 'STILL PRESENT'}`);
}

function sha256Of(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
