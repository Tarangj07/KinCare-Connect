#!/usr/bin/env node
/**
 * Phase 23 (W5) — mutation test of the configuration audit.
 *
 * A configuration audit is the easiest kind of check to write so that it
 * always passes: the failure mode is a long list of conditions that quietly
 * stop matching after an edit, and nothing in the build notices. This script
 * reintroduces, one at a time, each class of drift the audit claims to catch
 * and proves the audit rejects it.
 *
 * The repository is never modified. Each mutation is applied to a scratch copy
 * of the whole tree, the audit is run against that copy, and the copy is
 * removed. The real repository is audited once at the end to confirm the
 * harness left nothing behind.
 *
 * Mutants:
 *   M1  a variable read by code is removed from every template
 *   M2  a variable is documented that nothing reads
 *   M3  a template ships a JWT secret the production validator would accept
 *   M4  CI pins a Node major the images do not ship
 *   M5  the Dockerfile activates a pnpm version other than packageManager
 *   M6  a Dockerfile bakes a credential-shaped ENV
 *   M7  the web health-page fallback points at the wrong API port
 *   M8  the rate-limit bypass loses its NODE_ENV=test guard
 *   M9  the global ValidationPipe loses `transform` in apps/api/src/main.ts
 *   M10 the global ValidationPipe loses `whitelist` in apps/api/src/main.ts
 *   M11 the global ValidationPipe loses `forbidNonWhitelisted` in apps/api/src/main.ts
 *   M12 the global ValidationPipe sets `whitelist` to false rather than removing it
 *   M13 the test harness's ValidationPipe is weakened while production's is not
 *   M14 the global ValidationPipe registration is removed from main.ts entirely
 *
 * Usage:  node scripts/mutate-config-contract.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const audit = path.join(here, 'verify-config-contract.mjs');

let failures = 0;
function check(name, fn) {
  return (async () => {
    try {
      const detail = await fn();
      console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
    } catch (err) {
      failures += 1;
      console.error(`  FAIL  ${name}\n        ${String(err.message ?? err).split('\n').join('\n        ')}`);
    }
  })();
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function withScratch(mutate) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ecc-p23-cfgmut-'));
  // Everything the audit reads, and nothing it does not. node_modules is
  // linked, not copied: the audit never resolves a dependency.
  for (const rel of [
    'apps',
    'packages',
    'scripts',
    '.github',
    'package.json',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    '.env.example',
    'docker-compose.yml',
  ]) {
    const src = path.join(repoRoot, rel);
    if (!existsSync(src)) continue;
    const dest = path.join(root, rel);
    if (rel.endsWith('.env.example') || rel.endsWith('.yml')) {
      cpSync(src, dest);
    } else {
      cpSync(src, dest, {
        recursive: true,
        dereference: false,
        filter: (p) => !['node_modules', 'dist', '.next', '.turbo', '.expo'].includes(path.basename(p)),
      });
    }
  }
  try {
    const nm = path.join(root, 'node_modules');
    if (!existsSync(nm)) symlinkSync(path.join(repoRoot, 'node_modules'), nm, 'dir');
    mutate(root);
    const run = spawnSync(process.execPath, [path.join(root, 'scripts/verify-config-contract.mjs')], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function patch(root, rel, from, to) {
  const file = path.join(root, rel);
  const before = readFileSync(file, 'utf8');
  const after = before.replace(from, to);
  assert(after !== before, `could not apply the mutation to ${rel}: ${JSON.stringify(from.slice(0, 60))} not found`);
  writeFileSync(file, after);
}

function dropFromTemplates(root, name) {
  for (const rel of ['.env.example', 'apps/api/.env.example']) {
    const file = path.join(root, rel);
    const lines = readFileSync(file, 'utf8').split('\n');
    const kept = lines.filter((l) => !new RegExp(`^${name}=`).test(l.trim()));
    assert(kept.length !== lines.length, `could not remove ${name} from ${rel}`);
    writeFileSync(file, kept.join('\n'));
  }
}

async function main() {
  console.log('\nPhase 23 (W5) — mutation test of the configuration audit\n');

  await check('the audit passes on the unmodified repository', () => {
    const run = spawnSync(process.execPath, [audit], { encoding: 'utf8', cwd: repoRoot });
    assert(run.status === 0, `the audit rejected the real repository:\n${run.stdout}${run.stderr}`);
    return 'baseline is clean';
  });

  await check('M1: a code-read variable removed from the templates is detected', () => {
    const { status, output } = withScratch((root) => {
      // STORAGE_DIR is read by StorageService and validated in production.
      dropFromTemplates(root, 'STORAGE_DIR');
    });
    assert(status !== 0, 'the audit PASSED with STORAGE_DIR read by code but documented nowhere.');
    assert(/STORAGE_DIR/.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the undocumented read';
  });

  await check('M2: a documented variable nothing reads is detected', () => {
    const { status, output } = withScratch((root) => {
      patch(
        root,
        'apps/api/.env.example',
        'STORAGE_DIR=',
        'STORAGE_DIR=\n# Invented by the mutation harness.\nECC_INVENTED_SETTING=1',
      );
    });
    assert(status !== 0, 'the audit PASSED with a documented variable that nothing reads.');
    assert(/ECC_INVENTED_SETTING/.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the documented-but-unread variable';
  });

  await check('M3: a template shipping an acceptable JWT secret is detected', () => {
    const { status, output } = withScratch((root) => {
      patch(
        root,
        '.env.example',
        'JWT_ACCESS_SECRET=replace-me',
        'JWT_ACCESS_SECRET=k7Qm2Zx9Rt4Lp6Yw8Nc0Vb3Xa5Zd7Fg9Hj1Kl2Mn4Pq6Rs8Tu0Vv',
      );
    });
    assert(status !== 0, 'the audit PASSED a template whose placeholder secret the production validator would accept.');
    assert(/JWT_ACCESS_SECRET/.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the shippable-looking secret';
  });

  await check('M4: CI pinned to a Node major the images do not ship is detected', () => {
    const { status, output } = withScratch((root) => {
      patch(root, '.github/workflows/ci.yml', 'node-version: 24', 'node-version: 20');
    });
    assert(status !== 0, 'the audit PASSED with CI on Node 20 and the images on Node 24.');
    assert(/Node|node/i.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the runtime mismatch';
  });

  await check('M5: a Dockerfile activating a different pnpm than packageManager is detected', () => {
    const { status, output } = withScratch((root) => {
      patch(root, 'apps/api/Dockerfile', 'pnpm@11.25.0 --activate', 'pnpm@10.0.0 --activate');
    });
    assert(status !== 0, 'the audit PASSED with the Dockerfile activating a pnpm the repository does not pin.');
    assert(/pnpm/.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the pnpm divergence';
  });

  await check('M6: a Dockerfile baking a credential-shaped ENV is detected', () => {
    const { status, output } = withScratch((root) => {
      patch(root, 'apps/api/Dockerfile', 'ENV NODE_ENV=production', 'ENV NODE_ENV=production\nENV JWT_ACCESS_SECRET=baked-value');
    });
    assert(status !== 0, 'the audit PASSED an image that bakes a signing secret.');
    assert(/bake|credential/i.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the baked credential';
  });

  await check('M7: the web health fallback pointing at the wrong port is detected', () => {
    const { status, output } = withScratch((root) => {
      patch(
        root,
        'apps/web/src/app/health/page.tsx',
        "'http://localhost:3000'",
        "'http://localhost:9999'",
      );
    });
    assert(status !== 0, 'the audit PASSED a health page that probes a port the API does not listen on.');
    assert(/port/i.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the port mismatch';
  });

  await check('M8: the rate-limit bypass losing its NODE_ENV guard is detected', () => {
    const { status, output } = withScratch((root) => {
      patch(
        root,
        'apps/api/src/auth/guards/rate-limit.guard.ts',
        "if (process.env['NODE_ENV'] !== 'test') return false;",
        'if (false) return false;',
      );
    });
    assert(
      status !== 0,
      'the audit PASSED a rate-limit bypass guarded only by ECC_TEST_DISABLE_RATE_LIMIT, which would restore ' +
        'the accidental-production-bypass class Phase 18 removed.',
    );
    assert(/rate-limit|ECC_TEST_DISABLE_RATE_LIMIT/i.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the weakened bypass guard';
  });

  await check('M9: the global ValidationPipe losing `transform` is detected', () => {
    const { status, output } = withScratch((root) => {
      patch(root, 'apps/api/src/main.ts', '      transform: true,\n', '');
    });
    assert(
      status !== 0,
      'the audit PASSED with `transform` removed from the global ValidationPipe. The gate is supposed to assert this ' +
        'exact source configuration, and a regex that silently stopped matching would have made the audit vacuous.',
    );
    assert(/transform/.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the missing transform flag';
  });

  await check('M10: the global ValidationPipe losing `whitelist` is detected', () => {
    const { status, output } = withScratch((root) => {
      patch(root, 'apps/api/src/main.ts', '      whitelist: true,\n', '');
    });
    assert(status !== 0, 'the audit PASSED with `whitelist` removed from the global ValidationPipe.');
    assert(/whitelist/.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the missing whitelist flag';
  });

  await check('M11: the global ValidationPipe losing `forbidNonWhitelisted` is detected', () => {
    const { status, output } = withScratch((root) => {
      patch(root, 'apps/api/src/main.ts', '      forbidNonWhitelisted: true,\n', '');
    });
    assert(
      status !== 0,
      'the audit PASSED with `forbidNonWhitelisted` removed. Without it unknown properties are stripped silently ' +
        'instead of rejected, which is the class of weakness this assertion exists to prevent.',
    );
    assert(/forbidNonWhitelisted/.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the missing forbidNonWhitelisted flag';
  });

  await check('M12: a strictness flag flipped to false rather than removed is detected', () => {
    const { status, output } = withScratch((root) => {
      patch(root, 'apps/api/src/main.ts', '      whitelist: true,', '      whitelist: false,');
    });
    assert(
      status !== 0,
      'the audit PASSED a ValidationPipe that explicitly sets `whitelist: false`. A deletion-only assertion would miss ' +
        'this entirely, because the property is still present in the source.',
    );
    assert(/whitelist/.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the flag present but set to false';
  });

  await check('M13: a flag held as a non-literal is detected', () => {
    const { status, output } = withScratch((root) => {
      patch(root, 'apps/api/src/main.ts', '      forbidNonWhitelisted: true,', '      forbidNonWhitelisted: process.env.NODE_ENV === "production",');
    });
    assert(
      status !== 0,
      'the audit PASSED a strictness flag expressed as a conditional. It may evaluate true in production, but it is ' +
        'not statically provable, and the value would silently depend on the environment.',
    );
    assert(/forbidNonWhitelisted/.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the non-literal flag value';
  });

  await check('M14: the test harness weakening its mirror of the pipe is detected', () => {
    const { status, output } = withScratch((root) => {
      patch(
        root,
        'apps/api/src/testing/create-test-app.ts',
        'new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })',
        'new ValidationPipe({ transform: true })',
      );
    });
    assert(
      status !== 0,
      'the audit PASSED with production strict but a weakened test harness. That divergence is how a spec ends up ' +
        'asserting behaviour production does not have.',
    );
    assert(/create-test-app/.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the harness/production divergence';
  });

  await check('M15: the global ValidationPipe registration removed entirely is detected', () => {
    const { status, output } = withScratch((root) => {
      patch(
        root,
        'apps/api/src/main.ts',
        '  app.useGlobalPipes(\n    new ValidationPipe({\n      transform: true,\n      whitelist: true,\n      forbidNonWhitelisted: true,\n    }),\n  );\n\n',
        '',
      );
    });
    assert(
      status !== 0,
      'the audit PASSED a bootstrap with no global ValidationPipe at all. Every DTO rule would be inert while every ' +
        'DTO and its spec remained in place — the greenest possible appearance of security that validates nothing.',
    );
    assert(/main\.ts/.test(output), `the audit failed for an unrelated reason:\n${output}`);
    return 'audit reported the absent registration';
  });

  await check('the repository is unchanged by the harness', () => {
    const run = spawnSync(process.execPath, [audit], { encoding: 'utf8', cwd: repoRoot });
    assert(run.status === 0, `the repository no longer passes the audit after the mutants:\n${run.stdout}${run.stderr}`);
    return 'the real repository is still clean';
  });

  if (failures > 0) {
    console.error(`\nFAILED — ${failures} mutation check(s) did not hold.\n`);
    process.exit(1);
  }
  console.log('\nThe configuration audit detects undocumented reads, unread documents, baked secrets and version drift.\n');
}

void main();
