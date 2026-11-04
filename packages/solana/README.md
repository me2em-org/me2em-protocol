[![npm version](https://img.shields.io/npm/v/@me2em/solana.svg)](https://www.npmjs.com/package/@me2em/solana)
[![License](https://img.shields.io/npm/l/@me2em/solana.svg)](./LICENSE)
[![Docs](https://img.shields.io/badge/docs-solana.me2em.com-blue)](https://solana.me2em.com)

# @me2em/solana

Solana adapter for the Me2eM payment layer: deterministic wallet trees over SLIP-0010, chain-bound wallet adapters, payment references and Solana Pay request URLs — offline by design (no RPC in this release).

## Status

**v1.0.0-rc.1 — Ф3 "wallet-only"** (payment-layer plan, Документ 2 v1.2 §9). Deterministic wallets, adapter registration and the external-wallet URL flow. `verifyPayment` / `verifyWalletBinding` arrive with Ф4 (rc.2), `pay` with Ф5 (rc.3).

## Install

```sh
pnpm add @me2em/solana @me2em/core
```

> 💡 `@me2em/core` is a **peer** dependency (`>=1.0.0-rc.3 <2.0.0-0`) —
> the adapter registry, CAIP-2 grammar and `DisposedError` live there.
> SLIP-0010 derivation is delegated to `@me2em/crypto` (a direct
> dependency, installed automatically). This package is headless-only —
> browser and Node.js ≥ 22.

## Modules

### networks/ — chain identity

- **`SOLANA_CHAINS`** — the exact CAIP-2 chain id per network: `solana:mainnet-beta`, `solana:devnet`, `solana:testnet`, `solana:localnet`. These strings are the adapter-registry keys and the attestation `subjectWalletChain` values. `mainnet-beta` is the canonical cluster name — there is no `solana:mainnet`.
- **`isSolanaChain(chain)`** — CAIP-2 grammar (via core) + `solana` namespace check.
- **`SolanaNetwork`** — `'mainnet-beta' | 'devnet' | 'testnet' | 'localnet'`, runtime-guarded by `isSolanaNetwork`.

### wallet-tree/ — deterministic derivation

- **`SolanaWalletTree.fromSeed(seed)`** — a tree over one 64-byte seed (the `Identity.fromSeed` contract; anything else is a `TypeError`). The seed is consumed by derivation and **never retained** — only the master key + chain code live in private fields; the caller's buffer is untouched.
- **`tree.deriveWallet(index)`** — `m/44'/501'/{index}'/0'` → SLIP-0010 ed25519 (via `crypto.slip10`) → base58 address. Returns `{ address, privateKey, derivationPath }`; the private key is a fresh 32-byte buffer — **the caller MUST wipe it** (`secureWipe`).
- **`tree.nextIndex(usedPaths)`** — chain-scoped index allocation (v1.2 §2.2): unparseable/foreign paths are ignored, empty input yields `0`, otherwise `max(indexes) + 1` — holes are never reused. Works after `dispose()` (no key material involved).
- **`tree.dispose()`** — zeroizes the master material; further key-requiring calls throw `DisposedError`. Idempotent.

```ts
import { SolanaWalletTree } from '@me2em/solana';
import { secureWipe } from '@me2em/crypto';

const tree = SolanaWalletTree.fromSeed(seed64); // 64-byte BIP39 seed
try {
  const { address, privateKey, derivationPath } = await tree.deriveWallet(0);
  entity.bindWallet({ chain: 'solana:mainnet-beta', address, derivationPath });
  // … sign if needed …
  secureWipe(privateKey); // caller MUST wipe
} finally {
  tree.dispose();
}
```

### adapter/ — the WalletAdapter

- **`SolanaWalletAdapter`** — implements core's `WalletAdapter` for one exact CAIP-2 chain. `resolveWallet(entity, { seed, index? })` derives per call (throwaway tree, disposed in `finally`) and returns a descriptor with **no key material** — the derived private key is wiped inside; use `SolanaWalletTree` directly when you need the raw key. A missing `seed` is a `TypeError` (deterministic-adapter contract).
- **`isValidSolanaAddress(address)`** — structural check: base58 decoding to exactly 32 bytes. **Off-curve (PDA) addresses are valid** — no on-curve filter exists in this package; on-curve strengthening belongs to `verifyWalletBinding` (Ф4).

### reference/ — payment correlation

- **`createPaymentReference()`** — 32 random bytes base58-encoded; the `PaymentRequest.reference` value for chain-level `REPLAYED` detection (v1.2 §5.4). One reference per request — reuse is indistinguishable from a replay.

### url/ — external wallet hand-off

- **`createPaymentRequestURL(request)`** — Solana Pay URI for Phantom/Solflare (external wallets never go through `pay`, v1.2 §5.1):

  ```ts
  solana:<payTo>?amount=<amount>&spl-token=<mint>&reference=<ref>
  ```

  `spl-token` is present exactly when `asset` is an SPL mint; the native SOL sentinel is **`'sol'`** (`SOLANA_NATIVE_ASSET`, exact lowercase match). `expiresAt` is deliberately **not** encoded — the verifier enforces expiry from the SIGNED `PaymentRequest` (v1.2 §0.1: all verification parameters live in signed artifacts; the URL is a transport, not the verification artifact).

```ts
import { createPaymentRequestURL } from '@me2em/solana';

const url = createPaymentRequestURL({
  chain: 'solana:mainnet-beta',
  payTo: recipient,
  amount: '1.5',
  asset: 'sol', // or an SPL mint (base58)
  reference,    // createPaymentReference()
  expiresAt,    // enforced by the verifier from the signed request
});
// hand `url` to the buyer's wallet; verify later with verifyPayment (Ф4)
```

### register/ — registry

- **`registerSolanaAdapters({ networks? })`** — registers one stateless `SolanaWalletAdapter` per network under its exact CAIP-2 key; defaults to `['mainnet-beta']` (dev/test clusters are an explicit opt-in). Returns an idempotent combined disposer. Network names are validated **before** any registration.

```ts
import { registerSolanaAdapters } from '@me2em/solana';

const dispose = registerSolanaAdapters(); // solana:mainnet-beta
// … the payment layer resolves the adapter by exact chain id …
dispose(); // test hygiene
```

> ⚠️ **Last-wins registry.** A later registration for an occupied chain
> key replaces the earlier adapter — any code in the process can do it.
> Registering is a privilege of the application's trusted code; do not
> import untrusted dependencies before registration.

## Error model

| Condition | Error |
|---|---|
| Seed not exactly 64 bytes / not `Uint8Array` | `TypeError` |
| Index not a safe integer in `0..2^31−1` | `TypeError` |
| Missing `opts.seed` in `resolveWallet` | `TypeError` |
| Malformed request fields in `createPaymentRequestURL` | `TypeError` |
| Unknown network name (adapter / registration) | `TypeError` |
| Key-requiring call after `dispose()` | `DisposedError` (`code: 'DISPOSED'`) |
| Malformed address in `isValidSolanaAddress` | returns `false` (never throws) |

Programmer errors are bare `TypeError` — the same contract as `crypto.slip10` and `Identity.fromSeed`. Runtime/operational failures of the payment flow (`verifyPayment` reasons) arrive with Ф4 as core's `PaymentFailureReason`.

## Invariants

- **Offline (Ф3):** no RPC, no network calls, no transaction building — verification and `pay` are Ф4/Ф5.
- **No SLIP-0010 and no curve code of its own:** derivation is `crypto.slip10`; base58 is `@scure/base`. `@noble/curves` is never imported directly.
- **Stateless adapter, stateful tree, never both:** the adapter holds nothing; the tree holds only master key material and dies with `dispose()`.
- **Descriptors carry no key material** — ever.

## Roadmap

- **Ф4 (rc.2)** — `verifyPayment` (JSON-RPC; check order `NOT_FOUND` → `REFERENCE_MISMATCH` → `EXPIRED` → `REPLAYED` → `WRONG_RECIPIENT` → `UNDERPAID`), `verifyWalletBinding` override (on-curve), `deriveForVerification` (Mode 1).
- **Ф5 (rc.3)** — `pay` via `@solana/kit`, sweep documentation.

See [packages/core README](../core/README.md) for the payment-layer interfaces and the [root README](../../README.md) for the full package map.

## License

Apache License 2.0 — see [LICENSE](../../LICENSE).

© 2026 Me2eM Organization. Built for privacy, openness, and user sovereignty.
