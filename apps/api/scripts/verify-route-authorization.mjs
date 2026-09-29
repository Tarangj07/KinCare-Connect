#!/usr/bin/env node
/**
 * Phase 23 (W3) — authorization matrix for the COMPILED API.
 *
 * Every prior authorization test in this repository exercises the source
 * through vitest/SWC. Phase 22 proved that toolchain is not the one that
 * ships, so an authorization claim is only worth as much as the artifact it
 * was proved against. This script reads the route table straight out of the
 * built `dist/` — the same classes Nest will instantiate in the image — and
 * reports, per route, the guards and role metadata that are actually
 * attached at runtime.
 *
 * It exists to answer two questions the source cannot answer reliably:
 *
 *   1. What is the complete externally reachable surface? A controller that
 *      is compiled but not registered in any module, or a `@UseGuards` that
 *      was attached to the wrong target, is invisible to a source read and
 *      to a per-module test.
 *   2. Is every route outside the documented public set actually guarded?
 *      The assertion here is structural (a guard instance is present), which
 *      complements — rather than duplicates — the behavioural 401/403 tests,
 *      which prove the guard *works* but only for the routes someone
 *      remembered to test.
 *
 * It is deliberately a report plus a narrow gate. The gate is:
 *   - every route is either in PUBLIC_ROUTES or carries an auth guard;
 *   - no route outside PUBLIC_ROUTES is missing `JwtAuthGuard`;
 *   - every role-restricted route has a non-empty role list;
 *   - Phase 24 (D-4): every *mounted* route that binds a whole request body
 *     binds it to a class `ValidationPipe` will actually validate;
 *   - Phase 25 (F-2): that class must actually CARRY constraints in the built
 *     artifact. A metatype is not a validation contract;
 *   - Phase 25 (F-3): a keyed `@Body('field')` is a violation unless the route
 *     is on the documented public allow-list. Binding one field of the body
 *     bypasses the whitelist entirely, so it can never be waved through by
 *     "the DTO covers it".
 * Anything broader would be guessing at intent.
 *
 * Usage:  node scripts/verify-route-authorization.mjs [--dist <dir>]
 *         node scripts/verify-route-authorization.mjs --json
 */
import { createRequire } from 'node:module';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const distArgIndex = process.argv.indexOf('--dist');
const distDir = distArgIndex >= 0 ? path.resolve(process.argv[distArgIndex + 1]) : path.join(apiRoot, 'dist');
const asJson = process.argv.includes('--json');

require_('reflect-metadata');

/**
 * Phase 25 (F-2) — class-validator's own metadata storage, in the same
 * registry the running application uses.
 *
 * This is deliberately NOT a source check. The Phase 24 gate asked "is the
 * body parameter's metatype a class?", and a DTO with every constraint
 * stripped is still a class: removing the decorators from `LoginDto` left the
 * gate green while the route accepted any body shape at all. What the pipe
 * actually runs is the metadata that the decorators registered at import time,
 * so the gate has to read that metadata — from the SAME `getMetadataStorage()`
 * instance, reached through the same `class-validator` module resolution, or
 * the two would be different registries and the count would always be zero.
 *
 * `getTargetValidationMetadatas(targetConstructor, targetSchema, always, ...)`
 * walks the constructor and its prototype chain, so inherited constraints count
 * — which is what a subclassed DTO needs.
 */
const classValidator = require_('class-validator');
const metadataStorage = classValidator.getMetadataStorage();

/** Constraints that do nothing on their own: `@IsOptional`, `@ValidateIf`. */
const CONDITIONAL_VALIDATION_TYPES = new Set(['conditionalValidation']);

/**
 * The validation constraints a compiled DTO class actually carries.
 * @returns {{total: number, effective: number, properties: number, types: string[]}}
 */
function validationConstraints(metatype) {
  const all = metadataStorage.getTargetValidationMetadatas(metatype, metatype, false) ?? [];
  const effective = all.filter((m) => !CONDITIONAL_VALIDATION_TYPES.has(m.type));
  return {
    total: all.length,
    effective: effective.length,
    properties: new Set(effective.map((m) => m.propertyName)).size,
    types: [...new Set(effective.map((m) => m.type))].sort(),
  };
}

