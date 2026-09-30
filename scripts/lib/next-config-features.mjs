/**
 * Phase 25 (F-4) — what `apps/web/next.config.mjs` actually configures.
 *
 * A security triage rule has to answer "does this app enable feature X?", and
 * the honest way to answer it about a JavaScript file is to parse the file, not
 * to grep it. The Phase 24 (D-6) rule for `rewrites` was:
 *
 *     const config = /\brewrites\s*:/.test(readIfPresent(webNextConfig));
 *
 * That is wrong in both directions at once, and the Phase 25 reviewer's
 * demonstration only shows one of them:
 *
 *   - It MISSES the form Next.js documents and supports — a `rewrites()`
 *     function on the exported config object, whether written as a method
 *     (`async rewrites() { ... }`) or as a property holding a function
 *     (`rewrites: async () => [...]`). A planted, WORKING rewrite of exactly
 *     that shape left the gate green, and the triage reported "the web app
 *     does not have rewrites" about a web app that had one.
 *   - It also cannot be right by luck in the other direction: the same regex
 *     fires on the word `rewrites:` inside a comment or a string, and on an
 *     `images:`/`i18n:` property belonging to some unrelated object.
 *
 * So the check is an AST walk. The TypeScript compiler is already a repository
 * devDependency and can parse JavaScript directly, which means no new parser
 * dependency and no evaluation of the config file — evaluating it would mean
 * importing arbitrary third-party code into a security gate.
 *
 * The analyser answers three questions, and the third is the one that keeps it
 * honest:
 *
 *   1. Which top-level keys does the exported Next config object declare?
 *   2. Does the export have a shape this analyser understands at all?
 *   3. Is there something in the config whose contents this analyser cannot
 *      read (a `plugins` array, a computed/spread config)?
 *   4. For keys whose security effect depends on their VALUE rather than on
 *      their presence, what is that value? (`readNextConfigValue`)
 *
 * (4) exists because of Phase 36 (P35-1). The `images` key is exactly this
 * shape: `images: {}` and `images: { unoptimized: true }` both declare the key,
 * and before this change both were reported as "image optimization" — the same
 * verdict. They are not the same posture. `next/dist/server/next-server.js`
 * enters the optimizer only when `images.loader` is `default` AND
 * `images.unoptimized` is falsy; with `unoptimized: true` it renders a 404 and
 * never loads the optimizer module. A presence test cannot tell those apart, so
 * the triage rule had to guess, and it guessed "the app does not use images,
 * therefore the optimizer is absent" — which is false, because Next registers
 * `/_next/image` regardless of whether any component uses it.
 *
 * When (2) or (3) is negative the caller MUST fail closed. "I could not check
 * this" is a finding, not a dismissal — the same rule the triage script
 * already applies to an advisory it has no rule for.
 *
 * Usage:  import { analyseNextConfig, readNextConfigValue } from './lib/next-config-features.mjs';
 *         analyseNextConfig(source, { fileName: 'next.config.mjs' })
 *         readNextConfigValue(source, 'images', 'unoptimized', { fileName: 'next.config.mjs' })
 */
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const ts = require_('typescript');

/**
 * Top-level Next config keys the triage rules reason about, and the reasons
 * they matter. Kept here rather than in the triage script so the analyser and
 * its rules cannot drift apart.
 */
export const NEXT_CONFIG_FEATURES = [
  { key: 'rewrites', feature: 'rewrites' },
  { key: 'redirects', feature: 'redirects' },
  { key: 'headers', feature: 'headers' },
  { key: 'images', feature: 'image optimization' },
  { key: 'i18n', feature: 'Pages Router with i18n' },
];

/**
 * Keys whose VALUE this analyser cannot read. A `plugins` array is a list of
 * functions that receive the config and may return a modified one; a
 * `[plugins]` spread of another file is the same problem. Either way the
 * analyser cannot assert what the final config contains, so it reports
 * `analysable: false` and the caller fails closed.
 */
const OPAQUE_KEYS = ['plugins'];

