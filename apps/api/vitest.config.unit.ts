import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Fast unit/service specs under src/. Database-backed specs opt into a
 * real PostgreSQL via their own guards; this config excludes the heavier
 * HTTP integration suites (see vitest.config.e2e.ts).
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
    include: ['src/**/*.{spec,test}.ts'],
    setupFiles: ['src/testing/setup-env.ts'],
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