const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';
const GUARDS_METADATA = '__guards__';
const ROLES_METADATA = 'roles';
const IS_PUBLIC_KEY = 'isPublic';
const ROUTE_ARGS_METADATA = '__routeArguments__';
const PARAMTYPES_METADATA = 'design:paramtypes';

/**
 * `RouteParamtypes.BODY` from @nestjs/common, as the literal integer Nest
 * itself uses. In @nestjs/common 10 the per-parameter metadata is stored on
 * the controller CLASS, keyed by method name, as a map whose KEYS are
 * `"<paramtype>:<index>"` — the value objects carry only `{ index, data,
 * pipes }`. So the param type is recovered from the key prefix, and this
 * constant is what makes that possible. It is cross-checked by mutant M4 in
 * `mutate-route-authorization.mjs`, which fails if the constant stops
 * identifying body parameters.
 */
const ROUTE_PARAM_BODY = 3;

/**
 * Nest's `ValidationPipe.toValidate()` skip-list. A parameter whose reflected
 * metatype is one of these is NOT validated at all — no constraints, no
 * whitelist, no `forbidNonWhitelisted`. Phase 24 (D-4) is what happens when a
 * whole-body parameter lands on this list.
 */
const VALIDATION_SKIP_LIST = [String, Boolean, Number, Array, Object, Buffer, Date];

/** True for a metatype the pipe would hand to class-validator. */
function isValidatedClass(metatype) {
  return typeof metatype === 'function' && !VALIDATION_SKIP_LIST.includes(metatype);
}

function describeMetatype(v) {
  if (v === Function) return '`Function`';
  if (v === undefined) return '`undefined` (no metadata emitted)';
  if (v === Object) return '`Object`';
  if (typeof v === 'function') return `\`${v.name || 'anonymous'}\``;
  return String(v);
}

/**
 * Phase 24 (D-4) + Phase 25 (F-2/F-3) — every request-body parameter a
 * handler binds, and what the pipe will actually do with it.
 *
 * `data !== undefined` is the keyed form, `@Body('field')`. The Phase 24
 * version returned `null` for those and the review is right that this is a
 * hole: a keyed body parameter takes ONE property out of the request body
 * before the DTO pipeline ever runs, so the global `whitelist` and
 * `forbidNonWhitelisted` never see the rest of the object and the named field
 * is validated by whatever check the handler happens to write — often none.
 * Reading the reflected metadata rather than the source is the point: this is
 * the artefact that ships.
 *
 * @returns {{bindings: Array, unvalidated: object|null, keyed: Array}}
 */
function inspectBody(controllerClass, methodName) {
  const empty = { bindings: [], unvalidated: null, keyed: [] };
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controllerClass, methodName);
  if (!args || typeof args !== 'object') return empty;
  const paramtypes = Reflect.getMetadata(PARAMTYPES_METADATA, controllerClass.prototype, methodName);
  if (!Array.isArray(paramtypes)) return empty;

  for (const [key, arg] of Object.entries(args)) {
    const [paramType] = key.split(':');
    if (Number(paramType) !== ROUTE_PARAM_BODY) continue;
    const index = arg?.index;
    if (typeof index !== 'number') continue;
    const metatype = paramtypes[index];
    const isKeyed = arg?.data !== undefined;
    const validated = isValidatedClass(metatype);
    const constraints = validated ? validationConstraints(metatype) : null;
    const binding = {
      index,
      keyed: isKeyed,
      field: isKeyed ? String(arg.data) : null,
      metatype: describeMetatype(metatype),
      validated,
      constraints,
    };
    empty.bindings.push(binding);
    if (isKeyed) {
      empty.keyed.push(binding);
      continue;
    }
    if (!validated) empty.unvalidated = binding;
  }
  return empty;
}

const METHOD_NAMES = { 0: 'GET', 1: 'POST', 2: 'PUT', 3: 'DELETE', 4: 'PATCH', 5: 'ALL', 6: 'OPTIONS', 7: 'HEAD' };

/**
 * Routes that are unauthenticated BY DESIGN, each with the reason. This is a
 * closed list: adding a route here is a security decision that has to be
 * written down, and anything not on it must be guarded.
 */
