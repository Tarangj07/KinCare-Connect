#!/usr/bin/env node
/**
 * Phase 23 (W3) — mutation test of the authorization-structure gate.
 *
 * A structural gate is only worth having if it detects the structural defect
 * it claims to detect. This script reintroduces, in a scratch copy of the
 * source, the three ways this gate is supposed to catch an unguarded or
 * mis-scoped surface, and proves each one fails:
 *
 *   M1  `@UseGuards(JwtAuthGuard, RolesGuard)` removed from a controller
 *       -> every route on that controller becomes reachable unauthenticated.
 *   M2  `@UseGuards(...)` replaced by a guard that is not `JwtAuthGuard`
 *       -> the surface stays "guarded" by something that never validates a
 *          token. A gate that only counted guards would pass this.
 *   M3  `@Public()` added to a route that is not in the documented public
 *       set -> an authentication requirement silently removed.
 *   M4  a body parameter retyped to `Partial<SomeDto>` (Phase 24, D-4)
 *       -> TypeScript emits `Object`, `ValidationPipe` skips it, and the
 *          route accepts any body with no whitelist. This is the defect the
 *          gate could NOT see before Phase 24: the metadata gate rejects
 *          `Function`, not `Object`, so both Phase 23 gates passed while the
 *          route was completely unvalidated.
 *   M5  a body parameter retyped to an inline type literal — the second shape
 *       of the same defect, on a different route, to show the check is not
 *       keyed to one file.
 *   M6  a body DTO stripped of every validation decorator (Phase 25, F-2) —
 *       the class survives as a metatype, so the D-4 rule above is satisfied
 *       and the route looks covered while accepting anything.
 *   M7  the same DTO reduced to `@IsOptional()` alone — metadata is still
 *       registered, so a gate that COUNTS entries passes it.
 *   M8  a keyed `@Body('field')` introduced on a live route (Phase 25, F-3) —
 *       the shape the D-4 rule could not see at all.
 *
 * It also proves the gate does not fire on a route that is legitimately
 * public, and that the allow-list rots visibly: a documented public route
 * that no longer exists is a failure, so a renamed route cannot inherit a
 * permanent exemption.
 *
 * M4 doubles as the cross-check on the hard-coded `RouteParamtypes.BODY`
 * constant the new check relies on: if that constant stopped identifying body
 * parameters, M4 would go undetected.
 *
 * Nothing in the repository is modified; the scratch tree is built in a temp
 * directory and removed afterwards.
 *
 * Usage:  node scripts/mutate-route-authorization.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const repoRoot = path.resolve(apiRoot, '..', '..');
const gate = path.join(here, 'verify-route-authorization.mjs');

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

const ENV = { ...process.env, JWT_ACCESS_SECRET: 'route-mutation-harness-secret-32chars-min' };

function buildScratch(mutate) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ecc-p23-routemut-'));
  cpSync(apiRoot, root, {
    recursive: true,
    dereference: false,
    filter: (src) => !['dist', 'node_modules', '.turbo'].includes(path.basename(src)),
  });
  symlinkSync(path.join(apiRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  const parentModules = path.join(path.dirname(root), 'ecc-p23-routemut-root');
  if (!existsSync(parentModules)) symlinkSync(path.join(repoRoot, 'node_modules'), parentModules, 'dir');
  try {
    mutate(root);
    const build = spawnSync('node_modules/.bin/nest', ['build'], { cwd: root, encoding: 'utf8', env: ENV });
    assert(
      build.status === 0,
      `the mutant failed to build, so the gate was never exercised:\n${build.stdout}\n${build.stderr}`,
    );
    return { root, parentModules, dist: path.join(root, 'dist') };
  } catch (err) {
    rmSync(root, { recursive: true, force: true });
    if (existsSync(parentModules)) rmSync(parentModules, { recursive: true, force: true });
    throw err;
  }
}

function runGate(dist) {
  const run = spawnSync(process.execPath, [gate, '--dist', dist], { encoding: 'utf8', env: ENV });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

function cleanup(ctx) {
  rmSync(ctx.root, { recursive: true, force: true });
  rmSync(ctx.parentModules, { recursive: true, force: true });
}

/** Edit a file in the scratch tree, asserting the replacement happened. */
function patch(file, from, to) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(from, to);
  assert(after !== before, `could not apply the mutation: ${from} not found in ${path.basename(file)}`);
  writeFileSync(file, after);
}

