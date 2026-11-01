# Changelog

## [Unreleased]

### Changed
- `Handle.getMetadata()` and the `Handle` constructor metadata input now
  deep-copy custom metadata (JSON-safe structures up to depth 8);
  non-plain values (Date, Map, functions) remain shared by reference —
  same caveats as `getSubMetadata()`. Symmetry hardening (PR-7
  direction): closes the last live-reference input in the Handle family
  — the caller keeps no live reference. Non-breaking: code relying on
  the previous shallow behavior sees only more isolation.
- `specs/v1.0.md` §12 now enumerates the `crypto` namespace as actually
  exported — the derivation functions, the documented raw Ed25519
  wrappers (`getPublicKey`, `sign`, `verify` and their `*Async`
  variants) and `hkdf` / `sha256` — and notes that `derivePassword` /
  `deriveChannelKey` are `Handle` methods, not namespace members;
  the seed-utilities list is completed (`generateSeedPhrase`,
  `normalizeSeedPhrase`, `validateSeedPhrase`). §7/§8: API-misuse
  `TypeError` cases (non-string name/context, non-`Signer` issuer,
  raw private-key bytes) documented as outside the `AttestationError`
  model. Docs+tests only, non-breaking; golden vectors untouched.
- TSDoc completed for the raw wrappers (Async variants, `sha256`) and
  the `crypto` namespace description added; README core documents the
  raw-primitives group and the reasons the wrappers exist; the
  five previously unpinned wrappers are pinned by arch-cycle parity
  tests (noble-oracle agreement + sync/async byte-identity).
- `vectors` script now runs `node --experimental-strip-types
  scripts/generate-vectors.ts` and `engines.node` is bumped from
  `>=22.0.0` to `>=22.6.0` (root and all packages): Node could not
  execute a `.ts` entry point without the flag before 23.6, so the
  documented regeneration flow failed on Node 22 (the CI major). The
  flag is a no-op on ≥23.6; no new dependencies.
- `bench:baseline` now normalizes `bench/baseline.json` after every
  regeneration (`scripts/normalize-baseline.mjs`): vitest emits the
  runner machine's absolute `filepath`; the committed baseline is
  package-relative and machine-independent. The two previously
  committed absolute paths are normalized; `bench --compare` matching
  is by task name and unaffected.
- Security-posture docs: SECURITY.md now states the PGP key
  publication commitment (before v1.0.0) and points reporters to
  email / GitHub private vulnerability reporting in the interim;
  the CI security posture (gitleaks, CodeQL, typecheck,
  test:coverage thresholds, advisory lint/audit) is documented next
  to the audit-status table. USE_CASES.md Scenario 8 adds the
  token-vault recipe on frozen primitives
  (`deriveChannelKey('token-store/<service>')` + application-side
  AES-256-GCM, with its two documented caveats). Docs-only,
  non-breaking.

### Fixed
- Stricter validation at decode/parse time (iat/exp hardening):
  non-finite `iat`/`exp` (e.g. `1e999`, which `JSON.parse` maps to
  `Infinity` — such an `exp` previously defeated the expiry time check,
  making a validly signed token never expire) and `exp <= iat` are now
  rejected by `Attestation.decode` and `Session.parseSessionToken` with
  `AttestationError` `MALFORMED`/`FORMAT`. Non-breaking: previously
  valid tokens are unaffected; golden vectors untouched.
- Passphrase normalization is performed by the BIP39 layer (`NFKD`,
  per the standard); the previous explicit NFKC call in
  `get64ByteSeedFromMnemonic` was redundant — output bytes are
  identical for all inputs (UAX #15 identity `NFKD(NFKC(x)) = NFKD(x)`,
  pinned by a new byte-identity test). Spec §2 prose corrected from
  "NFKC-normalized" to "NFKD-normalized (by the BIP39 layer)" with an
  explicit MUST NOT for additional normalization; JSDoc updated.

## [1.0.0-rc.1] — 2026-11-01

