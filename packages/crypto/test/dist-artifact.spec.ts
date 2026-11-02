// packages/crypto/test/dist-artifact.spec.ts
import { describe, it, expect } from 'vitest';
// Imports the BUILT artifact, not src. CI1 runs `build` before tests,
// so dist always exists in CI; locally run `pnpm --filter @me2em/crypto
// build` first.
import { generateSecurePassword } from '../dist/index.js';

/**
 * Smoke pin for the PUBLISHED module graph (BL-45).
 *
 * tsup bundles every import that is not a declared dependency. BL-45:
 * `src/validation/seed.ts` imported `@scure/bip39` WITHOUT declaring
 * it, so the inlined copy's `import { utils } from '@scure/base'`
 * landed in `dist/index.js` — and `@scure/base` 2.x (post-F6) exports
 * no `utils`, producing a module-level SyntaxError: the whole package
 * was unimportable for consumers while the src-based vitest suite
 * stayed green. Declaring the dependency externalizes it; this spec
 * fails if the phantom-dep class ever regresses into the dist graph.
 */
describe('dist artifact (published shape)', () => {
  it('loads and executes — no phantom-dep bundling (BL-45)', () => {
    const pw = generateSecurePassword(16);
    expect(pw.length).toBe(16);
  });
});
