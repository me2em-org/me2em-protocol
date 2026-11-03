# Changelog

## [1.1.0] — 2026-11-04

Seed hygiene (BL-48) and structured errors (BL-50) — the post-freeze
train. **Early break accepted** (verdict 2026-11-04): the derivation
hook and flow error shapes change in a minor release; the ecosystem at
rc.3 is empty, so no deprecation window is provided.

### Breaking (early break — BL-50)
- `useHandle` returns a discriminated union instead of
  `Handle | null`: `{ handle, error: null }` on success,
  `{ handle: null, error }` on failure, `{ handle: null, error: null }`
  while the derivation is in flight. `error.code` is machine-readable:
  `AttestationErrorCode` from core passes through verbatim, plus
  `NO_IDENTITY` (no activated identity in the provider) and `UNKNOWN`
  (outside the core error model). Failures no longer go only to the
  console (R7 resolved).
- `useSubHandle` returns the same union under `subHandle`
  (`SubHandleResult`).
- Flow hooks (`useCreateIdentity`, `useImportSeed`) surface `error` as
  `Me2emFlowError | null` (`{ code, message }`) instead of
  `string | null`; `IdentityFlowState.error` and the `FAIL` event
  carry the same shape (`FAIL` gains an optional `code`, defaulting to
  `APP_FAILURE`). Flow codes: `GENERATE_FAILED`, `INVALID_WORDS`,
  `DERIVATION_FAILED`, `ACTIVATION_FAILED`, `APP_FAILURE`.
- Migration: destructure `const { handle } = useHandle('name')` and
  branch on `error.code`; replace string comparisons against `error`
  with code matches.

### Added
- BL-48: `discardSeed()` on `useCreateIdentity` and `useImportSeed`
  (and the headless `DISCARD_SEED` event) — the app-initiated seed
  hygiene action drops the retained `identitySeed` from the flow state
  after activation, making the bytes GC-eligible. Valid from
  'verified'/'imported' (no-op while the words are still on screen);
  the underlying buffer is not zeroed (mixed caller/library ownership,
  R6).

### Fixed
- `useImportSeed` no longer swallows activation failures: the
  `activateIdentity` result was ignored, so a failed activation left
  the flow in 'imported' with no error and no identity. It now
  surfaces as a structured `ACTIVATION_FAILED` failure.
- BL-52: the half-life threshold is defined once
  (`halfLifePointMs(expiresAt, ttl)`); the timer and the
  `visibilitychange` path read the same fixed point, so they cannot
  drift when `ttl` changes mid-session. The timer now also schedules
  (min 1s delay) when the session is already past the point, instead
  of never scheduling.
- BL-53: test hygiene — bounded `waitFor` replaces the fixed 2–3 s
  sleeps in the renewal tests; the BL-51 absence windows shrink to
  25 ms with an explicit rationale (waitFor cannot prove absence).

## [1.0.0-rc.3] — 2026-11-04

Session renewal on return to visibility (BL-51). No public API
changes.

