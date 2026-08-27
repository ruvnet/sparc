import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts', 'scripts/*.mjs'],
      thresholds: {
        lines: 70,
        functions: 80,
        statements: 70,
        branches: 55,
      },
    },
  },
});
