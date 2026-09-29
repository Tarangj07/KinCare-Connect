#!/usr/bin/env node
/**
 * Phase 23 (W1) — Nest decorator-metadata parity gate.
 *
 * The defect Phase 22 found (F-01) was not a bug in one file. It was a
 * *class* of build-output defect: TypeScript's `emitDecoratorMetadata`
 * needs a runtime symbol for every class-typed parameter, so an `import type`
 * (which is fully elided) leaves the compiler with no symbol to emit. tsc
 * then writes `Function` into `design:paramtypes`. Nest's ValidationPipe
 * skip-list is [String, Boolean, Number, Array, Object, Buffer, Date] —
 * `Function` is NOT on it — so the pipe runs class-validator against a
 * constructor that carries none of the DTO's constraints, and
 * `forbidNonWhitelisted: true` rejects every supplied property.
 *
 * The reason it shipped is equally important: vitest/SWC emits
 * `typeof X === "undefined" ? Object : X`, which degrades to `Object`, which
 * IS on the skip list, which means the pipe silently SKIPS validation. The
 * test toolchain and the shipping toolchain disagree, and only the shipping
 * toolchain decides whether the product works.
 *
 * This gate makes that disagreement a build failure instead of a surprise.
 * It runs in two halves against two different artefacts, and both halves
 * must pass:
 *
 *   PART A — source (static, TypeScript compiler API)
 *     For every class member that TypeScript will actually decorate
 *     (any decorated method, and every constructor) in every file that
 *     `tsconfig.build.json` compiles, for every parameter whose declared
 *     type resolves to a CLASS declaration, assert that the class reached
 *     the file through a *value* import. `import type`, or an inline
 *     `{ type X }` specifier, is a violation. This is the root-cause rule:
 *     it fires on the defect itself rather than on one symptom of it.
 *
 *   PART B — compiled output (behavioural, loads dist/*.js)
 *     1. No `design:paramtypes` entry anywhere in dist is `Function`.
 *        `Function` in that metadata is the fingerprint of an elided
 *        import and is never legitimate.
 *     2. For every class-typed parameter Part A identified, the class object
 *        actually present in the shipped `design:paramtypes` array is
 *        *identical* (`===`) to the class exported by the corresponding
 *        compiled DTO module. This is identity, not a name: a stub, an
 *        `Object`, or a different class with the right name all fail.
 *
 * Part B is what makes this a real gate rather than a lint rule: it reads
 * the artefact that ships. `scripts/mutate-decorator-metadata.mjs`
 * reintroduces the exact Phase 22 defect in a scratch copy, rebuilds, and
 * proves this gate fails.
 *
 * Deliberately NOT a blanket "no `import type`" rule. `Request`/`Response`
 * from express, `ExecutionContext`/`CanActivate` from @nestjs/common and
 * Prisma's generated enum types are interfaces or type-only constructs:
 * they have no runtime identity to preserve, and requiring a value import
 * for them would be wrong. Only CLASS declarations are enforced.
 *
 * Usage:  node scripts/verify-decorator-metadata.mjs [--dist <dir>]
 * Exits non-zero if any rule is violated.
 */
import { createRequire } from 'node:module';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const repoRoot = path.resolve(apiRoot, '..', '..');

const distArgIndex = process.argv.indexOf('--dist');
const distDir = distArgIndex >= 0 ? path.resolve(process.argv[distArgIndex + 1]) : path.join(apiRoot, 'dist');
const srcDir = path.join(apiRoot, 'src');

const violations = [];
function report(where, message) {
  violations.push(`${where}: ${message}`);
}

// ---------------------------------------------------------------------------
// PART A — static analysis of the source that feeds the production build.
// ---------------------------------------------------------------------------

const ts = require_('typescript');

const configPath = path.join(apiRoot, 'tsconfig.build.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  console.error(ts.formatDiagnostic(configFile.error, formatHost));
  process.exit(1);
}
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, apiRoot);
const program = ts.createProgram(parsed.fileNames, {
  ...parsed.options,
  noEmit: true,
});
const checker = program.getTypeChecker();

const formatHost = {
  getCanonicalFileName: (f) => f,
  getCurrentDirectory: () => apiRoot,
  getNewLine: () => '\n',
};

const ROUTE_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options', 'Body', 'Param', 'Query', 'Req', 'Res']);