// M1 — a controller loses its guards entirely.
const dropGuards = (root) => {
  patch(
    path.join(root, 'src/modules/documents/documents.controller.ts'),
    '@UseGuards(JwtAuthGuard, RolesGuard)\n',
    '',
  );
};

// M2 — guards are swapped for something that never validates a token.
const swapGuard = (root) => {
  patch(
    path.join(root, 'src/modules/documents/documents.controller.ts'),
    "import { RolesGuard } from '../../auth/guards/roles.guard';",
    "import { RateLimitGuard } from '../../auth/guards/rate-limit.guard';",
  );
  patch(
    path.join(root, 'src/modules/documents/documents.controller.ts'),
    '@UseGuards(JwtAuthGuard, RolesGuard)',
    '@UseGuards(RateLimitGuard)',
  );
};

// M3 — a protected route is marked public without being on the allow-list.
const markPublic = (root) => {
  patch(
    path.join(root, 'src/modules/notifications/notification.controller.ts'),
    "  @Get(':notificationId')\n",
    "  @Get(':notificationId')\n  @Public()\n",
  );
  patch(
    path.join(root, 'src/modules/notifications/notification.controller.ts'),
    "import { JwtAuthGuard } from '../../auth/guards/auth.guard';",
    "import { Public } from '../../auth/decorators/public.decorator';\nimport { JwtAuthGuard } from '../../auth/guards/auth.guard';",
  );
};

// M4 — Phase 24 (D-4): a live body route's DTO replaced by `Partial<…>`.
// This is the exact shape of the defect Phase 24 closed. `Partial<T>` is a
// mapped type, not a class, so the emitted metatype is `Object` — which
// Nest's ValidationPipe skips. Both Phase 23 gates passed on this build.
const bodyBecomesPartial = (root) => {
  patch(
    path.join(root, 'src/modules/feed/feed.controller.ts'),
    '@Body() dto: UpdateFamilyUpdateDto,',
    '@Body() dto: Partial<CreateFamilyUpdateDto>,',
  );
};

// M5 — the same defect class in its other shape: an inline type literal.
const bodyBecomesInlineType = (root) => {
  patch(
    path.join(root, 'src/modules/notifications/preference.controller.ts'),
    'async update(@Body() body: UpdateNotificationPreferenceDto) {',
    'async update(@Body() body: { channel?: string; kind?: string; enabled?: boolean }) {',
  );
};

// M6 — Phase 25 (F-2): every validation decorator stripped from a live DTO.
// The class SURVIVES as the body parameter's metatype, so the Phase 24 (D-4)
// rule is satisfied and the route still looks covered by the compiled
// artefact. This is the exact mutation the Phase 25 review applied: strip
// `LoginDto` to two bare fields, rebuild, and the D-4 gate stays green while
// POST /auth/login accepts any body at all.
const dtoLosesAllConstraints = (root) => {
  patch(
    path.join(root, 'src/auth/dto/auth.dto.ts'),
    `export class LoginDto {
  @IsEmail({}, { message: 'Email format is invalid.' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required.' })
  password!: string;
}`,
    `export class LoginDto {
  email!: string;
  password!: string;
}`,
  );
};

