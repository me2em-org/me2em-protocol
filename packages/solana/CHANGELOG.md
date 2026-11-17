# Changelog

All notable changes to `@me2em/solana` are documented here. This is the
first release of the package — the Solana track of the Me2eM payment
layer.

> **Note on naming.** The package was renamed from `@me2em/solano` to
> `@me2em/solana` before the first stable track was established: the
> network is Solana, and the codename in early planning documents
> (`solano`) is not the product name. `@me2em/solano@0.0.0-stage` and
> `@me2em/solano@1.0.0-rc.1` on npm are deprecated placeholders —
> install `@me2em/solana` instead.

## [1.0.0-rc.4] — 2026-11-17

Ф5: payment submission (`pay`) — programmatic SOL spend from a managed
wallet, SOL-only, seed per call (the adapter and the registry stay
stateless). No API surface change beyond `pay` (previously
`NOT_IMPLEMENTED`) and the two `RpcClient` methods it needs.

### Added
- **`pay(from, request, opts, ctx)`** (`src/pay.ts`) — validates
  chain (`request`/`from` vs `ctx.chain`), asset (SOL-only,
  `SOLANA_NATIVE_ASSET`), seed shape, recipient/reference structure
  (base58-32) and the derivation path, verifies the derived address
  against `from.address` (fail-closed against a descriptor/seed
  mismatch — no default index exists), builds a system transfer with
  `request.reference` as a read-only non-signing account key (the
  Solana Pay convention; optional memo via the memo program), signs
  with a throwaway `SolanaWalletTree`, submits via
  `RpcClient.sendTransaction` (fresh `getLatestBlockhash` per call,
  preflight on, no confirmation wait) and returns the tx signature.
  Seed and node key are wiped in `finally`; the tree is disposed.
  Contract violations throw bare `TypeError`; transport failures
  propagate the `RpcClient`'s `Error` (v1.2 §5.1 — `pay` throws on
  failure, never returns an empty `txRef`).
- **`solToLamports`** — strict decimal-string → lamports (bigint,
  never float, BL-55): `/^\d+(\.\d{1,9})?$/`, zero rejected;
  `'1.2.3'`/`'-1'`/`'1e3'` are TypeErrors, not silent math.
- **`RpcClient.getLatestBlockhash()`** and
  **`RpcClient.sendTransaction(wireBase64)`** — the two RPC methods
  `pay` needs (В-7/A): one transport, one endpoint, one error
  contract as Ф4; empty `sendTransaction` signature → `Error`.
- **`PayOptions` / `PayContext`** — per-call spend options (`seed`,
  optional `memo`) and transport context (`rpc` + exact CAIP-2
  `chain`).
- **Dependencies:** `@solana/kit ^8.6.0`,
  `@solana-program/system ^0.16.0`, `@solana-program/memo ^0.16.0`,
  `@solana/keys ^2.3.0` (regular; kit types do not appear in the
  public `pay` signature, so no peer range on kit — the program
  clients pin `@solana/kit ^8.5.0` themselves).
- **Peer floor bumped** to `@me2em/core >=1.0.0-rc.6`
  (`PaymentAdapter.pay` gained an optional third `opts` parameter —
  core rc.6, additive, not breaking).

### Changed
- **`SolanaPaymentAdapter.pay(from, request, opts?)`** — now
  implemented (was `NOT_IMPLEMENTED`). Requires `opts.seed`; without
  it throws `TypeError` — the same contract as `resolveWallet`. The
  adapter remains stateless; `registerSolanaAdapters` instances are
  fully functional.
- **`tsup` external** — `@solana/kit`, `@solana/keys`,
  `@solana-program/system`, `@solana-program/memo` are no longer
  inlined into dist.
- **`src/index.ts` scope header** — the package is no longer
  offline; `pay`, `solToLamports`, `PayOptions`, `PayContext` are
  exported.
- **README** — `pay` usage example and the sweep note (sweep is
  application logic, not a package method — В-4/В-5).

