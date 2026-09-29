#!/usr/bin/env node
/**
 * Phase 25 (F-4) — mutation test for the Next `rewrites` triage rule.
 *
 * A gate nobody has watched fail is a comment. The Phase 24 (D-6) rule was
 * `/\brewrites\s*:/.test(nextConfigText)` and it stayed green through the exact
 * change it existed to catch: a working
 *
 *     async rewrites() { return [{ source, destination }] }
 *
 * in `apps/web/next.config.mjs`, which is the form Next.js documents. This
 * harness re-plants that and requires the triage script to change its verdict.
 *
 * It MUTATES THE REAL FILES, not fixtures: `apps/web/next.config.mjs` is
 * edited, `pnpm audit` is re-run by the triage script, and the planted
 * rewrite must produce a REACHABLE verdict for the `rewrites` advisory. The
 * file is restored afterwards and the restored state must be clean again, so
 * a later conclusion is not about a planted rewrite.
 *
 * Three mutants, because a rule can be broken three different ways:
 *
 *   M1  the async `rewrites()` METHOD is planted  -> the Phase 24 defect exactly.
 *   M2  `rewrites` is planted as `rewrites: async () => [...]`.
 *   M3  the rewrite is planted AND the analyser is neutered. The expected
 *       verdict is NOT REACHABLE, and that is the point: the word is still in
 *       the file, the rule is still present, and only the ANALYSIS changed. A
 *       verdict that survives a neutered analyser would mean the rule was
 *       reading text, not structure — which is precisely the Phase 24 defect.
 *
 * Usage:  node scripts/mutate-next-config-rewrites.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextConfigPath = path.join(repoRoot, 'apps/web/next.config.mjs');
const analyserPath = path.join(repoRoot, 'scripts/lib/next-config-features.mjs');

const originalConfig = readFileSync(nextConfigPath, 'utf8');
const originalAnalyser = readFileSync(analyserPath, 'utf8');

let failures = 0;
const log = (m) => console.log(m);

function restore() {
  writeFileSync(nextConfigPath, originalConfig);
  writeFileSync(analyserPath, originalAnalyser);
}

/** Run the triage script and return the parsed JSON report. */
function triage() {
  const run = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/triage-vulnerabilities.mjs'), '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  let parsed;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    return { ok: false, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
  }
  return { ok: true, parsed, status: run.status };
}

/** The verdict the triage script reached for an advisory requiring `rewrites`. */
function rewritesVerdict(result) {
  if (!result.ok) return { verdict: null, evidence: `triage produced no JSON: ${result.stdout.slice(0, 200)}` };
  const rows = result.parsed.rows.filter((r) => /rewrites?\b/i.test(r.title));
  if (rows.length === 0) {
    return { verdict: 'NO-ADVISORY', evidence: 'no current advisory title mentions rewrites, so this mutant cannot be judged' };
  }
  const row = rows[0];
  return { verdict: row.verdict, evidence: row.evidence, rows: rows.length };
}

const PLANTED_METHOD = `  async rewrites() {
    // Phase 25 (F-4) mutation fixture: a WORKING rewrite to an
    // attacker-chosen destination, in the form Next.js documents.
    return [{ source: '/api-proxy/:path*', destination: 'https://attacker.invalid/:path*' }];
  },
`;

function plantMethod() {
  const mutated = originalConfig.replace('const nextConfig = {', `const nextConfig = {\n${PLANTED_METHOD}`);
  if (mutated === originalConfig) throw new Error('could not plant the rewrites() method: the anchor text is gone');
  writeFileSync(nextConfigPath, mutated);
}

function plantPropertyArrow() {
  const mutated = originalConfig.replace(
    'const nextConfig = {',
    `const nextConfig = {\n  rewrites: async () => [{ source: '/p/:x*', destination: 'https://attacker.invalid/:x*' }],\n`,
  );
  if (mutated === originalConfig) throw new Error('could not plant the rewrites property: the anchor text is gone');
  writeFileSync(nextConfigPath, mutated);
}

