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
      // (2026-11-04, v1.1 train: 87.42 / 79.93 / 88.48 / 89.09 — the
      // BL-50 result-union tests landed the missing useSubHandle /
      // useImportSeed slice; lines floor kept one point of headroom).
      // Raise to 90/90 (A7 target) with the remaining gap closers.
      // Tracked in BL-34.
      thresholds: {
        lines: 88,
        branches: 79,
        functions: 88,
        statements: 87,
      },
    },
  },
});