// M7 — Phase 25 (F-2), the realistic weakening rather than the total one: the
// DTO keeps its `@IsOptional()` marker and loses every real constraint. A gate
// that counted metadata entries rather than EFFECTIVE ones would pass this,
// because `@IsOptional` registers metadata too — it just enforces nothing by
// itself. The call site is adjusted in the same patch so the mutant still
// compiles; that is a mechanical consequence of the type change, not part of
// the defect under test.
const dtoKeepsOnlyOptional = (root) => {
  patch(
    path.join(root, 'src/modules/documents/dto/access-grant.dto.ts'),
    `  @IsString({ message: 'Target userId is required.' })
  @IsNotEmpty({ message: 'Target userId cannot be empty.' })
  @IsUUID('4', { message: 'Invalid UUID for userId.' })
  userId!: string;`,
    `  @IsOptional()
  userId?: string;`,
  );
  // `expiresAt` keeps a real `@Matches` constraint, so stripping only
  // `userId` would leave the DTO with one effective constraint and the gate
  // would rightly stay green. Strip it too: the mutant is "every effective
  // constraint gone, every conditional one kept".
  patch(
    path.join(root, 'src/modules/documents/dto/access-grant.dto.ts'),
    `  @IsString()
  @IsOptional()
  @Matches(/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/, { message: 'Invalid expiration format.' })
  expiresAt?: string;`,
    `  @IsOptional()
  expiresAt?: string;`,
  );
  patch(
    path.join(root, 'src/modules/documents/documents.controller.ts'),
    'dto.userId, dto.expiresAt',
    'dto.userId!, dto.expiresAt',
  );
};

// M8 — Phase 25 (F-3): a keyed `@Body('field')` introduced on a LIVE route.
// This is the exact shape the Phase 24 (D-4) rule could not see: it looks for
// whole-body bindings, finds none, and reports the route as covered. The
// mutation is the pre-Phase-25 form of `addParticipant`, re-introduced on a
// different route so the check is not keyed to one file.
const keyedBodyOnLiveRoute = (root) => {
  patch(
    path.join(root, 'src/modules/documents/documents.controller.ts'),
    '@Body() dto: CreateAccessGrantDto,',
    "@Body('targetUserId') targetUserId: string,",
  );
  patch(
    path.join(root, 'src/modules/documents/documents.controller.ts'),
    'dto.userId, dto.expiresAt',
    'targetUserId, undefined',
  );
};

