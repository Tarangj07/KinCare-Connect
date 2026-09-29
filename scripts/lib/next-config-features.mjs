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
 *
 * When (2) or (3) is negative the caller MUST fail closed. "I could not check
 * this" is a finding, not a dismissal — the same rule the triage script
 * already applies to an advisory it has no rule for.
 *
 * Usage:  import { analyseNextConfig } from './lib/next-config-features.mjs';
 *         analyseNextConfig(source, { fileName: 'next.config.mjs' })
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
