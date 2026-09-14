# NOTES — @me2em/react (Iteration C1)

## Dependencies

- `@scure/bip39` is not listed in the original dependency spec but is needed
  only as a transitive dependency of `@me2em/core`. The `wordlist` is passed
  into `buildVerificationGrid` as a parameter, so no direct import is required.
  At runtime the wordlist resolves via `@me2em/core`'s hoisted dependency.

## Root tsconfig.base.json

No changes made. The package's `tsconfig.json` extends it and overrides
`jsx`, `lib`, `outDir`, and `types` as needed.

## Test counts

- Headless tests: 11 (identity-flow: 6, seed-words: 5)
- React tests: 13 (provider: 6, useHandle: 2, plus 5 additional in provider.spec.tsx)
- Total: 24 tests across 3 test files
