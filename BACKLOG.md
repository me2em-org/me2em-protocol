# Me2eM Protocol — Development Backlog

Baseline: core · react · crypto all at **1.0.0-rc.1** (648 tests =
core 364 · crypto 182 · react 102). tsc/build-docs clean per package.
The API-freeze release candidate of the LTS program (PR-12); the
original tracking baseline (core 0.7.0-alpha.2 = 438 tests) is history.
npm (2026-11-03): **@me2em/core 1.0.0-rc.1 published as `latest`** —
tag `v1.0.0-rc.1` on the publish source `9bcf0f3`; verified by
dist-tags and a clean-install consumer smoke (all four core exports).
**@me2em/crypto 1.0.0-rc.1 published as `latest`** the same day —
published with `--tag rc`, then re-pointed via `npm dist-tag add`,
the `rc` tag removed (core convention: no prerelease tag next to
`latest`); git tag `crypto-v1.0.0-rc.1` on `095b29b`. Verified by
dist-tags and a clean-install consumer smoke: 54 exports, runtime
deps exactly `@me2em/core ^1.0.0-rc.1`, `@scure/base ^2.4.0`,
`@scure/bip39 ^1.6.0`, `hash-wasm ^4.12.0` — the BL-41/BL-45 fixes
are visible in the published manifest. The react publish follows
separately (react on readiness) — its npm line is still the alpha
(0.1.0-alpha.2).
This document is **advisory** — a recommendation list for future
development, not part of the shipped API contract.

## Workflow

- Priorities: **P1** correctness/security (next release) → **P2**
  robustness → **P3** protocol extensions (0.8+) → **P4** cosmetics.
- Statuses: `open` → `in-progress` → `done` | `declined` (with rationale).
- Closing an item: reference the commit and the test file.
- Anything touching key derivation (info strings, salts) MUST ship as a
  new versioned string (`/v2`) with a migration note — never in place.
- Publishing: only from `packages/*` directories (`pnpm --filter`),
  never from the workspace root (root is `"private": true`).
- Publication checklist (DR-4): fresh `pnpm build` and a green
  `pnpm --filter <pkg> lint` before publish (the per-package lint
  gate works for a single-package publish exactly as for the
  workspace-wide `pnpm -r lint`); `pnpm publish --tag alpha`;
  post-checks — `npm view <pkg>@<ver> dependencies`, tarball
  inspection, and a clean-install build of a real consumer
  (workspace linking masks published-manifest issues). npm serves
  metadata before the tarball (2–5 min) — not an error.
- Status checks: pushing to `main` must never bypass required status
  checks — CI must actually run (lesson of 2026-10-30).
- TSDoc is the source of the per-package API docs
  (core/crypto/react.me2em.com); TypeDoc runs with
  `treatWarningsAsErrors: true` — every exported symbol needs complete
  TSDoc (description, params/returns, `@example` for non-trivial API).
- `crypto` namespace includes documented raw Ed25519 wrappers
  (`crypto/ed25519.ts`): they are frozen public API surface
  (specs/v1.0.md §12), kept for TSDoc documentation ownership and
  `@noble` typing isolation under `treatWarningsAsErrors`; removal is a
  breaking 2.0.0 decision — do not propose (PLAN amendment A5).
- Versioning: independent per-package semver. Cross-package
  dependencies inside the monorepo use `workspace:^` — `pnpm publish`
  substitutes `workspace:*` with an EXACT version, which breaks
  consumers on every release (DR-4). Changesets adoption planned
  before 1.0.
- Git tags: release tags are per-package — `<pkg>-v<version>`
  (`crypto-v1.0.0-rc.1`, `react-v1.0.0-rc.1`, `crypto-v1.0.0-rc.2`,
  …). Packages share version numbers but release from different
  commits, so a bare `v<version>` is ambiguous. Historical exception:
  `v1.0.0-rc.1` remains the core release tag; every tag created after
  it uses the prefixed scheme.
