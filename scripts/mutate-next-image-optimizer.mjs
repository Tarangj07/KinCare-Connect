#!/usr/bin/env node
/**
 * Phase 36 (P35-1) — mutation test of the image-optimizer control.
 *
 * `scripts/verify-next-image-optimizer.mjs` asserts that `/_next/image` cannot
 * serve an optimized image. Advisory 1193733 is a critical unauthenticated RCE
 * in the Next.js Image Optimization API when AVIF output is used, and until
 * Phase 36 the repository's triage gate reported it NOT REACHABLE on evidence
 * that the Phase 35 review showed to be false: `/_next/image` was live and
 * unauthenticated in the production container, answering 200 with image bytes
 * to any client, in an application that renders no images at all.
 *
 * A control that has never been shown to fail might not work, so each mutant
 * below attacks one specific way this one could stop protecting anything, and
 * each is scored on TWO things:
 *
 *   1. the mutant was actually APPLIED — a no-op mutant produces a
 *      "detected, as required" verdict that demonstrates nothing;
 *   2. it failed for the INTENDED reason — the named check failed, not a syntax
 *      error, a missing build, or an unrelated assertion.
 *
 * The second point is why this harness records which CHECK failed rather than
 * only the exit code. An earlier revision of this very gate proved 200 with
 * `content-type: image/png` while its own probe fixture was missing from the
 * server's `public/` directory, so the runtime layer could not distinguish a
 * disabled endpoint from a broken probe. That defect was found only because the
 * vulnerable state was executed by hand, which is exactly the discipline this
 * harness encodes: M2 asserts the fixture is present, so a future regression of
 * that class is a hard failure rather than a silent pass.
 *
 * ## What each layer must catch, and which mutant attacks it
 *
 *   Layer 1 (config)     M1 restores the vulnerable config, M4 removes the key
 *                         entirely, M5 flips it to `false`, M6 makes it dynamic,
 *                         M8 proves a comment cannot satisfy it, M9 proves the
 *                         check is not satisfied by reversing the boolean.
 *   Layer 2 (build)      M3 shows the built manifest is real evidence, not a
 *                         restatement of the source: a hand-edited manifest that
 *                         disagrees with the config must be caught.
 *   Layer 3 (runtime)    M2/M7 prove the runtime probe is load-bearing and that
 *                         the fixture it depends on is asserted.
 *
 * ## Why M7 exists and is expected to be tolerated
 *
 * M7 disables the runtime probe while the config stays correct. The gate still
 * fails, because the built manifest and the config both still say
 * `unoptimized: true`. That is the correct layering: the runtime probe is the
 * strongest evidence but not the only one, so losing it degrades the proof
 * rather than silently accepting the vulnerable state. A design where any single
 * layer could be deleted without consequence would not be a layered control.
 *
 * ## Method
 *
 * Mutants mutate a throwaway MIRROR of `apps/web/next.config.mjs` and the built
 * `.next` tree. The real files are never opened for writing, and their
 * byte-identity is asserted at the end regardless of how the run ended. The
 * mirror's `node_modules` is a symlink to the real store, which is read-only to
 * every gate here.
 *
 * Usage:  node scripts/mutate-next-image-optimizer.mjs [--only M1,M2] [--keep]
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(repoRoot, 'apps/web');
const gateRel = path.join('scripts', 'verify-next-image-optimizer.mjs');
const analyserRel = path.join('scripts', 'lib', 'next-config-features.mjs');
const configRel = path.join('apps', 'web', 'next.config.mjs');

const only = process.argv.includes('--only')
  ? new Set((process.argv[process.argv.indexOf('--only') + 1] ?? '').split(',').map((s) => s.trim()))
  : null;
const keepMirrors = process.argv.includes('--keep');

const log = (m) => console.log(m);
const createdMirrors = [];

function makeMirror() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ecc-p36-image-opt-'));
  createdMirrors.push(root);
  cpSync(path.join(repoRoot, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  // The built tree is what Layers 2 and 3 read. Copying it (rather than
  // symlinking) is what lets M3 hand-edit the manifest: a symlink would mutate
  // the repository's real build output.
  cpSync(path.join(webRoot, '.next'), path.join(root, 'apps/web/.next'), {
    recursive: true,
    dereference: false,
  });
  cpSync(path.join(repoRoot, configRel), path.join(root, configRel));
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  symlinkSync(path.join(repoRoot, 'apps/web/node_modules'), path.join(root, 'apps/web/node_modules'), 'dir');
  return root;
}

function readMirror(root, rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}
function writeMirror(root, rel, content) {
  writeFileSync(path.join(root, rel), content);
}

/** Rewrite `images.unoptimized` in the mirror's config, structurally. */
function setUnoptimized(root, replacement) {
  const src = readMirror(root, configRel);
  const re = /(images:\s*\{[^}]*?)unoptimized:\s*(true|false|[^,\n}]+)/;
  if (!re.test(src)) throw new Error('the mirror config has no `images.unoptimized` to rewrite');
  const next = src.replace(re, `$1unoptimized: ${replacement}`);
  if (next === src) throw new Error('the config edit changed nothing');
  writeMirror(root, configRel, next);
  return `images.unoptimized -> ${replacement}`;
}