### Notes
- SOL-only in rc.4 (В-3/A): `request.asset !== 'sol'` → `TypeError`
  (`pay` contract: throws — not a `PaymentResult`; symmetric with Ф4
  step 6a). SPL transfer-checked → deferred (amendment to P0.3 §7).
- No blockhash injection: `pay` calls `getLatestBlockhash` itself
  (В-7/A). `SolanaX402Signer` (M2) keeps its `getRecentBlockhash`
  injection — different contracts.
- Unit tests use the existing `fetch` injection point
  (`SolanaPaymentAdapterOptions.fetch` / `RpcClientOptions.fetch`)
  — no module mocks; the wire payload is decoded with kit's own
  decoders to pin the assembly. The non-CI devnet integration
  (`ME2EM_DEVNET_PAY_SEED`) closes on Ф4: `pay` → `verifyPayment` =
  success; repeat → `REPLAYED`.
- Coverage: `pay.ts` 96.7 % lines, `rpc.ts` 96.4 %; the package
  branch total rises 81.69 → 84.72 % vs rc.3. The remaining branch
  gap is the Ф4 LUT-fallback paths in `verify.ts` — pre-existing
  debt, tracked by BL-54/56/57 (the 90 % branch threshold was
  already failing on rc.3).

## [1.0.0-rc.3] — 2026-11-16

Ф4: payment verification (`verifyPayment` — 7-step normative order),
LUT address resolution, on-curve wallet binding (`verifyWalletBindingSolana`),
`deriveForVerification` (non-consuming seed), JSON-RPC client, and
`blockTime` fallback. SOL-only (SPL → `WRONG_ASSET`). No API surface
change — all additions are new functions/types.

### Added
- **`SolanaPaymentVerifier` — 7-step `verifyPayment` (normative Ф4).**
  Steps: NOT_FOUND → REFERENCE_MISMATCH → EXPIRED/containment-before-time
  → REPLAYED → WRONG_RECIPIENT → UNDERPAID → WRONG_ASSET → success.
  LUT fallback for reference resolution when reference is not in
  static keys. Idempotent: repeated calls with same `txRef` return
  success. `blockTime` falls back to `tx.meta.blockTime` (RPC returns
  only this). Chain check: `request.chain` must match adapter chain.
- **`SolanaPaymentAdapter` — Ф4 adapter.** Wraps `SolanaPaymentVerifier`
  + `SolanaWalletAdapter` + `RpcClient`. Exposes `verifyPayment`,
  `resolveWallet`, `isValidAddress`, `nextIndex`, `chain`, `network`.
- **`verifyWalletBindingSolana` — on-curve wallet binding (Ф4).**
  Takes `WalletDescriptor`, checks `@noble/curves/ed25519` on-curve.
  Core-default `verifyWalletBinding` (signature + subject + address)
  is separate — applications call BOTH.
- **`SolanaWalletTree.deriveForVerification` — non-consuming seed.**
  Creates a temporary tree, derives wallet at index, disposes tree.
  Seed is NOT consumed (unlike `deriveWallet` which advances internal
  state). Path: `m/44'/501'/{N}'/0'` (canonical 4-level).
- **`RpcClient` — JSON-RPC 2.0 client for Solana.** Methods:
  `getTransaction`, `getSignaturesForAddress`, `getAccountInfo`.
  Supports custom `fetch` for testing. Throws `Error` on JSON-RPC
  errors, HTTP errors, or null results (except `getTransaction`
  returning `null` for NOT_FOUND).
- **`parseLutAddresses` — LUT account data parser.** Decodes base64,
  parses Solana Extension format (deactivationSlot, lastExtendedSlot,
  authority, addresses). Returns `readonly Uint8Array[] | null`
  (fail-closed on corruption).
- **`SOLANA_RPC_ENDPOINTS` — well-known RPC endpoints.** Default
  endpoints for mainnet-beta, devnet, testnet, localnet.
- **`networks.ts` — chain namespace utilities.** `solanaChain()`,
  `isSolanaReference()`, `isSolanaAddress()`.