### Fixed
- `useSession`: auto-renewal ran on the half-life `setTimeout` alone.
  Background tabs throttle timers (clamped wakeups after ~5 minutes
  hidden) and fully suspend them while frozen (Memory Saver, mobile
  backgrounds), so on returning to a long-hidden tab the session
  could already be past its half-life — or expired — while the
  overdue timer had not yet fired, leaving the first user actions
  racing an expiring session (BL-51, external review #8). The hook now
  also listens for `visibilitychange`: when the document becomes
  visible and the session is past its half-life point
  (`expiresAt − ttl/2`, the same threshold the timer uses), it renews
  proactively. `autoRenew: false` opts out, exactly like the timer
  path; `renew()` clears and reschedules the timer, so the overdue
  timer cannot double-renew.

## [1.0.0-rc.2] — 2026-11-04

Dispose parity for the identity lifecycle (BL-47) plus the JSDoc
contract fold promised in the rc.1 follow-up (BL-48/BL-49, R5–R7).
No public API changes.

### Fixed
- `Me2emProvider` never disposed the replaced identity: re-activating
  over an active identity (`activateIdentity`) and `clearIdentity()`
  dropped the previous `Identity` without calling `dispose()`, so its
  key material was never zeroed (BL-47, external review #1). The
  replaced (or cleared) handle is now disposed at the swap; stale
  references fail loudly with `DisposedError` per the core contract
  instead of silently operating on zeroed keys. In-flight activations
  are generation-ordered (the same load-race class fixed for
  `useIdentityContext` in rc.1): a result landing after a newer
  activation, `clearIdentity()` or unmount disposes its own handle
  and resolves `false` instead of overwriting newer state. Unmount
  runs a cleanup-only dispose. Dispose never happens inside state
  updaters (StrictMode double-invokes them); the ref is mutated only
  in event handlers and cleanup effects, always alongside
  `setIdentity`.

### Changed
- Documentation contracts (no behavior change): `Me2emContextValue` —
  replacement/clear disposes the previous identity, and
  `activateIdentity` does not consume the caller's seed buffer
  (BL-48); `IdentityFlowState.identitySeed` — retained in state after
  'verified'/'imported' by design, the flow does not self-consume it;
  an explicit `discardSeed()` action is the planned v1.1 opt-in
  (BL-48); `SeedPhraseVerify` — the grid shuffle is deterministic by
  design, not a security control (BL-49);
  `IdentityContextStorage.close()` — caller-owned reopen contract
  (R5, README example now closes the storage on unmount);
  `deriveCacheKey` — `loginMaterial` is caller-owned and never wiped
  by the implementation (R6); `useHandle`/`useSubHandle` —
  silent-failure contract documented, the structured
  `{ handle, error }` shape is post-freeze BL-50 (R7).

## [1.0.0-rc.1] — 2026-11-04

Release-candidate alignment with `@me2em/core` 1.0.0-rc.1 (the
API-freeze release of the LTS program). The public API of this package
is frozen as of this version; additive changes land in 1.x minors.

### Changed
- `engines.node` floor raised to `>=22.0.0` (A2, applied workspace-wide:
  root, core, crypto, react).
- Identity Context Cache envelope codec: base64url encoding now goes
  through the audited `@scure/base` codec re-exported by `@me2em/core`
  (`base64urlEncode`/`base64urlDecode`), replacing the hand-rolled
  `btoa`/`atob` wrapper (audit R4) — one base64 implementation across
  packages. The persisted envelope format is unchanged (unpadded
  URL-safe base64); `deriveCacheKey` / `encryptContext` /
  `decryptContext` signatures are untouched.
- Test hygiene in the `useIdentityContext` spec: a fresh fake-IndexedDB
  factory per test. The tests derive the same identity from the same
  mnemonic, so their storage DB name is identical — a shared database
  leaked the previous test's record into the next one. This fed the
  race above a stale record and was observed once as a CI flake
  ('rerender → context stays': expected `persistent-handle`, received
  the previous test's `test-handle`).

### Fixed
- `useIdentityContext`: an in-flight context load (identity change or
  `refresh()`) could resolve **after** a newer `save()`/`clear()` and
  overwrite the fresh state with pre-save data — an out-of-order async
  update. All async state transitions (load, save, clear, refresh) are
  now generation-sequenced: a stale resolution is dropped instead of
  clobbering newer state. Pinned by a deterministic regression test
  that holds the pre-save load snapshot in a gated storage proxy and
  releases it after the save.
- `useIdentityContext`: `save()`/`clear()` no longer commit their state
  change when the active identity switched while the storage operation
  was in flight. The generation ticket from the load-race fix only
  orders these operations against in-flight loads; it does not know
  about identity switches — a slow `save()` resolving after a logout
  (or an identity switch) would surface identity A's context under the
  new state, and a slow `clear()` could blank identity B's freshly
  loaded context. Both commits are now guarded by the identity the
  operation started for (render-mirrored ref); a stale commit is
  dropped and the new identity's load effect owns the state.
- `useIdentityContext`: a successful `save()`/`clear()` now resets a
  previously set load `error` (parity with the load success path,
  which already cleared it).
- `SeedPhraseDisplay`: a failed clipboard copy now distinguishes a
  permanent failure (async Clipboard API unavailable — non-secure
  context, unsupported browser: the message points at manual word
  selection and the copy button is disabled) from a transient one
  (the write was rejected — retry stays possible and a successful
  retry clears the error). The error element carries a
  `data-kind="transient"|"permanent"` attribute (audit R8).

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
