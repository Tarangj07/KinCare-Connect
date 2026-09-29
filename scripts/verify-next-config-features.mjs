#!/usr/bin/env node
/**
 * Phase 25 (F-4) — regression suite for the Next configuration analyser.
 *
 * The rule this exists for was `/\brewrites\s*:/.test(nextConfigText)`. It is
 * not a weak rule, it is a rule about the wrong language: it reads a
 * JavaScript file as text. That made it wrong in both directions, and only one
 * of them was demonstrated:
 *
 *   - It MISSED the form Next.js documents and supports. `rewrites` is a
 *     FUNCTION on the exported config, not an object property, and a planted
 *     `async rewrites() { return [...] }` left the Phase 24 D-6 gate green
 *     while the triage reported "the web app does not have rewrites".
 *   - It FIRES on a comment, on a string, and on an unrelated object's
 *     `rewrites:` property — a gate that reports REACHABLE for a config that
 *     merely mentions the word is a gate nobody reads.
 *
 * Every case below is a fixture, not a mock: the analyser is handed config
 * source and must classify it. `assertNoFalsePositive` and `assertDetected`
 * are separate on purpose — the first family proves the rule has not become
 * trigger-happy, the second proves it has not become blind, and a suite with
 * only one of them is a comment with a test runner around it.
 *
 * The last group runs against the REAL `apps/web/next.config.mjs`, so the
 * current legitimate configuration is proved to stay green and not only the
 * fixtures are.
 *
 * Usage:  node scripts/verify-next-config-features.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyseNextConfig } from './lib/next-config-features.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realConfigPath = path.join(repoRoot, 'apps/web/next.config.mjs');

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

/** The config declares `feature` and the analyser could read it. */
function assertDetected(label, source, feature) {
  const a = analyseNextConfig(source, { fileName: 'fixture.mjs' });
  check(
    label,
    a.analysable && a.features.includes(feature),
    `analysable=${a.analysable} features=[${a.features}] notes=${JSON.stringify(a.notes)}`,
  );
}

/** The config does NOT declare `feature`, and the analyser could read it. */
function assertNoFalsePositive(label, source, feature) {
  const a = analyseNextConfig(source, { fileName: 'fixture.mjs' });
  check(
    label,
    a.analysable && !a.features.includes(feature),
    `analysable=${a.analysable} features=[${a.features}] notes=${JSON.stringify(a.notes)}`,
  );
}

/** The analyser cannot read the config, so the caller must fail closed. */
function assertUnreadable(label, source) {
  const a = analyseNextConfig(source, { fileName: 'fixture.mjs' });
  check(label, a.analysable === false, `expected analysable=false, got ${a.analysable} (${JSON.stringify(a.notes)})`);
}

console.log('\nPhase 25 (F-4) — Next configuration feature detection\n');

// ---------------------------------------------------------------------------
// 1. The `rewrites` forms Next.js actually supports. Every one of these is a
//    configuration the old regex missed, so every one is a regression.
// ---------------------------------------------------------------------------
console.log('  rewrites: every supported declaration form must be detected');
assertDetected(
  'rewrites as an async METHOD (the form the Phase 25 review planted)',
  `const nextConfig = {
     async rewrites() { return [{ source: '/p/:x*', destination: 'http://attacker.invalid/:x*' }]; },
   };
   export default nextConfig;`,
  'rewrites',
);
assertDetected(
  'rewrites as a synchronous method',
  `export default { rewrites() { return []; } };`,
  'rewrites',
);
assertDetected(
  'rewrites as a property holding an async arrow',
  `export default { rewrites: async () => [{ source: '/a', destination: '/b' }] };`,
  'rewrites',
);
assertDetected(
  'rewrites as a property holding an async function expression',
  `export default { rewrites: async function () { return []; } };`,
  'rewrites',
);
assertDetected(
  'rewrites as a plain array (the synchronous form)',
  `export default { rewrites: [{ source: '/a', destination: '/b' }] };`,
  'rewrites',
);
assertDetected(
  'rewrites inside the documented function-form config: export default async (phase, {defaultConfig}) => {...}',
  `export default async (phase, { defaultConfig }) => {
     return { reactStrictMode: true, async rewrites() { return [{ source: '/p', destination: 'http://x.invalid' }]; } };
   };`,
  'rewrites',
);
assertDetected(
  'rewrites inside a named default-export function',
  `export default function config() { return { rewrites: async () => [] }; }`,
  'rewrites',
);
assertDetected(
  'rewrites built with Object.assign',
  `export default Object.assign({}, { rewrites: async () => [] });`,
  'rewrites',
);