First release candidate of the LTS line: everything in this block
accumulated on `main` since 0.7.0-alpha.2 and ships together (no 0.8.0
was ever published). **The public API is frozen as of this version**
(specs/v1.0.md §12): additive changes may land in 1.x minors; breaking
changes require 2.0.0 and a new spec revision. All BREAKING entries
below are a record, not a migration guide (A9 — no-compatibility
mandate).

### API freeze
- **Public API frozen (PR-12).** The frozen surface — classes, `Signer`,
  `crypto` namespace, seed utilities, error model and the wire formats
  of specs/v1.0.md §4–§7 — is enumerated normatively in
  [specs/v1.0.md §12](../../specs/v1.0.md); the machine-checkable part
  of the freeze is `specs/test-vectors.json` (untouched in this PR).
  Docs consolidated in this release: root `THREAT_MODEL.md` (replay,
  clock-skew bounds, BL-07 limits, grant escalation, parser hardening,
  explicit non-goals), `SECURITY.md` (24-month LTS window, 7-day
  critical-fix SLA), core README "Runtime & Limits" section.

### BREAKING
- **The `Session` constructor is private (PR-11, D6).** Direct
  `new Session(handleId, handleName, …)` no longer type-checks — a
  Session is either issued by `Session.create` or obtained from
  `Session.verifyStateless` / `Session.verifyAttested`, which closes the
  last gap that allowed fabricating a verified-looking session object
  outside the library (`Identity` and `Handle` constructors have been
  private since the encapsulation PR; `Session` was the outlier).
  Reconstruction of an already-verified session in tests and tooling
  goes through the `@internal` `Session.fromVerified` factory — not
  public API, reached via test-utils. Note for plain-JS callers: TS
  privacy is compile-time; a fabricated instance still carries no valid
  token and fails every verification path.
- **Derivation API is options-object: `derivePassword(context,
  { revision?, byteLength? })`, `deriveChannelKey(context, { revision? })`
  (PR-8, §7 / D3).** The positional forms
  `derivePassword(context, length?)` and the bare `length` argument are
  gone — `length` becomes the `byteLength` option (same default, 16;
  same output bytes for the same numbers). There is no legacy shim
  (A1: a legacy path preserves nothing after the 64-byte-seed change,
  and A9 mandates no compatibility surface) — re-derive at the call
  sites: `derivePassword('github', 16)` →
  `derivePassword('github', { byteLength: 16 })`. New validation
  (thrown as `AttestationError` `MALFORMED`/`FORMAT`, the
  `Session.create` ttl pattern): `revision` must be a positive integer,
  `byteLength` an integer in `[1, 8160]` (RFC 5869: 255 × SHA-256
  output); a context that is empty after canonicalization is rejected.
  Non-string contexts remain `TypeError` (API misuse).
- **Contexts are NFKC-canonicalized (PR-8).** Password/channel contexts
  were `lowercase → trim`; they are now `NFKC → lowercase → trim` and
  MUST NOT be empty after canonicalization (specs/v1.0.md §1). For
  every context that contains only ASCII this changes nothing — the
  golden vectors keep their byte values. Contexts with non-NFKC-normal
  characters (e.g. the fullwidth `ＧitHub`, which previously salted as
  `ｇithub`) now derive the canonical secret; a vector row pins the
  fullwidth form equal to `github`. Re-derive if you relied on
  non-canonical context bytes.
