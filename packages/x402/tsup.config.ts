import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/b402.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['@me2em/core'],
});
