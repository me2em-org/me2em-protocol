import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    '@me2em/core',
    '@solana/kit',
    '@solana/keys',
    '@solana-program/system',
    '@solana-program/memo',
  ],
});