- **Unified error model (PR-7, §7: "All errors are `AttestationError` with
  `code`/`level`").** Every failure in the package — token parsing, session
  creation, `Session.verifyStateless`, derivation and lifecycle checks — now
  throws `AttestationError` with a stable `code` and the `level` that produced
  it. Previously parsing/structural failures (wrong token shape, invalid
  Base64URL, oversized payload, non-JSON payload, missing fields) and all of
  `Session.verifyStateless` threw plain `Error`s, and SubHandle constraint
  violations threw untyped messages; integrators had to match on message text.
  Now a single `catch (e) { if (e instanceof AttestationError) e.code; e.level; }`
  covers the whole surface — match on `code`/`level`, never on messages
  (specs/v1.0.md §7.2). Consequences, in order of visibility:
  (1) `Session.verifyStateless` failures map to `AUDIENCE_NOT_PERMITTED`,
  `EXPIRED`, `NOT_YET_VALID`, `BAD_SIGNATURE`, `SUBJECT_MISMATCH`, `REVOKED`
  (level `SESSION`) and `MALFORMED`/`FORMAT` for structural failures;
  (2) `Session.create` / `SubHandle.validateSessionOptions` violations map to
  `AUDIENCE_NOT_PERMITTED` / `SCOPE_EXCEEDED` / `TTL_EXCEEDED` / `EXPIRED`
  (level `SESSION`), bad `ttl` to `MALFORMED`/`FORMAT`;
  (3) key/seed length validation (`Identity.fromSeed`, `deriveSharedSecret`,
  `Attestation.issue`) is `MALFORMED`/`FORMAT` instead of plain `Error`;
  (4) `AttestationError.name` is now `'AttestationError'`;
  (5) a structurally invalid `hPath` (not an array of two strings) is
  rejected at the FORMAT layer with `MALFORMED` — previously it slipped to
  step 4 and surfaced as `PATH_MISMATCH`/`SESSION`.
- **`DisposedError` is an `AttestationError` subclass (PR-7).** It carries
  `code === 'DISPOSED'`, `level === 'FORMAT'` and keeps `name ===
  'DisposedError'`, `className` and `instanceof DisposedError` — existing
  targeted handling keeps working; generic `AttestationError` handlers now
  catch it too.
- **`Attestation.issue` takes a `Signer`, not a raw private key (PR-6,
  §7 / D2).** The signature is now
  `Attestation.issue(signer, subjectPublicKey, subjectName, grant, opts)`
  where `signer` is an object with a `sign(data)` method — `Identity`,
  `Handle` and `SubHandle` all qualify. Passing raw 32-byte private key
  bytes (the pre-0.8 form) throws `TypeError`. Rationale: raw private
  keys never cross a trust boundary as function arguments — issuance is
  signed by the issuer's own encapsulated key. `attestHandle` /
  `attestSubHandle` pass `this` internally, so their callers are
  unaffected. No compatibility shims (A9): replace
  `Attestation.issue(privKey, …)` with `Attestation.issue(identity, …)`
  / `Attestation.issue(handle, …)`, or wrap the key in a minimal
  `{ sign(data) }` object when only raw bytes exist.
- **Encapsulation hardening (PR-5, §7: "API preserved, internals hardened").**
  `Identity`, `Handle` and `SubHandle` store key material in true
  ECMAScript `#private` fields. Consequences, in order of visibility:
  (1) internal fields are no longer reachable at runtime through casts
  or property access — code that poked at `(handle as any).privateKey`
  (TS-`private` was runtime-visible) now gets `undefined`, and methods
  invoked on a foreign `this`
  (`Handle.prototype.sign.call(fakeThis, …)`) throw `TypeError`;
  (2) `getPublicKey()` / `getMetadata()` / `getPath()` /
  `getSubMetadata()` return defensive copies — mutating them no longer
  (and never officially did) affects the object; constructor inputs
  (`privateKey`, `path`, constraint metadata) are copied on input, so
  caller-side mutation after construction has no effect;
  (3) new `dispose()` (inherited by `SubHandle`) zeroizes the private
  key; capability methods then throw the new `DisposedError`
  (`e.name === 'DisposedError'`), informational getters keep working;
  (4) `JSON.stringify()` and console inspection are redacted — they emit
  only `{ kind, id, name, path? }` and never key material or constraint
  metadata. The public method surface is unchanged otherwise.
- **Seed = 64 bytes (BIP39), D1.** `get32ByteSeedFromMnemonic` is replaced by
  `get64ByteSeedFromMnemonic`, which returns the full 64-byte BIP39 seed
  (PBKDF2-HMAC-SHA512 output) without the previous SHA-256 post-hashing.
  `Identity.fromSeed` now accepts 64 raw bytes or a 128-character hex string;
  a 32-byte / 64-hex seed throws `Invalid seed: must be 64 bytes`.
  HKDF info strings are unchanged — only the input key material changes.
  **All identities, handles, passwords, channel keys and shared secrets
  derived from a mnemonic change.** Re-derive the seed via the new function
  and re-issue attestations/sessions. There are no compatibility shims and
  no migration guide (no-compatibility mandate): this record and the
  CHANGELOG are the history.
- Removed the undocumented SHA-256(`seed64`) reduction step. It was a
  nonstandard deviation from BIP39: identities derived here could not be
  reproduced from the same mnemonic in any BIP39-compatible tooling.
  Ed25519 keys are now derived by HKDF-SHA256 directly from the 64-byte
  standard seed.

### Added
- **Shared derivation module + static module graph (PR-10, D4/D5).**
  The derivation formulas now live in the `crypto` namespace —
  `crypto.deriveRootKey(seed)`, `crypto.deriveHandleKey(rootKey, name)`,
  `crypto.deriveSubHandleKey(handleKey, handleName, subName)` — and
  both SubHandle entry points (`Handle.deriveSubHandle`,
  `Identity.deriveSubHandle`) call the same `deriveSubHandleKey`, so
  their byte-parity is guaranteed by construction (pinned by test 5.3.3
  and `test/arch-cycle.spec.ts`). Architecture: the `Handle`/`SubHandle`
  class pair is co-located in one module and `subhandle.ts` is a pure
  re-export facade — the dynamic `import('./subhandle.js')` cycle dodge
  is gone, the module graph is acyclic and 100% static, and it loads
  from any root (pinned by the `import-order-*.spec.ts` tests). The
  raw X25519 (Montgomery) ECDH step of the P2P derivation is exposed as
  `crypto.rawX25519SharedSecret(myPrivateKey, otherPublicKey)`. All
  internal `hkdf`/`sha256`/curve imports now go through `crypto/`
  wrappers; no `@noble` import remains outside `src/crypto/` — the
  source-scan pin covers every import form (static, side-effect,
  dynamic `import()`, `require()`, `export … from`) and additionally
  pins the auto-init invariant: `@noble/ed25519` is imported by
  `crypto/init.ts` alone, which configures the backend on module load;
  combined with the single-entry-point `exports` map, any code path that
  can reach a crypto operation sees a configured backend in any import
  order. The module-structure contract (co-location rationale, crypto
  boundary, auto-init) is normatively documented in specs/v1.0.md §11.
  Crypto auto-init (D5): importing `@me2em/core` synchronously configures
  `@noble/ed25519` (sha512) — no manual init call. Public API is
  unchanged (additive only).
- **Derivation revision model (PR-8, D3) — the sanctioned rotation path.**
  `derivePassword` and `deriveChannelKey` accept `revision` (positive
  integer, default `1`; an integer is canonical by construction — NFKC
  applies to string contexts only). Revision `1` is byte-identical to the frozen
  v1.0 derivation; revision `N ≥ 2` derives a secret that is
  cryptographically independent of revision 1 for the same context —
  rotate a leaked credential or a compromised channel without changing
  the context string (`{ revision: 2 }`). Info strings:
  `me2em/secret/v1/rN`, `me2em/channel/v1/rN` — built by the new
  centralized `DERIVATION_PATHS.password(revision?)` /
  `DERIVATION_PATHS.channel(revision?)` (the single source of truth the
  spec freeze rule rests on). Vectors pin revision 1, revision 2 and
  the NFKC context rows (`specs/test-vectors.json` extended, existing
  rows byte-identical). Conformance suite: `test/revisions.spec.ts`
  (default ≡ revision-1 byte-parity, revision independence, manual-HKDF
  end-to-end through `DERIVATION_PATHS`, options validation, NFKC
  contexts).
- **Hardening slice (PR-7).** In detail: base64url is implemented on the
  audited `@scure/base` codec (A3) with a source-scan test that keeps
  `btoa`/`atob` out of `src/`; `crypto.randomUUID` gains a
  `getRandomValues`-based v4 fallback so issuance works on runtimes without
  it (with test); signature-length pre-checks (non-64-byte signatures are
  rejected with `false` before curve math in `Attestation.verifySignature`
  and `Handle.verify`); `jti` validation (non-empty, ≤ 256 chars — at
  `decode`, in `issue` opts and in session payloads); `__proto__` pollution
  protection in both token parsers (`safeJsonParse` reviver — hostile
  payloads are `MALFORMED`, `Object.prototype` stays clean); strict session
  payload field types (`hId`/`hNm`/`aud`/`hPath`/`scp` are type-checked
  before name derivation, so tampered tokens can no longer provoke
  `TypeError`s); `SubHandle.getSubMetadata()` returns a true deep copy
  (JSON-safe structures cloned at any depth; non-plain values shared and
  documented).
- **New error codes (PR-7).** `MAX_DEPTH_EXCEEDED` (a leaf `SubHandle`
  cannot derive children — previously a plain-`Error` throw) and `DISPOSED`
  (capability on a disposed object, via the `DisposedError` subclass).
- **Error table test (5.8).** `test/error-table.spec.ts` pins a
  representative scenario with code+level for every `AttestationErrorCode`
  — exhaustiveness is enforced by the type system (`Record<AttestationErrorCode, …>`).
- **Parser fuzz (5.15).** Deterministic seeded fuzz (~1 050 rounds over
  garbage and mutated tokens) asserting that only `AttestationError` ever
  escapes `Attestation.decode` / `Attestation.verifySignature` /
  `Session.verifyStateless` / `Session.verifyAttested`.
- **`Signer` interface + `Identity.sign()` (PR-6).** The package root
  exports the `Signer` contract (`sign(data): Promise<Uint8Array>`,
  `src/types.ts`) accepted by `Attestation.issue`; custom signers
  (remote-/HSM-backed) are accepted structurally, no base class needed.
  `Identity` gains `sign(data)` — root-key signing under the PR-5
  guarantees (`#private` storage, `DisposedError` after `dispose()`) —
  making `Identity` a full `Signer`. `Identity`, `Handle` and
  `SubHandle` now all implement `Signer`.
- **`dispose()` / `DisposedError` (PR-5).** `Identity.dispose()` and
  `Handle.dispose()` (inherited by `SubHandle`) zeroize the private key
  and permanently revoke all capability methods (`sign`, derivations,
  attestations); they throw `DisposedError` (`className` property names
  the disposed class) afterwards. Informational getters
  (`getName`, `getId`, `getPublicKey`, `getMetadata`, `getPath`,
  `getSubMetadata`) deliberately keep working — public keys are not
  secrets. `dispose()` is idempotent. `Session.create` on a disposed
  handle fails with `DisposedError`.
- **Real protocol test vectors + normative spec (BL-20/BL-21, PR-3).**
  `specs/test-vectors.json` (15 rows: BIP39 seed, identity/handle/subhandle
  derivation, passwords, channel keys, shared secrets, byte-exact
  attestation tokens, pinned session tokens), generated by
  `scripts/generate-vectors.ts` (`pnpm --filter @me2em/core vectors`)
  through the public runtime API. Golden test `test/vectors.spec.ts`
  re-computes every row — any deviation is a protocol break.
  Normative spec: `specs/v1.0.md`; pre-attestation draft removed from
  the working tree (DR-7 — git history retains it).
- Official BIP39 test vectors in `test/seed.spec.ts` (12-word and 24-word
  mnemonics, empty and non-empty passphrase), cross-verified against an
  independent PBKDF2-HMAC-SHA512 implementation.
- 12-vs-24-word seed equivalence tests: both strengths produce a 64-byte
  seed; different strengths derive different (but deterministic) identities.

### Changed
- **`Session.verifyAttested` split into five private stages (PR-11,
  3.4/3.6).** The ~210-line monolith is now
  `#verifyChainStructure` → `#verifyRootAttestation` →
  `#verifyHandleAttestation` → `#verifySessionAgainstGrant` →
  `#verifySessionSignature` (audience/time checks and the session
  revocation step remain in the orchestrator). Check order, error codes
  and error levels are byte-identical to the pre-split flow — pinned by
  the untouched attested-session (28), error-table (8) and fuzz (4)
  suites. No behavioral change.
- **`attestSubHandle` / `attestHandle` canonicalize the subject name
  exactly once (PR-11, 3.6).** Both issuers pre-normalized the name and
  then called `deriveSubHandle` / `deriveHandle`, which canonicalize
  again (`Attestation.issue` applies its own defensive pass on top —
  its public contract, unchanged). `normalizeName` is idempotent, so
  issued attestations are byte-identical; the redundant pass is gone.
- `engines.node` floor raised to `>=22.0.0` (A2): Node 18/20 are EOL, CI
  pins Node 22 (LTS maintenance to 2027-04). Applied workspace-wide — root,
  `@me2em/core`, `@me2em/crypto`, `@me2em/react`.

### Dependencies
- Added `@scure/base: ^2.4.0` (PR-7, A3): audited base64url codec replacing
  the hand-rolled `btoa`/`atob` math — same family as the already-depended-on
  `@scure/bip39`. Encoding is byte-identical (unpadded URL-safe), pinned by
  the golden vectors.

### Fixed
- `index.ts` module JSDoc example passed a mnemonic string directly to
  `Identity.fromSeed` (would throw at runtime); the example now derives
  the seed first.

## 0.7.0-alpha.2

### Fixed
- The `wordlist` export announced in 0.7.0-alpha.1 was missing from the
  published artifact — consumer builds failed with
  `[MISSING_EXPORT] "wordlist"`. The re-export from
  `@scure/bip39/wordlists/english` (official 2048-entry list) is now
  verifiably present in `dist/`.

### Dependencies
- Added `@scure/bip39: ^1.3.0` to `dependencies` so the `wordlist`
  re-export resolves for consumers.

## 0.7.0-alpha.1

### Added
- BIP39 passphrase support: `get32ByteSeedFromMnemonic(words, passphrase)`.
  Enables the split-trust pattern (mnemonic in one place, passphrase
  in another). Passphrase is NFKC-normalized, case-sensitive, and
  NOT recoverable.
- Exported BIP39 English wordlist (`wordlist`) from `@me2em/core` for
  consumer components that need to validate user input against the
  official 2048-entry list.

### Changed
- `SubHandle.getMetadata()` no longer exposes constraint fields
  (`allowedAudiences`, `allowedScopes`, `maxSessionTtl`, `expiresAt`).
  Use `getSubMetadata()` for constraints. (Minor: fields were
  leaking into a layer documented as serializable.)

### Fixed
- Cosmetic consistency: docblock indentation, test suite titles,
  helper documentation, mixed-language comments.

## 0.6.0-alpha.1

### BREAKING
- `Handle.deriveSharedSecret` now derives channel keys with both
  peers' public keys bound into the KDF (`me2em/p2p-channel/v2`).
  Secrets derived with the previous version are NOT compatible.
  This prevents unknown key-share attacks. Migrate by re-deriving
  shared secrets on both sides after upgrade.
- Empty `allowedAudiences`/`allowedScopes` arrays in
  `SubHandleMetadata` now DENY ALL instead of allowing everything
  (consistent with `AttestationGrant`). Use `undefined` for
  "unrestricted".

### Fixed
- `Attestation.verifySignature` returns `false` (instead of
  throwing) on malformed signature lengths.
- `Session.create` validates `ttl`: must be a positive integer;
  NaN/0/negative/fractional values throw at creation instead of
  producing self-rejecting tokens.
