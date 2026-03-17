import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/tests/e2e/**'],
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['tests/unit/main/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'preload',
          environment: 'node',
          include: ['tests/unit/preload/**/*.test.ts'],
        },
      },
    ],
  },
});