/** True when the compiler will emit design:paramtypes for this member. */
function emitsParamtypes(member) {
  if (ts.isConstructorDeclaration(member)) return true;
  const decorators = ts.canHaveDecorators?.(member) ? ts.getDecorators(member) ?? [] : [];
  return decorators.length > 0;
}

function decoratorName(decorator) {
  const expr = decorator.expression;
  if (ts.isCallExpression(expr)) return expr.expression.getText();
  if (ts.isIdentifier(expr)) return expr.text;
  return undefined;
}

/**
 * How did `symbol` enter this file? Returns 'local' (declared here) or
 * 'value' / 'type-only' (imported).
 *
 * The symbol passed here must be the LOCAL one — for a parameter declared
 * `dto: SomeDto` that is the symbol of the `SomeDto` identifier in the type
 * reference, which is an alias whose single declaration is the
 * ImportSpecifier. Passing the resolved type's symbol instead yields the
 * class declaration in the *defining* module, which would make every import
 * look local and the rule would never fire.
 */
function importKindOfSymbol(symbol) {
  if (!symbol) return 'local';
  const decls = symbol.declarations ?? [];
  if (decls.length === 0) return 'local';

  const importSpecifiers = decls.filter((d) => ts.isImportSpecifier(d));
  if (importSpecifiers.length > 0) {
    let typeOnly = false;
    let value = false;
    for (const spec of importSpecifiers) {
      // `import type { X } from 'y'` marks the whole ImportClause.
      const clause = spec.parent?.parent;
      if (ts.isImportClause(clause) && clause.isTypeOnly) {
        typeOnly = true;
        continue;
      }
      // `import { type X } from 'y'` marks the specifier itself.
      if (spec.isTypeOnly) {
        typeOnly = true;
        continue;
      }
      value = true;
    }
    if (value) return 'value';
    return typeOnly ? 'type-only' : 'local';
  }

  // `import * as ns from 'y'` and default imports are always value imports.
  if (decls.some((d) => ts.isNamespaceImport(d) || ts.isImportClause(d))) return 'value';
  if (decls.some((d) => ts.isClassDeclaration(d) || ts.isClassExpression(d))) return 'local';
  return 'local';
}

/**
 * Does `type` resolve to a CLASS declaration (a value that must exist at
 * runtime)? Interfaces, type aliases, enums-as-const-unions, generics and
 * structural object types are all rejected here on purpose.
 */
function runtimeClassOfType(type) {
  if (type.isUnionOrIntersection?.() || type.isUnion?.() || type.isIntersection?.()) return undefined;
  const symbol = type.aliasSymbol ?? type.getSymbol();
  if (!symbol) return undefined;
  const decls = symbol.declarations ?? [];
  const classDecl = decls.find((d) => ts.isClassDeclaration(d) || ts.isClassExpression(d));
  if (!classDecl) return undefined;
  // A generic class used without type arguments still needs runtime identity
  // (its constructor is the DI token), so generic classes are kept.
  return classDecl;
}

/**
 * The symbol a type node *names in this file*. For a TypeReference that is
 * the identifier (`SomeDto` in `dto: SomeDto`); for a bare identifier type
 * it is the identifier itself. Qualified names resolve to the leftmost part,
 * which is where the import lives.
 */
function localSymbolFor(typeNode, checker) {
  if (ts.isTypeReferenceNode(typeNode) || ts.isExpressionWithTypeArguments(typeNode)) {
    return checker.getSymbolAtLocation(typeNode.typeName) ?? undefined;
  }
  if (ts.isQualifiedName(typeNode)) {
    let left = typeNode;
    while (ts.isQualifiedName(left)) left = left.left;
    return checker.getSymbolAtLocation(left);
  }
  if (ts.isIdentifier(typeNode)) return checker.getSymbolAtLocation(typeNode);
  return undefined;
}

const expected = []; // { where, className, compiledFile, consumerFile, consumerClass, memberName, index }
let checkedParams = 0;
let requiredRuntimeClasses = 0;

const sourceFiles = program
  .getSourceFiles()
  .filter((sf) => !sf.isDeclarationFile && sf.fileName.startsWith(srcDir + path.sep));

