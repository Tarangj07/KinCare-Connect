#!/usr/bin/env node
/**
 * Phase 24 (D-2) — mutation test for the access-token lifetime bound.
 *
 * `JwtAuthGuard` verifies tokens with `maxAge: ACCESS_TOKEN_TTL_SECONDS`, so
 * the effective validity of any accepted access token is
 * `min(exp, iat + 15m)` regardless of what the token claims. Phase 23
 * deferred this as D-2 ("unbounded access-token lifetime") and asserted the
 * gap was still open; Phase 24 closed it. A control nobody has seen fail is a
 * comment, so both ways of losing it are reintroduced and the suite is
 * required to catch them:
 *
 *   M1  `maxAge` removed from `verifyAsync`
 *       -> the verifier bounds nothing but `exp`, and a token minted an hour
 *          ago with a ten-year `exp` is accepted again. This is the exact
 *          Phase 23 defect.
 *
 *   M2  `ACCESS_TOKEN_TTL_SECONDS` raised to 24 hours
 *       -> the *realistic* regression: a lifetime "temporarily" increased.
 *          Both issuance and verification move together, so nothing looks
 *          inconsistent and every existing test still passes. It is also the
 *          exact way the deferred D-1 window (a deactivated account keeps
 *          access for the life of its token) would silently widen from
 *          15 minutes to a day.
 *
 * Each mutant is applied to the source, the guard's unit suite is run, and
 * the suite MUST fail. The source is then restored and the suite must pass
 * again, so a mutant cannot leave the repository in a state that later
 * conclusions are not about.
 *
 * The suite is chosen deliberately: it is the one that signs real tokens with
 * the real `jsonwebtoken` verifier, so a mutant that merely stops *asking*
 * for the bound and one that *widens* the bound are distinguishable. A suite
 * that only asserted "maxAge is in the options object" would not catch M2, and
 * would not catch M1 either if the option were passed but ignored.
 *
 * Usage:  node scripts/mutate-token-lifetime.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');

const GUARD = path.join(apiRoot, 'src/auth/guards/auth.guard.ts');
const CONFIG = path.join(apiRoot, 'src/config/security-config.ts');
const SPEC = 'src/auth/guards/auth.guard.spec.ts';

const MUTANTS = {
  M1: {
    label: 'the maxAge bound removed from token verification',
    // The option is deleted rather than set to a huge value: both are
    // regressions, and deleting the line is the one a revert produces.
    file: GUARD,
    from: '        algorithms: [\'HS256\'],\n        maxAge: ACCESS_TOKEN_TTL_SECONDS,\n',
    to: '        algorithms: [\'HS256\'],\n',
    expect: /lifetime policy is 15 minutes|lifetime is bounded|ten-year|one-hour-old|accepts a token issued now/,
  },
  M2: {
    label: "the access-token lifetime raised from 15 minutes to 24 hours",
    file: CONFIG,
    from: 'export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;',
    to: 'export const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;',
    expect: /lifetime policy is 15 minutes|one second short|lifetime is bounded/,
  },
  M3: {
    // Phase 25 (F-1). The control under test is the guard's refusal of a
    // future-dated `iat`. It is removed from the LIVE file the guard
    // imports — not from a copy, and not from an unloaded module — so the
    // guard suite exercises the mutated code. Before this mutation the
    // future-`iat` cases in the suite were absent, and Phase 24's suite
    // passed with the hole open.
    label: 'the future-dated `iat` check removed from token verification',
    file: GUARD,
    from: `      if (!isAccessTokenIssuedInThePast(payload.iat)) {
        throw new UnauthorizedException('Access token invalid or expired.');
      }
`,
    to: '',
    expect: /future-dated `iat` cannot extend/i,
  },
  M4: {
    // The realistic version of M3: not "the check was deleted" but "the check
    // was relaxed until it is decorative". A window of one hour accepts every
    // `iat` a real attacker would use and still refuses nothing, so it is the
    // way this regresses in practice.
    label: 'the tolerated future-`iat` window widened from 5 seconds to 1 hour',
    file: CONFIG,
    from: 'export const ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS = 5;',
    to: 'export const ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS = 60 * 60;',
    expect: /tolerated future-`iat` window is 5 seconds|future-dated `iat` cannot extend/i,
  },
};

let failures = 0;
const log = (m) => console.log(m);

function applyMutant(id) {
  const spec = MUTANTS[id];
  const before = readFileSync(spec.file, 'utf8');
  if (!before.includes(spec.from)) {
    throw new Error(
      `could not apply ${id}: the anchor text is not present in ${path.relative(apiRoot, spec.file)}:\n${spec.from}`,
    );
  }
  writeFileSync(spec.file, before.replace(spec.from, spec.to));
  return { path: spec.file, before };
}

function runGuardSuite() {
  const run = spawnSync('node_modules/.bin/vitest', ['run', '--config', 'vitest.config.unit.ts', SPEC], {
    cwd: apiRoot,
    encoding: 'utf8',
    env: { ...process.env, JWT_ACCESS_SECRET: 'mutation-harness-secret-value-32-chars-min' },
    maxBuffer: 32 * 1024 * 1024,
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

for (const id of Object.keys(MUTANTS)) {
  const spec = MUTANTS[id];
  let restore;
  try {
    restore = applyMutant(id);
    const { status, output } = runGuardSuite();
    if (status === 0) {
      failures += 1;
      log(`  FAIL  ${id}: ${spec.label}`);
      log('        the guard suite PASSED with this control removed. The control is decorative.');
      continue;
    }
    if (!spec.expect.test(output)) {
      failures += 1;
      log(`  FAIL  ${id}: ${spec.label}`);
      log('        the suite failed, but not on a lifetime assertion — a pass for the wrong reason:');
      log(output.split('\n').filter((l) => /FAIL|✓|×|Error|expected/i.test(l)).slice(0, 12).map((l) => `          ${l}`).join('\n'));
      continue;
    }
    log(`  PASS  ${id}: ${spec.label}`);
    log('        the guard suite failed on a lifetime assertion');
  } catch (err) {
    failures += 1;
    log(`  FAIL  ${id}: ${spec.label}`);
    log(`        ${String(err.message ?? err).split('\n').join('\n        ')}`);
  } finally {
    if (restore) writeFileSync(restore.path, restore.before);
  }
}

const restored = runGuardSuite();
if (restored.status !== 0) {
  failures += 1;
  log('  FAIL  the guard suite does not pass again on the restored repository');
} else {
  log('  PASS  the guard suite passes again on the restored repository');
}

if (failures > 0) {
  log(`\nFAILED — ${failures} token-lifetime mutation check(s) did not hold.\n`);
  process.exit(1);
}
log('\nThe access-token lifetime bound is load-bearing: removing or widening it fails the suite.\n');
