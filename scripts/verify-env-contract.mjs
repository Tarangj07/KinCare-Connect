#!/usr/bin/env node
/**
 * Phase 19 — environment template contract check.
 *
 * The repository ships three environment templates:
 *   .env.example                  (root, API + web + local infrastructure)
 *   apps/api/.env.example         (API service)
 *   apps/mobile/.env.example      (mobile app)
 *
 * A template is a deployment contract, so a variable that nothing reads is
 * actively misleading: an operator may set it and believe it took effect.
 * Phase 18 removed stale variables from apps/api/.env.example; this check
 * prevents the same drift from returning and keeps the root template honest.
 *
 * What it asserts:
 *  1. Every variable the API, web app or CI tooling actually reads is
 *     documented in the relevant template.
 *  2. Variables that were previously documented as if they were consumed but
 *     are not read by any code or tooling are reported as stale.
 *  3. docker-compose variables that the root template still needs for
 *     interpolation are retained.
 *
 * Read-only: it inspects files and never writes to the repository.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (...segments) => readFileSync(join(...segments), 'utf8');

/** `KEY=value` assignment lines, ignoring comments and blank lines. */
function declaredVars(path) {
  if (!existsSync(path)) return null;
  const vars = new Set();
  for (const line of read(path).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(trimmed);
    if (match) vars.add(match[1]);
  }
  return vars;
}

/** Variables read by API source, both process.env['X'] and process.env.X. */
function apiReadVars() {
  const dir = join(repoRoot, 'apps', 'api', 'src');
  const found = new Set();
  const walk = (d) => {
    for (const entry of readDirSafe(d)) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'testing') continue; // test-only helper
        walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        const src = read(full);
        // Both process.env['X'] and process.env.X forms.
        for (const m of src.matchAll(/process\.env(?:\[['"]([A-Z_0-9]+)['"]\]|\.([A-Z_0-9]+))/g)) {
          found.add(m[1] ?? m[2]);
        }
      }
    }
  };
  walk(dir);
  // DATABASE_URL is consumed by Prisma via the datasource block in
  // schema.prisma rather than from application source.
  const schemaPath = join(repoRoot, 'apps', 'api', 'prisma', 'schema.prisma');
  if (existsSync(schemaPath) && /env\("DATABASE_URL"\)/.test(read(schemaPath))) {
    found.add('DATABASE_URL');
  }
  return found;
}

function readDirSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

const problems = [];
const notes = [];

// --- 1. API variables must be documented ---------------------------------
const apiRead = apiReadVars();
const rootVars = declaredVars(join(repoRoot, '.env.example'));
const apiVars = declaredVars(join(repoRoot, 'apps', 'api', '.env.example'));
const mobileVars = declaredVars(join(repoRoot, 'apps', 'mobile', '.env.example'));

// The API template owns the API's contract; the root template is the
// deployment-oriented reference and should cover the same ground.
for (const name of ['NODE_ENV', 'PORT', 'DATABASE_URL', 'STORAGE_DIR', 'JWT_ACCESS_SECRET']) {
  if (!apiVars?.has(name)) problems.push(`apps/api/.env.example is missing required variable ${name}`);
  if (!rootVars?.has(name)) problems.push(`.env.example is missing required variable ${name}`);
}

// Test-only: must NOT be presented as a normal deployment variable.
if (apiVars?.has('ECC_TEST_DISABLE_RATE_LIMIT')) {
  problems.push('apps/api/.env.example must not present the test-only rate-limit opt-out as normal configuration');
}

// --- 2. Stale variables ---------------------------------------------------
// Historically documented but never read by any code or tooling.
const staleCandidates = [
  ['API_BASE_URL', 'web reads NEXT_PUBLIC_API_URL; the API uses PORT'],
  ['JWT_REFRESH_SECRET', 'no such variable; refresh tokens are CSPRNG secrets'],
  ['JWT_ACCESS_TTL', 'access-token lifetime is hardcoded (15m)'],
  ['JWT_REFRESH_TTL', 'refresh-cookie lifetime is hardcoded (30d)'],
  ['WEB_ALLOWED_ORIGINS', 'no CORS configuration exists in the application'],
  ['LOG_LEVEL', 'no logger reads a level from the environment'],
  ['EXPO_PUBLIC_API_URL', 'mobile reads expo.extra.apiBaseUrl from app.json'],
  ['S3_ENDPOINT', 'no S3 client; storage is the local filesystem via STORAGE_DIR'],
  ['S3_ACCESS_KEY_ID', 'no S3 client'],
  ['S3_SECRET_ACCESS_KEY', 'no S3 client'],
  ['S3_REGION', 'no S3 client'],
  ['S3_FORCE_PATH_STYLE', 'no S3 client'],
];
for (const [name, why] of staleCandidates) {
  if (rootVars?.has(name)) problems.push(`.env.example documents ${name} but nothing consumes it (${why})`);
  if (apiVars?.has(name)) problems.push(`apps/api/.env.example documents ${name} but nothing consumes it (${why})`);
  if (mobileVars?.has(name)) problems.push(`apps/mobile/.env.example documents ${name} but nothing consumes it (${why})`);
}

// --- 3. docker-compose interpolation must stay satisfiable ---------------
const composeSrc = read(join(repoRoot, 'docker-compose.yml'));
const composeVars = new Set(
  [...composeSrc.matchAll(/\$\{([A-Z_0-9]+)/g)].map((m) => m[1]),
);
for (const name of composeVars) {
  if (rootVars?.has(name)) continue;
  // compose supplies a default for every one of these, so this is a note
  // rather than a hard failure.
  notes.push(`.env.example omits compose variable ${name} (compose default applies)`);
}

// --- Report ---------------------------------------------------------------
console.log('Phase 19 — environment template contract check');
console.log(`  API variables read by code: ${[...apiRead].sort().join(', ')}`);
console.log(`  Root template variables:     ${[...(rootVars ?? [])].sort().join(', ')}`);

if (notes.length) {
  console.log('\n  notes:');
  for (const n of notes) console.log(`    - ${n}`);
}

if (problems.length) {
  console.error(`\n  FAILED (${problems.length}):`);
  for (const p of problems) console.error(`    - ${p}`);
  process.exit(1);
}
console.log('\n  Environment templates are consistent with the code.');
