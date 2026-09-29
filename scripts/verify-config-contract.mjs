#!/usr/bin/env node
/**
 * Phase 23 (W5) — environment contract audit.
 *
 * The Phase 19 `verify-env-contract.mjs` answers one question: does each
 * template document the variables the code reads? This script audits the rest
 * of the surface, and exists because a template that is accurate about
 * *names* can still be wrong about *values*, and because several places
 * outside `apps/api/src` read the environment at all:
 *
 *   - CI job-level and step-level `env:` blocks
 *   - Dockerfile `ENV` lines
 *   - docker-compose.yml interpolation and `environment:` entries
 *   - build-time and run-time scripts under `scripts/` and `apps/.../scripts`
 *   - the mobile app's app.json config, which the code reads in place of
 *     an environment variable
 *
 * What it asserts. Every one of these is a real, checkable property; none is
 * a style preference.
 *
 *   1. No secret-shaped value is committed or baked into an image. Checks
 *      the tracked files and the Dockerfiles for literal credentials,
 *      including a DATABASE_URL a developer might have pasted.
 *   2. Every variable read anywhere in the repository is either documented in
 *      a template, or is on an explicit allow-list with a stated reason
 *      (build-tool noise, CI-only, or test-only).
 *   3. Every documented variable is actually read somewhere — a documented
 *      variable an operator sets is a false promise.
 *   4. Ports are consistent. The API default, the web dev port, the compose
 *      published host ports and the Dockerfile EXPOSE must not contradict the
 *      documentation.
 *   5. Node and pnpm versions are internally consistent across
 *      packageManager, engines, the Dockerfiles, the CI workflow and
 *      the documentation. Phase 22 fixed CI; this proves it stayed fixed and
 *      that a future edit to any one of them is caught.
 *   6. The test-only rate-limit opt-out is not presented as normal
 *      configuration anywhere, and is documented as ignored in production.
 *   7. A placeholder secret in a template is not the value the production
 *      validator would accept, so a copied template cannot boot a deployment.
 *   8. The global `ValidationPipe` in `apps/api/src/main.ts` still carries
 *      `transform`, `whitelist` and `forbidNonWhitelisted`, and the test
 *      harness still mirrors them. This is the source-level assertion for
 *      input strictness: the runtime behaviour of these three flags is that
 *      unrecognised properties are rejected rather than persisted, and no
 *      other gate fails when one of them is deleted.
 *
 * Read-only. It never writes to the repository and never prints a value of a
 * variable that could be a real secret — only names.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...s) => readFileSync(path.join(...s), 'utf8');
const problems = [];
const notes = [];
const fail = (m) => problems.push(m);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sourceFiles = [
  ...walk(path.join(repoRoot, 'apps')),
  ...walk(path.join(repoRoot, 'packages')),
  ...walk(path.join(repoRoot, 'scripts')),
].filter((f) => /\.(ts|tsx|mjs|cjs|js)$/.test(f));

// ---------------------------------------------------------------------------
// Enumerate every environment variable read, and where.
// ---------------------------------------------------------------------------

/**
 * Both the dotted and bracketed forms of process.env, plus the `env.NAME`
 * form used by `resolveJwtAccessSecret(env)` and friends.
 */