/** @returns {{analysable: boolean, form: string, features: string[], opaque: string[], notes: string[]}} */
export function analyseNextConfig(source, { fileName = 'next.config.mjs' } = {}) {
  const result = { analysable: true, form: 'unknown', features: [], opaque: [], notes: [] };
  if (typeof source !== 'string' || source.trim() === '') {
    return { ...result, analysable: false, form: 'empty', notes: ['the config file is empty or unreadable'] };
  }

  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.JS);

  // --- 1. Find the exported configuration expression -----------------------
  let exported;
  for (const stmt of sf.statements) {
    // `export default <expr>` — including `export default function () {}` and
    // `export default async () => {}`, which TypeScript also represents as an
    // ExportAssignment.
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) exported = stmt.expression;
    // `export default function config() {}` — a NAMED default export is a
    // FunctionDeclaration carrying the `default` modifier, not an
    // ExportAssignment, and is easy to miss.
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name === undefined === false &&
      (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Default) !== 0
    ) {
      exported = stmt;
    }
  }
  // `.mjs` is ESM, but a Next config may still be authored CJS-style when
  // copied in. Supporting it costs one branch and removes a silent hole.
  if (!exported) {
    for (const stmt of sf.statements) {
      if (
        ts.isExpressionStatement(stmt) &&
        ts.isBinaryExpression(stmt.expression) &&
        stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(stmt.expression.left) &&
        ts.isIdentifier(stmt.expression.left.expression) &&
        stmt.expression.left.expression.text === 'module' &&
        stmt.expression.left.name.text === 'exports'
      ) {
        exported = stmt.expression.right;
        result.form = 'cjs';
      }
    }
  }
  if (!exported) {
    return {
      ...result,
      analysable: false,
      form: 'no-export',
      notes: ['no default export and no `module.exports` assignment was found in the config file'],
    };
  }
  if (result.form === 'unknown') {
    result.form =
      ts.isObjectLiteralExpression(exported) || ts.isParenthesizedExpression(exported)
        ? 'object'
        : ts.isIdentifier(exported)
          ? 'identifier-alias'
          : ts.isFunctionExpression(exported) || ts.isArrowFunction(exported) || ts.isFunctionDeclaration(exported)
            ? 'function'
            : 'expression';
  }

  // --- 2. Resolve the export to the config object literal(s) ---------------
  const { objects, unresolved } = resolveConfigObjects(sf, exported);
  if (objects.length === 0) {
    return {
      ...result,
      analysable: false,
      form: result.form,
      notes: [
        `the default export is \`${describeNode(exported)}\`, which does not resolve to a config object literal`,
        ...unresolved.map((u) => `unresolved: ${u}`),
      ],
    };
  }

  // --- 3. Read the top-level keys of each config object -------------------
  const features = new Set();
  for (const obj of objects) {
    for (const prop of obj.properties) {
      if (ts.isSpreadAssignment(prop)) {
        result.analysable = false;
        result.notes.push(
          `the config object spreads \`${describeNode(prop.expression)}\`; the keys it contributes are unknown`,
        );
        continue;
      }
      if (prop.name === undefined || ts.isComputedPropertyName(prop.name)) {
        if (ts.isComputedPropertyName(prop.name)) {
          result.analysable = false;
          result.notes.push(`the config object has a computed key \`${prop.name.getText(sf)}\``);
        }
        continue;
      }
      const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText(sf);
      const feature = NEXT_CONFIG_FEATURES.find((f) => f.key === name);
      if (feature) {
        features.add(feature.feature);
        const at = sf.getLineAndCharacterOfPosition(prop.getStart(sf));
        result.notes.push(
          `\`${name}\` is declared ${ts.isMethodDeclaration(prop) ? 'as a method' : 'as a property'} at ` +
            `${fileName}:${at.line + 1}:${at.character + 1}`,
        );
      }
      if (OPAQUE_KEYS.includes(name)) {
        result.analysable = false;
        result.opaque.push(name);
        result.notes.push(
          `the config declares \`${name}\`, which this analyser cannot read; the final config is not knowable here`,
        );
      }
    }
  }

  result.features = [...features];
  return result;
}