### Fixed
- **`blockTime` fallback — only `tx.meta?.blockTime` (Б-4).** The
  previous code checked `tx.meta?.blockTime ?? tx.blockTime` but
  the Solana RPC returns only `meta.blockTime` (no top-level
  `blockTime`). The top-level field was removed from the RPC type.
- **WRONG_ASSET ordering — step 6a (BEFORE UNDERPAID).** SPL tokens
  must fail at step 6a (WRONG_ASSET) before step 6 (UNDERPAID).
  This is because Ф4 is SOL-only.
- **`#verifyAmount` — removed `asset` parameter.** Asset check is
  done at step 6a (before `#verifyAmount`). The `asset` parameter
  and `asset !== 'sol'` check inside `#verifyAmount` were removed.
- **`deriveForVerification` — `exec()` instead of `test()` +
  `match()` (Б-3).** The previous `test()` + regex `match()` was
  fragile (padded indices matched `test()` but not `match()`).
  Now uses `exec()` to capture the index directly.
- **`readU64LE` — deleted dead code (Ф4).** The LUT parser no
  longer reads `deactivationSlot`/`lastExtendedSlot` (u64 LE) —
  they are skipped with `offset += 8`. `readU64LE` was removed.
  `readU32LE` is kept for `count` (Vec<Pubkey> length).
- **`parseLutAddresses` — discriminator check (u32 LE = 1).**
  The wire format starts with discriminator (not version byte).
  Discriminator must equal 1 (initialized LUT); any other value
  causes `null` return (fail-closed).
- **`#resolveLutLookup` — owner check.** Account owner must be
  `AddressLookupTab1e1111111111111111111111111`; non-LUT accounts
  are rejected (fail-closed).
- **`register.ts` — SolanaPaymentAdapter instead of SolanaWalletAdapter.**
  `registerSolanaAdapters` now registers `SolanaPaymentAdapter` (Ф4
  verifyPayment support) instead of `SolanaWalletAdapter`.
- **`dist-artifact.spec.ts` — constructor calls instead of typeof.**
  Tests now instantiate `SolanaPaymentAdapter` and call
  `deriveForVerification` to verify the dist artifact is functional.

### Changed
- **`@noble/curves` — added as direct dependency (Ф4, Н-1).**
  Previously not a dependency (derivation went through
  `crypto.slip10`). Ф4's `verifyWalletBindingSolana` imports
  `@noble/curves/ed25519` directly for on-curve checks.
- **`@me2em/crypto` dependency: `workspace:^` (— `^1.1.0-rc.2`
  at publish; Н-3).** No change from rc.2.

### Notes
- `createPaymentRequestURL`'s optional `label`/`message`/`memo`
  parameters (P0.3 §5.5) remain **not part of rc.3** — deferred
  to x402 (Б-3, open).
- `verifyWalletBindingSolana` is on-curve only (Ф4). Core-default
  `verifyWalletBinding` (signature + subject + address equality)
  is separate. Applications MUST call BOTH for full binding
  verification.
- LUT resolution: `parseLutAddresses` reads base64-encoded LUT
  account data from RPC (`getAccountInfo`). The `loadedAddresses`
  fallback in `verifyPayment` handles transactions that include
  address table lookups in their message (v0 transactions).
- `deriveForVerification` does NOT consume seed: it creates a
  temporary `SolanaWalletTree`, derives the wallet, and disposes
  the tree in a `finally` block. This is safe for repeated calls.
- `@scure/base` / `@noble/curves` in dist: `pnpm pack` confirms
  no inline `slip10`/`secureWipe`/`@noble/curves` — all external
  dependencies.

## [1.0.0-rc.2] — 2026-11-16

Ф3 correctness fixes after the rc.1 review: `nextIndex` semantics
(phantom-path recognition + padded-index rejection) and a real-wallet
acceptance cross-check. No API surface change — all fixes are in the
behavior of existing functions.

