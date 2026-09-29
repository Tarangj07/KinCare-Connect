/* ESLint config for Node / NestJS apps. */
const base = require('./eslint.base.cjs');

module.exports = {
  ...base,
  env: { ...(base.env ?? {}), node: true, es2022: true },
  rules: {
    ...(base.rules ?? {}),
    'no-process-exit': 'error',

    // Phase 22 (F-01 follow-up). `@typescript-eslint/consistent-type-imports`
    // MUST be off for the NestJS API, and the reason is a security defect, not
    // a style preference.
    //
    // NestJS depends on runtime type information: `emitDecoratorMetadata` emits
    // `design:paramtypes` so the DI container can resolve a constructor
    // parameter, and so the global `ValidationPipe({ transform: true })` can
    // instantiate a DTO and run the constraints declared on it.
    //
    // `import type` is fully elided at compile time, so a class reachable only
    // through `import type` has no runtime symbol to reference. TypeScript
    // then emits a degraded paramtype — and for a method parameter it emits
    // `Function`, which is NOT in Nest's `toValidate()` skip list
    // ([String, Boolean, Number, Array, Object, Buffer, Date]). The pipe
    // therefore runs class-validator against a constructor carrying none of
    // the DTO's constraints, and `forbidNonWhitelisted: true` rejects every
    // supplied field.
    //
    // This exact combination shipped: `auth.controller.ts` used
    // `import type { RegisterDto, … }`, and the production image answered
    // 400 "property email should not exist" to every registration and every
    // login, while the build was green and every test passed. See
    // SECURITY_REVIEW_PHASE_21.md and the Phase 22 report.
    //
    // The rule reported 59 warnings across 29 files in this workspace,
    // including every controller with a DTO. Running `eslint --fix` would
    // have converted all of them to `import type` and broken EVERY request
    // that carries a body — a catastrophic latent hazard. The rule is safe in
    // the browser/mobile packages, which have no decorator metadata, so it is
    // disabled here only.
    '@typescript-eslint/consistent-type-imports': 'off',
  },
};