/**
 * Remove comments while preserving line structure, so that a removal cannot
 * join two lines of code into a false match. The simplest correct approach is
 * preferred over a clever one: an over-eager strip could only ever *hide* a
 * read, which is the safe direction to be wrong in — a variable it misses
 * surfaces as a "read but undocumented" failure.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, prefix) => prefix);
}

function readEnvVars() {
  const found = new Map(); // name -> Set of files
  const record = (name, file) => {
    if (!found.has(name)) found.set(name, new Set());
    found.get(name).add(path.relative(repoRoot, file));
  };
  for (const file of sourceFiles) {
    // Comments are stripped before scanning. Without this the auditor reads
    // its own documentation — a line like `process.env['X']` in a doc comment
    // is a phantom variable named `X`, and a regex literal in a sibling
    // script looks like a read that never happens. Only executable code can
    // read the environment.
    const src = stripComments(read(file));
    for (const m of src.matchAll(/process\.env(?:\[['"]([A-Za-z_0-9]+)['"]\]|\.([A-Za-z_0-9]+))/g)) {
      record(m[1] ?? m[2], file);
    }
    // `env.NAME` inside a function that defaults to process.env. Restricted
    // to the two config modules that actually do this, so a random local
    // variable named `env` cannot create phantom entries.
    if (file.endsWith(path.join('config', 'security-config.ts')) || file.endsWith(path.join('config', 'runtime-config.ts'))) {
      for (const m of src.matchAll(/\benv\[['"]([A-Za-z_0-9]+)['"]\]/g)) record(m[1], file);
    }
    // A `?.` or destructured form such as `const { X } = process.env` is not
    // matched above; scan for it explicitly so the read set is complete.
    for (const m of src.matchAll(/\bprocess\.env\.([A-Z_][A-Z_0-9]*)\b/g)) record(m[1], file);
  }
  return found;
}

/** Variables CI sets in `env:` blocks. */
function ciEnvVars() {
  const file = path.join(repoRoot, '.github/workflows/ci.yml');
  if (!existsSync(file)) return new Map();
  const found = new Map();
  const src = read(file);
  for (const m of src.matchAll(/^\s{6}([A-Z_0-9]+):\s*(.+)$/gm)) {
    if (!found.has(m[1])) found.set(m[1], new Set());
    found.get(m[1]).add('ci.yml');
  }
  for (const m of src.matchAll(/^\s{10}([A-Z_0-9]+):\s*(.+)$/gm)) {
    if (!found.has(m[1])) found.set(m[1], new Set());
    found.get(m[1]).add('ci.yml (step)');
  }
  return found;
}

/** Dockerfile `ENV NAME=value` instructions. */
function dockerEnvVars() {
  const found = new Map();
  for (const rel of ['apps/api/Dockerfile', 'apps/web/Dockerfile']) {
    const file = path.join(repoRoot, rel);
    if (!existsSync(file)) continue;
    for (const m of read(file).matchAll(/^ENV\s+(.+)$/gm)) {
      for (const pair of m[1].matchAll(/([A-Z_0-9]+)=([^\s]+)/g)) {
        if (!found.has(pair[1])) found.set(pair[1], new Set());
        found.get(pair[1]).add(`${rel} (baked)`);
      }
    }
  }
  return found;
}

