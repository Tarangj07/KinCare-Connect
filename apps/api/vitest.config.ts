import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the API.
 *
 * Phase 16: tests that boot AppModule (supertest integration specs) need
 * `emitDecoratorMetadata` to be preserved for Nest's DI to resolve
 * constructor-injected services. Vite's esbuild transform drops that
 * metadata, so the transform is delegated to the standard
 * `unplugin-swc` NestJS integration instead.
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
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
