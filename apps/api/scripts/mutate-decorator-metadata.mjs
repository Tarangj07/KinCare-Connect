#!/usr/bin/env node
/**
 * Phase 23 (W1) — mutation test for the decorator-metadata gate.
 *
 * A gate that has never been shown to fail is not a gate. This script
 * reintroduces the exact Phase 22 (F-01) defect — `import type` for a DTO
 * used as a controller parameter — into a *scratch copy* of the API source,
 * builds it, and proves that `verify-decorator-metadata.mjs` rejects the
 * result. It then proves the gate passes again on the unmodified build.
 *
 * Nothing in the repository is touched. The scratch tree is built in a
 * temporary directory outside the workspace, the original `dist/` is
 * restored afterwards, and the script exits non-zero if the gate fails to
 * detect the mutant — which would mean the gate is decorative.
 *
 * Two mutants are exercised, because they fail for different reasons and a
 * gate that only catches one is fragile:
 *
 *   M1  `import type` for the auth DTOs
 *       -> tsc emits `Function`; the pipe runs against a constraint-free
 *          constructor and every field is rejected (register/login return
 *          400 for all users).
 *
 *   M2  a controller parameter retyped to a bare interface
 *       -> tsc emits `Object`; Nest's ValidationPipe SKIPS validation and
 *          the raw body passes through unvalidated. This is the quieter
 *          half of the same class and the reason the gate checks identity
 *          rather than only the `Function` fingerprint.
 *
 * Usage:  node scripts/mutate-decorator-metadata.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const repoRoot = path.resolve(apiRoot, '..', '..');
const gate = path.join(here, 'verify-decorator-metadata.mjs');

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

const originalDistExists = existsSync(path.join(apiRoot, 'dist'));
const originalDist = path.join(apiRoot, 'dist');
let scratchRoot;

/** Build a scratch tree, run the gate against it, restore everything. */
async function withMutant(label, mutate, assertion) {
  scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'ecc-p23-mutant-'));
  // Copy the whole API app (src, prisma, configs, node_modules symlinks) so
  // `nest build` and the gate both work unchanged inside the scratch tree.
  cpSync(apiRoot, scratchRoot, {
    recursive: true,
    dereference: false,
    filter: (src) => {
      const base = path.basename(src);
      if (base === 'dist' || base === 'node_modules' || base === '.turbo') return false;
      return true;
    },
  });
  // node_modules is excluded above for speed; link it so the build resolves.
  const link = path.join(scratchRoot, 'node_modules');
  try {
    symlinkSync(path.join(apiRoot, 'node_modules'), link, 'dir');
  } catch (err) {
    throw new Error(`could not link node_modules into the scratch tree: ${err.message}`);
  }
  // Workspace packages are resolved through the real root; link the repo
  // node_modules too so `@ecc/*` resolves from the scratch app.
  const rootModules = path.join(scratchRoot, '..', 'ecc-p23-root-node_modules');
  if (!existsSync(rootModules)) {
    symlinkSync(path.join(repoRoot, 'node_modules'), rootModules, 'dir');
  }

  mutate(scratchRoot);

  // Build the mutant. `nest build` resolves tsconfig from the scratch cwd.
  const build = spawnSync('node_modules/.bin/nest', ['build'], {
    cwd: scratchRoot,
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert(
    build.status === 0,
    `the mutant itself failed to build, so the gate was never exercised:\n${build.stdout}\n${build.stderr}`,
  );

  const dist = path.join(scratchRoot, 'dist');
  assert(existsSync(path.join(dist, 'main.js')), 'the mutant build emitted no dist/main.js');

  const gateRun = spawnSync(process.execPath, [gate, '--dist', dist], {
    cwd: scratchRoot,
    encoding: 'utf8',
    env: { ...process.env, JWT_ACCESS_SECRET: 'mutation-harness-only-ephemeral-secret-32chars' },
  });
  const output = `${gateRun.stdout}${gateRun.stderr}`;

  try {
    assertion(gateRun.status, output);
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
    rmSync(rootModules, { recursive: true, force: true });
    scratchRoot = undefined;
  }
}

// M1 — the Phase 22 defect, reintroduced exactly.
const mutateTypeImport = (root) => {
  const file = path.join(root, 'src/auth/auth.controller.ts');
  const before = readFileSync(file, 'utf8');
  const after = before.replace(
    /^import \{ LoginDto, RefreshDto, RegisterDto \} from '\.\/dto\/auth\.dto';$/m,
    "import type { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';",
  );
  assert(after !== before, 'M1 could not be applied: the auth DTO import line was not found.');
  writeFileSync(file, after);
};

// M2 — a DTO replaced by a bare interface of the same shape.
const mutateInterfaceParam = (root) => {
  const file = path.join(root, 'src/auth/auth.controller.ts');
  const before = readFileSync(file, 'utf8');
  const after =
    before.replace(
      /^import \{ LoginDto, RefreshDto, RegisterDto \} from '\.\/dto\/auth\.dto';$/m,
      '',
    ) +
    '\ninterface RegisterLike {\n  email: string;\n  password: string;\n  fullName: string;\n}\n';
  // Target the method signature itself, not the explanatory comment that
  // also mentions the DTO by name.
  let next = after.replace('async register(@Body() dto: RegisterDto)', 'async register(@Body() dto: RegisterLike)');
  assert(next !== after, 'M2 could not be applied: the register method signature was not found.');
  // `LoginDto` is still referenced by login(); keep the import but drop the
  // register binding so the file still compiles.
  next = next.replace(
    "import { AuthService } from './auth.service';",
    "import { LoginDto, RefreshDto } from './dto/auth.dto';\nimport { AuthService } from './auth.service';",
  );
  writeFileSync(file, next);
};

async function main() {
  console.log('\nPhase 23 (W1) — mutation test of the decorator-metadata gate\n');

  // The unmutated repository must pass, or "the gate failed" below would
  // prove nothing.
  await check('the gate passes on the unmodified repository', () => {
    const run = spawnSync(process.execPath, [gate], {
      cwd: apiRoot,
      encoding: 'utf8',
      env: { ...process.env, JWT_ACCESS_SECRET: 'mutation-harness-only-ephemeral-secret-32chars' },
    });
    assert(
      run.status === 0,
      `the gate rejected the real build:\n${run.stdout}${run.stderr}`,
    );
    return 'baseline is green';
  });

  await check('M1: `import type` on a controller DTO is detected', () =>
    withMutant('M1', mutateTypeImport, (status, output) => {
      assert(
        status !== 0,
        'the gate PASSED a build carrying the exact Phase 22 (F-01) defect. It is not a real gate.',
      );
      assert(
        /import type|Function|type-only/.test(output),
        `the gate failed, but not for a metadata reason — the message does not mention the elided import:\n${output}`,
      );
      return 'gate rejected the mutant';
    }),
  );

  await check('M2: a DTO replaced by a bare interface is detected', () =>
    withMutant('M2', mutateInterfaceParam, (status, output) => {
      assert(
        status !== 0,
        'the gate PASSED a build whose register DTO degraded to an unvalidated interface. Validation would ' +
          'be silently skipped in production while every source-level test still passed.',
      );
      return 'gate rejected the mutant';
    }),
  );

  // The repository's own dist must be left exactly as we found it.
  if (originalDistExists && !existsSync(originalDist)) {
    failures += 1;
    console.error('  FAIL  the harness removed the repository dist/ directory');
  }

  if (failures > 0) {
    console.error(`\nFAILED — ${failures} mutation check(s) did not hold.\n`);
    process.exit(1);
  }
  console.log('\nThe gate detects both halves of the Phase 22 defect class.\n');
}

void main();
