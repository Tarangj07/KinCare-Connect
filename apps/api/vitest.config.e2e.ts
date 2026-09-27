import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * E2E / HTTP-level security integration specs (real Nest app + PostgreSQL).
 * Runs with the same SWC decorator-metadata transform as the unit config so
 * AppModule DI resolves exactly like production.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    setupFiles: ['src/testing/setup-env.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    // Real-DB suites must not interleave DB fixtures.
    fileParallelism: false,
  },
});