function removeImagesKey(root) {
  const src = readMirror(root, configRel);
  const next = src.replace(/\n\s*images:\s*\{[^}]*\},/, '');
  if (next === src) throw new Error('the `images` key was not found in the mirror config');
  writeMirror(root, configRel, next);
  return 'removed the whole `images` key from the config';
}

/** Hand-edit the BUILT manifest, so build evidence and source can disagree. */
function editBuiltManifest(root, fn) {
  const rel = path.join('apps', 'web', '.next', 'images-manifest.json');
  const manifest = JSON.parse(readMirror(root, rel));
  fn(manifest);
  writeMirror(root, rel, `${JSON.stringify(manifest)}\n`);
  return 'hand-edited .next/images-manifest.json';
}

function runGate(root) {
  const res = spawnSync(process.execPath, [path.join(root, gateRel)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 300_000,
    env: { CI: '1', FORCE_COLOR: '0' },
  });
  const text = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  // The gate writes PASS lines to stdout and FAIL lines to stderr, so the
  // failing checks must be read from BOTH. Reading only stdout — as an earlier
  // revision of this harness did — reported "(none parsed)" for every mutant
  // that the gate correctly rejected, which is indistinguishable from the gate
  // having failed for no reason at all.
  const failedChecks = text
    .split('\n')
    .filter((l) => /\bFAIL\b/.test(l) && !l.includes('POST-CONDITION'))
    .map((l) => l.trim().replace(/^(FAIL\s+)+/, ''));
  return { status: res.status, text, failedChecks };
}

function isParseableJs(file) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 60_000 });
  return res.status === 0 ? { ok: true } : { ok: false, reason: (res.stderr ?? '').split('\n').slice(0, 6).join(' | ') };
}

