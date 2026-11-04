# Changelog

All notable changes to `@me2em/solano` are documented here. This is the
first release of the package — the Solana track of the Me2eM payment
layer.

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
