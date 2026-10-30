# NOTES — @me2em/react

## 0.1.0-alpha.2 re-publication (DR-4, 2026-10-30)

- No code changes: `dist/` is byte-identical to 0.1.0-alpha.1. The
  re-release exists only to fix the published manifest — see BACKLOG.md
  → DR-4 for the full incident record.
- What was wrong: `pnpm publish` substituted `workspace:*` with the
  EXACT workspace version, so the published package pinned
  `@me2em/core@0.7.0-alpha.1`, whose artifact lacked the `wordlist`
  export its changelog announced → site build failed with
  `[MISSING_EXPORT] "wordlist"`.
- The fix: the source declares `workspace:^`, which publishes as the
  caret range `^0.7.0-alpha.2`. `workspace:*` is forbidden for
  cross-package dependencies (rule from DR-4).

## Dependencies

- `@scure/bip39` is **not** a direct dependency of this package. The
  `wordlist` is passed into `buildVerificationGrid` as a parameter; no
  direct import exists in `src/` or `test/` (verified by search).
- Since core 0.7.0-alpha.2, `@scure/bip39 ^1.3.0` is a **declared**
  dependency of `@me2em/core` (it ships the official 2048-entry
  wordlist re-export). Resolution goes through core's manifest — do
  not rely on pnpm hoisting of transitive dependencies; relying on
  hoisting is exactly what made the DR-4 incident possible.
- Cross-package dependency: `@me2em/core: workspace:^` in source,
  published as `^0.7.0-alpha.2`.

## Root tsconfig.base.json

No changes made. The package's `tsconfig.json` extends it and overrides
`jsx`, `lib`, `outDir`, and `types` as needed.

## Test counts (as of 0.1.0-alpha.2)

- Headless tests: 61 across 7 files — context-crypto 4, display-flow 9,
  identity-context-storage 9, identity-flow 6, import-flow 10,
  seed-words 13, verify-flow 10.
- React tests: 40 across 7 spec files — PassphraseInput 4,
  SeedPhraseDisplay 7, SeedPhraseImport 6, SeedPhraseVerify 4,
  provider 9, useIdentityContext 5, useSession 5; plus the
  `renderWithProvider.tsx` helper (not a spec).
- Total: 101 tests across 14 files — matches the BACKLOG baseline
  (react 101 of 438 total).
