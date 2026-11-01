# Me2eM Protocol — LTS v1.0 Program Plan

**Version:** 3.1 — amended per architect review (2026-10-30): no-compatibility mandate (A9), `subjectWallet`/D8 → `@me2em/solano` track (A4), engines ≥22 (A2). Supersedes internal plan draft v2.0 after a full code audit at `0b73599`.
**Goal:** ship `@me2em/core` v1.0.0 as an LTS release: 24-month security-support window, 7-day SLA for critical CVEs, frozen public API, gated on external audit or bug bounty (D7).
**Roles:** Zed Wizard — implementation, branches, PRs, gates; architect — review, merge, CI workflow patches, Cloudflare config, audit, npm publishing.

---

## 1. Verified baseline (2026-10-30, commit `0b73599`)

| Item | State |
|---|---|
| Versions | core `0.7.0-alpha.2`, react `0.1.0-alpha.2`, crypto `0.1.0-alpha.1` |
| Tests | **438 green**: core 186 (8 files), crypto 151 (16), react 101 (14) — locally reproduced via `pnpm -r test` |
| CI | `.github/workflows/ci-security.yml`: gitleaks + build-and-test (Node 22, pnpm 10.11.1) + CodeQL; all three required on `main` |
| Seed path | `seed.ts:170` returns `sha256(seed64)` (D1 target confirmed) |
| `Identity.fromSeed` | accepts 32 bytes / 64 hex (`identity.ts:11–75`) |
| Derivation API | `derivePassword(context, length = 16)`, `deriveChannelKey(context)` — positional (D3 target confirmed) |
| Runtime portability | `btoa`/`atob` in `util.ts`, `handle.ts`; `crypto.randomUUID` in `session.ts:206`, `attestation.ts:337` |
| Import cycle | `handle.ts:171` uses `await import('./subhandle.js')`; `identity.ts` already imports `subhandle.js` statically |
| Constants | `ATTESTATION_MAX_PAYLOAD = 2048` (exported), session `MAX_PAYLOAD_SIZE = 4096` (private), `CLOCK_SKEW_SECONDS = 30` (private) |
| `crypto/ed25519.ts` | **exported publicly** via `crypto/index.ts` → `export * as crypto` — not dead code (see A5) |
| Test vectors | `specs/draft/test-vectors.json` is a placeholder (`"Ab3...Xy9"`, `"deadbeef..."`) — real vectors do not exist yet |
| engines | root `package.json` has `node >=18`; `packages/core/package.json` has none |
| Consumer coupling | `get32ByteSeedFromMnemonic` used by react production code (`useImportSeed.ts`, `useCreateIdentity.ts`), react tests (4 files), core tests, core README/USE_CASES |
| Known docs debt | `index.ts` `fromSeed` JSDoc example passes a mnemonic (would throw at runtime); BACKLOG roadmap table lists stale versions |

---

## 2. Decision record D1–D9 — all accepted