/**
 * Phase 36 (P35-1) — read the VALUE of a nested key in the exported config.
 *
 * `readNextConfigValue(source, 'images', 'unoptimized')` answers "what does
 * `config.images.unoptimized` evaluate to, textually?" for the literal forms a
 * Next config is written in.
 *
 * Why a presence test is not enough here. Next enters the image optimizer only
 * when `images.loader === 'default'` and `images.unoptimized` is falsy; with
 * `unoptimized: true` it 404s the route and never requires the optimizer module
 * at all. The triage rule for the AVIF RCE has to know which side of that line
 * the app is on, and `analyseNextConfig` cannot tell it: both `images: {}` and
 * `images: { unoptimized: true }` declare the `images` key.
 *
 * Deliberately conservative, in the direction of the caller failing closed:
 *
 *   - Returns `{ known: false }` for anything it cannot read with certainty —
 *     a spread, a computed key, a reference to something declared elsewhere, a
 *     value built by a call. It NEVER guesses. The triage rule treats
 *     `known: false` as "cannot prove the optimizer is disabled", which reports
 *     REACHABLE. An unreadable config must not be read as a safe one.
 *   - Reads only literals (`true`, `false`, `null`, numbers, strings) and the
 *     unary `!` of a literal. `unoptimized: !!process.env.X` is NOT resolved to
 *     a boolean — it is reported as `known: false`.
 *   - A key that is simply ABSENT is `known: true, value: undefined`, which is
 *     distinct from `known: false`. Absent means "not declared", i.e. Next's
 *     default applies; unreadable means "cannot tell". The caller must not
 *     conflate them.
 *
 * @returns {{known: boolean, value: boolean|string|number|null|undefined, at: string|null, reason: string|null}}
 */
export function readNextConfigValue(source, topKey, nestedKey, { fileName = 'next.config.mjs' } = {}) {
  const unknown = (reason) => ({ known: false, value: undefined, at: null, reason });
  if (typeof source !== 'string' || source.trim() === '') return unknown('the config file is empty or unreadable');

  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.JS);
  let exported;
  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) exported = stmt.expression;
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name === undefined === false &&
      (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Default) !== 0
    ) {
      exported = stmt;
    }
  }
  if (!exported) {
    for (const stmt of sf.statements) {
      if (
        ts.isExpressionStatement(stmt) &&
        ts.isBinaryExpression(stmt.expression) &&
        stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(stmt.expression.left) &&
        ts.isIdentifier(stmt.expression.left.expression) &&
        stmt.expression.left.expression.text === 'module' &&
        ts.isPropertyAccessExpression(stmt.expression.left) &&
        stmt.expression.left.name.text === 'exports'
      ) {
        exported = stmt.expression.right;
      }
    }
  }
  if (!exported) return unknown('no default export and no `module.exports` assignment was found in the config file');

  const { objects, unresolved } = resolveConfigObjects(sf, exported);
  if (objects.length === 0) {
    return unknown(`the default export does not resolve to a config object literal: ${describeNode(exported)}`);
  }

  // More than one resolved object means a conditional/merged config; a single
  // literal value cannot describe it.
  if (objects.length > 1) {
    return unknown(
      `the config resolves to ${objects.length} object literals (${unresolved.join('; ') || 'a conditional or merged export'}), so no single value can be asserted`,
    );
  }

  const obj = objects[0];
  let top = null;
  for (const prop of obj.properties) {
    if (ts.isSpreadAssignment(prop)) return unknown(`the config object spreads \`${describeNode(prop.expression)}\``);
    if (prop.name === undefined) continue;
    if (ts.isComputedPropertyName(prop.name)) return unknown(`the config object has a computed key \`${prop.name.getText(sf)}\``);
    const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText(sf);
    if (name !== topKey) continue;
    if (top !== null) return unknown(`the config declares \`${topKey}\` more than once, so no single value can be asserted`);
    top = prop;
  }

  if (top === null) {
    // Declared nowhere: Next's default applies. Known, and explicitly NOT the
    // same as "unreadable".
    return { known: true, value: undefined, at: null, reason: null };
  }
  if (ts.isMethodDeclaration(top)) return unknown(`\`${topKey}\` is declared as a method, not a value`);

  let inner = top.initializer;
  if (!inner) return unknown(`\`${topKey}\` has no readable initializer`);
  if (ts.isIdentifier(inner)) {
    const decl = findVariableInitializer(sf, inner.text);
    if (!decl) return unknown(`\`${topKey}\` is \`${inner.text}\`, which is not a variable declared in this file`);
    inner = decl;
  }
  if (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  if (!ts.isObjectLiteralExpression(inner)) {
    return unknown(`\`${topKey}\` is \`${describeNode(inner)}\`, which is not an object literal`);
  }

  for (const prop of inner.properties) {
    if (ts.isSpreadAssignment(prop)) {
      return unknown(`\`${topKey}\` spreads \`${describeNode(prop.expression)}\`, so its keys cannot be enumerated`);
    }
    if (prop.name === undefined) continue;
    if (ts.isComputedPropertyName(prop.name)) {
      return unknown(`\`${topKey}\` has a computed key \`${prop.name.getText(sf)}\``);
    }
    const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText(sf);
    if (name !== nestedKey) continue;
    if (ts.isMethodDeclaration(prop)) return unknown(`\`${topKey}.${nestedKey}\` is declared as a method, not a value`);
    const literal = readLiteral(prop.initializer);
    if (literal.known !== true) {
      return unknown(`\`${topKey}.${nestedKey}\` is \`${describeNode(prop.initializer)}\`, which is not a literal`);
    }
    const at = sf.getLineAndCharacterOfPosition(prop.getStart(sf));
    return { known: true, value: literal.value, at: `${fileName}:${at.line + 1}:${at.character + 1}`, reason: null };
  }

  // The key exists and is readable, but does not declare the nested key.
  return { known: true, value: undefined, at: null, reason: null };
}