const PUBLIC_ROUTES = new Map([
  ['GET /api/v1/health', 'liveness probe — no dependency checks, exposes no data (Phase 19)'],
  ['GET /api/v1/health/ready', 'readiness probe — SELECT 1 only, reports a status not a driver error (Phase 19)'],
  ['POST /api/v1/auth/register', 'account creation is the entry point of authentication'],
  ['POST /api/v1/auth/login', 'credential exchange'],
  ['POST /api/v1/auth/refresh', 'refresh rotation owns its own token validation'],
  ['POST /api/v1/auth/forgot-password', 'Phase 4 stub — constant response, no account enumeration'],
  ['POST /api/v1/auth/reset-password', 'Phase 4 stub'],
  ['POST /api/v1/auth/verify-email', 'Phase 4 stub'],
]);

function walkJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkJs(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

if (!statSync(distDir)) {
  console.error(`\nFATAL: ${distDir} does not exist. Run \`pnpm build\` first.\n`);
  process.exit(1);
}

// --- which controllers are actually reachable? -----------------------------
// Scanning dist/ alone would report controllers that no module registers —
// `care-tasks.controller.ts` is exactly that case: it compiles, it carries
// guards, and it is unreachable because no module declares it. A route table
// that cannot distinguish "guarded but not mounted" from "live" is worse
// than no route table, so the module graph is walked from AppModule and only
// registered controllers are reported as live. Unregistered ones are listed
// separately as unreachable, which is information, not a failure.
const MODULE_IMPORTS = 'imports';
const MODULE_CONTROLLERS = 'controllers';

const registeredControllers = new Map(); // class -> module name
(function walkModules(moduleClass, seen = new Set()) {
  if (!moduleClass || seen.has(moduleClass)) return;
  seen.add(moduleClass);
  for (const controller of Reflect.getMetadata(MODULE_CONTROLLERS, moduleClass) ?? []) {
    registeredControllers.set(controller, moduleClass.name);
  }
  for (const imported of Reflect.getMetadata(MODULE_IMPORTS, moduleClass) ?? []) {
    const target = typeof imported === 'function' ? imported : imported?.module;
    walkModules(target, seen);
  }
})(require_(path.join(distDir, 'app.module.js')).AppModule);

const routes = [];

for (const file of walkJs(distDir)) {
  if (path.resolve(file) === path.join(distDir, 'main.js')) continue;
  let mod;
  try {
    mod = require_(file);
  } catch {
    continue; // modules needing a live datasource are covered by other gates
  }
  for (const exported of Object.values(mod)) {
    if (typeof exported !== 'function' || !exported.prototype) continue;
    const classPath = Reflect.getMetadata(PATH_METADATA, exported);
    if (typeof classPath !== 'string') continue; // not a @Controller

    const isRegistered = registeredControllers.has(exported);

    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, exported) ?? []).map(describe);
    const classRoles = Reflect.getMetadata(ROLES_METADATA, exported);

    for (const name of Object.getOwnPropertyNames(exported.prototype)) {
      if (name === 'constructor') continue;
      const method = exported.prototype[name];
      if (typeof method !== 'function') continue;
      const methodPath = Reflect.getMetadata(PATH_METADATA, method);
      if (typeof methodPath !== 'string') continue;
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, method);
      if (requestMethod === undefined) continue;

      const guards = [...classGuards, ...(Reflect.getMetadata(GUARDS_METADATA, method) ?? []).map(describe)];
      const roles = Reflect.getMetadata(ROLES_METADATA, method) ?? classRoles;
      const isPublic =
        Reflect.getMetadata(IS_PUBLIC_KEY, method) === true || Reflect.getMetadata(IS_PUBLIC_KEY, exported) === true;
      const body = inspectBody(exported, name);

      const verb = METHOD_NAMES[requestMethod] ?? String(requestMethod);
      // An empty method path means the class path IS the route. Normalising
      // here (rather than tolerating both spellings) keeps the public
      // allow-list from silently rotting into a permanent exemption.
      // Nest normalises a bare `@Get()` to '/', so the joined string needs a
      // trailing-slash trim to match the path the router actually serves.
      const segments = ['api', 'v1', classPath, methodPath]
        .filter((s) => typeof s === 'string' && s.length > 0)
        .join('/')
        .replace(/\/+/g, '/')
        .replace(/\/$/, '');
      routes.push({
        route: `${verb} /${segments}`,
        controller: exported.name,
        handler: name,
        guards: [...new Set(guards)],
        roles: Array.isArray(roles) ? roles : null,
        isPublic,
        registered: isRegistered,
        module: registeredControllers.get(exported) ?? null,
        unvalidatedBody: body.unvalidated,
        bodyBindings: body.bindings,
        keyedBodies: body.keyed,
      });
    }
  }
}

