import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type Json = Record<string, unknown>;

/**
 * The API package root. Vitest runs with cwd set to the package root
 * (apps/api), where nest-cli.json and tsconfig.build.json live. Resolved
 * this way rather than via import.meta.url because the API compiles as
 * CommonJS, where the import.meta meta-property is not permitted.
 */
const appRoot = process.cwd();
const repoRoot = join(appRoot, '..', '..');

/**
 * Strip `//` and block comments from a JSONC document (tsconfig files are
 * JSONC and are read here to assert the build configuration) without
 * touching comment-like sequences that appear inside string values.
 */
function stripJsonComments(source: string): string {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      } else if (ch === '\n') {
        out += ch;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function readJson(...segments: string[]): Json {
  const file = join(...segments);
  if (!existsSync(file)) {
    throw new Error(`Expected config file not found: ${file} (cwd was ${appRoot})`);
  }
  return JSON.parse(stripJsonComments(readFileSync(file, 'utf8'))) as Json;
}

/**
 * Phase 18 (M-01) — production build configuration invariant.
 *
 * The Phase 17 independent review found that `nest build` could exit 0
 * while emitting nothing: `nest-cli.json` sets `deleteOutDir: true`, which
 * deletes dist/ before compilation, while the inherited `incremental: true`
 * let tsc consult tsconfig.build.tsbuildinfo, decide every output was
 * already up to date, and skip the emit entirely. A second `nest build`
 * with unchanged sources therefore produced an empty dist/ and no
 * dist/main.js, while still reporting success.
 *
 * The behavioural reproduction lives in
 * `scripts/verify-build-determinism.mjs` (`pnpm --filter @ecc/api
 * build:verify`, also run in CI). This spec is the fast, always-on guard
 * inside the normal unit lane: if a future change re-enables incremental
 * compilation for the production build, this test fails immediately instead
 * of the problem silently reappearing as a misleading build.
 */
describe('production build configuration (Phase 18 M-01)', () => {
  const nestCli = readJson(appRoot, 'nest-cli.json');
  const buildTsconfig = readJson(appRoot, 'tsconfig.build.json');
  const baseTsconfig = readJson(repoRoot, 'packages', 'config', 'tsconfig.base.json');

  const nestOptions = nestCli['compilerOptions'] as Json;
  const buildOptions = buildTsconfig['compilerOptions'] as Json;
  const baseOptions = baseTsconfig['compilerOptions'] as Json;

  it('nest build deletes the output directory (what makes the emit unconditional)', () => {
    expect(nestOptions['deleteOutDir']).toBe(true);
  });

  it('the production build config disables incremental emit skipping', () => {
    expect(buildOptions['incremental']).toBe(false);
  });

  it('the production build config never enables composite project builds', () => {
    // `composite` carries build-mode emit semantics that likewise let tsc
    // reuse prior output; the production build must stay a plain full emit.
    expect(buildOptions['composite']).toBeUndefined();
  });

  it('the production build config still type checks strictly (fix does not weaken checking)', () => {
    const strictFlags = [
      'strict',
      'noUncheckedIndexedAccess',
      'noImplicitOverride',
      'noFallthroughCasesInSwitch',
    ];

    for (const flag of strictFlags) {
      expect(buildOptions[flag] ?? baseOptions[flag], `${flag} must stay enabled`).toBe(true);
    }
    // `skipLibCheck` is inherited, not overridden; the fix must neither
    // weaken nor strengthen it relative to the shared base config.
    expect(buildOptions['skipLibCheck'] ?? baseOptions['skipLibCheck']).toBe(
      baseOptions['skipLibCheck'],
    );
  });

  it('the production build config still excludes test code and test helpers', () => {
    const excluded = buildTsconfig['exclude'] as string[];

    expect(excluded).toContain('src/testing');
    expect(excluded).toContain('**/*spec.ts');
    expect(excluded).toContain('**/*test.ts');
    expect(excluded).toContain('test');
    expect(excluded).toContain('dist');
  });

  it('only the build config opts out of incremental compilation', () => {
    // Development type checking (tsconfig.json / tsconfig.test.json) keeps
    // incremental compilation, which is safe because `tsc --noEmit` produces
    // no output that could be deleted underneath it.
    const devTsconfig = readJson(appRoot, 'tsconfig.json');
    const testTsconfig = readJson(appRoot, 'tsconfig.test.json');

    expect((devTsconfig['compilerOptions'] as Json)['incremental']).toBeUndefined();
    expect((testTsconfig['compilerOptions'] as Json)['incremental']).toBeUndefined();
  });
});
