import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.spec.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // A7 ratchet (PLAN-LTS PR-4): enforced floor at the measured level
      // (2026-11-04, rc.1 publish-prep: 82 / 75.17 / 82.94 / 83.86).
      // Raise to 90/90 (A7 target) with the PR that lands the missing
      // component test slice (useSubHandle 0%, useImportSeed ~53%).
      // Tracked in BL-34.
      thresholds: {
        lines: 83,
        branches: 75,
        functions: 82,
        statements: 82,
      },
    },
  },
});