- Spec self-sufficiency: iteration specs must be executable in a fresh
  agent session — no references to prior conversations; all context
  inline.
- Commit workflow: the agent does NOT commit; the architect reviews
  and runs the commit commands provided after acceptance.
- Terminology: protocol terms are domain-neutral (normative glossary:
  root GLOSSARY.md); every use case assigns its own domain
  interpretation. Normative for all READMEs, specs, and articles.
- Brand: writing canon — Me2eM (human-facing) / me2em (machine:
  npm, code identifiers, domains, URLs, CLI); `Me2em` is forbidden.
  Normative text: root README → Brand & Naming (DR-5).

## P1 — Correctness & Security

*(empty — closed in 0.6.0/0.7.0-alpha.1)*

## P2 — Robustness, Infrastructure & Package Strategy

- **BL-31 · done · Replay window for channels.**
  Implemented in `crypto/replay-window` (security-batch item F7,
  2026-11-03): sliding
  window of the last 1000 successfully decrypted sequences per
  channel — duplicates inside the window rejected (REPLAY_DETECTED),
  bounded out-of-order delivery accepted, FIFO eviction (evicted
  sequences can replay again — documented trade-off), failed decrypts
  do not consume window slots, window resets on epoch rotation.
  Merged as #37 (2026-11-03).
- **BL-32 · open · PreKeyStorage IDB implementation.**
  The `PreKeyStorage` contract (persisted SPK/OTK batches under the
  non-extractable cache key) is defined but only the in-memory test
  implementation exists. The IndexedDB implementation follows the
  proven pattern (IdentityContextIDBStorage in @me2em/react).
  Prerequisite for the async messaging profile of BL-27.
- **BL-33 · open · Argon2id cloud-backup mode (product decision).**
  The primitive is done (kdf/argon2, profiles, verifyArgon2). Missing:
  the PRODUCT decision + flow (opt-in encrypted seed backup in cloud).
  Requires: UI flow, envelope format for seed backup, recovery UX.
  Blocked on product priority, not engineering.
