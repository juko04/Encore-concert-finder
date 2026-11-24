import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Regression suite for the PR-review findings. Run with:
//   npx vitest run --config tests/regression/vitest.config.ts
const root = path.resolve(__dirname, '../..');

export default defineConfig({
  plugins: [react()],
  root,
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15000,
    include: ['tests/regression/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': root,
      'server-only': path.resolve(root, 'tests/mocks/server-only.ts'),
    },
  },
});
