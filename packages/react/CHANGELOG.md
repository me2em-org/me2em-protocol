# Changelog

## [Unreleased]

### Fixed
- `useIdentityContext`: an in-flight context load (identity change or
  `refresh()`) could resolve **after** a newer `save()`/`clear()` and
  overwrite the fresh state with pre-save data — an out-of-order async
  update. All async state transitions (load, save, clear, refresh) are
  now generation-sequenced: a stale resolution is dropped instead of
  clobbering newer state. Pinned by a deterministic regression test
  that holds the pre-save load snapshot in a gated storage proxy and
  releases it after the save.

### Changed
- Test hygiene in the `useIdentityContext` spec: a fresh fake-IndexedDB
  factory per test. The tests derive the same identity from the same
  mnemonic, so their storage DB name is identical — a shared database
  leaked the previous test's record into the next one. This fed the
  race above a stale record and was observed once as a CI flake
  ('rerender → context stays': expected `persistent-handle`, received
  the previous test's `test-handle`).

## [1.0.0-rc.1] — 2026-11-01

Release-candidate alignment with `@me2em/core` 1.0.0-rc.1 (the
API-freeze release of the LTS program). The public API of this package
is frozen as of this version; additive changes land in 1.x minors.

### Changed
- `engines.node` floor raised to `>=22.0.0` (A2, applied workspace-wide:
  root, core, crypto, react).

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