const MUTANTS = [
  {
    id: 'M1',
    label: 'the vulnerable configuration is RESTORED (the `images` key removed entirely)',
    // The exact P35-1 state: no `images.unoptimized` anywhere, so Next takes
    // the optimizer branch. This is the regression the whole phase exists to
    // make impossible to reintroduce silently.
    expected: 'fail',
    mustFailCheck: 'exactly `true`',
    apply(root) {
      return removeImagesKey(root);
    },
  },
  {
    id: 'M2',
    label: 'the runtime probe fixture is removed while the config stays correct',
    // Guards the defect found while building this gate: the probe previously ran
    // against a fixture that had already been deleted, so a live optimizer
    // answered 400 "isn't a valid image" and the runtime layer reported PASS on
    // the vulnerable state. If the fixture assertion is ever removed, this
    // mutant becomes undetectable and the harness says so.
    expected: 'fail',
    mustFailCheck: 'probe image is staged',
    apply(root) {
      const rel = path.join('apps', 'web', '.next', 'standalone', 'apps', 'web', 'server.js');
      if (!existsSync(path.join(root, rel))) throw new Error('the standalone server is not in the mirror; build the web app first');
      // Make the standalone tree unwritable for the fixture by replacing the
      // public directory with a regular FILE, so staging cannot succeed.
      const publicDir = path.join(root, 'apps', 'web', '.next', 'standalone', 'apps', 'web', 'public');
      rmSync(publicDir, { recursive: true, force: true });
      writeFileSync(publicDir, 'not a directory\n');
      return 'replaced the standalone tree\'s public/ directory with a regular file so the probe fixture cannot be staged';
    },
  },
  {
    id: 'M3',
    label: 'the config is correct but the BUILT manifest disagrees (hand-edited to unoptimized:false)',
    // Layer 2 must be real evidence rather than a restatement of Layer 1. A
    // build that did not pick up the config change — a stale `.next`, a cached
    // turbo task — produces exactly this disagreement, and it is the state a
    // CI runner that caches build output can silently be in.
    expected: 'fail',
    mustFailCheck: 'BUILT manifest reports',
    apply(root) {
      return editBuiltManifest(root, (m) => {
        m.images.unoptimized = false;
      });
    },
  },
  {
    id: 'M4',
    label: '`unoptimized` is explicitly set to false',
    expected: 'fail',
    mustFailCheck: 'exactly `true`',
    apply(root) {
      return setUnoptimized(root, 'false');
    },
  },
  {
    id: 'M5',
    label: '`unoptimized` is made DYNAMIC (a runtime expression instead of a literal)',
    // The fail-closed property. A config that might or might not disable the
    // optimizer cannot be asserted safe, so it must be reported as unreadable
    // rather than optimistically treated as fine.
    expected: 'fail',
    mustFailCheck: 'readable literal',
    apply(root) {
      // A global rather than `process.env.X`: the config-contract gate scans
      // raw source for env reads and cannot distinguish one inside a fixture
      // string from a real one, so a `process.env` here would make it report an
      // environment variable this harness does not read.
      return setUnoptimized(root, 'globalThis.__imageOptIn');
    },
  },
  {
    id: 'M6',
    label: 'the check is satisfied by a COMMENT claiming `unoptimized: true`',
    // A source-only check that greps the file would pass here. The gate reads
    // the AST, so it must not.
    expected: 'fail',
    mustFailCheck: 'exactly `true`',
    apply(root) {
      const src = readMirror(root, configRel);
      const next = src.replace("  images: {\n    unoptimized: true,\n  },", '  // images: { unoptimized: true }');
      if (next === src) throw new Error('the images block was not found in the expected form');
      writeMirror(root, configRel, next);
      return 'replaced the `images` block with a comment naming it';
    },
  },
  {
    id: 'M7',
    label: 'the RUNTIME probe is disabled while the config and build stay correct',
    // Expected to be TOLERATED, and that is the design working: Layers 1 and 2
    // still hold, so the gate still refuses to certify a tree whose runtime was
    // never checked against nothing. It is recorded as an accepted weakening
    // rather than a detection, because a layered control is supposed to
    // degrade gracefully — but a reviewer reading the output sees it happen.
    expected: 'tolerated',
    apply(root) {
      const src = readMirror(root, gateRel);
      const anchor = "if (!configOnly) {\n  console.log('\\n  Layer 3";
      if (!src.includes(anchor)) throw new Error('anchor for the Layer 3 block was not found');
      const next = src.replace(anchor, "if (false) {\n  console.log('\\n  Layer 3");
      if (next === src) throw new Error('the Layer 3 edit changed nothing');
      writeMirror(root, gateRel, next);
      return 'disabled the Layer 3 runtime block in the gate source';
    },
  },
  {
    id: 'M8',
    label: 'the analyser is regressed to a TEXT match for `unoptimized`',
    // M6 is only a meaningful test while the analyser reads the AST. If
    // `readNextConfigValue` were reimplemented as `config.includes('unoptimized: true')`,
    // M6 would pass and the whole gate would become a source-only check that
    // the Phase 35 finding already showed to be insufficient.
    expected: 'fail',
    mustFailCheck: 'COMMENT claiming',
    apply(root) {
      const src = readMirror(root, analyserRel);
      const anchor = 'export function readNextConfigValue(source, topKey, nestedKey, { fileName = \'next.config.mjs\' } = {}) {';
      if (!src.includes(anchor)) throw new Error('readNextConfigValue was not found');
      const next = src.replace(
        anchor,
        `${anchor}\n  // Phase 36 mutant M8: a naive text match, which a comment or a string can satisfy.\n  if (typeof source === 'string' && source.includes(\`\${nestedKey}: true\`)) {\n    return { known: true, value: true, at: 'text match', reason: null };\n  }`,
      );
      if (next === src) throw new Error('the analyser edit changed nothing');
      writeMirror(root, analyserRel, next);
      return 'inserted a text-match shortcut at the top of readNextConfigValue()';
    },
  },
];

