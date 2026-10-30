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
      // A7 ratchet (PLAN-LTS PR-4): enforced floor at the measured level;
      // raise to 90/90 (A7 target) with the next react-touching PR
      // that lands the component test slice. Tracked in BL-34.
      thresholds: {
        lines: 82,
        branches: 71,
        functions: 81,
        statements: 80,
      },
    },
  },
});
