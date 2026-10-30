# Changelog

## 0.1.0-alpha.2

### Changed
- Published manifest: `@me2em/core` is now declared as the caret range
  `^0.7.0-alpha.2` instead of the exact pin `0.7.0-alpha.1`. The exact
  pin was an artifact of `workspace:*` substitution during
  `pnpm publish`; it broke consumer builds (site:
  `[MISSING_EXPORT] "wordlist"`) as soon as core moved forward. In the
  source the dependency is declared as `workspace:^`, which publishes
  as `^X.Y.Z`.
- `dist/` is byte-identical to 0.1.0-alpha.1 — no code changes.

## 0.1.0-alpha.1

### Added
- Initial publication: identity lifecycle hooks (`useCreateIdentity`,
  `useImportSeed`, `useHandle`, `useSubHandle`), seed phrase UX
  components (`SeedPhraseDisplay`, `SeedPhraseVerify`,
  `SeedPhraseImport`, `PassphraseInput`), `useSession` with
  auto-renewal at half-life, encrypted Identity Context Cache
  (IndexedDB, non-extractable persisted CryptoKey), and the
  framework-agnostic headless layer (exported as the `headless`
  namespace).