function describe(g) {
  if (typeof g === 'function') return g.name || 'anonymous';
  if (g && typeof g === 'object') return g.constructor?.name ?? 'instance';
  return String(g);
}



routes.sort((a, b) => a.route.localeCompare(b.route));

// --- gate ------------------------------------------------------------------
const problems = [];
const seen = new Set();
const live = routes.filter((r) => r.registered);
const unreachable = routes.filter((r) => !r.registered);

for (const r of live) {
  if (seen.has(r.route)) {
    problems.push(`DUPLICATE route registered twice: ${r.route} (${r.controller}.${r.handler})`);
  }
  seen.add(r.route);

  // --- request-body contract, checked for EVERY mounted route -------------
  //
  // Phase 25 (F-2). These three rules used to sit AFTER the `continue` below,
  // which fires for documented public routes — so POST /auth/login and
  // POST /auth/register, the two routes an unauthenticated caller reaches
  // first and the two with the richest DTOs, were exempt from every body
  // check. Stripping `LoginDto` of its constraints therefore kept the gate
  // green, and the gate could not honestly claim to prove that body DTOs
  // carry validation. Authentication and validation are separate questions:
  // a route may be public AND still have to validate its body.
  //
  // Reported only for MOUNTED routes: an unreachable controller is not a live
  // input surface, and holding dead code to the standard of live code is how
  // "unreachable" quietly becomes "shipped".

  // Phase 24 (D-4).
  if (r.unvalidatedBody) {
    problems.push(
      `${r.route} (${r.controller}.${r.handler}) binds a whole request body to ${r.unvalidatedBody.metatype} at ` +
        `parameter #${r.unvalidatedBody.index}, which Nest's ValidationPipe skips: this body is accepted ` +
        'unvalidated — no whitelist, no forbidNonWhitelisted, no type or length constraints. `Partial<SomeDto>` ' +
        'and inline type literals both emit `Object` here. Bind it to a DTO class.',
    );
  }

  // Phase 25 (F-2). The D-4 rule above is satisfied by a CLASS, and a class
  // with its validation decorators removed is still a class — the Phase 25
  // review stripped `LoginDto` down to two bare fields, rebuilt, and the gate
  // stayed green while the route accepted any body at all. So the metatype is
  // not the contract; the constraints the metatype CARRIES in the built
  // artefact are. Read from class-validator's own metadata storage, i.e. the
  // exact registry `ValidationPipe` executes from.
  for (const b of r.bodyBindings ?? []) {
    if (b.keyed) continue;
    if (!b.validated) continue; // already reported by the D-4 rule above
    const c = b.constraints;
    if (c.effective === 0) {
      problems.push(
        `${r.route} (${r.controller}.${r.handler}) binds its body to ${b.metatype} at parameter #${b.index}, and ` +
          `that class carries ${c.total} validation constraint(s) in the built artefact — ` +
          `${c.effective === 0 && c.total > 0 ? 'all of them conditional (`@IsOptional`/`@ValidateIf`), which enforce nothing by themselves' : 'none at all'}. ` +
          'The metatype being a class is not a validation contract: the pipe runs against whatever metadata the ' +
          'decorators registered, and there is none, so the body is accepted unconstrained while `whitelist` and ' +
          '`forbidNonWhitelisted` report the route as covered.',
      );
    }
  }

  // Phase 25 (F-3). A keyed `@Body('field')` pulls ONE property out of the
  // request body before the DTO pipeline runs. The rest of the object is never
  // whitelisted, and the named field is validated only by whatever check the
  // handler happens to write — frequently none. That makes it invisible to
  // every rule above, which is why the Phase 24 gate returned `null` for it.
  //
  // Policy, decided against this repository's own contract: keyed body
  // parameters are permitted ONLY on routes that are already on the documented
  // public allow-list, where the body is a courtesy input and the response is
  // a constant. Every other route binds the body to a DTO. The allow-list is
  // `PUBLIC_ROUTES` itself, so the exemption is visible, justified and cannot
  // be widened by editing a second list.
  for (const b of r.keyedBodies ?? []) {
    if (r.isPublic || PUBLIC_ROUTES.has(r.route)) continue;
    problems.push(
      `${r.route} (${r.controller}.${r.handler}) binds a KEYED body field \`@Body('${b.field}')\` at parameter ` +
        `#${b.index}. A keyed body parameter is taken out of the request body before ValidationPipe runs, so the ` +
        'rest of the object is never whitelisted and the named field is validated only by whatever check the ' +
        'handler writes itself. The Phase 24 rule could not see this: it returned "no whole body" and the route ' +
        'looked covered. Bind the body to a DTO, or move the route onto the documented public allow-list with a ' +
        'written reason.',
    );
  }

  // --- authentication contract, checked only for NON-public routes ---------
  const publicReason = PUBLIC_ROUTES.get(r.route);
  if (publicReason) {
    if (r.guards.length > 0 && !r.guards.includes('RateLimitGuard')) {
      // A guard on a public route is fine (RateLimitGuard is expected); note
      // anything unexpected rather than failing, since intent varies.
    }
    continue;
  }

  if (r.isPublic) {
    problems.push(`${r.route} is marked @Public() but is not in the documented public set — state the reason.`);
    continue;
  }
  if (!r.guards.includes('JwtAuthGuard')) {
    problems.push(
      `${r.route} (${r.controller}.${r.handler}) is not public and carries no JwtAuthGuard. ` +
        `guards: ${r.guards.length ? r.guards.join(', ') : 'none'}`,
    );
  }
  if (r.roles !== null && r.roles.length === 0) {
    problems.push(`${r.route} has an empty role list, which permits everyone the guard admits.`);
  }
}