for (const sf of sourceFiles) {
  sf.forEachChild((node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return;

    const members = [...(node.members ?? [])];
    for (const member of members) {
      if (!emitsParamtypes(member)) continue;
      if (!ts.isConstructorDeclaration(member) && !ts.isMethodDeclaration(member)) continue;
      const memberName = ts.isConstructorDeclaration(member) ? 'constructor' : member.name.getText();
      const isRouteHandler =
        ts.isMethodDeclaration(member) &&
        (ts.canHaveDecorators?.(member) ? ts.getDecorators(member) ?? [] : []).some((d) =>
          ROUTE_DECORATORS.has(decoratorName(d) ?? ''),
        );

      member.parameters.forEach((param, index) => {
        if (!param.type) return;
        checkedParams += 1;
        const type = checker.getTypeAtLocation(param);
        const classDecl = runtimeClassOfType(type);
        if (!classDecl) return; // type-only construct: no runtime identity needed
        requiredRuntimeClasses += 1;

        // Judge the import on the symbol written in THIS file. For a
        // reference like `dto: SomeDto` that is the identifier inside the
        // TypeReference, which is an alias with an ImportSpecifier
        // declaration. The type's own symbol resolves through the alias to
        // the class declaration in the defining module, which would make
        // every import look local and the rule would never fire.
        const kind = importKindOfSymbol(localSymbolFor(param.type, checker));

        const declFile = classDecl.getSourceFile().fileName;
        const where = `${path.relative(repoRoot, sf.fileName)} ${node.name.text}.${memberName}#${index}${
          isRouteHandler ? ' (route handler)' : ''
        }`;

        if (kind === 'type-only') {
          report(
            where,
            `parameter type \`${param.type.getText()}\` is a class (${classDecl.name?.text}) but reaches this file via ` +
              '`import type`. The import is elided, `design:paramtypes` degrades to `Function`, and Nest\'s ' +
              'ValidationPipe then runs against a constraint-free constructor. Import it as a value.',
          );
          return;
        }

        if (declFile.startsWith(srcDir + path.sep)) {
          const rel = path.relative(srcDir, declFile).replace(/\.ts$/, '.js');
          const consumerRel = path.relative(srcDir, sf.fileName).replace(/\.ts$/, '.js');
          expected.push({
            where,
            className: classDecl.name.text,
            compiledFile: path.join(distDir, rel),
            consumerFile: path.join(distDir, consumerRel),
            consumerClass: node.name.text,
            memberName,
            index,
          });
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// PART B — inspect the artefact that actually ships.
// ---------------------------------------------------------------------------

require_('reflect-metadata');

function walkJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkJs(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

if (!statSyncSafe(distDir)) {
  console.error(`\nFATAL: compiled output not found at ${distDir}. Run \`pnpm build\` first.\n`);
  process.exit(1);
}

function statSyncSafe(p) {
  try {
    return statSync(p);
  } catch {
    return undefined;
  }
}

const loaded = new Map();
function loadCompiled(file) {
  if (!loaded.has(file)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    loaded.set(file, require_(file));
  }
  return loaded.get(file);
}

let scannedFiles = 0;
let scannedMembers = 0;
let functionEntries = 0;

for (const file of walkJs(distDir)) {
  if (path.resolve(file) === path.join(distDir, 'main.js')) continue; // would bootstrap a server
  let mod;
  try {
    mod = loadCompiled(file);
  } catch (err) {
    // A module that cannot be loaded cannot be reasoned about; surface it
    // rather than silently excluding it from the audit.
    report(path.relative(repoRoot, file), `compiled module could not be loaded: ${err.message.split('\n')[0]}`);
    continue;
  }
  scannedFiles += 1;
  for (const exported of Object.values(mod)) {
    if (typeof exported !== 'function') continue;
    // Two metadata shapes exist, and the gate must cover both:
    //   constructors       -> Reflect.getMetadata(key, TheClass)
    //   decorated methods  -> Reflect.getMetadata(key, TheClass.prototype, name)
    const namedTargets = [];
    if (exported.prototype) {
      for (const name of Object.getOwnPropertyNames(exported.prototype)) {
        if (name === 'constructor') continue;
        namedTargets.push([exported.prototype, name]);
      }
    }
    const targets = [[exported, undefined], ...namedTargets];
    for (const [target, propName] of targets) {
      const paramtypes = Reflect.getMetadata('design:paramtypes', target, propName);
      if (!Array.isArray(paramtypes)) continue;
      scannedMembers += 1;
      const where = propName ? `${exported.name}.${propName}` : `${exported.name} constructor`;
      paramtypes.forEach((pt, i) => {
        if (pt === Function) {
          functionEntries += 1;
          report(
            path.relative(repoRoot, file),
            `design:paramtypes[${i}] of ${where} is \`Function\` — an import was elided at compile time. ` +
              'This is the exact Phase 22 (F-01) fingerprint.',
          );
        }
      });
    }
  }
}

// Identity check: the shipped metadata must hold the REAL DTO class.
for (const item of expected) {
  let required;
  try {
    required = loadCompiled(item.compiledFile)[item.className];
  } catch (err) {
    report(item.where, `could not load ${path.relative(repoRoot, item.compiledFile)}: ${err.message.split('\n')[0]}`);
    continue;
  }
  if (typeof required !== 'function') {
    report(item.where, `${item.className} is not exported from the compiled module it is imported from.`);
    continue;
  }

  // Locate the *consuming* class in the compiled output, by module and by
  // class name, so we assert identity on exactly the member the compiler
  // emitted metadata for — not on some same-named method elsewhere.
  let consumerMod;
  try {
    consumerMod = loadCompiled(item.consumerFile);
  } catch (err) {
    report(item.where, `could not load ${path.relative(repoRoot, item.consumerFile)}: ${err.message.split('\n')[0]}`);
    continue;
  }
  const consumerClass = consumerMod[item.consumerClass];
  if (typeof consumerClass !== 'function' || !consumerClass.prototype) {
    report(item.where, `compiled ${item.consumerClass} is not exported from ${path.relative(repoRoot, item.consumerFile)}.`);
    continue;
  }

  if (item.memberName === 'constructor') {
    checkIdentity();
  } else {
    if (typeof consumerClass.prototype[item.memberName] !== 'function') {
      report(item.where, `compiled ${item.consumerClass}.${item.memberName} does not exist.`);
      continue;
    }
    checkIdentity();
  }

  function checkIdentity() {
    // TypeScript emits method metadata in the descriptor form —
    // `__decorate([...], Class.prototype, "method", null)` — so the metadata
    // is keyed by the property name, not attached to the function object.
    // Constructor metadata is attached to the class itself.
    const paramtypes =
      item.memberName === 'constructor'
        ? Reflect.getMetadata('design:paramtypes', consumerClass)
        : Reflect.getMetadata('design:paramtypes', consumerClass.prototype, item.memberName);
    if (!Array.isArray(paramtypes)) {
      report(
        item.where,
        'no design:paramtypes metadata was emitted for this member, so Nest has no runtime type to ' +
          'validate the parameter against.',
      );
      return;
    }
    if (paramtypes[item.index] !== required) {
      report(
        item.where,
        `compiled design:paramtypes[${item.index}] is ${describe(paramtypes[item.index])}, not the real ` +
          `${item.className} class. Nest will not validate this parameter against its DTO.`,
      );
    }
  }
}

function describe(v) {
  if (v === Function) return '`Function` (elided import)';
  if (v === undefined) return '`undefined` (no metadata emitted)';
  if (v === Object) return '`Object` (validation skipped by Nest)';
  if (typeof v === 'function') return `\`${v.name || 'anonymous'}\``;
  return String(v);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log('\nPhase 23 (W1) — Nest decorator-metadata parity\n');
console.log(`  source files analysed : ${sourceFiles.length}`);
console.log(`  typed parameters      : ${checkedParams}`);
console.log(`  class-typed params    : ${requiredRuntimeClasses} (all must be value imports)`);
console.log(`  compiled files loaded : ${scannedFiles}`);
console.log(`  metadata entries seen : ${scannedMembers}`);
console.log(`  "Function" entries    : ${functionEntries}`);
console.log(`  DTO identity checks   : ${expected.length}`);

if (violations.length > 0) {
  console.error(`\nFAILED — ${violations.length} decorator-metadata violation(s):\n`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    '\nA build that fails here can pass every source-level test suite and still\n' +
      'ship an artifact whose endpoints reject all input. This is the Phase 22\n' +
      '(F-01) class of defect.\n',
  );
  process.exit(1);
}

console.log('\nDecorator metadata is intact in source and in the compiled artifact.\n');
