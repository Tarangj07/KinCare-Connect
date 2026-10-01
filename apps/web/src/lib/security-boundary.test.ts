/**
 * Phase 50 — enforce that the API client can never reach the browser bundle.
 *
 * `api-client.ts` reads `API_INTERNAL_URL` and attaches Bearer tokens. If it
 * were ever imported from a `'use client'` module, that module would be the
 * one place where an access token and the backend's internal address could be
 * shipped to the browser. Nothing in the application is *supposed* to do that;
 * this test exists so a future refactor fails loudly instead of quietly.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_DIR = path.resolve(process.cwd(), 'src/app');
const LIB_DIR = path.resolve(process.cwd(), 'src/lib');

const SERVER_ONLY_MODULES = ['lib/api-client.ts', 'app/api/_session.ts'];

function walk(dir: string, extensions = ['.ts', '.tsx']): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...walk(full, extensions));
    else if (extensions.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}

function isClientComponent(file: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]use client['"]/.test(readFileSync(file, 'utf8'));
}

const allFiles = [...walk(APP_DIR), ...walk(LIB_DIR)].filter((f) => !f.endsWith('.test.ts'));

describe('server/client boundary', () => {
  it('finds the server-only modules', () => {
    for (const rel of SERVER_ONLY_MODULES) {
      const abs = path.resolve(process.cwd(), 'src', rel);
      expect(() => readFileSync(abs, 'utf8')).not.toThrow();
    }
  });

  it('no client component imports the API client or the session helper', () => {
    const offenders: string[] = [];
    for (const file of allFiles) {
      if (!isClientComponent(file)) continue;
      const source = readFileSync(file, 'utf8');
      for (const rel of SERVER_ONLY_MODULES) {
        const specifier = rel.replace(/^app\//, '@/app/').replace(/^lib\//, '@/lib/');
        if (source.includes(specifier) || source.includes(`'${rel}'`)) {
          offenders.push(`${path.relative(process.cwd(), file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only the minimal expected modules are client components', () => {
    const clients = allFiles.filter(isClientComponent).map((f) => path.relative(process.cwd(), f));
    expect(clients.sort()).toEqual([
      'src/app/(authenticated)/seniors/senior-preference.tsx',
      'src/app/login/login-form.tsx',
      'src/app/providers.tsx',
    ]);
  });

  it('no module reads browser storage', () => {
    const offenders: string[] = [];
    for (const file of allFiles) {
      const source = readFileSync(file, 'utf8');
      if (/localStorage|sessionStorage|document\.cookie/.test(source)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no source module contains a hardcoded senior UUID', () => {
    const offenders: string[] = [];
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
    for (const file of allFiles) {
      const source = readFileSync(file, 'utf8');
      // Strip comments so documentation examples do not trip the check.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (uuid.test(code)) offenders.push(path.relative(process.cwd(), file));
    }
    expect(offenders).toEqual([]);
  });

  it('no source module logs a token, password or secret', () => {
    const offenders: string[] = [];
    const logger = /console\.(log|debug|info|warn|error)\([^)]*(token|jwt|password|secret|cookie|access)/i;
    for (const file of allFiles) {
      if (logger.test(readFileSync(file, 'utf8'))) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no route handler accepts an arbitrary upstream URL parameter', () => {
    const offenders: string[] = [];
    for (const file of walk(APP_DIR)) {
      if (!file.endsWith('route.ts')) continue;
      const source = readFileSync(file, 'utf8');
      // A caller-supplied upstream would have to be read from the request and
      // used to build a URL. Neither is permitted.
      if (/searchParams\.get\(\s*['"](url|target|upstream|endpoint)['"]/i.test(source)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every route that forwards a seniorId to the API validates it first', () => {
    const offenders: string[] = [];
    for (const file of walk(APP_DIR)) {
      if (!file.endsWith('route.ts')) continue;
      const source = readFileSync(file, 'utf8');
      const forwardsToApi = /apiUrl\(`[^`]*seniorId|apiUrl\(`\/api\/v1\/seniors/.test(source);
      if (forwardsToApi && !/looksLikeUuid/.test(source)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the senior-preference route is a UI preference store, not a data proxy', () => {
    // It must not call the API at all: it cannot be what authorizes anything.
    const source = readFileSync(
      path.resolve(process.cwd(), 'src/app/api/me/senior/route.ts'),
      'utf8',
    );
    expect(source).not.toContain('apiUrl');
    expect(source).not.toContain('fetch(');
  });
});