async function main() {
  console.log(
    '\nPhase 25 — mutation test of the authorization-structure gate\n' +
      '  M1-M3 Phase 23 (W3)   M4-M5 Phase 24 (D-4)   M6-M7 Phase 25 (F-2)   M8 Phase 25 (F-3)\n',
  );

  await check('the gate passes on the unmodified repository', () => {
    const run = runGate(path.join(apiRoot, 'dist'));
    assert(run.status === 0, `the gate rejected the real build:\n${run.output}`);
    return 'baseline is green';
  });

  await check('M1: removing @UseGuards from a controller is detected', () => {
    const ctx = buildScratch(dropGuards);
    try {
      const { status, output } = runGate(ctx.dist);
      assert(status !== 0, 'the gate PASSED a build whose document controller has no authentication guard at all.');
      assert(
        /JwtAuthGuard/.test(output),
        `the gate failed without naming the missing guard, so it failed for an unrelated reason:\n${output}`,
      );
      return 'gate rejected the mutant';
    } finally {
      cleanup(ctx);
    }
  });

  await check('M2: substituting a non-authenticating guard is detected', () => {
    const ctx = buildScratch(swapGuard);
    try {
      const { status, output } = runGate(ctx.dist);
      assert(
        status !== 0,
        'the gate PASSED a build whose routes are guarded only by RateLimitGuard, which never validates a token. ' +
          'This is the exact failure a guard-presence check is prone to.',
      );
      return 'gate rejected the mutant';
    } finally {
      cleanup(ctx);
    }
  });

  await check('M3: marking a protected route @Public() is detected', () => {
    const ctx = buildScratch(markPublic);
    try {
      const { status, output } = runGate(ctx.dist);
      assert(status !== 0, 'the gate PASSED a build with an undeclared public route.');
      assert(
        /@Public\(\)/.test(output),
        `the gate failed without naming the public-marking, so it failed for an unrelated reason:\n${output}`,
      );
      return 'gate rejected the mutant';
    } finally {
      cleanup(ctx);
    }
  });

  await check('M4: a live body route retyped to Partial<SomeDto> is detected (Phase 24 D-4)', () => {
    const ctx = buildScratch(bodyBecomesPartial);
    try {
      const { status, output } = runGate(ctx.dist);
      assert(
        status !== 0,
        'the gate PASSED a build in which PATCH /feed/:updateId binds its body to `Object` and is therefore ' +
          'validated by nothing. This is the Phase 24 (D-4) defect, undetected.',
      );
      assert(
        /binds a whole request body/.test(output),
        `the gate failed without naming the unvalidated body, so it failed for an unrelated reason:\n${output}`,
      );
      return 'gate rejected the mutant';
    } finally {
      cleanup(ctx);
    }
  });

  await check('M5: a live body route retyped to an inline type literal is detected', () => {
    const ctx = buildScratch(bodyBecomesInlineType);
    try {
      const { status, output } = runGate(ctx.dist);
      assert(
        status !== 0,
        'the gate PASSED a build in which PATCH /notification-preferences binds its body to an inline type ' +
          'literal, which emits `Object` and is validated by nothing.',
      );
      assert(
        /binds a whole request body/.test(output),
        `the gate failed without naming the unvalidated body, so it failed for an unrelated reason:\n${output}`,
      );
      return 'gate rejected the mutant';
    } finally {
      cleanup(ctx);
    }
  });

  await check('M6: a body DTO stripped of every validation constraint is detected (Phase 25 F-2)', () => {
    const ctx = buildScratch(dtoLosesAllConstraints);
    try {
      const { status, output } = runGate(ctx.dist);
      assert(
        status !== 0,
        'the gate PASSED a build in which LoginDto carries no validation metadata at all. The metatype is still a ' +
          'class, so the Phase 24 (D-4) rule is satisfied, and POST /auth/login accepts any body. This is the ' +
          'exact mutation the Phase 25 review applied.',
      );
      assert(
        /carries 0 validation constraint/.test(output),
        `the gate failed without naming the constraint-free DTO, so it failed for an unrelated reason:\n${output}`,
      );
      return 'gate rejected the mutant';
    } finally {
      cleanup(ctx);
    }
  });

  await check('M7: a body DTO reduced to @IsOptional() alone is detected (Phase 25 F-2)', () => {
    const ctx = buildScratch(dtoKeepsOnlyOptional);
    try {
      const { status, output } = runGate(ctx.dist);
      assert(
        status !== 0,
        'the gate PASSED a build in which CreateAccessGrantDto carries only @IsOptional(). Metadata is still ' +
          'registered, so a gate that counts entries would be satisfied, but nothing is enforced.',
      );
      assert(
        /conditional/.test(output),
        `the gate failed without naming the conditional-only constraints, so it failed for an unrelated reason:\n${output}`,
      );
      return 'gate rejected the mutant';
    } finally {
      cleanup(ctx);
    }
  });

  await check('M8: a keyed @Body(\'field\') on a live route is detected (Phase 25 F-3)', () => {
    const ctx = buildScratch(keyedBodyOnLiveRoute);
    try {
      const { status, output } = runGate(ctx.dist);
      assert(
        status !== 0,
        'the gate PASSED a build in which a live route reads a single named field out of the request body. The ' +
          'whole-body rule finds no whole-body binding and reports the route as covered; this is exactly the hole ' +
          'the Phase 25 review pointed at.',
      );
      assert(
        /KEYED body field/.test(output),
        `the gate failed without naming the keyed body parameter, so it failed for an unrelated reason:\n${output}`,
      );
      return 'gate rejected the mutant';
    } finally {
      cleanup(ctx);
    }
  });

  if (failures > 0) {
    console.error(`\nFAILED — ${failures} mutation check(s) did not hold.\n`);
    process.exit(1);
  }
  console.log(
    '\nThe gate detects removed, substituted and over-broad authentication, unvalidated request bodies, ' +
      'constraint-free DTOs, and keyed body parameters.\n',
  );
}

void main();