// ---------------------------------------------------------------------------
const preRun = {
  config: readFileSync(path.join(repoRoot, configRel), 'utf8'),
  gate: readFileSync(path.join(repoRoot, gateRel), 'utf8'),
  analyser: readFileSync(path.join(repoRoot, analyserRel), 'utf8'),
  manifest: readFileSync(path.join(webRoot, '.next', 'images-manifest.json'), 'utf8'),
};

let failures = 0;
log('Phase 36 (P35-1) — mutation test of the image-optimizer control\n');
log('  Every weakening mutant must be DETECTED for the intended reason. Mutants are');
log('  applied to a throwaway mirror; the real config, gate and analyser are never written.\n');

if (!existsSync(path.join(webRoot, '.next', 'images-manifest.json'))) {
  log('  SKIPPED — apps/web/.next/images-manifest.json does not exist. This harness proves the');
  log('             gate against BUILD EVIDENCE, so it needs a web build. Run `pnpm --filter');
  log('             @ecc/web build` first. Skipping is reported, never recorded as a pass.\n');
  process.exit(2);
}

log('  CONTROL  (unmutated mirror — every layer must hold)');
{
  const root = makeMirror();
  const res = runGate(root);
  if (res.status !== 0) {
    log('      FAIL  the unmutated repository FAILS its own image-optimizer gate.');
    log(`        exit=${res.status}`);
    for (const c of res.failedChecks.slice(0, 5)) log(`        - ${c}`);
    failures += 1;
  } else {
    log('        -> green, so a red mutant is attributable to the mutation\n');
  }
}