function neuterAnalyser() {
  // The rule still exists, still calls into the analyser, and still reports a
  // clearance — it just never sees a feature again. Only a verdict-level test
  // can catch this.
  const anchor = '  result.features = [...features];\n  return result;';
  if (!originalAnalyser.includes(anchor)) throw new Error('could not neuter the analyser: the anchor text is gone');
  writeFileSync(analyserPath, originalAnalyser.replace(anchor, '  result.features = [];\n  return result;'));
}

const MUTANTS = [
  {
    id: 'M1',
    label: 'a working `async rewrites()` METHOD planted in apps/web/next.config.mjs',
    apply: plantMethod,
    expect: 'REACHABLE',
  },
  {
    id: 'M2',
    label: '`rewrites: async () => [...]` planted in apps/web/next.config.mjs',
    apply: plantPropertyArrow,
    expect: 'REACHABLE',
  },
  {
    id: 'M3',
    label:
      'the analyser neutered so it never reports a feature, WITH the rewrite still planted — the verdict ' +
      'must become NOT REACHABLE, which is what proves it is the ANALYSIS and not the word in the file',
    // The rule still exists, still calls into the analyser, and still returns
    // a clearance — it just never sees a feature again. The rewrite is left in
    // place on purpose: without it, "no feature" would be the correct answer
    // and the mutant would prove nothing. With it, a sound gate flips to
    // REACHABLE because the analyser SEES the key; a neutered one stays at
    // NOT REACHABLE, and that is the detection.
    apply: () => {
      plantMethod();
      neuterAnalyser();
    },
    expect: 'NOT REACHABLE',
  },
];

try {
  for (const m of MUTANTS) {
    restore();
    try {
      m.apply();
      const v = rewritesVerdict(triage());
      if (v.verdict === 'NO-ADVISORY') {
        failures += 1;
        log(`  SKIP  ${m.id}: ${m.label}`);
        log(`        ${v.evidence}`);
        log('        an unknown-advisory path is exercised by scripts/verify-dependency-triage.mjs instead.');
        continue;
      }
      if (v.verdict === m.expect) {
        log(`  PASS  ${m.id}: ${m.label}`);
        log(`        the triage verdict became ${v.verdict}${m.expect === 'NOT REACHABLE' ? ' (detected: a neutered analyser misses a planted rewrite)' : ''}`);
      } else {
        failures += 1;
        log(`  FAIL  ${m.id}: ${m.label}`);
        log(`        the triage verdict stayed ${v.verdict}; the gate did not notice the change.`);
        log(`        evidence: ${v.evidence}`);
      }
    } catch (err) {
      failures += 1;
      log(`  FAIL  ${m.id}: ${m.label}`);
      log(`        ${String(err.message ?? err).split('\n').join('\n        ')}`);
    }
  }
} finally {
  restore();
}

// The restored repository must be green again, or a later conclusion is about a
// planted rewrite rather than about the project.
const finalVerdict = rewritesVerdict(triage());
if (finalVerdict.verdict === 'NOT REACHABLE') {
  log('  PASS  the restored repository reports the rewrites advisory as NOT REACHABLE again');
} else {
  failures += 1;
  log(`  FAIL  the restored repository still reports ${finalVerdict.verdict} for rewrites`);
  log(`        evidence: ${finalVerdict.evidence}`);
}

if (readFileSync(nextConfigPath, 'utf8') !== originalConfig) {
  failures += 1;
  log('  FAIL  apps/web/next.config.mjs was not restored byte-for-byte');
}

if (failures > 0) {
  log(`\nFAILED — ${failures} next-config rewrites mutation check(s) did not hold.\n`);
  process.exit(1);
}
log('\nThe rewrites triage rule is load-bearing: the form Next.js actually supports changes its verdict.\n');
