[![npm version](https://img.shields.io/npm/v/@me2em/solana.svg)](https://www.npmjs.com/package/@me2em/solana)
[![License](https://img.shields.io/npm/l/@me2em/solana.svg)](https://github.com/me2em-org/me2em-protocol/blob/main/LICENSE)
[![Docs](https://img.shields.io/badge/docs-solana.me2em.com-blue)](https://solana.me2em.com)

# @me2em/solana

Solana adapter for the Me2eM payment layer: deterministic wallet trees over SLIP-0010, chain-bound wallet/payment adapters, payment references, Solana Pay request URLs, on-chain payment verification (`verifyPayment`) and programmatic payment submission (`pay`).

## Status

**Payment-adapter release (rc.4).** Deterministic wallets, adapter registration, the external-wallet URL flow (Ф3), payment verification (Ф4: `verifyPayment`, `verifyWalletBindingSolana`, `deriveForVerification`) and payment submission (Ф5: `pay` — SOL-only, seed per call) are shipped. SPL transfers and x402 signer integration are on the [Roadmap](#roadmap).

## Install

Wallet-only mode (this release) — deterministic Solana wallets derived
from the Identity seed:

```sh
pnpm add @me2em/solana @me2em/core @me2em/crypto
```

> 💡 `@me2em/core` is a **peer** dependency (`>=1.0.0-rc.6 <2.0.0-0`) —
> the adapter registry, CAIP-2 grammar, payment-layer interfaces and
> `DisposedError` live there. `@me2em/crypto` supplies SLIP-0010
> derivation and `secureWipe`; both are resolved automatically.
> `pay` brings `@solana/kit` + `@solana-program/system`/`memo` as
> regular dependencies (installed with the package); `@me2em/crypto`
> stays a direct dependency, so listing it explicitly keeps the
> manifest honest — the examples below call its API directly.
> This package is headless-only — browser and Node.js ≥ 22.

Payments mode (planned): the install set stays the same plus the future
x402 payment layer once it ships — nothing extra is needed today.

## Modules

### networks/ — chain identity

- **`SOLANA_CHAINS`** — the exact CAIP-2 chain id per network: `solana:mainnet-beta`, `solana:devnet`, `solana:testnet`, `solana:localnet`. These strings are the adapter-registry keys and the attestation `subjectWalletChain` values. `mainnet-beta` is the canonical cluster name — there is no `solana:mainnet`.
- **`isSolanaChain(chain)`** — CAIP-2 grammar (via core) + `solana` namespace check.
- **`SolanaNetwork`** — `'mainnet-beta' | 'devnet' | 'testnet' | 'localnet'`, runtime-guarded by `isSolanaNetwork`.

### wallet-tree/ — deterministic derivation

- **`SolanaWalletTree.fromSeed(seed)`** — a tree over one 64-byte seed (the `Identity.fromSeed` contract; anything else is a `TypeError`). The seed is consumed by derivation and **never retained** — only the master key + chain code live in private fields; the caller's buffer is untouched.
- **`tree.deriveWallet(index)`** — `m/44'/501'/{index}'/0'` → SLIP-0010 ed25519 (via `crypto.slip10`) → base58 address. Returns `{ address, privateKey, derivationPath }`; the private key is a fresh 32-byte buffer — **the caller MUST wipe it** (`secureWipe`).
- **`tree.nextIndex(usedPaths)`** — chain-scoped index allocation: unparseable/foreign paths are ignored, empty input yields `0`, otherwise `max(indexes) + 1` — holes are never reused. Works after `dispose()` (no key material involved).
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
- **`isValidSolanaAddress(address)`** — structural check: base58 decoding to exactly 32 bytes. **Off-curve (PDA) addresses are valid** — no on-curve filter exists in this package; on-curve strengthening belongs to the future `verifyWalletBinding` verifier (see [Roadmap](#roadmap)).

### reference/ — payment correlation

- **`createPaymentReference()`** — 32 random bytes base58-encoded; the `PaymentRequest.reference` value for chain-level `REPLAYED` detection. One reference per request — reuse is indistinguishable from a replay.

### url/ — external wallet hand-off

- **`createPaymentRequestURL(request)`** — Solana Pay URI for Phantom/Solflare (external wallets never go through `pay`):

  ```ts
  solana:<payTo>?amount=<amount>&spl-token=<mint>&reference=<ref>
  ```

  `spl-token` is present exactly when `asset` is an SPL mint; the native SOL sentinel is **`'sol'`** (`SOLANA_NATIVE_ASSET`, exact lowercase match). `expiresAt` is deliberately **not** encoded — the verifier enforces expiry from the SIGNED `PaymentRequest`: all verification parameters live in signed artifacts; the URL is a transport, not the verification artifact.

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
// hand `url` to the buyer's wallet; verification (`verifyPayment`) is on the roadmap
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

### verify/ + rpc/ — on-chain verification (Ф4)

- **`SolanaPaymentAdapter`** — core's `PaymentAdapter` for one exact
  chain: the wallet surface (`resolveWallet`, `isValidAddress`,
  `nextIndex`) delegated to `SolanaWalletAdapter`, plus
  `verifyPayment` (normative order `NOT_FOUND` → `REFERENCE_MISMATCH`
  → `EXPIRED` → `REPLAYED` → `WRONG_RECIPIENT` → `UNDERPAID` →
  success; SOL-only — SPL → `WRONG_ASSET`) and the on-curve
  `verifyWalletBinding` override. RPC transport: the minimal
  **`RpcClient`** (JSON-RPC 2.0; `getTransaction`,
  `getSignaturesForAddress`, `getAccountInfo`,
  `getLatestBlockhash`, `sendTransaction`) with a `fetch` injection
  point for tests. `SolanaPaymentAdapterOptions.endpoint` overrides
  the network's default public RPC — production passes its own.

### pay/ — programmatic spend (Ф5)

`pay` spends from a wallet **you** control: pass the 64-byte seed
**per call** — the adapter never retains key material and stays
stateless. Returns the transaction signature; confirmation is
`verifyPayment`'s job (no confirmation wait inside `pay`).

```ts
import { SolanaPaymentAdapter } from '@me2em/solana';

const adapter = new SolanaPaymentAdapter({ network: 'devnet' }); // prod: endpoint override
const txRef = await adapter.pay(from, request, { seed });
// later / recipient side:
const result = await adapter.verifyPayment(txRef, request); // status: 'success' | 'failure'
```

Contract highlights:

- **SOL-only** — `request.asset !== 'sol'` throws `TypeError` (SPL
  transfer-checked is deferred).
- **Seed per call** — without `opts.seed` it throws `TypeError` (the
  same contract as `resolveWallet`); the derived address is checked
  against `from.address`, so a stale descriptor cannot spend from the
  wrong wallet.
- **`request.reference`** rides the transaction as a read-only,
  non-signing account key — chain-level `REPLAYED` detection and
  `verifyPayment`'s containment check key on it.
- **Amounts** are strict decimal strings (`solToLamports`, bigint —
  never float); zero and > 9 fractional digits are rejected.
- **`opts.memo`** — optional on-chain memo (memo program).
- Direct use without the registry: import **`pay`** and supply
  `ctx = { rpc: new RpcClient({ endpoint }), chain }` yourself.

### Sweep (documentation only)

`@me2em/solana` does **not** implement a `sweep` method. Sweeping is
application logic: derive the source wallet (via `SolanaWalletTree`),
build a transfer to the target address, and submit it — the same
primitives `pay` uses. Track this in your app's reconciliation flow;
the protocol does not standardize it.

## Error model

| Condition | Error |
|---|---|
| Seed not exactly 64 bytes / not `Uint8Array` | `TypeError` |
| Index not a safe integer in `0..2^31−1` | `TypeError` |
| Missing `opts.seed` in `resolveWallet` / `pay` | `TypeError` |
| Malformed request fields in `createPaymentRequestURL` | `TypeError` |
| Unknown network name (adapter / registration) | `TypeError` |
| `pay`: chain/asset mismatch, invalid payTo/reference, missing or foreign derivation path, derived ≠ `from.address`, zero or malformed amount | `TypeError` |
| `pay`: JSON-RPC / HTTP / preflight failure, empty signature | `Error` (transport contract) |
| Key-requiring call after `dispose()` | `DisposedError` (`code: 'DISPOSED'`) |
| Malformed address in `isValidSolanaAddress` | returns `false` (never throws) |

Programmer errors are bare `TypeError` — the same contract as `crypto.slip10` and `Identity.fromSeed`. Payment-verification outcomes are core's `PaymentResult` with `PaymentFailureReason`; `pay` itself throws on failure (v1.2 §5.1).

## Invariants

- **Submission without confirmation wait:** `pay` submits and returns the signature; checking execution is `verifyPayment`'s job. `getLatestBlockhash` is fetched per call — no blockhash injection (that stays M2-signer's contract).
- **No SLIP-0010 and no curve code of its own:** derivation is `crypto.slip10`; base58 is `@scure/base`; on-curve checks and signing use `@noble/curves` / `@solana/kit`.
- **Stateless adapter, stateful tree, never both:** the adapter holds nothing; the tree holds only master key material and dies with `dispose()`. `pay` derives from the per-call seed through a throwaway tree.
- **Descriptors carry no key material** — ever.

## Roadmap

- ~~Payment verification~~ — shipped in rc.3 (`verifyPayment`, `verifyWalletBindingSolana`, `deriveForVerification`).
- ~~Payment submission~~ — shipped in rc.4 (`pay`, SOL-only, seed per call).
- **SPL transfers** — transfer-checked instructions for token assets (deferred from rc.4).
- **x402 integration** — `SolanaX402Signer` (M2) and the `@me2em/x402` wire layer.

See the [@me2em/core README](https://www.npmjs.com/package/@me2em/core) for the payment-layer interfaces and the [repository README](https://github.com/me2em-org/me2em-protocol) for the full package map.

## License

Apache License 2.0.

© 2026 Me2eM Organization. Built for privacy, openness, and user sovereignty.