- **BL-34 · done · CI pipeline maintenance.**
  Shipped (CI1): gitleaks v3 (org license), build-first order (fixed
  TS2307 class), CodeQL v4 security-extended, pnpm store caching,
  ubuntu-24.04 pin. Coverage thresholds enforced in-repo via vitest
  configs (PR-4, A7): core 90/90, crypto 90/90, react ratcheted at
  82/71 — raise react to the 90/90 target with its next test slice
  (this item); the CI wiring diff is supplied to the architect in the
  PR-4 description (wired into `ci-security.yml` from PR-13, A7 done).
  Shipped (PR-31): eslint flat config for the whole workspace —
  root-owned toolchain (eslint, typescript-eslint, eslint-plugin-
  react-hooks, globals in the ROOT devDependencies; core's own eslint
  devDep removed), one root `eslint.config.mjs`, per-package
  `lint: eslint .` scripts; first pass triaged 940 findings to zero
  errors (generated TypeDoc assets ignored; 49 real findings fixed;
  three rationale line-disables in the freshly race-fixed hooks,
  render-phase refactor tracked post-1.0.0).
  Shipped (PR-32): dependency audit is a **blocking gate**
  (`pnpm audit --prod --audit-level high`), triage policy in
  CONTRIBUTING.md → «Dependency audit policy»; the Lint
  `continue-on-error` mask is removed (architect-applied hunks on
  #31/#32; main green with both gates real: 1cf61fd, 5b3ff0f).
  Closed (2026-11-03, this sweep): branch protection with the required
  check set (Build & Test, CodeQL, CodeQL SAST, gitleaks) confirmed by
  the architect (the protection API is admin-only — HTTP 403 for the
  agent token, so the confirmation is the architect's; the
  2+-stable-runs precondition was met long ago). Evidence since
  confirmation: five consecutive security-batch PRs (#36–#40) merged
  green with the full required set plus the Pages deploy, and the
  test-count baseline in the header is kept live per-PR (646 as of
  #40).
- **BL-37 · in-progress · npm dist-tag maintenance.** Core half
  **done (2026-11-03)**: the @me2em/core rc.1 publish shipped with
  `--tag latest`, so a plain `npm install @me2em/core` resolves to
  1.0.0-rc.1 (verified via dist-tags). The `alpha` tag stays at
  0.7.0-alpha.2 — exact pins are unaffected, and `dist-tag rm` is
  declined for now (it would break `@alpha` consumers). Crypto half
  **done (2026-11-03)**: @me2em/crypto 1.0.0-rc.1 published with
  `--tag rc`, then `latest` re-pointed via `npm dist-tag add` and the
  `rc` tag removed (core convention: no prerelease tag next to
  `latest`) — a plain `npm install @me2em/crypto` resolves to
  1.0.0-rc.1 (verified via dist-tags). Still open: re-point
  @me2em/react `latest` (0.1.0-alpha.1) when the react rc.1 line
  publishes.
- **BL-39 · open · Audit vendor / bug bounty search (D7, PLAN-LTS §9).**
  The search starts **at the developer's discretion** — there is no
  fixed PR deadline (amended 2026-11-01 per architect: the old
  "start by PR-8" milestone is dropped). Planning facts, not
  deadlines: typical lead time is 4–10 weeks and the external audit
  runs on the PR-11 code freeze, so an early start simply leaves more
  runway. This is the release gate: external audit or bug bounty
  (D7) before v1.0.0 (see the DR-6 entry). Architect-owned track
  (PLAN-LTS §9, outside agent scope); tracked here so the track is
  not lost between PRs.
- **BL-41 · done · Reconcile `@me2em/crypto` dependency spec with
  DR-4 before the crypto rc.1 publish (O2).**
  Shipped (PR #43): `packages/crypto/package.json` declares
  `"@me2em/core": "workspace:^"` + lockfile refresh; the pack check
  proved the tarball carries `^1.0.0-rc.1`, and the published
  manifest itself now confirms the substitution — the exact-pin
  incident class (react 0.1.0-alpha.1) is closed for crypto. Landed
  before the crypto 1.0.0-rc.1 publish (2026-11-03), as required.
- **BL-43 · done · Password char-selection modulo bias.**
  Shipped (PR #44): `generateSecurePassword` now takes every random
  index — per-class selection (8 guaranteed slots), fill, and
  shuffle — from the F2 rejection-sampling helper `randomIntBelow`; the
  ±5% within-class skew on the 26-char classes is gone. The dead
  `randomBytes` selection path and its import are removed; the
  `password-shuffle-bias.mjs` null model collapses from
  selection-corrected to uniform-within-class (the same χ² now guards
  selection AND shuffle). CI pins the fix deterministically: a
  scripted `getRandomValues` queue feeds `0xffffffff` (in the rejected
  partial-residue class for n = 26) — a modulo-based path would yield
  `255 % 26 = 21` → `'v'`; the pin asserts `'v'` can never appear
  (flagged during the PR-C review (#38, 2026-11-03); non-blocking for
  rc.1 per the architect's review decision).
- **BL-45 · done · Phantom dep `@scure/bip39` broke the crypto dist
  at runtime.**
  Shipped (PR #45): `src/validation/seed.ts` imported `@scure/bip39`
  without declaring it; tsup inlined the (undeclared) package and the
  inlined copy's `import { utils } from '@scure/base'` fails against
  `@scure/base` 2.x (post-F6, no `utils` export) — a module-level
  SyntaxError made `dist/index.js` unimportable for consumers while
  the src-based vitest suite stayed green (found 2026-11-03 while
  re-running the bias script against the built artifact). Fix:
  declare `"@scure/bip39": "^1.6.0"` (externalized; same 1.x family
  as core) + `test/dist-artifact.spec.ts` smoke pinning the published
  graph. Evidence: uniform-null χ² on the PRE-fix dist = 145–146
  (FAIL, bias detected); post-fix = 80 / 89 (PASS, E = df = 87).
  Blocks the crypto rc.1 publish until merged.
- **BL-46 · done · `@noble/curves` was a runtime import declared as a
  devDependency (same phantom class, non-breaking).**
  Shipped (PR #47): `@noble/curves ^1.8.1` moved to `dependencies`
  (the range already matched core's) — tsup externalizes it, so the
  dist no longer ships a private noble copy; noble dedups with
  `@me2em/core`'s. Entry correction: `@noble/hashes` was never
  directly imported by crypto (HKDF is native WebCrypto, Argon2id is
  hash-wasm) — it arrived transitively via `@noble/curves` (its own
  `@noble/hashes@1.8.0`) and is dropped from devDependencies instead
  of promoted. Evidence: `dist/index.js` 97.1 KB → 29.8 KB (−69%),
  the bare `@noble/curves/ed25519.js` import preserved, zero noble
  inlining left; pack check shows the new runtime dep; 648 tests
  green. Non-breaking: devDeps never ship; rc.1 (published) keeps
  the runtime-safe inlined copy — this lands with the next crypto
  publish.
- **BL-47 · open · react: dispose parity on identity swap/clear (react
  rc.2).** `Me2emProvider` drops the previous `Identity` without
  `dispose()` on both lifecycle exits — `activateIdentity()` overwrites
  the handle, `clearIdentity()` nulls it — so old key material is never
  zeroed even though core rc.2 ships an idempotent `dispose()` +
  `DisposedError`. Verdict (2026-11-04, PR #53 follow-up): code fix in
  react rc.2 — ref-mirror + dispose before swap and in
  `clearIdentity()`, never inside state updaters (StrictMode
  double-invoke, F3/R15 pattern); needs a generation counter on
  `activateIdentity` (load-race class: two in-flight `fromSeed` may
  land out of order and dispose the newer handle). No API change;
  ~25 LOC + 2–3 tests. Slotted for the react rc.2 train with the
  JSDoc fold (BL-48/BL-49, R5–R7).
- **BL-48 · open · react: identitySeed retention in flow state — docs
  now, opt-in consume in v1.1.** The reducer keeps raw seed bytes in
  state after activation (`identity-flow.ts:59` 'verified',
  `:35` 'imported'); no react hook reads it past 'seed-generated', so
  retention is pure exposure surface (R15 class). Verdict
  (2026-11-04): rc.2 = JSDoc contract on
  `IdentityFlowState.identitySeed` ("retained by design, does not
  self-consume"); auto-nulling at CONFIRM_WORDS is an observable
  behavior change for headless consumers (public state type) → v1.1,
  as an explicit `discardSeed()` action so the app decides when to
  drop the material.
- **BL-49 · open → won't-fix (by design) · react: deterministic grid
  seed in SeedPhraseVerify.** `baseSeed = 42`
  (`SeedPhraseVerify.tsx:28`) drives only the cosmetic verification
  grid shuffle — decoys come from the public wordlist, retry already
  varies it (`baseSeed + retryCount + 1`); not a security control,
  determinism aids tests/SSR. Verdict (2026-11-04): keep as-is, no
  `randomSeed` prop in 1.0 (no driver during freeze); one JSDoc line
  in rc.2 ("grid shuffle is deterministic by design, not a security
  control"); revisit a prop only on a real consumer request (v1.1+).
- **BL-50 · open · react: structured errors ({handle, error}) instead
  of string error — post-freeze v1.1.** Flow hooks surface `error` as
  `string | null`; a `{handle, error}` union would let apps branch on
  failure cause. Observable shape change at rc → v1.1 (verdict
  2026-11-04, PR #53 follow-up).
- **BL-51 · done · react: `useSession` does not renew on return to
  visibility.** External-agent remark #8 (PR #53 follow-up,
  2026-11-04). Entry correction: the record originally filed here
  ("seed/clipboard hygiene on tab hide", citing remark #7) was a
  mislabel — the tracked issue is #8, session renewal; seed-display
  reachability stays R15 "by design". Mechanics: auto-renewal ran on
  the half-life `setTimeout` alone; background tabs throttle timers
  (clamped wakeups) and fully suspend them while frozen (Memory
  Saver, mobile backgrounds), so on return the session could already
  be past half-life or expired while the overdue timer had not yet
  fired. Shipped (PR #56): a `visibilitychange` listener renews
  proactively when the document becomes visible and the session is
  past its half-life point (`expiresAt − ttl/2`, the same threshold
  the timer uses); respects `autoRenew: false`; `renew()` clears and
  reschedules the timer, so no double-renewal. Pinned by 3 tests
  (renew past half-life incl. hidden-event no-op, no-op before
  half-life, opt-out).

## P3 — Protocol Extensions (0.8+)

- **BL-40 · open · Dedicated token-vault derivation path (potential
  v2.0).** USE_CASES.md Scenario 8 builds the token vault by borrowing
  the frozen channel slot (`deriveChannelKey('token-store/<service>')`,
  recipe caveat 2 — deliberate, documented). A future release could add
  a dedicated path `me2em/token-store/v1` with a new public method
  `deriveTokenStorageKey(context)` — additive in shape:
  `deriveChannelKey` stays byte-identical, no existing derivation
  changes; requires a new normative section of the spec and new golden
  vectors. Tracked at the architect's direction as a potential v2.0
  item (2026-11-02, PR-5 review) — no v1.1 rework is planned.
- **BL-42 · open · Media key reuse across files (M5 — explicitly
  deferred).** Reusing one AEAD key (or key schedule) across a
  session's files instead of `generateFileKey()` per file is a
  performance idea, not a defect: the current per-file key is the
  safe default. Requires a new public API (session-scoped key
  registry) and is therefore out of rc scope — deferred per the
  crypto security batch verdict (2026-11-03: "do not implement,
  track in BACKLOG").
- **BL-29 · open · `@me2em/messenger` package.** Target 0.9.
  First vertical: chats, groups (epoch/GK patterns), delivery
  receipts, @me2em/server integration. Pilot consumer: BeSafeChat.
  Depends on BL-28 (done). Verticals keep UI logic in src/react/,
  domain logic in src/headless/.
- **BL-35 · open · Publish automation via CI.**
  Publishing is manual (`pnpm publish` per package). Add a
  release workflow: npm trusted publishing (or NPM_TOKEN secret),
  changesets-driven version bumps, per-package publish jobs with
  `--tag alpha`. Natural next step now that CI exists.
- **BL-06 · open · `sid` (session lineage id).**
  Renewal rotates `jti`, so a renewed session's lineage cannot be
  revoked wholesale. Add optional `sid` in the payload (random at
  creation, stable across renewals); `RevocationChecker` checks both.
  `sid` must be random (not derived from the handle) to avoid
  cross-audience linkability. Auto-renewal has shipped in @me2em/react
  — practically relevant now.
- **BL-07 · open · `destroy()` for Identity/Handle/SubHandle.**
  `fill(0)` private key bytes + `destroyed` flag; key operations throw
  afterwards. TSDoc must honestly state GC/JIT limits. Partially
  superseded by the session-bound profile (transient secrets are
  architectural), but stays relevant for the classic fromSeed flow.
  *Status note (PR-12):* the mechanism itself has shipped — `dispose()`
  (PR-5) does `fill(0)` + flag + `DisposedError` on all three classes,
  and the GC/JIT limitation is stated honestly in the core README, in
  `THREAT_MODEL.md` §5.2 and in `SECURITY.md`. What remains is the
  decision whether the residual platform gap justifies anything beyond
  `dispose()`; candidate to close at the next BACKLOG sweep.
- **BL-10 · open · `attRef` — chain compression for narrow channels.**
  Full chain on first contact, verifier caches by `jti`, later tokens
  carry `attRef` only. Cache holds public data; loss degrades
  performance, not security.
- **BL-11 · open · Renewal window for IoT attestation rotation.**
  Verifiers accept a chain expired ≤ N days with a warning flag. Pairs
  with an operator dashboard. Relevant for `@me2em/iot` (BL-30).
- **BL-12 · open · Root public key distribution (DID / transparency log).**
  Bootstrap of trust for third-party verifiers. Elevated relevance:
  messenger vertical + cross-domain attestation verification + AI agent
  mandates (UC-1).
- **BL-13 · open · Re-attestation transparency.**
  Detecting that the same identity was re-attested. Requires an
  append-only attestation event log; depends on BL-12.
- **BL-14 · open · PFS upgrade: Noise-style ratchet for channels.**
  Current channels provide FS at epoch rotation points only (per-message
  HKDF derivation is an interim pattern within an epoch). Full
  Noise-style XK/KK or Double Ratchet gives per-message FS + PCS.
  Channel abstraction is in place (@me2em/crypto channels/) — this is
  the deepest protocol extension on the roadmap.
- **BL-15 · open · Revocation namespaces.**
  Attestations and sessions share one `RevocationChecker`. Priority
  raised: BL-27 ties attestation revocation to group epoch rotation —
  namespace confusion there is dangerous. Convention first
  (`att:` / `sess:` prefixes), split interfaces on demand.
- **BL-20 · done (PR-3) · Real protocol test vectors.**
  `specs/test-vectors.json` — computed through the public runtime API by
  `packages/core/scripts/generate-vectors.ts` (seed, identity/handle/subhandle
  derivation, passwords, channel keys, shared secrets, byte-exact
  attestation tokens, pinned session tokens) and enforced by the golden
  test `packages/core/test/vectors.spec.ts`. X3DH/channel vectors for
  @me2em/crypto remain future work (RFC 5869 vectors already live in
  crypto tests).
- **BL-21 · done (PR-3) · Rewrite specs/core.md against 0.7.0.**
  Shipped as `specs/v1.0.md` (implementation-independent: derivation
  formulas and info strings, canonicalization, token formats, payload
  schemas, both verification modes with error levels, limits
  2048/4096/±30s, issuance/Signer contract). Draft archived to
  `specs/archive/draft-core.md` with a deprecation pointer.
- **BL-22 · open · OpenAPI reference server spec.**
  Real flow: POST /auth/challenge, /auth/verify, /attestations,
  /backup/envelope, /prekeys/* (X3DH), revocation endpoints. Do
  together with `@me2em/server`.
- **BL-30 · open · `@me2em/iot` — device-management vertical.**
  Deferred until a real enterprise pilot exists (YAGNI). Merges the
  EV-station and drone-fleet patterns. Splitting later is easy; merging
  two separate packages later is expensive.

## P4 — Cosmetics

- **BL-16 · open ·** Rename describe titles "Phase 0 …" to semantic names.
- **BL-17 · open ·** `SeedStrength` TSDoc promises 160/192/224; the type
  allows only 128|256. Align doc and type.
- **BL-18 · open ·** Replace `bPayload!` non-null assertion in
  `verifyAttested` step 11 with an explicit branch that throws.
- **BL-23 · open ·** Cosmetic consistency sweep: docblock indent drift,
  stale file-header comments, unused type imports; argon2.spec.ts NFKC
  test comment outdated ("passed as-is") after the NFKC fix.
- **BL-24 · open ·** Final audit of non-English comments across all
  packages (core and react fixed; verify crypto).
- **BL-36 · open ·** Create security@me2em.com (see SECURITY.md).

## Closed

**0.6.0-alpha.1:** BL-01 (UKS binding, `1d8f705`) · BL-02 (fail-closed
`[]`, `bdcd63e`) · BL-03 (verifySignature total, `5e58309`) · BL-05
(ttl validation, `a83d0c6`) · BL-08 (metadata leak,
extractDisplayFields) · BL-09 (Mode 1 semantics decision record) ·
BL-25 (publish pipeline fixed).

**0.7.0-alpha.1:** BL-04 (BIP39 passphrase, seed.spec.ts).

**2026-10-30 (brand, DR-5):** BL-38 (code-comment sweep: 14 lines
across core/crypto src and test — JSDoc/TSDoc prose, the test fixture
`Hello, Me2em!`, the suite name `Me2em Core Functionality`; react
identifiers kept as-is per the machine-text carve-out; historical
quotes in this entry are intentional).

**crypto-0.1.0 (D1–D5):**
- **BL-26 · done · Argon2id in @me2em/crypto.** kdf/argon2 with
  INTERACTIVE/SENSITIVE profiles, verifyArgon2, NFKC normalization.
  hash-wasm dependency scoped to crypto only.
- **BL-27 · done · Session-Bound Context Profile.** Implemented across
  @me2em/crypto D1–D5: X3DH (canonical Signal §3.3, OTK mandatory,
  no zero-fallback), pre-key management (SPK signature verification,
  batch + refill threshold), channels (per-message HKDF keys, replay
  protection via strictly-increasing seq, epoch rotation with forward
  secrecy), key envelopes (self-contained, offline delivery), hPK
  pattern (hashIdentityMaterial, RAM-only). References: Lubimov
  "Beyond Signal", BeSafeChat storage architecture. Isolation and
  warm-restart patterns live in @me2em/react
  (IdentityContextIDBStorage).
- **BL-28 · done · `@me2em/crypto` package.** Published as
  v0.1.0-alpha.1. Final API (evolved from the sketch):
  core (hkdf RFC-verified, x25519SharedSecret full 32B, aead,
  signRaw, secureWipe) · kdf (hashIdentityMaterial, Argon2id) ·
  x3dh (initiateX3DH/completeX3DH, SPK/OTK management, PreKeyBundle) ·
  channels (establish/encrypt/decrypt with REPLAY_DETECTED, rotate
  with epoch FS) · envelopes (wrapKeyForRecipient/unwrapKeyForMe,
  deterministic-IV media chunks) · validation (extended
  SeedValidationResult, password strength + HIBP).
  151 tests. Found and fixed during implementation: BeSafeChat X3DH
  deviations (swapped DH roles, slice(1) truncation, zero-fallback),
  NFKC gap in hash-wasm password handling.

## Decision Records

- **DR-1 (0.7.0)** — Terminology standard: protocol terms are
  domain-neutral; domain interpretations per use case. Normative
  glossary lives in root GLOSSARY.md (moved from the root README,
  2026-10-30). Terms "Session-Bound
  Identity" and "Non-persistent private key" REJECTED as misleading
  (identity is constant, not session-bound; keys are computed, not
  stored) → adopted: **Seed-Derived Identity**, **Transient/Ephemeral
  material**.
- **DR-2 (crypto-0.1.0)** — Documentation use cases approved: UC-1
  AI Agent Delegation, UC-2 IoT Device Hierarchy, UC-3 Multi-Context
  Identity. USE_CASES.md restructured accordingly (EV/Drone → UC-2,
  Corporate Messenger → UC-3, AI Agent → UC-1 added). Examples never
  mix domains.
- **DR-3 (crypto-0.1.0)** — X3DH implemented canonical per Signal
  spec §3.3: EK in DH2/DH3/DH4, OTK mandatory on both sides,
  zero-fallback prohibited. Deviations found in earlier code
  (swapped roles, zero-fallback) documented as anti-patterns.
- **DR-4 (core 0.7.0-alpha.2 / react 0.1.0-alpha.2, 2026-10-30)** —
  Publishing incident and fix. `pnpm publish` substitutes `workspace:*`
  with the EXACT workspace version, so the published react pinned
  `@me2em/core@0.7.0-alpha.1`, whose artifact lacked the `wordlist`
  export its changelog announced — the site build failed with
  `[MISSING_EXPORT] "wordlist"`. Fixes: core alpha.2 ships the real
  re-export (`@scure/bip39 ^1.3.0` added to dependencies); react
  alpha.2 declares `^0.7.0-alpha.2` (source: `workspace:^`). Rules:
  cross-package deps use `workspace:^` (never `workspace:*`, never
  exact pins); every publication is verified as a "package + consumer"
  pair on a clean install; required status checks on `main` are never
  bypassed.
- **DR-5 (2026-10-30)** — Brand writing canon: exactly two forms
  project-wide — **Me2eM** (all human-facing text) and **me2em**
  (machine contexts: npm, code identifiers, domains, URLs, CLI);
  `Me2em` is a forbidden typo form. Normative text: root README →
  Brand & Naming. The rough note formerly appended to this file was
  removed; the documentation sweep (all Markdown, package.json
  descriptions, BACKLOG header) is complete as of 2026-10-30.
  Code comments and test strings were swept the same day (BL-38,
  closed). Code identifiers are machine text and are not renamed;
  archived drafts in specs/draft/ are left as-is.
- **DR-6 (2026-10-30)** — LTS v1.0 program adopted. Final plan:
  [PLAN-LTS-v1.md](./PLAN-LTS-v1.md) (supersedes the internal plan
  draft v2.0 after a code audit at `0b73599`; v3.1 per architect
  review: no-compat mandate — no migration guides, `subjectWallet`/
  D8 → separate `@me2em/solano` TZ, engines >=22). Decisions D1–D9
  accepted (D8 deferred out of core scope); amendments A1–A9 are
  part of the plan; baseline verified: 438 tests green (core 186 /
  crypto 151 / react 101). Work proceeds as ~11 coherent PRs
  (PR map in §5); `main` stays green
  after every merge (same-PR consumer rule A6). Derivation freeze:
  after the 64-byte seed PR, no derivation-affecting change before
  v1.0.0 (§4). Release gated on external audit or bug bounty (D7).
- **DR-7 (2026-10-31)** — Specs tree hygiene (rides in PR-3):
  `specs/archive/` and `specs/draft/` are removed from the working
  tree. Working-tree rule: only live artifacts — the normative spec
  (`specs/v1.0.md`), machine-checkable vectors
  (`specs/test-vectors.json`), active docs. The pre-0.6 draft
  (server-issued sessions, registry-based lookup) is dead
  architecture, incompatible with core 0.6+; everything still
  normative in it is captured by `specs/v1.0.md` and
  `derivation-paths.ts`. The 9-line OpenAPI stub under
  `specs/draft/openapi/` was not a spec — BL-22 will be written
  fresh with `@me2em/server`. Git history, not the tree, retains
  the drafts (retrievable at `e0f4dc5`). This supersedes the
  archive disposition of D9/PLAN-LTS as the final one; those
  records remain untouched as history.

## Package Roadmap (strategy)

| Layer | Package | Status |
|---|---|---|
| 0 — primitives | `@me2em/core` | ✅ rc (1.0.0-rc.1) — published as npm `latest` (DR-6) |
| 1 — react bindings | `@me2em/react` | ✅ alpha (0.1.0-alpha.2) |
| 2 — protocol mechanisms | `@me2em/crypto` | ✅ rc (1.0.0-rc.1) — published as npm `latest` |
| 3 — verticals | `@me2em/messenger` | planned (BL-29, pilot: BeSafeChat) |
| 3 — verticals | `@me2em/iot` | deferred (BL-30) |
| — | `@me2em/server` | planned (reference NestJS, with BL-22) |

Dependency rule: strictly upward (verticals → crypto → core); verticals
never depend on each other. Every vertical keeps UI logic in
`src/react/`, domain logic in `src/headless/`.