/**
 * A literal, or the unary `!` of a literal. Anything else is `known: false`.
 * `!!process.env.FOO` deliberately does NOT resolve — a runtime value is not a
 * literal, and a security rule must not be handed a guess.
 */
function readLiteral(node) {
  if (!node) return { known: false, value: undefined };
  if (ts.isParenthesizedExpression(node)) return readLiteral(node.expression);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { known: true, value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { known: true, value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { known: true, value: null };
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = readLiteral(node.operand);
    return inner.known === true ? { known: true, value: !inner.value } : inner;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { known: true, value: node.text };
  if (ts.isNumericLiteral(node)) return { known: true, value: Number(node.text) };
  return { known: false, value: undefined };
}

/**
 * Follow an expression to the object literal(s) that ARE the Next config.
 *
 * Handles the three shapes Next.js accepts and the ones a reader has to expect
 * in a `.mjs`:
 *   const c = {...}; export default c;            -> the variable's initializer
 *   export default async (phase, {defaultConfig}) => { return {...} }  -> each return
 *   export default (phase) => ({...})             -> the arrow's body
 * `Object.assign({}, {...})` is followed too, because that is how a config is
 * conditionally built.
 */
function resolveConfigObjects(sf, expr, depth = 0) {
  const objects = [];
  const unresolved = [];
  if (depth > 6) {
    unresolved.push('expression nesting is too deep to follow');
    return { objects, unresolved };
  }

  const visit = (node) => {
    if (!node) return;
    if (ts.isParenthesizedExpression(node)) return visit(node.expression);
    if (ts.isObjectLiteralExpression(node)) {
      objects.push(node);
      return;
    }
    if (ts.isIdentifier(node)) {
      const decl = findVariableInitializer(sf, node.text);
      if (decl) visit(decl);
      else unresolved.push(`\`${node.text}\` is not a variable declared in this file`);
      return;
    }
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isFunctionDeclaration(node)) {
      if (node.body && ts.isBlock(node.body)) {
        for (const stmt of node.body.statements) {
          if (ts.isReturnStatement(stmt)) visit(stmt.expression);
        }
      } else if (node.body) {
        // Concise arrow body: `(phase) => ({...})`
        visit(node.body);
      }
      return;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = `${node.expression.expression.getText(sf)}.${node.expression.name.text}`;
      if (callee === 'Object.assign') {
        for (const arg of node.arguments) visit(arg);
        return;
      }
      unresolved.push(`\`${callee}(...)\` is a call this analyser does not follow`);
      return;
    }
    unresolved.push(`\`${describeNode(node)}\` is not a form this analyser follows`);
  };

  visit(expr);
  return { objects, unresolved };
}

function findVariableInitializer(sf, name) {
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) return decl.initializer;
    }
  }
  return undefined;
}

function describeNode(node) {
  if (!node) return 'undefined';
  const kind = ts.SyntaxKind[node.kind];
  if (ts.isIdentifier(node)) return `identifier \`${node.text}\``;
  if (ts.isCallExpression(node)) return `a call to \`${node.expression.getText?.() ?? kind}\``;
  return kind;
}