### Fixed
- **`nextIndex` / `nextPaymentIndex` — padded index renderings are no
  longer treated as used (В-1).** `m/44'/501'/00'/0'` can never be
  produced by `crypto.slip10.derivePath` (canonical
  `(0|[1-9][0-9]*)` grammar); the previous `(\d+)` alternative was a
  defect — it could block a legitimate allocation for an index that
  was never actually derived. The index grammar is now canonical.

### Changed
- **`nextIndex` / `nextPaymentIndex` — the 3-level "phantom" shape
  `m/44'/501'/{N}'` is now recognized as used (Б-1).** One seed, one
  wallet family: Phantom and other SLIP-0010 wallets derive
  `m/44'/501'/{N}'` from the same seed, and index allocation must not
  hand out an index that an external wallet already claims — that
  would create a semantic collision (same index, different address)
  for users who import the same mnemonic across wallets. Both the
  3-level phantom shape and the canonical 4-level shape now count as
  used; index allocation is `max(seen) + 1` over the union.

### Added
- **Phantom / `solana-keygen` acceptance cross-check (Б-2, deferred).**
  The fixed test mnemonic (BIP39 official 12-word vector) derives a
  wallet at `m/44'/501'/0'/0'`; the resulting public address is pinned
  against a REAL Phantom import and the `solana-keygen recover`
  reference CLI. This is the only test that proves interop with the
  Solana ecosystem, independent of the me2em stack. The test is
  skipped until the fixture is filled at acceptance (`PHANTOM_GOLDEN_ADDRESS`
  placeholder); CI stays green. Provenance is documented in
  `test/goldens.ts` (Phantom version, OS, date) — never the private
  key. Phantom cross-check — deferred, `test.skip` до заполнения,
  не блокирует rc.2.
- **gitleaks allowlist for public golden fixtures.** `packages/solana/test/goldens.ts`
  carries only PUBLIC data (test-vector seed hex + base58 addresses);
  allowlisted via `.gitleaksignore`, `.gitleaks.toml`, and inline
  `// gitleaks:allow` comments so the `allow-test-fixtures` rule
  does not flag it (the same class of false positive that blocked
  the pre-rename `@me2em/solano` CI run).

### Notes
- `createPaymentRequestURL`'s optional `label`/`message`/`memo`
  parameters (P0.3 §5.5) are **not** part of rc.2 — the decision
  (implement now vs. scope-reduce) is deferred to the x402 analysis
  (Б-3, open). The current URL shape (`amount`, `[spl-token]`,
  `reference`) is unchanged. Deliberately absent; x402 memo goes
  through extra.me2em.memo; add later if needed for direct flow.
- No change to `@scure/base` / `@noble/curves` dependency policy
  (Н-1): `@scure/base` stays a direct dependency (imported directly
  by `adapter.ts`, `reference.ts`, `wallet-tree.ts`); `@noble/curves`
  is not added in Ф3 (derivation goes through `crypto.slip10`);
  Ф4 will add it directly when `verifyWalletBinding` (on-curve)
  lands.
- `@me2em/crypto` dependency stays `workspace:^` (— `^1.1.0-rc.2`
  at publish; Н-3).

## [1.0.0-rc.1] — 2026-11-04

Initial release: the **Ф3 "wallet-only"** phase of the payment-layer
plan (Документ 2 v1.2 §9). Everything a Solana wallet needs BEFORE any
network touch: deterministic derivation, adapter registration and the
external-wallet request-URL flow. Offline by design — `verifyPayment`
and `pay` are deliberately absent (Ф4/Ф5).