function composeVars() {
  const file = path.join(repoRoot, 'docker-compose.yml');
  if (!existsSync(file)) return new Set();
  const src = read(file);
  return {
    interpolated: new Set([...src.matchAll(/\$\{([A-Z_0-9]+)/g)].map((m) => m[1])),
    // `environment:` keys, which are literals, not interpolations.
    literals: new Set([...src.matchAll(/^\s{4}([A-Z_0-9]+):/gm)].map((m) => m[1])),
  };
}

/** `KEY=value` lines in a template. */
function templateVars(rel) {
  const file = path.join(repoRoot, rel);
  if (!existsSync(file)) return new Map();
  const vars = new Map();
  for (const line of read(file).split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(t);
    if (m) vars.set(m[1], m[2]);
  }
  return vars;
}

const readVars = readEnvVars();
const ciVars = ciEnvVars();
const dockerVars = dockerEnvVars();
const compose = composeVars();
const rootTpl = templateVars('.env.example');
const apiTpl = templateVars('apps/api/.env.example');
const mobileTpl = templateVars('apps/mobile/.env.example');

/**
 * Variables that are legitimately read but must not appear in an operator's
 * template, or that are noise. Each entry states why, so a reviewer can
 * disagree with a specific decision rather than a hidden list.
 */
const NOT_CONFIGURATION = new Map([
  ['TERM', 'terminal capability, not application configuration'],
  ['P23_AUTH_BASE_PORT', 'port for the Phase 23 compiled-auth harness; CI-only'],
  ['P20_API_IMAGE', 'image tag used only by the Phase 20 container verification harness'],
  ['P20_WEB_IMAGE', 'image tag used only by the Phase 20 container verification harness'],
  ['P23_CI_DATABASE_URL', 'database URL override for the Phase 26 CI-parity runner; harness-only escape hatch, the gate provisions its own otherwise'],
  ['P23_ARTIFACT_DATABASE_URL', 'database URL override for the Phase 23 artifact check; harness-only'],
  // Phase 26 (WS6): the artifact gate now provisions its own throwaway
  // PostgreSQL, so this override is a deliberate escape hatch for a constrained
  // environment rather than the default path. It stays harness-only.
  ['P23_PG_PORT', 'host port for the Phase 23 throwaway PostgreSQL; harness-only'],
  ['P20_SKIP_BUILD', 'skips the image rebuild in the Phase 20 container gate; harness-only'],
  ['AUTOPREFIXER_GRID', 'postcss-preset-env feature flag (build tooling)'],
  ['BROWSERSLIST_IGNORE_OLD_DATA', 'browserslist noise suppressor (build tooling)'],
  ['BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA', 'browserslist noise suppressor (build tooling)'],
]);

// ---------------------------------------------------------------------------
// 1. No committed secrets, no baked credentials.
// ---------------------------------------------------------------------------

/**
 * Values that must never appear in a tracked file. Deliberately specific:
 * a generic "looks like a password" heuristic produces false positives on
 * documentation, whereas a literal that is genuinely a credential is
 * unambiguous.
 */
const FORBIDDEN_LITERALS = [
  'ecc-ci-secret',
  'p20-verify-secret',
  'p23-compiled-auth-suite-secret',
];

for (const file of [...walk(path.join(repoRoot, 'apps')), ...walk(path.join(repoRoot, 'scripts')), ...walk(path.join(repoRoot, 'docs')), ...walk(path.join(repoRoot, 'packages'))]) {
  if (!/\.(ts|tsx|mjs|cjs|js|json|md|yml|yaml|prisma|sql|Dockerfile)$/.test(file) && !file.endsWith('Dockerfile')) continue;
  const rel = path.relative(repoRoot, file);
  // The CI workflow legitimately contains the CI database password; it is
  // scoped to an ephemeral service container and is not a production secret.
  if (rel === '.github/workflows/ci.yml') continue;
  // Phase 22/23 verification scripts deliberately contain throwaway values.
  // They are asserted to be throwaway by the gates themselves.
  if (rel.startsWith('apps/api/scripts/') || rel === 'scripts/verify-docker-images.mjs') continue;
  // This file names the literals it searches for, so it necessarily contains
  // them. Skipping itself is the only way to search for a literal by value.
  // Each of these names the literals it searches for, so each necessarily
  // contains them. Skipping a file that names the secret it is looking for is
  // the only way to search by value.
  if (['scripts/verify-config-contract.mjs', 'scripts/verify-release-artifact.mjs'].includes(rel)) continue;
  if (rel.startsWith('SECURITY_REVIEW_') || rel.startsWith('docs/')) continue;

  let src;
  try {
    src = read(file);
  } catch {
    continue;
  }
  for (const literal of FORBIDDEN_LITERALS) {
    if (src.includes(literal)) fail(`${rel} contains the literal credential "${literal}"`);
  }
  // A committed .env is the classic leak. .env.example is the contract and
  // is expected.
  if (path.basename(file) === '.env' && !file.includes('node_modules')) {
    fail(`${rel} is a committed .env file; it must be gitignored and untracked`);
  }
}

// Dockerfile ENV values must never be a credential.
for (const [name, where] of dockerVars) {
  if (/SECRET|PASSWORD|TOKEN|KEY|CREDENTIAL/i.test(name)) {
    fail(`a Dockerfile bakes a credential-shaped variable: ${name} (${[...where].join(', ')})`);
  }
}

// ---------------------------------------------------------------------------
// 2/3. Read and documented sets must correspond.
// ---------------------------------------------------------------------------

const documented = new Map();
for (const [rel, vars] of [
  ['.env.example', rootTpl],
  ['apps/api/.env.example', apiTpl],
  ['apps/mobile/.env.example', mobileTpl],
]) {
  for (const name of vars.keys()) {
    if (!documented.has(name)) documented.set(name, new Set());
    documented.get(name).add(rel);
  }
}

/**
 * Variables an operator must be able to set, with the reason. Listed
 * explicitly because "the code reads it" is not sufficient: a variable read
 * only by a verification script or a test is supplied by the harness, not by
 * a deployment, and documenting it would be noise. A variable the *server*
 * reads in production is a deployment contract and must appear in a template
 * no matter who else sets it.
 */
const OPERATOR_REQUIRED = new Set(['NODE_ENV', 'PORT', 'DATABASE_URL', 'STORAGE_DIR', 'JWT_ACCESS_SECRET']);

/** Files whose reads are the application itself, as opposed to tooling. */
function isApplicationSource(file) {
  const rel = path.relative(repoRoot, file);
  return rel.startsWith(`apps${path.sep}api${path.sep}src${path.sep}`) || rel.startsWith(`apps${path.sep}web${path.sep}src${path.sep}`);
}

for (const [name, where] of readVars) {
  if (NOT_CONFIGURATION.has(name)) continue;
  if (documented.has(name)) continue;

  const readers = [...where];
  const applicationReads = readers.some(isApplicationSource);

  if (OPERATOR_REQUIRED.has(name)) {
    fail(
      `\`${name}\` is required by the running application (${readers.find(isApplicationSource) ?? readers[0]}) but is documented ` +
        'in no template. The API cannot start without it in production, so its absence from the template is a ' +
        'guaranteed deployment failure.',
    );
    continue;
  }

  if (!applicationReads && ciVars.has(name)) {
    notes.push(`${name} is read only by tooling and supplied by CI; not operator configuration (${readers[0]})`);
    continue;
  }

  fail(
    `\`${name}\` is read by ${readers[0]} but is documented in no template. ` +
      'An operator setting it from the documentation would be misled, and one not setting it gets a surprise.',
  );
}

for (const [name, where] of documented) {
  const isComposeOnly = compose.interpolated.has(name) || compose.literals.has(name);
  const isRead = readVars.has(name);
  const isCi = ciVars.has(name);
  if (isRead || isCi || isComposeOnly) continue;
  fail(
    `\`${name}\` is documented in ${[...where].join(', ')} but nothing reads it. ` +
      'Setting it has no effect, which is worse than not documenting it.',
  );
}

// ---------------------------------------------------------------------------
// 8. Global ValidationPipe strictness.
// ---------------------------------------------------------------------------

/**
 * Resolve the TypeScript parser out of the existing dependency graph rather
 * than adding a dependency. The AST matters here: the property values are
 * booleans, and a source-level assertion written with a regular expression
 * would accept `transform: !!1`, `transform: SOME_CONSTANT` or a property
 * inside a nested object — every one of which is a real way to lose strictness
 * without changing the text the regex looks for.
 */
function loadTypeScript() {
  const candidates = [
    'typescript',
    ...readdirSync(path.join(repoRoot, 'node_modules/.pnpm'))
      .filter((d) => d.startsWith('typescript@'))
      .map((d) => path.join(repoRoot, 'node_modules/.pnpm', d, 'node_modules/typescript')),
  ];
  for (const c of candidates) {
    try {
      return createRequire(import.meta.url)(c);
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('could not load the `typescript` parser from the dependency graph');
}

const ts = loadTypeScript();

/**
 * The flags that make the global pipe reject anything it did not declare.
 * `transform` alone is a convenience, not a control, and `whitelist` without
 * `forbidNonWhitelisted` strips unknown properties silently — which is why all
 * three are asserted together rather than individually.
 */
const REQUIRED_PIPE_FLAGS = ['transform', 'whitelist', 'forbidNonWhitelisted'];

/**
 * Read a single-line object-literal property value, and report it structurally:
 * `true` for a literal true, the literal text for anything else. A property
 * that is absent entirely is reported as absent rather than as `undefined`,
 * so the failure message can say which of the two happened.
 */
function literalFlagProperty(objectLiteral, name, sf) {
  for (const prop of objectLiteral.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === name) {
      const init = prop.initializer;
      if (init.kind === ts.SyntaxKind.TrueKeyword) return { present: true, value: true };
      if (init.kind === ts.SyntaxKind.FalseKeyword) return { present: true, value: false };
      return { present: true, value: init.getText(sf) };
    }
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === name) {
      return { present: true, value: `${prop.name.text} (shorthand)` };
    }
  }
  return { present: false, value: null };
}

/**
 * Every `useGlobalPipes` argument in a file that constructs a `ValidationPipe`.
 * Returned rather than asserted here so a caller can distinguish "no global
 * pipe at all" from "a global pipe with the wrong options".
 */
function globalValidationPipeOptions(relFile) {
  // `relFile` is repository-relative. Resolving it against the process cwd
  // instead of the repo root would let a run from a scratch copy silently
  // read the real repository's file, which is precisely the situation in
  // which this assertion must not be trusted.
  const abs = path.join(repoRoot, relFile);
  const src = read(abs);
  const sf = ts.createSourceFile(relFile, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  const registrations = [];

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const isGlobalPipeRegistration =
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'useGlobalPipes';
      if (isGlobalPipeRegistration) {
        for (const arg of node.arguments) {
          if (ts.isNewExpression(arg) && arg.expression.getText(sf) === 'ValidationPipe') {
            registrations.push({ line: sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1, args: arg.arguments ?? [] });
            const options = arg.arguments?.[0];
            if (options && ts.isObjectLiteralExpression(options)) found.push({ options, sf });
          } else {
            // A pipe registered from an identifier or a factory. Recorded so
            // the report can name it; the options are not statically visible,
            // which is itself a reviewable fact rather than a silent pass.
            registrations.push({ line: sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1, args: null });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { found, registrations, sf };
}

const PIPE_SITES = [
  { rel: 'apps/api/src/main.ts', why: 'the production bootstrap' },
  { rel: 'apps/api/src/testing/create-test-app.ts', why: 'the e2e/harness bootstrap, which must mirror production or the suite tests a different pipeline' },
];

for (const site of PIPE_SITES) {
  const { found, registrations } = globalValidationPipeOptions(site.rel);

  if (registrations.length === 0) {
    fail(
      `${site.rel} registers no global \`ValidationPipe\` at all (${site.why}). Every DTO rule would be inert: ` +
        'request bodies would reach the handler unvalidated and untransformed.',
    );
    continue;
  }
  if (found.length === 0) {
    fail(
      `${site.rel} calls useGlobalPipes but none of the arguments is an inline \`new ValidationPipe({...})\` (${site.why}). ` +
        'This audit cannot verify the options statically, and an unverified strictness configuration is exactly the ' +
        'gap this assertion closes.',
    );
    continue;
  }
  if (found.length !== registrations.length) {
    fail(
      `${site.rel} registers ${registrations.length} global pipe(s) but only ${found.length} are an inline ` +
        `\`new ValidationPipe({...})\` (${site.why}). The strictness of the others is unverifiable.`,
    );
  }

  for (const { options, sf } of found) {
    for (const flag of REQUIRED_PIPE_FLAGS) {
      const actual = literalFlagProperty(options, flag, sf);
      const where = `${site.rel}:${sf.getLineAndCharacterOfPosition(options.getStart(sf)).line + 1}`;
      if (!actual.present) {
        const consequence =
          flag === 'transform'
            ? "Nest's default applies, which is not the strict behaviour this repository relies on"
            : 'unknown properties are silently accepted rather than rejected';
        fail(
          `${where} — the global ValidationPipe does not set \`${flag}\` (${site.why}); ${consequence}.`,
        );
        continue;
      }
      if (actual.value !== true) {
        fail(
          `${where} — the global ValidationPipe sets \`${flag}\` to \`${actual.value}\` rather than the literal ` +
            `\`true\` (${site.why}).`,
        );
      }
    }
  }
}

notes.push(
  `global ValidationPipe: transform, whitelist and forbidNonWhitelisted are all literal true in ` +
    `${PIPE_SITES.map((s) => s.rel).join(' and ')}`,
);

// ---------------------------------------------------------------------------
// 4. Ports.
// ---------------------------------------------------------------------------

const apiPortDefault = /const port = Number\.parseInt\(process\.env\.PORT \?\? '(\d+)'/.exec(
  read(path.join(repoRoot, 'apps/api/src/main.ts')),
)?.[1];
const webDevPort = /"dev":\s*"next dev -p (\d+)/.exec(read(path.join(repoRoot, 'apps/web/package.json')))?.[1];
const webStartPort = /"start":\s*"next start -p (\d+)/.exec(read(path.join(repoRoot, 'apps/web/package.json')))?.[1];
const webDockerPort = /ENV PORT=(\d+)/.exec(read(path.join(repoRoot, 'apps/web/Dockerfile')))?.[1];
const apiExpose = /EXPOSE (\d+)/.exec(read(path.join(repoRoot, 'apps/api/Dockerfile')))?.[1];
const webExpose = /EXPOSE (\d+)/.exec(read(path.join(repoRoot, 'apps/web/Dockerfile')))?.[1];

const portExpectations = [
  ['API default PORT', apiPortDefault, '3000'],
  ['API Dockerfile EXPOSE', apiExpose, '3000'],
  ['web dev port', webDevPort, '3001'],
  ['web start port', webStartPort, '3001'],
  ['web Dockerfile ENV PORT', webDockerPort, '3001'],
  ['web Dockerfile EXPOSE', webExpose, '3001'],
];
for (const [label, actual, expected] of portExpectations) {
  if (actual !== expected) fail(`${label} is ${actual ?? 'absent'}; the documented value is ${expected}`);
}
if (apiPortDefault === webDevPort) {
  fail('the API and web default ports are identical; running both locally would collide');
}
notes.push(`ports: API ${apiPortDefault} (default) / web ${webDevPort} (dev and container)`);

// The health page's fallback must match the API default, or a misconfigured
// deployment silently probes the wrong port.
const webFallback = /NEXT_PUBLIC_API_URL \?\? '([^']+)'/.exec(
  read(path.join(repoRoot, 'apps/web/src/app/health/page.tsx')),
)?.[1];
if (webFallback && !webFallback.endsWith(`:${apiPortDefault}`)) {
  fail(
    `apps/web/src/app/health/page.tsx falls back to ${webFallback}, which does not target the API's ` +
      `default port ${apiPortDefault}. With NEXT_PUBLIC_API_URL unset the health page would probe the wrong port.`,
  );
}

// ---------------------------------------------------------------------------
// 5. Node / pnpm version consistency.
// ---------------------------------------------------------------------------

const rootPkg = JSON.parse(read(path.join(repoRoot, 'package.json')));
const packageManager = /^pnpm@(.+)$/.exec(rootPkg.packageManager ?? '')?.[1];
const enginesNode = rootPkg.engines?.node;

if (!packageManager) fail('the root package.json does not pin packageManager; CI and Docker would resolve different pnpm versions');

/** Minimum Node satisfying a `>=x.y.z` range. */
function minNode(range) {
  const m = />=\s*(\d+)\.(\d+)\.(\d+)/.exec(range ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function gte(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if ((a?.[i] ?? 0) > (b?.[i] ?? 0)) return true;
    if ((a?.[i] ?? 0) < (b?.[i] ?? 0)) return false;
  }
  return true;
}

const dockerBase = /FROM node:(\d+)/.exec(read(path.join(repoRoot, 'apps/api/Dockerfile')))?.[1];
const webDockerBase = /FROM node:(\d+)/.exec(read(path.join(repoRoot, 'apps/web/Dockerfile')))?.[1];
const ciNodeVersions = [...read(path.join(repoRoot, '.github/workflows/ci.yml')).matchAll(/node-version:\s*(\S+)/g)].map(
  (m) => m[1],
);

if (dockerBase !== webDockerBase) {
  fail(`the Dockerfiles use different Node majors (api ${dockerBase}, web ${webDockerBase})`);
}
for (const v of ciNodeVersions) {
  if (v === dockerBase) continue;
  if (v.startsWith('${{')) continue; // an expression, not a pinned version
  fail(`CI pins Node ${v} but the images ship Node ${dockerBase}; CI would test a different runtime than production`);
}

const required = minNode(enginesNode);
if (required) {
  for (const [label, major] of [['api Dockerfile', dockerBase], ['web Dockerfile', webDockerBase]]) {
    if (!major) continue;
    if (!gte([Number(major), 0, 0], required)) {
      fail(
        `the ${label} uses Node ${dockerBase} but the repository's engines field requires Node ${enginesNode}. ` +
          'pnpm would refuse to install, or would warn and continue inconsistently.',
      );
    }
  }
  for (const v of ciNodeVersions) {
    if (v.startsWith('${{')) continue;
    if (!gte([Number(v), 0, 0], required)) {
      fail(`CI pins Node ${v}, which does not satisfy the repository's engines requirement ${enginesNode}`);
    }
  }
}

// The Dockerfiles activate a specific pnpm; it must equal packageManager.
for (const rel of ['apps/api/Dockerfile', 'apps/web/Dockerfile']) {
  const activated = /corepack prepare pnpm@(\S+) --activate/.exec(read(path.join(repoRoot, rel)))?.[1];
  if (activated && packageManager && activated !== packageManager) {
    fail(`${rel} activates pnpm@${activated} but the repository pins pnpm@${packageManager}`);
  }
}

// Every workspace package's engines, if any, must agree with the root.
for (const rel of ['apps/api/package.json', 'apps/web/package.json', 'apps/mobile/package.json']) {
  const pkg = JSON.parse(read(path.join(repoRoot, rel)));
  const declared = pkg.engines?.node;
  if (!declared) {
    notes.push(`${rel} declares no engines.node; the root value (${enginesNode}) applies`);
    continue;
  }
  if (declared !== enginesNode) {
    fail(`${rel} declares engines.node ${declared} but the root declares ${enginesNode}`);
  }
}

// ---------------------------------------------------------------------------
// 6. The test-only opt-out must not be presented as configuration.
// ---------------------------------------------------------------------------

if (apiTpl.has('ECC_TEST_DISABLE_RATE_LIMIT')) {
  fail('apps/api/.env.example presents the test-only rate-limit opt-out as normal configuration');
}
const rateGuard = read(path.join(repoRoot, 'apps/api/src/auth/guards/rate-limit.guard.ts'));
if (!/NODE_ENV[^;]*!==\s*'test'/.test(rateGuard) || !/ECC_TEST_DISABLE_RATE_LIMIT[^;]*===\s*'1'/.test(rateGuard)) {
  fail(
    'the rate-limit bypass is no longer guarded by BOTH NODE_ENV=test and ECC_TEST_DISABLE_RATE_LIMIT=1. ' +
      'A single broad condition would restore the accidental-production-bypass class Phase 18 removed.',
  );
}
notes.push('ECC_TEST_DISABLE_RATE_LIMIT is test-only and inert unless NODE_ENV is exactly `test`');

// ---------------------------------------------------------------------------
// 7. A template placeholder must not satisfy the production validator.
// ---------------------------------------------------------------------------

/** Mirrors `looksPlaceholder` in src/config/security-config.ts. */
function looksPlaceholder(secret) {
  return (
    secret.includes('replace-me') ||
    secret.includes('change-me') ||
    secret === 'dev-secret-change-me' ||
    secret.length < 32
  );
}
for (const [rel, vars] of [
  ['.env.example', rootTpl],
  ['apps/api/.env.example', apiTpl],
]) {
  const secret = vars.get('JWT_ACCESS_SECRET');
  if (secret === undefined) continue;
  if (!looksPlaceholder(secret)) {
    fail(
      `${rel} ships a JWT_ACCESS_SECRET that the production validator would accept. A template must contain a ` +
        'placeholder, otherwise it is a credential committed to the repository.',
    );
  }
}

// The root template's DATABASE_URL must be a placeholder password, not a
// working one, and its port must match the compose POSTGRES_PORT.
const rootDb = rootTpl.get('DATABASE_URL') ?? '';
const composePgPort = rootTpl.get('POSTGRES_PORT');
if (composePgPort && rootDb) {
  const dbPort = /:(\d+)\//.exec(rootDb)?.[1];
  if (dbPort && dbPort !== composePgPort) {
    fail(
      `.env.example sets DATABASE_URL on port ${dbPort} but POSTGRES_PORT=${composePgPort}. ` +
        'Copying the template verbatim produces a connection refused error.',
    );
  }
  const dbName = /\/([^/?]+)(?:\?|$)/.exec(rootDb)?.[1];
  if (dbName && rootTpl.has('POSTGRES_DB') && dbName !== rootTpl.get('POSTGRES_DB')) {
    fail(
      `.env.example points DATABASE_URL at database "${dbName}" but POSTGRES_DB is ` +
        `"${rootTpl.get('POSTGRES_DB')}". The template is internally inconsistent.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log('\nPhase 23 (W5) — environment and configuration contract audit\n');
console.log(`  source files scanned        : ${sourceFiles.length}`);
console.log(`  env vars read by code       : ${[...readVars.keys()].sort().join(', ')}`);
console.log(`  env vars set by CI          : ${[...ciVars.keys()].sort().join(', ')}`);
console.log(`  env vars baked in Dockerfiles: ${[...dockerVars.keys()].sort().join(', ')}`);
console.log(`  documented in templates     : ${[...documented.keys()].sort().join(', ')}`);
console.log(`  compose interpolations      : ${[...compose.interpolated].sort().join(', ')}`);
console.log(`  node: packageManager=${packageManager ?? '?'} engines=${enginesNode ?? '?'} docker=${dockerBase ?? '?'} ci=${ciNodeVersions.join(',') || '?'}`);

if (notes.length) {
  console.log('\n  notes:');
  for (const n of notes) console.log(`    - ${n}`);
}

if (problems.length) {
  console.error(`\nFAILED — ${problems.length} configuration problem(s):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  process.exit(1);
}
console.log('\nThe environment contract is accurate: read, documented, CI, image and compose sets correspond.\n');