| # | Decision | Verdict | Note |
|---|---|---|---|
| D1 | Seed = 64 bytes (BIP39), drop `sha256(seed64)` | ✅ accepted | HKDF info strings unchanged; only IKM changes. Canonical, compatible with future BIP32/SLIP-0010 work |
| D2 | `Signer` interface for `Attestation.issue` | ✅ accepted | Private key never crosses the call stack as an argument |
| D3 | Options object for `derivePassword` / `deriveChannelKey` | ✅ accepted | With A1 (no legacy function) |
| D4 | Break `handle ↔ subhandle` cycle — variant C (static import) | ✅ accepted | `identity.ts` already imports `subhandle.js` statically, so ESM-cycle behavior is already exercised; variant A (factory) stays out of LTS |
| D5 | Auto-init `@noble/ed25519` stays in `crypto/init.ts` | ✅ accepted | Documented as the single justified side effect; explicit `initEd25519()` optional for subpath imports |
| D6 | `Session.fromVerified` → `@internal`, not exported from `index.ts` | ✅ accepted | Tests access it via test-utils, not the public surface |
| D7 | External audit or bug bounty mandatory | ✅ accepted | LTS without it is marketing; see §9 (vendor search starts at the developer's discretion) |
| D8 | `subjectWallet?: string` in attestation payload (not in grant) | ⏸ deferred — out of LTS core scope | Per architect review 2026-10-30: wallet binding is designed in a separate TZ and shipped in `@me2em/solano`; plan tasks 2.3.* excluded from this program |
| D9 | Spec is `specs/v1.0.md`; `specs/draft/core.md` archived | ✅ accepted | Draft vectors placeholder replaced by generated real vectors |

---

## 3. Amendments to plan v2.0 (each verified against the code)

| # | Ref | Amendment | Rationale |
|---|---|---|---|
| A1 | 2.1.2 | **Drop `derivePasswordLegacy`** — confirmed. | After D1 the master key material changes (seed 32→64 bytes), so no v0.7 derived value survives; a legacy path preserves nothing. With A9 there is no migration guide either — the breaking change is stated in the package CHANGELOG. |
| A2 | 0.3.1 | `engines.node: ">=22"` (root + core) — raised per architect review. | Node 18/20 are EOL; CI already pins Node 22 (LTS maintenance to 2027-04); zero installed base makes the floor a free choice, and one supported Node line keeps CI simple. |
| A3 | 1.5 | Add `@scure/base` dependency for base64url. | Audited, tiny, same family as the already-depended-on `@scure/bip39`. No hand-rolled codecs in a crypto library. (The base58 use moved to the `@me2em/solano` track together with 2.3.) |
| A4 | 2.3.* | **Excluded from the LTS program** (architect review 2026-10-30): `subjectWallet`, on-curve/base58 validation and everything Solana-bound moves to a separate TZ and the separate package `@me2em/solano`. The PDA note (off-curve addresses are valid) carries over into that TZ. | Freezes the core attestation format earlier and shrinks the LTS audit surface. PR-9 is retired (tombstone in §5). |
| A5 | 3.3.2/3.3.3 | `crypto/ed25519.ts` is **not** deleted: it is re-exported by `crypto/index.ts` into the public `crypto` namespace. Keep the documented wrappers; unify only *internal* imports (3.3.1 unchanged). | Plan v2.0 called it dead code; the audit shows it is public API surface with owned TypeDoc documentation. Removing it would be a separate breaking decision, out of LTS scope. |
| A6 | flow rule | **Same-PR consumer rule:** every breaking `core` PR carries the `@me2em/react` (and crypto where applicable) migration in the same PR. `main` must be green after every merge. | Verified: PR-2's rename breaks `useImportSeed.ts`, `useCreateIdentity.ts` and 4 react test files. A red `main` would also feed broken state to the docs sites on redeploy. |
| A7 | 0.3.2 | CI already exists (`ci-security.yml`). Remaining work: enforce coverage ≥90% (lines+branches) via vitest thresholds in-repo (PR-4); CI wiring patch supplied to the architect. | Workflow edits require the Workflows token scope, which `me2em-sandbox-agent` deliberately does not have. |
| A8 | docs debt | Fix `index.ts` `fromSeed` JSDoc example (passes a mnemonic; would throw) in PR-2; fix stale BACKLOG roadmap versions in PR-1. | Small, found during audit; riding on planned PRs. |
| A9 | 4.3, program-level | **No-compatibility mandate** (architect, 2026-10-30): the protocol is new and has zero users — no backward-compat shims, no migration guides. `MIGRATION.md` (4.3) is removed from the program; every breaking change is documented honestly in the package CHANGELOG at the moment it lands. | Removes dead documentation weight; the breaking-changes record (§7) stays as the single program-level history. |

---

## 4. Derivation freeze rule (new, program-level)

After PR-2 lands (64-byte seed), **no derivation-affecting change lands before v1.0.0**. The revision mechanism (2.1/2.2) is the only sanctioned evolution path for passwords and channel keys after that point. Any exception requires a new DR and a new breaking-change row. This is what makes the revision system trustworthy.

---

## 5. PR map

Base unit of work = **one PR** (not one stage; not one subtask). Stage 5 (tests) is distributed: every PR carries its own test slice and leaves `main` green. Stage 4 (docs) rides with feature PRs; PR-12 consolidates the standalone documents.

| PR | Branch | Plan v2.0 tasks | Content | Breaking? |
|---|---|---|---|---|
| PR-1 (this PR) | `docs/lts-v1-plan` | — | This plan; BACKLOG: DR-6 + roadmap version fix (A8) | no |
| PR-2 | `core/seed-64` | 0.0.1–0.0.6 | 64-byte seed (D1): `get64ByteSeedFromMnemonic`, `Identity.fromSeed` 64 B / 128 hex, HKDF-length test, all vectors updated, 12-vs-24-word tests, README + USE_CASES; **react consumer fix (A6)**; `index.ts` JSDoc fix (A8); core CHANGELOG "Unreleased" | **yes** |
| PR-3 | `core/test-vectors` | 0.1.1–0.1.3, 0.2.1–0.2.3, 4.8 | `scripts/generate-vectors.ts`, real `specs/test-vectors.json`, golden test `vectors.spec.ts`, `specs/v1.0.md` (info strings, token limits 2048/4096, `CLOCK_SKEW_SECONDS = 30`, `Signer`), `specs/draft/core.md` → `specs/archive/draft-core.md` with deprecation pointer | no |
| PR-4 | `core/engines-bench` | 0.3.1, 0.3.3, 0.3.4, 0.4.1, 0.4.2 | engines `>=22` (A2), vitest bench + `bench/baseline.json` fixed **before** Stage 1, `expectAttestationError()` helper replacing regex assertions, dedupe `derivation.spec`/`phase0.spec`, `createTestHandle()` factory, coverage thresholds in vitest config (A7; CI wiring patch to architect) | no |
| PR-5 | `core/encapsulation` | 1.1, 1.3, 1.4, 1.8.1 | `#private` fields on `Identity`/`Handle`/`SubHandle`, constructor input copying + defensive getters, `dispose()` + `DisposedError`, `toJSON`/`inspect` redaction; tests 5.1–5.5 incl. `Handle.prototype.sign.call(fakeThis)` TypeError | **yes** (API preserved, internals hardened) |
| PR-6 | `core/signer` | 1.2 | `interface Signer` in `types.ts`, `Attestation.issue(signer, subjectPublicKey, subjectName, grant, opts)`, `Identity`/`Handle` implement `Signer`, `attestHandle`/`attestSubHandle` pass `this`; tests 5.13 | **yes** |
| PR-7 | `core/hardening` | 1.5, 1.6, 1.7, 1.8.2–1.8.7 | base64url via `@scure/base` (A3) + no-`btoa` test, `randomUUID` fallback, all errors → `AttestationError` with `code`/`level`, `MAX_DEPTH_EXCEEDED`, `DISPOSED`, error table test (5.8), `expectAttestationError` migration (5.9), signature-length pre-check, `jti` validation, `__proto__` protection, `getSubMetadata` deep copy, shared-secret mutation tests (5.12), fuzz on `parseToken`/`parseSessionToken` (5.15), no-`randomUUID` test (5.18) | **yes** (error types) |
| PR-8 | `core/revisions` | 2.1, 2.2, 2.4, 5.6, 5.16 | `derivePassword(context, { revision?, byteLength? })`, `deriveChannelKey(context, { revision? })`, NFKC on context+revision, `DERIVATION_PATHS.password(revision?)`/`.channel(revision?)`; `derivePasswordLegacy` **dropped** (A1); README/USE_CASES revision model + JSDoc `@since`; CHANGELOG breaking note (A1, A9) | **yes** |
| PR-9 | *(retired)* | 2.3, 5.17 | **Retired pre-implementation** — `subjectWallet` moved to the `@me2em/solano` TZ (A4). Number kept for traceability, not re-used. | — |
| PR-10 | `core/arch-cycle` | 3.1, 3.2, 3.3.1, 3.3.4 | Static `SubHandle` import in `handle.ts` (D4), `deriveSubHandleKey()` in `crypto/derivation.ts` shared by both entry points + parity test (5.3.3), all internal `hkdf`/`sha256`/`ed` imports via `crypto/`, auto-init documented (D5); wrappers kept (A5) | no |
| PR-11 | `core/session-split` | 3.4, 3.5, 3.6.1–3.6.3 | `#verifyChainStructure`/`#verifyRootAttestation`/`#verifyHandleAttestation`/`#verifySessionAgainstGrant`/`#verifySessionSignature` with order+levels preserved (all 20+ attested-session tests green untouched), private `Session` constructor + `@internal` `Session.fromVerified`, `MAX_DEPTH_EXCEEDED` override, no double normalization in `attestSubHandle` | **yes** (constructor) |
| PR-12 | `docs-lts-rc` | 4.1–4.2, 4.4–4.6, 6.4, 6.5 | `THREAT_MODEL.md` (incl. attestation/session replay, clock-skew exploitation, BL-07 limits), `SECURITY.md` update (SLA 7 days), README limits/runtime section, API freeze, `v1.0.0-rc.1` prep (no `MIGRATION.md` — A9) | docs + freeze |

Excluded from LTS: variant-A factory (3.1 long-term), `FinalizationRegistry` guarantees (1.4.3), `subjectWallet`/D8 → `@me2em/solano` TZ (A4), `MIGRATION.md` (A9).

---

## 6. Flow fit: PR granularity, review, deploy noise

**Why one coherent PR (≈ stage or half-stage) and not one subtask-PR:**

1. **Review quality.** The architect is the single reviewer. A PR of PR-5's size (~6–8 files + tests) is reviewable in one sitting; fifty small PRs burn attention on overhead, and one giant "LTS" PR gets skimmed — the worst outcome for crypto code.
2. **Atomic revert and bisect.** DR-4 proved the value: when a released artifact misbehaved, the fix was scoped to a coherent unit. Each PR here is revertable as one decision.
3. **Status checks.** Every PR runs the full CI trio; nothing merges red (DR-4 rule). Because each PR is self-contained (code + tests + consumers), `main` is always releasable.
4. **Deploy noise — the Cloudflare Pages concern.** Every merge currently rebuilds all three docs sites (`me2em-docs-core`, `me2em-docs-crypto`, `me2em-docs-react`). Mitigations:
   - **Batching (this plan):** ~11 executed merges (12 mapped, PR-9 retired) instead of ~50 subtask merges; cosmetics (plans, BACKLOG, doc sweeps) never ship as standalone merges — they ride with a content PR (PR-1 demonstrates this).
   - **Build watch paths (architect, Cloudflare dashboard — recommended):** `me2em-docs-core` ← `packages/core/**, specs/**`; `me2em-docs-crypto` ← `packages/crypto/**`; `me2em-docs-react` ← `packages/react/**`. Note JSDoc changes *do* change TypeDoc output, so code PRs legitimately rebuild their own site — watch paths make that rebuild targeted instead of triple.
5. **Stage = PR is *not* adopted verbatim.** Stage 0 splits (PR-2 is the riskiest diff of the whole program — seed semantics — and deserves isolated review; PR-3/PR-4 are independent of it). Stage 1 splits into encapsulation / signer / hardening because PR-6 is a public-API signature change while PR-5 and PR-7 are internal. Stages 2–3 map 2:1. Docs consolidate in PR-12.

**Sequencing rule:** one PR in review at a time; each branch is cut from up-to-date `main`; after merge I fetch/ff, delete the branch, and cut the next.

---

## 7. Breaking-changes record (supersedes the v2.0 table; per A9 this is a record, not a migration guide — CHANGELOGs document each landing)

| Version | Breaking change | Mitigation |
|---|---|---|
| v0.8.0 | Seed = 64 bytes (D1): `get64ByteSeedFromMnemonic`, `fromSeed` accepts 64 B / 128 hex | Re-derive seed via the new function; **all identities, passwords, channel keys change** |
| v0.8.0 | `#private` fields, defensive copying, `dispose()` | Public API surface unchanged; serialization paths use explicit redaction |
| v0.8.0 | `Attestation.issue(signer, subjectPublicKey, ...)` | Pass `Identity`/`Handle` (or any `Signer`) instead of raw private key |
| v0.8.0 | `derivePassword(context, { revision?, byteLength? })`, `deriveChannelKey(context, { revision? })` | Positional args → options object; no legacy shim (A1) — re-derive. Contexts now NFKC-canonicalized (was lowercase → trim) — re-derive for non-NFKC contexts; vectors extended (r2 + NFKC rows) |
| v0.8.0 | All errors are `AttestationError` with `code`/`level` | Match on `e.code`/`e.level`, not messages |
| v0.8.0 | `Session` constructor private; `fromVerified` internal | `Session.create` / `Session.verify*` on the public surface |
| v1.0.0 | API freeze | — |

---

## 8. Priority subset (80% of risk, from v2.0)

1. PR-2 (seed 64) — everything else derives from it.
2. PR-5 + PR-6 (`#private`+copying+dispose, `Signer`) — runtime and stack key-leak closure.
3. PR-3 (real test vectors) — regression control for all of the above.
4. PR-7 error unification — integration reliability.

If capacity shrinks, these four PRs are the LTS floor; PR-10/PR-11 may defer to v1.1 (but PR-10's cycle break is cheap and stays).

---

## 9. Architect-owned track (outside agent token scope)

| Item | When | Note |
|---|---|---|
| Cloudflare Pages **Build watch paths** (§6.4) | anytime, one-time | dashboard-only; cuts most of the triple-redeploy noise |
| CI coverage wiring + any `ci-security.yml` edit | with PR-4 | I supply the diff; push needs Workflows scope (A7) |
| Audit vendor / bug bounty search (D7) | at the developer's discretion | typical lead time 4–10 weeks; audit runs on the PR-11 code freeze — no fixed start deadline (amended 2026-11-01) |
| Publish pair-checks per DR-4 checklist | RC + release | package + consumer on clean install |
| Verify `vectors` on exactly Node 22.6.0 | before `v1.0.0`, not `rc.2` | П.7 moved the script to `--experimental-strip-types` (a 22.6.0+ flag); the agent sandbox only has Node 24, where the run is verified byte-identical. The first `pnpm --filter @me2em/core vectors` run on exactly 22.6.0 gates `v1.0.0` — CI never invokes `vectors`, so zero runtime risk in the meantime |
| `v1.0.0-rc.1` → `v1.0.0`, npm dist-tag `lts`, migration guide post | Stage 6–7 | release ops |

---

## 10. Timeline

| Window | Work |
|---|---|
| Week 1 | PR-2, PR-3 (seed + vectors/spec) |
| Week 2 | PR-4, PR-5 |
| Weeks 3–4 | PR-6, PR-7 (Stage 1 complete) |
| Week 5 | PR-8 (Stage 2 complete) |
| Weeks 6–7 | PR-10, PR-11 (Stage 3 complete; code freeze) |
| Week 8 | PR-12: THREAT_MODEL/SECURITY, freeze, `rc.1` |
| Audit window | external audit / bounty on `rc` (lead time dominated) |
| +2–4 weeks | audit fixes → `v1.0.0` → 24-month LTS window opens |

Cadence assumes one PR in review at a time with same-day review turnaround; the binding constraint on the v1.0.0 date is the audit (D7), not the code. A realistic v1.0.0 lands Q1–Q2 2027.

---

## 11. Traceability — plan v2.0 item → PR

| v2.0 items | PR | v2.0 items | PR |
|---|---|---|---|
| 0.0.1–0.0.6 | PR-2 | 2.4.1–2.4.2 | PR-8 |
| 0.1.1–0.1.3 | PR-3 | 3.1.1–3.1.5 | PR-10 |
| 0.2.1–0.2.3 | PR-3 | 3.2.1–3.2.3 | PR-10 |
| 0.3.1 | PR-4 | 3.3.1, 3.3.4 | PR-10 |
| 0.3.2 | PR-4 (config) + architect (CI) | 3.3.2/3.3.3 | A5 (wrappers kept) |
| 0.3.3 | PR-4 | 3.4.1–3.4.3 | PR-11 |
| 0.3.4 | PR-4 | 3.5.1–3.5.3 | PR-11 |
| 0.4.1–0.4.2 | PR-4 | 3.6.1–3.6.3 | PR-11 |
| 1.1.1–1.1.5 | PR-5 | 4.1 | PR-12 |
| 1.2.1–1.2.6 | PR-6 | 4.2 | PR-12 |
| 1.3.1–1.3.5 | PR-5 | 4.3 | removed (A9) |
| 1.4.1–1.4.5 | PR-5 | 4.4, 4.5 | PR-2/PR-8/PR-12 (ride-along), PR-12 (consolidate) |
| 1.5.1–1.5.2 | PR-7 | 4.6 | PR-12 |
| 1.6.1–1.6.2 | PR-7 | 4.7 | every feature PR |
| 1.7.1–1.7.5 | PR-7 | 4.8 | PR-3 |
| 1.8.1 | PR-5 | 5.1–5.5 | PR-5 |
| 1.8.2–1.8.4 | PR-7 | 5.6, 5.16 | PR-8 |
| 1.8.5–1.8.7 | PR-7 | 5.7 | PR-7 (property-based), distributed |
| 2.1.1–2.1.5 | PR-8 (2.1.2 dropped, A1) | 5.8–5.10 | PR-4/PR-7 |
| 2.2.1–2.2.3 | PR-8 | 5.11 | PR-3 |
| 2.3.1–2.3.6 | excluded → solano TZ (A4) | 5.12–5.14 | PR-7 (5.14 → PR-3/PR-7) |
| — | — | 5.15, 5.18–5.19 | PR-7 (5.17 → solano TZ) |
| 6.1–6.6, 7.1–7.5 | architect track (§9) + PR-12 | | |