### Added
- **`SolanaWalletTree`** (`src/wallet-tree.ts`) — deterministic
  derivation context over one 64-byte seed (the `Identity.fromSeed`
  contract; v1.2 §4.1):
  - `fromSeed(seed)` — validates via `crypto.slip10.masterKeyFromSeed`
    and retains ONLY the master key + chain code in private fields;
    the caller's seed buffer is neither retained nor wiped.
  - `deriveWallet(index)` — the canonical Solana payment path
    `m/44'/501'/{index}'/0'` → SLIP-0010 ed25519 → base58 address.
    Returns `{ address, privateKey, derivationPath }`; the private
    key is a fresh 32-byte buffer, the caller MUST wipe it; the
    (unreturned) child chain code is wiped immediately.
  - `nextIndex(usedPaths)` — chain-scoped index allocation (v1.2
    §2.2): foreign/unparseable paths are ignored, empty (or
    empty-after-filtering) input yields `0`, otherwise `max + 1` —
    holes are never reused. Pure planning — works after `dispose()`.
  - `dispose()` — two-pass-secure-wipes the master material
    (via `@me2em/crypto`'s `secureWipe`); further key-requiring calls
    throw core's `DisposedError`.
- **`SolanaWalletAdapter`** (`src/adapter.ts`) — core `WalletAdapter`
  for one exact CAIP-2 chain id. Stateless chain-bound view:
  `resolveWallet(entity, { seed, index? })` derives per call through a
  throwaway tree and returns a descriptor with NO key material
  (missing `seed` → `TypeError`, per core's deterministic-adapter
  contract); `isValidAddress` is structural — base58 decoding to
  exactly 32 bytes, **off-curve (PDA) addresses are valid**; `nextIndex`
  shares the tree's allocation semantics.
- **`createPaymentReference()`** (`src/reference.ts`) — 32 random
  bytes (WebCrypto via `@me2em/crypto`) base58-encoded: the
  `PaymentRequest.reference` correlation key for chain-level
  `REPLAYED` detection (v1.2 §5.4).
- **`createPaymentRequestURL(request)`** (`src/url.ts`) — Solana Pay
  URI for external wallets (Phantom/Solflare; v1.2 §5.1 — external
  wallets never go through `pay`): `solana:<payTo>?amount=…&[spl-token=…]&reference=…`
  in the spec's parameter order. Native-SOL asset sentinel:
  `'sol'` (`SOLANA_NATIVE_ASSET`, exact match); any other asset must
  be a base58-encoded 32-byte SPL mint. `expiresAt` is deliberately
  NOT encoded — the verifier enforces expiry from the SIGNED
  `PaymentRequest` (v1.2 §0.1). Fail-closed `TypeError` validation on
  chain/payTo/amount/asset/reference.
- **`registerSolanaAdapters({ networks? })`** (`src/register.ts`) —
  one adapter per exact CAIP-2 registry key (v1.2 §2.1); defaults to
  `['mainnet-beta']` (dev/test clusters are explicit opt-in); combined
  idempotent disposer; network names validated BEFORE any
  registration.
- **Chain constants** (`src/networks.ts`) — `SOLANA_CHAINS`
  (`solana:mainnet-beta` / `solana:devnet` / `solana:testnet` /
  `solana:localnet`), `SolanaNetwork`, `isSolanaNetwork`,
  `isSolanaChain` (CAIP-2 grammar via core + `solana` namespace),
  `solanaChain`, `SOLANA_NAMESPACE`.
- **Dependencies:** `@me2em/crypto >=1.1.0-rc.1` (direct — the
  `crypto.slip10` namespace, `secureWipe`, `randomBytes`),
  `@scure/base ^2.4.0` (base58); `@me2em/core >=1.0.0-rc.3 <2.0.0-0`
  as a PEER dependency (registry, CAIP-2 grammar, `DisposedError`).
  No curve library is imported — derivation is fully delegated to
  `crypto.slip10`.
- Tests: golden address pins for `m/44'/501'/{index}'/0'` computed
  INDEPENDENTLY of this package (SLIP-0010 Test Vector 2 seed through
  the published `@me2em/crypto` build + `@scure/base`), incl. the
  `2^31 − 1` boundary; seed-contract negatives; seed non-retention
  and non-wipe semantics; dispose/`DisposedError` lifecycle; adapter
  contract (descriptor without key material, chain-bound instances,
  missing-seed `TypeError`); PDA-tolerant address validation;
  reference uniqueness; Solana Pay URI shape/order/validation;
  registry keys, default network set, disposer hygiene and last-wins
  interplay; a dist-artifact smoke pinning the published module graph.
