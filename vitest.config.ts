import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // NestJS relies on emitDecoratorMetadata for dependency injection. Vitest's
  // default esbuild transform does not emit it, so DI tests fail with opaque
  // "Nest can't resolve dependencies" errors. SWC emits it correctly.
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['services/**/*.{test,spec}.ts', 'packages/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    coverage: { reporter: ['text', 'lcov'] },
  },
});
