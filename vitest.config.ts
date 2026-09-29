import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every case that loads a TypeScript file pays jiti's first-transpile cost, and the interop cases spawn a second cosmiconfig major.
    testTimeout: 30_000,
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