// Every documented public route must actually exist, so the allow-list cannot
// rot into a permanent exemption for a route that was renamed away.
for (const route of PUBLIC_ROUTES.keys()) {
  if (!seen.has(route)) {
    problems.push(`documented public route ${route} no longer exists; update the allow-list deliberately.`);
  }
}

if (asJson) {
  console.log(JSON.stringify({ live, unreachable, problems }, null, 2));
} else {
  console.log('\nPhase 23 (W3) — authorization matrix of the compiled API\n');
  const width = Math.max(...live.map((r) => r.route.length), 20);
  for (const r of live) {
    const guards = r.isPublic ? 'PUBLIC' : r.guards.join('+') || 'NONE';
    const roles = r.roles ? ` roles=[${r.roles.join('|')}]` : '';
    console.log(`  ${r.route.padEnd(width)}  ${guards}${roles}`);
  }
  const bodyRoutes = live.filter((r) => (r.bodyBindings ?? []).length > 0);
  const bodySummary = bodyRoutes.map((r) => {
    const parts = r.bodyBindings.map((b) => {
      if (b.keyed) return `@Body('${b.field}')`;
      if (!b.validated) return `@Body() -> ${b.metatype} (NOT validated)`;
      const c = b.constraints;
      return `@Body() -> ${b.metatype} (${c.effective} constraints on ${c.properties} properties)`;
    });
    return `    ${r.route}\n      ${parts.join('\n      ')}`;
  });

  console.log(
    `\n  ${live.length} live routes from ${routes.length} compiled handlers; ` +
      `${PUBLIC_ROUTES.size} documented public.`,
  );

  if (bodySummary.length > 0) {
    console.log('\n  Request-body bindings read from the built artifact (Phase 24 D-4, Phase 25 F-2/F-3):');
    console.log(bodySummary.join('\n'));
  }

  if (unreachable.length > 0) {
    const byController = new Map();
    for (const r of unreachable) {
      if (!byController.has(r.controller)) byController.set(r.controller, 0);
      byController.set(r.controller, byController.get(r.controller) + 1);
    }
    console.log('\n  Compiled but NOT registered in any module (unreachable — not a live surface):');
    for (const [controller, count] of [...byController].sort()) {
      console.log(`    ${controller} (${count} handler${count === 1 ? '' : 's'})`);
    }
  }

  if (problems.length > 0) {
    console.error(`\nFAILED — ${problems.length} authorization-structure problem(s):\n`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('');
    process.exit(1);
  }
  console.log('\nEvery non-public live route is guarded; the public allow-list matches reality.\n');
}

if (asJson && problems.length > 0) process.exit(1);