// ---------------------------------------------------------------------------
// 2. The rule must not fire on the word. A gate that reports REACHABLE for a
//    config that only mentions `rewrites:` in prose is one nobody reads.
// ---------------------------------------------------------------------------
console.log('\n  rewrites: the word alone must never be a detection');
assertNoFalsePositive(
  'a comment mentioning `rewrites:` is not a declaration',
  `export default {
     // rewrites: this is a note about rewrites, not a rule
     reactStrictMode: true,
   };`,
  'rewrites',
);
assertNoFalsePositive(
  'a string literal containing `rewrites:` is not a declaration',
  `export default { reactStrictMode: true, description: 'rewrites: none here' };`,
  'rewrites',
);
assertNoFalsePositive(
  'a `rewrites` key nested inside an UNRELATED object is not the Next config',
  `const log = { config: { rewrites: async () => [] } };
   export default { reactStrictMode: true };`,
  'rewrites',
);
assertNoFalsePositive(
  'an object named `rewritesSomething` is not the `rewrites` key',
  `export default { rewritesEnabled: false };`,
  'rewrites',
);
assertNoFalsePositive(
  'the real project config declares no rewrites',
  readFileSync(realConfigPath, 'utf8'),
  'rewrites',
);

// ---------------------------------------------------------------------------
// 3. Fail closed. An unreadable config must never yield "not reachable".
// ---------------------------------------------------------------------------
console.log('\n  an unreadable config must fail closed, not report absence');
assertUnreadable('a `plugins` array can inject any key', `export default { reactStrictMode: true, plugins: [withAuth()] };`);
assertUnreadable('a spread of another module', `import base from './base.js';\nexport default { ...base };`);
assertUnreadable('a computed key', `export default { ['rewrites' + 'Async']: async () => [] };`);
assertUnreadable('no export at all', `const nextConfig = { rewrites: async () => [] };`);
assertUnreadable('an empty file', ``);
assertUnreadable('an export this analyser does not follow', `import cfg from './cfg.mjs';\nexport default cfg;`);

{
  const a = analyseNextConfig(`export default { plugins: [withAuth()] };`, { fileName: 'fixture.mjs' });
  check(
    'a plugins config is reported as unreadable AND names the offending key',
    !a.analysable && a.opaque.includes('plugins'),
    `analysable=${a.analysable} opaque=[${a.opaque}]`,
  );
}

// ---------------------------------------------------------------------------
// 4. The current project configuration, and the other config-driven rules the
//    triage script derives from the same walk.
// ---------------------------------------------------------------------------
console.log('\n  the real apps/web/next.config.mjs');
{
  const a = analyseNextConfig(readFileSync(realConfigPath, 'utf8'), { fileName: 'apps/web/next.config.mjs' });
  check(
    'the project config is analysable and declares none of the triaged features',
    a.analysable && a.features.length === 0,
    `analysable=${a.analysable} features=[${a.features}] notes=${JSON.stringify(a.notes)}`,
  );
  check(
    'the project config was resolved through its `export default nextConfig` identifier alias',
    a.form === 'identifier-alias',
    `form=${a.form}`,
  );
}
assertNoFalsePositive('image optimization is not enabled by the real config', readFileSync(realConfigPath, 'utf8'), 'image optimization');
assertNoFalsePositive('i18n is not enabled by the real config', readFileSync(realConfigPath, 'utf8'), 'Pages Router with i18n');
assertDetected('image optimization IS detected when the key is present', `export default { images: { remotePatterns: [] } };`, 'image optimization');
assertDetected('i18n IS detected when the key is present', `export default { i18n: { locales: ['en'] } };`, 'Pages Router with i18n');
assertNoFalsePositive(
  'a comment mentioning `images:` does not enable the image optimizer',
  `export default { /* images: none */ reactStrictMode: true };`,
  'image optimization',
);

if (failures > 0) {
  console.error(`\nFAILED — ${failures} Next-config feature-detection assertion(s) did not hold.\n`);
  process.exit(1);
}
console.log('\nNext configuration features are detected from the AST, and an unreadable config fails closed.\n');