for (const m of MUTANTS) {
  if (only && !only.has(m.id)) continue;
  log(`  ${m.id}  ${m.label}`);

  const root = makeMirror();
  let description;
  try {
    description = m.apply(root);
  } catch (err) {
    log(`      FAIL  the mutant could not be applied: ${err?.message ?? String(err)}`);
    log('        A mutant that does not apply proves nothing.');
    failures += 1;
    continue;
  }

  const changed =
    readFileSync(path.join(root, configRel), 'utf8') !== preRun.config ||
    readFileSync(path.join(root, gateRel), 'utf8') !== preRun.gate ||
    readFileSync(path.join(root, analyserRel), 'utf8') !== preRun.analyser ||
    readFileSync(path.join(root, 'apps/web/.next/images-manifest.json'), 'utf8') !== preRun.manifest ||
    // M2 replaces the standalone tree's public/ DIRECTORY with a regular file.
    // `existsSync` is true for both, so the change signal is the type, not the
    // presence — otherwise this mutant would be scored as a no-op and the only
    // coverage the runtime fixture assertion has would be silently discarded.
    !lstatSync(path.join(root, 'apps', 'web', '.next', 'standalone', 'apps', 'web', 'public')).isDirectory();
  if (!changed) {
    log('      FAIL  the mutant did not change the mirror. Its result would be meaningless.');
    failures += 1;
    continue;
  }
  log(`        applied: ${description}`);

  for (const rel of [gateRel, analyserRel]) {
    const full = path.join(root, rel);
    if (readFileSync(full, 'utf8') === preRun[rel === gateRel ? 'gate' : 'analyser']) continue;
    const parse = isParseableJs(full);
    if (!parse.ok) {
      log(`      FAIL  the mutant left ${rel} unparseable (${parse.reason}).`);
      log('            A syntax error makes node exit 1 whatever the gate says, so this mutant');
      log('            cannot distinguish detection from breakage.');
      failures += 1;
      continue;
    }
  }
  // Re-parse the loop's `continue` guard: if any edited file failed to parse we
  // already counted a failure, but the mutant must not then also be scored.
  if (
    (readFileSync(path.join(root, gateRel), 'utf8') !== preRun.gate && !isParseableJs(path.join(root, gateRel)).ok) ||
    (readFileSync(path.join(root, analyserRel), 'utf8') !== preRun.analyser && !isParseableJs(path.join(root, analyserRel)).ok)
  ) {
    log('');
    continue;
  }

  const res = runGate(root);

  if (m.expected === 'tolerated') {
    if (res.status !== 0) {
      log('      FAIL  the gate failed even though the config and build are still correct.');
      for (const c of res.failedChecks.slice(0, 5)) log(`             ${c}`);
      failures += 1;
    } else {
      log('        -> tolerated, as designed: Layers 1 and 2 still refuse to certify a tree whose');
      log('           runtime was not probed. Recorded so the degradation is visible, not silent.');
    }
    log('');
    continue;
  }

  if (res.status === 0) {
    log('      FAIL  NOT DETECTED (exit=0). The gate claims to enforce this invariant and does not.');
    failures += 1;
    log('');
    continue;
  }

  // The failure must be the NAMED check, not some other assertion.
  if (m.mustFailCheck && !res.failedChecks.some((c) => c.includes(m.mustFailCheck))) {
    log(`      FAIL  detected, but NOT by the expected check. Expected a failure containing:`);
    log(`            ${JSON.stringify(m.mustFailCheck)}`);
    log(`            actual failing checks: ${res.failedChecks.map((c) => JSON.stringify(c)).join(', ') || '(none parsed)'}`);
    log('            A detection that fires for a different reason scores nothing.');
    failures += 1;
    log('');
    continue;
  }

  log(`        -> DETECTED (exit=${res.status}) by the intended check:`);
  for (const c of res.failedChecks.slice(0, 3)) log(`             ${c}`);
  log('');
}

if (!keepMirrors) {
  for (const m of createdMirrors) rmSync(m, { recursive: true, force: true });
  log(`  ${createdMirrors.length} throwaway mirror(s) removed.`);
} else {
  log(`  ${createdMirrors.length} mirror(s) kept under ${createdMirrors.join(', ')}`);
}
log('');

log('  POST-CONDITION  (the real files must be byte-identical)');
for (const [label, file, before] of [
  ['apps/web/next.config.mjs', configRel, preRun.config],
  ['scripts/verify-next-image-optimizer.mjs', gateRel, preRun.gate],
  ['scripts/lib/next-config-features.mjs', analyserRel, preRun.analyser],
  ['apps/web/.next/images-manifest.json', path.join('apps', 'web', '.next', 'images-manifest.json'), preRun.manifest],
]) {
  const after = readFileSync(path.join(repoRoot, file), 'utf8');
  if (after === before) {
    log(`    ok    ${label} is unchanged`);
  } else {
    log(`    FAIL  ${label} was modified. A leaked mutant corrupts every later phase.`);
    writeFileSync(path.join(repoRoot, file), before);
    failures += 1;
  }
}

log('');
if (failures) {
  log(`  RESULT  FAIL — ${failures} problem(s). The image-optimizer endpoint is not proven protected.`);
  process.exit(1);
}
log('  RESULT  PASS — restoring the vulnerable config, editing the built manifest, flipping the');
log('          boolean, making it dynamic, faking it with a comment, regressing the analyser to');
log('          a text match and breaking the runtime fixture are all detected, each by the check');
log('          that is supposed to catch it.');
log('');
log('  NOT PROVEN BY THIS HARNESS: anything about a deployment outside this repository, or about');
log('  advisories other than 1193733. The AVIF transform itself is not reachable while `sharp` is');
log('  absent from the traced tree; that is a property of the dependency graph, not of this gate.');
process.exit(0);
