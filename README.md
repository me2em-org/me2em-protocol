# 🌐 Me2eM Protocol

**A decentralized, seed-derived identity, authorization and payment protocol built on Ed25519 cryptography.**

[![CI & Security](https://github.com/me2em-org/me2em-protocol/actions/workflows/ci-security.yml/badge.svg)](https://github.com/me2em-org/me2em-protocol/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![npm org](https://img.shields.io/badge/npm-@me2em-cb3837?logo=npm)](https://www.npmjs.com/org/me2em)
[![Docs](https://img.shields.io/badge/docs-me2em.com%2Fdocs-blue)](https://me2em.com/docs)

---

## 🎯 What is Me2eM?

Me2eM is a **cryptographic identity protocol**: a set of formats, derivation rules, and verification procedures that let independent implementations establish authenticated, delegatable, end-to-end encrypted relationships — without ever persisting a private key.

The protocol addresses a growing class of problems in identity and authorization. Today these include:

| Problem | Me2eM Solution |
|---------|----------------|
| **Context collision** — one profile for everything (work, personal, IoT, agents) | Multiple isolated `Handle`s per `Identity`, each with its own keypair |
| **IoT scalability** — managing thousands of devices | Hierarchical derivation: `Identity` → `Handle` → `SubHandle` (MAX_DEPTH = 2), fully offline |
| **Delegatable trust** — granting scoped, time-boxed access to partners, clients, employees, AI agents | **Attestation chains**: parent-signed grants, verifiable by third parties with the root *public* key only |
| **Non-persistent keys** — private key material must never be stored on devices | **Seed-Derived Identity**: keys are recomputed from a seed phrase; only encrypted caches of derived material persist |
| **Privacy & trust** — requiring email/phone for registration | Anonymous, key-based authentication via seed phrases |
| **Paid APIs & agent commerce** — machine-to-machine micropayments for resources | **x402 v2 payment layer**: chain-agnostic `PaymentRequest`, chain `PaymentAdapter`s (Solana shipped), attestation-bound buyer/seller policy, HTTP-402 wire transport |

*This list is open: the protocol is a mechanism, not a product catalog. See the [use cases](#-use-cases) for the scenarios.*

### Core Architecture

```
Identity (Root — from seed phrase, private key stays in the vault)
  │
  ├─ Handle: @alice_work        ──→  Session → "work-app.com"
  ├─ Handle: @alice_private     ──→  Session → "messenger.app"
  │
  └─ Handle: station-001        ◀── attestHandle (signed by the root, issued once)
       │   (autonomous IoT device — works offline)
       ├─ SubHandle: connector-1   ◀── attestSubHandle (derived locally)
       └─ SubHandle: connector-2   (leaf, MAX_DEPTH = 2)
                             │
                             └─→ Session verified by ANY third party
                                 using only the root PUBLIC key
```

**Key properties:**
- 🔐 **Zero-knowledge** — private keys never leave the device
- 🔁 **Deterministic** — same seed + same name → same key (always)
- 🧩 **Isolated** — compromise of one Handle does not affect others
- 🌐 **Stateless** — servers verify signatures without database lookups
- 🔗 **Delegatable** — attestation chains carry signed grants (audiences, scopes, TTL caps, name patterns) enforced at verification time
- 🏗️ **Hierarchical** — `SubHandle` enables granular IoT/Enterprise access control
- 🔮 **Seed-derived** — the seed phrase is the only permanent carrier of identity; everything else is recomputed
- 🛡️ **Attested & revocable** — delegation is verifiable offline; revoking an attestation disables an entire branch instantly
- 💳 **Chain-agnostic payments** — `PaymentRequest` + `WalletAdapter`/`PaymentAdapter` contracts over a CAIP-2 registry; the x402 v2 transport moves signed artifacts; Solana ships first

---

## 📖 Terminology

Protocol terms are **domain-neutral** — each use case assigns them its own meaning. The eight core terms:

| Term | Definition |
|------|------------|
| **Identity** | Root cryptographic identity derived from a seed phrase. Constant forever. |
| **Handle** | A derived, attested, named key representing a distinct identity context. |
| **SubHandle** | A leaf child of a Handle (MAX_DEPTH = 2). |
| **Attestation** | A parent-signed statement binding a child key to a name and a grant. |
| **Session** | A stateless signed authorization token. |
| **Channel** | A long-lived E2EE relationship derived from an X3DH shared secret. |
| **Transient material** | Key bytes existing only in RAM at the moment of use. |
| **Ephemeral material** | TTL-bound rotating material (SPK/OTK, cache keys, session tokens). |

The **normative glossary** — full definitions, attestation grants, verification modes, crypto & react terms, wire limits, and domain interpretations per use case — lives in [`GLOSSARY.md`](./GLOSSARY.md).

---

## 🔤 Brand & Naming

The writing canon is **Me2eM**, and only two forms exist across the entire project:

| Form | Where it applies |
|------|------------------|
| **Me2eM** | Everything human-facing: prose, headings, logo, footer, meta tags, social media. The brand does not follow sentence position: just as "iPhone" stays "iPhone" at the start of a line, "Me2eM" never becomes "Me2em". |
| **me2em** | Machine contexts only, where casing is technically constrained: npm, code identifiers, domains, URLs, CLI. |

`Me2em` is a forbidden typo form: three coexisting spellings on a site on its way to being trilingual (where the Latin brand is not translated in ZH at all) is guaranteed chaos.

The canon governs human-facing text only. Existing code identifiers (e.g. `Me2emProvider`, `useMe2emContext`) are code artifacts — machine text is not translated, so they are not renamed.

---

## 📦 Repository Structure

This is a **pnpm monorepo** containing the Me2eM protocol implementation and documentation.

```
me2em-protocol/
├── packages/
│   ├── core/                    # 🧬 Core primitives + payment-layer contracts
│   │   ├── src/
│   │   │   ├── crypto/          # Ed25519, HKDF, derivation paths
│   │   │   ├── identity.ts      # Root Identity (+ attestHandle, bindWallet)
│   │   │   ├── handle.ts        # Contextual Handle (+ attestSubHandle)
│   │   │   ├── subhandle.ts     # Hierarchical SubHandle (leaf node)
│   │   │   ├── attestation.ts   # Parent-signed attestation chains
│   │   │   ├── session.ts       # Stateless sessions (verifyStateless + verifyAttested)
│   │   │   ├── payment.ts       # PaymentRequest/Result, Wallet/PaymentAdapter, CAIP-2 registry
│   │   │   ├── payment-x402.ts  # x402 v2 wire types + structural guards
│   │   │   ├── wallet-binding.ts# Default wallet↔entity binding check
│   │   │   ├── seed.ts          # BIP39 mnemonic utilities (+ passphrase)
│   │   │   └── index.ts         # Public API
│   │   ├── test/                # 447 tests
│   │   ├── README.md            # Package documentation
│   │   ├── USE_CASES.md         # Production examples
│   │   └── CHANGELOG.md         # Release notes
│   ├── crypto/                  # 🔐 Protocol crypto mechanisms
│   │   ├── src/
│   │   │   ├── x3dh/            # Canonical Signal X3DH + pre-key management
│   │   │   ├── channels/        # Long-lived E2EE channels, epoch rotation
│   │   │   ├── envelopes/       # X3DH key wrapping, media chunk encryption
│   │   │   ├── kdf/             # hashIdentityMaterial, Argon2id
│   │   │   ├── core/            # HKDF, X25519, AEAD, signatures, SLIP-0010, wipe
│   │   │   └── validation/      # Seed + password validation, HIBP
│   │   └── test/                # 200 tests
│   ├── react/                   # ⚛️ React bindings & UX components
│   │   ├── src/
│   │   │   ├── react/           # Hooks + seed phrase UX components
│   │   │   └── headless/        # Framework-agnostic logic (no React imports)
│   │   └── test/                # 117 tests
│   ├── x402/                    # 💳 x402 v2 payment transport (codec, pay-fetch, server helpers)
│   │   └── test/                # 93 tests
│   └── solana/                  # 💳 Solana chain adapter (wallet tree, verification, pay, x402 signer)
│       └── test/                # 184 tests
│
├── BACKLOG.md                   # Development backlog (advisory)
├── GLOSSARY.md                  # Normative glossary
├── THREAT_MODEL.md              # Assets, adversaries, mitigations, non-goals
├── PLAN-LTS-v1.md               # v1.0 program plan (hardening, LTS policy)
├── LTS-V1-REPORT.md             # v1.0 LTS readiness report
├── specs/                       # Normative specs: v1.0.md, test-vectors.json, tz-x402.md
├── README.md                    # This file
├── CONTRIBUTING.md              # How to contribute
├── GOVERNANCE.md                # Decision-making process
├── SECURITY.md                  # Responsible disclosure
├── CODE_OF_CONDUCT.md           # Community guidelines
├── LICENSE                      # Apache 2.0
├── package.json                 # Root workspace config
├── pnpm-workspace.yaml          # pnpm workspace definition
├── tsconfig.base.json           # Shared TypeScript config
└── typedoc.json                 # API documentation generator
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 22.6.0 (`engines.node` across the workspace)
- **pnpm** ≥ 9.0.0 — the repo pins `packageManager: pnpm@10.11.1`; `corepack enable` is the easiest path

### Installation

```bash
git clone https://github.com/me2em-org/me2em-protocol.git
cd me2em-protocol
pnpm install
pnpm -r build
pnpm -r test
```

---

## 📚 Use Cases

The protocol is domain-neutral: protocol terms (Handle, Attestation, Channel) are mechanical, and each scenario assigns them its own meaning. We document six use cases — the identity walkthrough below follows **UC-3**, and the payments walkthrough adds the payment layer on top of the same persona.

| # | Use case | Handle is… | Key mechanisms |
|---|----------|------------|----------------|
| **UC-1** | **AI Agent Delegation** | An AI agent acting on behalf of a user | `attestHandle` (the agent's mandate), `deriveSharedSecret` (agent ↔ known service), attestation revocation |
| **UC-2** | **IoT Device Hierarchy** | A physical device | `attestHandle`/`attestSubHandle` (provisioning), `deriveChannelKey` (owner ↔ device), offline sessions |
| **UC-3** | **Multi-Context Identity** | A user persona (work, personal) | `deriveHandle`/`deriveSubHandle`, `Session.create`, `verifyAttested` for external services |
| **UC-4** | **Multi-App SSO** | A per-app persona of the user | `Session.create` per app, HttpOnly instance cookie, shared revocation (Shared User Base) |
| **UC-5** | **Deterministic Password Manager** | A service context | `derivePassword` per service, Argon2id + HIBP guard rails |
| **UC-6** | **E2EE Messaging** | The user's messaging identity | `initiateX3DH`, channels with epoch rotation, envelopes |

> 📖 **More examples:** See [`packages/core/USE_CASES.md`](./packages/core/USE_CASES.md) for production-ready scenarios (Satellite Capacity Marketplace, Drone Fleet Management, Multi-App SSO, Deterministic Password Manager, E2EE Messenger).
>
> 💳 **Payments cut across all six:** any Handle can pay for or sell a resource — the payment layer (x402 v2 + Solana adapter) rides on top of the same seed-derived identity. See [Payment Layer](#-payment-layer).

---

## 🚀 Quick Start — UC-3: Multi-Context Identity

One scenario, three packages, end to end: a user with two personas (work and personal) creates sessions for each — and a partner service verifies them using only the root public key.

### Using `@me2em/core` — identity, handles, sessions

```typescript
import { Identity, Session, generateSeedPhrase, get64ByteSeedFromMnemonic } from '@me2em/core';

// 1. Identity from a seed phrase (or 64 raw bytes)
const phrase = generateSeedPhrase(128);            // 12 words — user writes them down
const seed = await get64ByteSeedFromMnemonic(phrase);
const identity = await Identity.fromSeed(seed);

// 2. Two personas: cryptographically isolated contexts
const workHandle = await identity.deriveHandle('work', {
  displayName: 'Alice @ Acme Corp'
});
const personalHandle = await identity.deriveHandle('personal');

// 3. A session for the work persona
const session = await Session.create(workHandle, {
  audience: 'work-app.com',
  scopes: ['read', 'write'],
  ttl: 1800
});

console.log('Token:', session.token);
```

*The work handle and the personal handle share nothing: compromising one reveals nothing about the other.*

### Using `@me2em/crypto` — an E2EE channel from the X3DH handshake

When the work persona needs an encrypted channel with a service that may be offline (or another persona's peer):

```typescript
import { initiateX3DH, establishChannel, encryptChannelMessage } from '@me2em/crypto';

// The peer publishes a PreKeyBundle; Alice initiates against it
const x3dh = await initiateX3DH(aliceIdentity, theirPreKeyBundle);
const channel = await establishChannel(x3dh.sharedSecret, 'chat-42');

const msg = await encryptChannelMessage(channel, 0, plaintext);
// send msg — the peer completes the same X3DH and decrypts
```

### Using `@me2em/react` — the same identity in a React app

```tsx
import { Me2emProvider, useCreateIdentity, SeedPhraseDisplay, SeedPhraseVerify } from '@me2em/react';

function App() {
  return <Me2emProvider><CreateIdentityScreen /></Me2emProvider>;
}

function CreateIdentityScreen() {
  const { status, seedWords, generate, confirmWords } = useCreateIdentity();

  if (status === 'idle') {
    return <button onClick={() => generate()}>Create identity</button>;
  }

  if (status === 'seed-generated' && seedWords) {
    return (
      <>
        {/* Shown exactly once; copy allowed once; then dismissed forever */}
        <SeedPhraseDisplay words={seedWords} />
        <SeedPhraseVerify realWords={seedWords} onVerified={confirmWords} />
      </>
    );
  }

  return <p>Identity ready</p>;
}
```

*Note: Me2eM never persists your seed. The seed phrase exists in two places only — your paper and transient memory during login. Browser storage holds only encrypted caches of derived material.*

### Using `@me2em/x402` + `@me2em/solana` — the same persona pays for an API resource

The work persona derives a deterministic Solana wallet from the **same 64-byte seed** — one seed phrase carries both the identity and the wallet — and pays an x402 v2 resource in one `fetch`-like call:

```typescript
import { SolanaWalletTree, SolanaX402Signer } from '@me2em/solana';
import { createPaymentFetch, readSettlement } from '@me2em/x402';

const tree = SolanaWalletTree.fromSeed(seed); // the same seed as Identity.fromSeed
const signer = new SolanaX402Signer({
  tree,
  index: 0,
  getRecentBlockhash: () => rpc.getLatestBlockhash(), // app-owned RPC — the signer has none
});
const pay = createPaymentFetch({ signer });

const res = await pay('https://api.example.com/premium/data'); // 402 → sign → replay once
const settle = readSettlement(res);
```

*The signer is offline by construction (blockhash by injection); settlement is confirmed by the facilitator and verified chain-side by `SolanaPaymentAdapter.verifyPayment`.*

📖 **Deeper scenarios:** [`packages/core/USE_CASES.md`](./packages/core/USE_CASES.md) — Satellite Capacity Marketplace, Drone Fleet Management, Multi-App SSO, Deterministic Password Manager, E2EE Messenger.

---

## 📚 Packages

| Package | Status | Description |
|---------|--------|-------------|
| [`@me2em/core`](./packages/core) | 🔐 **rc (v1.0.0-rc.7)** | Core primitives: `Identity`, `Handle`, `SubHandle`, `Session`, `Attestation` + payment-layer contracts (`PaymentRequest`, adapters, CAIP-2 registry, x402 v2 wire types) |
| [`@me2em/crypto`](./packages/crypto) | 🔐 **rc (v1.1.0-rc.2)** | Protocol crypto: canonical X3DH, E2EE channels with epoch rotation, envelopes, Argon2id, SLIP-0010 ed25519 derivation |
| [`@me2em/react`](./packages/react) | 🔐 **rc (v1.0.0-rc.4)** | React bindings: identity lifecycle hooks, seed phrase UX components, session management, encrypted context cache |
| [`@me2em/x402`](./packages/x402) | 🔐 **rc (v1.0.0-rc.1)** | x402 v2 payment transport: base64 header codec, payment-aware `fetch` client, server helpers, `extra.me2em`, facilitator contract |
| [`@me2em/solana`](./packages/solana) | 🔐 **rc (v1.1.0-rc.1)** | Solana chain adapter: SLIP-0010 wallet tree, wallet/payment adapters, on-chain verification, `pay`, x402 `PaymentSigner` |
| `@me2em/facilitator` | 🚧 Planned | Self-hosted x402 facilitator (verify/settle); `FacilitatorClient` is contract-only in `@me2em/x402` |
| `@me2em/messenger` | 🚧 Planned (0.9) | Vertical: E2EE chats, groups with epoch key rotation |
| `@me2em/iot` | 💤 Deferred | Vertical: managed attested devices (EV, drones) |
| `@me2em/server` | 🚧 Planned | Reference NestJS backend: verification middleware, revocation store |

### `@me2em/core` — Current Features

| Feature | Status | Description |
|---------|--------|-------------|
| `Identity` | ✅ | Root identity from 64-byte seed (or BIP39 phrase) |
| `Handle` | ✅ | Contextual Ed25519 keypair |
| `SubHandle` | ✅ | Hierarchical leaf node (MAX_DEPTH = 2) |
| `Session` | ✅ | Stateless tokens — `verifyStateless` (direct) + `verifyAttested` (chain) |
| **`Attestation`** | ✅ | Parent-signed grants: audiences, scopes, TTL caps, name wildcards; offline third-party verification; branch revocation |
| `RevocationChecker` | ✅ | Optional interface — covers session **and** attestation `jti` |
| `derivePassword` | ✅ | Deterministic password derivation |
| `deriveChannelKey` | ✅ | Symmetric key for encrypted channels |
| `deriveSharedSecret` | ✅ | X25519 ECDH with peer-key binding (UKS-safe, `p2p-channel/v2`) |
| BIP39 utilities | ✅ | 12/24-word mnemonic + passphrase ("25th word") support |
| **Payment contracts** | ✅ | `PaymentRequest`/`PaymentResult` (12 failure reasons, fail-closed), `WalletDescriptor`, `Me2emExtra` |
| **Adapter registry** | ✅ | `WalletAdapter`/`PaymentAdapter` + process-wide CAIP-2 registry (`registerWalletAdapter`/`getWalletAdapter`, last-wins per chain) |
| **Wallet binding** | ✅ | `verifyWalletBinding` default (issuer signature → subject agreement → address equality), `bindWallet`/`getWallet` on `Identity`/`Handle` |
| **x402 v2 wire** | ✅ | `X402PaymentRequired`/`Requirements`/`Payload`/`SettleResponse`/…, `X402_VERSION = 2`, never-throwing `isX402*` guards |

### `@me2em/crypto` — Current Features

| Feature | Status | Description |
|---------|--------|-------------|
| **X3DH** | ✅ | Canonical Signal key agreement (initiate + complete), OTK mandatory — no zero-fallback |
| **Pre-Keys** | ✅ | Signed Pre-Keys + One-Time Pre-Keys: generation, batch, bundle publishing, replay guard |
| **Channels** | ✅ | Long-lived E2EE: per-message HKDF keys, strictly-increasing replay protection, epoch rotation (forward secrecy at rotation points) |
| **Envelopes** | ✅ | X3DH key wrapping for offline recipients (self-contained); deterministic-IV media chunk encryption |
| **Argon2id** | ✅ | Password KDF with named profiles (INTERACTIVE / SENSITIVE) + verification |
| **Validation** | ✅ | BIP39 seed validation (extended result), password strength + HIBP breach check |
| **Core primitives** | ✅ | HKDF (RFC 5869 verified), X25519 ECDH (UKS-safe), AES-256-GCM, raw Ed25519 signatures, secure wipe |
| **SLIP-0010** | ✅ | ed25519 hierarchical derivation, hardened-only (official Test Vectors 1 & 2 verbatim) — the `crypto.slip10` namespace behind `@me2em/solana` wallet trees |

### `@me2em/react` — Current Features

| Feature | Status | Description |
|---------|--------|-------------|
| Identity hooks | ✅ | `useCreateIdentity`, `useImportSeed`, `useHandle`, `useSubHandle` |
| **Seed UX components** | ✅ | `SeedPhraseDisplay` (show-once, single copy), `SeedPhraseVerify` (order-verification grid), `SeedPhraseImport` (per-word validation), `PassphraseInput` |
| Session management | ✅ | `useSession` — create, auto-renew at half-life, expiry tracking |
| Encrypted context cache | ✅ | `useIdentityContext` + per-identity IndexedDB isolation, non-extractable persisted CryptoKey |
| Headless layer | ✅ | Framework-agnostic state machines (no React imports) — future `@me2em/sdk` |

### `@me2em/x402` — Current Features

| Feature | Status | Description |
|---------|--------|-------------|
| Header codec | ✅ | `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` — base64, pinned to the upstream x402 v2 golden vectors |
| Payment client | ✅ | `createPaymentFetch` — 402 → sign (exactly once) → replay; never pays twice |
| Server helpers | ✅ | `paymentRequiredResponse`, `readPaymentHeader`, `settlementHeader`, `assertValidX402Config` |
| `extra.me2em` | ✅ | `withMe2emExtra`/`readMe2emExtra` — Me2eM metadata on the x402 wire |
| Facilitator | ✅ | `FacilitatorClient` contract + opt-in `B402Facilitator` (`@me2em/x402/b402`, `@experimental`) |

### `@me2em/solana` — Current Features

| Feature | Status | Description |
|---------|--------|-------------|
| Wallet tree | ✅ | `SolanaWalletTree.fromSeed` — `m/44'/501'/{i}'/0'` SLIP-0010 over the Identity seed; `nextPaymentIndex` allocation |
| Wallet/payment adapters | ✅ | `SolanaWalletAdapter` + `SolanaPaymentAdapter` per exact CAIP-2 chain; `registerSolanaAdapters` |
| On-chain verification | ✅ | `verifyPayment` — normative order `NOT_FOUND → REFERENCE_MISMATCH → EXPIRED → REPLAYED → WRONG_RECIPIENT → UNDERPAID`; on-curve `verifyWalletBinding` |
| Payment submission | ✅ | `pay` — SOL-only, seed per call, `reference` rides the transaction |
| External wallets | ✅ | `createPaymentRequestURL` (Solana Pay URI) + `createPaymentReference` |
| x402 signer | ✅ | `SolanaX402Signer` — offline legacy-transfer signing, blockhash by injection, `@experimental` payload convention |

---

## 🔗 Attestations — delegatable trust in one minute

A parent **attests** a child key:

> “public key `K` belongs to name `N`, valid within grant `G`, until time `T`.”

Any third party verifies the chain with the **root public key only** — offline, no database. Revoking an attestation `jti` disables the entire branch: current **and** future sessions. Revoking the chain of an AI agent disables that agent. Revoking the chain of a charging station disables the station.

| | `verifyStateless` (direct) | `verifyAttested` (attested) |
|---|---|---|
| Verifier needs | `Identity` (**private** root) | root **public** key + chain |
| Use when | your own trusted backend | external audiences, delegation, selling access |

**Full guide:** [`packages/core/README.md` → Attestations](./packages/core/README.md#-attestations-verifiable-delegation).

---

## 💳 Payment Layer

The newest protocol track: a chain-agnostic payment stack that reuses the seed-derived identity — the buyer is a Handle with a bound wallet, the seller is an attested entity, and the x402 v2 wire format carries the signed artifacts over plain HTTP.

```text
PaymentRequest (core contracts)
        │
        ├──▶ PaymentAdapter (one per exact CAIP-2 chain)
        │         ├─ pay(from, request, opts)          → txRef
        │         └─ verifyPayment(txRef, request)     → success | failure{
        │               NOT_FOUND → REFERENCE_MISMATCH → EXPIRED → REPLAYED
        │               → WRONG_RECIPIENT → UNDERPAID }        (normative order)
        │
        └──▶ x402 v2 transport (@me2em/x402): HTTP 402 handshake,
             PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE headers
```

- **[`@me2em/core`](./packages/core)** — the contracts: `PaymentRequest`, `PaymentResult`, `WalletAdapter`/`PaymentAdapter`, the CAIP-2 adapter registry, wallet binding (`verifyWalletBinding`), and the x402 v2 wire types with structural guards. No network, no chain code.
- **[`@me2em/x402`](./packages/x402)** — the transport: header codec, payment-aware `fetch` client, server helpers, `extra.me2em`. *Transport, not policy:* who pays is attestation/Pact, how much is `PaymentRequest`, how it executes is an adapter, who confirms is the facilitator.
- **[`@me2em/solana`](./packages/solana)** — the first chain: deterministic wallet trees derived from the **same 64-byte seed** as the identity (`m/44'/501'/…'`), on-chain verification in the normative failure order, programmatic `pay` (SOL-only, seed per call), external-wallet URLs, and the offline x402 `PaymentSigner`.

Spec: [`specs/tz-x402.md`](./specs/tz-x402.md) (x402 v2 ТЗ, pinned to the upstream spec's golden vectors); package guides: [`packages/x402/README.md`](./packages/x402/README.md) · [`packages/solana/README.md`](./packages/solana/README.md).

---

## 🔐 Cryptographic Constants

All derivation paths are centralized in `packages/core/src/crypto/derivation-paths.ts`:

```typescript
DERIVATION_PATHS.identity       // "me2em/identity/v1/root"
DERIVATION_PATHS.handle(name)   // "me2em/handle/v1/{name}"
DERIVATION_PATHS.subhandle(h, s) // "me2em/subhandle/v1/{h}/{s}"
DERIVATION_PATHS.p2pChannelV2   // "me2em/p2p-channel/v2" (peer-key bound)
```

⚠️ **Changing any of these strings is a BREAKING CHANGE** and requires a new protocol version.

Solana wallet paths are centralized in `@me2em/solana` (`wallet-tree.ts`): `m/44'/501'/{index}'/0'` — SLIP-0010 ed25519 over the same 64-byte seed as `Identity.fromSeed`. Changing them belongs to the same BREAKING-change class.

---

## 📐 Standards Compliance

Me2eM does not invent cryptographic primitives: every mechanism is built on an established, peer-reviewed standard, used with its documented parameters. This table is the ecosystem-wide mapping of *standard → role → package*; new mechanisms must land here together with their standard.

| Standard / Spec | Role in Me2eM | Packages |
|---|---|---|
| **BIP39** | Mnemonic seed phrases → 64-byte seed (PBKDF2-HMAC-SHA512, 2048 iterations); optional "25th word" passphrase | core |
| **Ed25519** (RFC 8032) | All signatures: attestations, sessions, raw signing | core, crypto |
| **X25519** (RFC 7748) | ECDH for shared secrets and channel keys; Ed25519↔X25519 conversion | core, crypto |
| **HKDF** (RFC 5869) | All key derivation (HKDF-SHA256) with domain-separated `me2em/…/v1` info strings | core, crypto |
| **Argon2id** (RFC 9106) | Password-based KDF, `INTERACTIVE`/`SENSITIVE` profiles | crypto |
| **X3DH** (Signal) | Asynchronous key establishment with offline recipients: `PreKeyBundle` (SPK + OTK), signed pre-keys, key wrapping | crypto |
| **AES-GCM** (NIST SP 800-38D) | AEAD for E2EE channels, key envelopes, and the identity context cache | crypto, react |
| **Base64URL** (RFC 4648 §5) | Token and payload encoding | core, crypto |
| **Unicode NFKC** (UAX #15) | Canonical normalization of names, passphrases, and derivation contexts | core |
| **CAIP-2** | Chain identity: exact `namespace:reference` ids as adapter-registry keys and attestation `subjectWalletChain` values | core, solana |
| **BIP32 / SLIP-0010** | Hierarchical deterministic derivation (ed25519, hardened-only) — Solana wallet trees below the root identity | crypto, solana |
| **Base58** (Bitcoin) | Solana address/reference encoding — 32-byte keys, no checksum | solana |
| **Solana legacy wire format** | Hand-assembled system-transfer transaction in the x402 signer (151-byte message, golden-vector pinned) | solana |
| **JSON-RPC 2.0** | Solana RPC transport (`getTransaction`, `sendTransaction`, …) in the minimal `RpcClient` | solana |

Any deviation from a standard's parameters is a protocol-level decision, recorded in the package CHANGELOG and in the protocol specifications ([Protocol Specifications](#-protocol-specifications)).

---

## 🛠️ Development

### Available Scripts

```bash
pnpm -r build          # Build all packages (topological: core first)
pnpm -r test           # Run tests across all packages
pnpm typecheck         # TypeScript check across all packages
pnpm build-docs        # Generate API docs for every package

# For a specific package:
pnpm --filter @me2em/core test
pnpm --filter @me2em/crypto test
pnpm --filter @me2em/react test
```

### Testing

**1 041 tests** across 75 test files (vitest, five packages; 2 devnet-dependent cases skip outside CI):

- **core — 447**: derivation & canonical names, derivation revisions (r1 byte-parity, r2 independence, NFKC contexts), session lifecycle (create, verify, tamper, expiry, revocation), SubHandle constraints and leaf enforcement, attestation issuance/decode/determinism, the full attested-verification chain (nesting, wildcards, revocation at every level, signature robustness), BIP39 passphrase & wordlist, module-structure and crypto-boundary pins, parser fuzz — plus the payment surface (`PaymentRequest`/`PaymentResult`, adapter-registry last-wins, CAIP-2 grammar, `isX402*` guards against upstream vectors, `verifyWalletBinding`, `bindWallet`/`getWallet`)
- **crypto — 200**: HKDF (RFC 5869 vectors), X25519 ECDH (symmetry, full-32B pin), AEAD tamper cases, Argon2id profiles, seed & password validation (HIBP), canonical X3DH (roundtrip, MITM defense, canonical-order pin, no-OTK rejection), pre-key batches, channels (replay, epoch forward secrecy), envelopes (self-contained unwrap, deterministic-IV isolation), SLIP-0010 (official Test Vectors 1 & 2 verbatim + hardened-only negatives)
- **react — 117**: identity flow state machines, seed verification grid, Provider lifecycle, context cache isolation (two identities, one device), session auto-renewal, component suites
- **x402 — 93**: codec against the upstream x402 v2 golden vectors (well-formed, malformed, oversized, wrong-version), client behavior (pass-through, single replay, error codes, signer rejection with cause), server helpers, `extra.me2em` roundtrips, facilitator contract
- **solana — 184**: wallet-tree determinism over SLIP-0010, adapter registry, URL/reference encoding, `verifyPayment` normative order (every failure reason), `pay` (seed-per-call, reference containment), x402 signer golden vectors (151-byte message / 216-byte transaction), `RpcClient` with injected fetch, on-curve wallet binding

### Code Style

- **TypeScript** strict mode · **ESLint** + **Prettier**
- **TSDoc** on all public APIs — generated **per package**: [core.me2em.com](https://core.me2em.com) · [crypto.me2em.com](https://crypto.me2em.com) · [react.me2em.com](https://react.me2em.com) · [x402.me2em.com](https://x402.me2em.com) · [solana.me2em.com](https://solana.me2em.com) — zero-warning builds

---

## 📖 Documentation

| Resource | Link |
|----------|------|
| **Core package README** (attestation guide + error table) | [`packages/core/README.md`](./packages/core/README.md) |
| **Crypto package README** (X3DH, channels, envelopes) | [`packages/crypto/README.md`](./packages/crypto/README.md) |
| **React package README** (hooks, components, context cache) | [`packages/react/README.md`](./packages/react/README.md) |
| **x402 package README** (codec, client, server helpers, facilitator contract) | [`packages/x402/README.md`](./packages/x402/README.md) |
| **Solana package README** (wallet tree, verification, pay, x402 signer) | [`packages/solana/README.md`](./packages/solana/README.md) |
| **Use Cases Guide** | [`packages/core/USE_CASES.md`](./packages/core/USE_CASES.md) |
| **Payment-layer spec (x402 v2 ТЗ)** | [`specs/tz-x402.md`](./specs/tz-x402.md) |
| **Threat Model** (assets, adversary, mitigations, non-goals) | [`THREAT_MODEL.md`](./THREAT_MODEL.md) |
| **Security Policy** (reporting, 7-day critical SLA) | [`SECURITY.md`](./SECURITY.md) |
| **Development Backlog** | [`BACKLOG.md`](./BACKLOG.md) |
| **Changelog (core)** | [`packages/core/CHANGELOG.md`](./packages/core/CHANGELOG.md) |
| **Changelog (react)** | [`packages/react/CHANGELOG.md`](./packages/react/CHANGELOG.md) |
| **Changelogs (crypto / x402 / solana)** | [`crypto`](./packages/crypto/CHANGELOG.md) · [`x402`](./packages/x402/CHANGELOG.md) · [`solana`](./packages/solana/CHANGELOG.md) |
| **Glossary (normative)** | [`GLOSSARY.md`](./GLOSSARY.md) |
| **API Reference** | [core.me2em.com](https://core.me2em.com) · [crypto.me2em.com](https://crypto.me2em.com) · [react.me2em.com](https://react.me2em.com) |

---

## 🔐 Security

- ✅ **Ed25519** signatures (RFC 8032) — fast, widely audited
- ✅ **HKDF-SHA256** derivation with strict domain separation
- ✅ **Peer-key binding** in ECDH channel derivation (UKS protection)
- ✅ **Private key encapsulation** — keys never leave their owning class
- ✅ **Canonical name normalization** (NFKC) — no homoglyph or separator collisions
- ✅ **Canonical X3DH** — OTK mandatory, SPK signature verified (MITM defense)
- ✅ **Stateless verification** — no server-side session state to compromise
- ✅ **Fail-closed payments** — verification outcomes are explicit `PaymentResult`s; unknown failure reasons are treated as `REJECTED`, never as success; the x402 signer takes the blockhash by injection (no RPC of its own) and descriptors never carry key material

Threats, mitigations and accepted residual risks are documented in
[`THREAT_MODEL.md`](./THREAT_MODEL.md). For security concerns or to
report vulnerabilities, see [`SECURITY.md`](./SECURITY.md).

---

## 🤝 Contributing

We welcome contributions! Please read:

- 📄 [`CONTRIBUTING.md`](./CONTRIBUTING.md) — How to contribute code and docs
- 🗳️ [`GOVERNANCE.md`](./GOVERNANCE.md) — Project decision-making process
- 🔐 [`SECURITY.md`](./SECURITY.md) — Responsible disclosure policy
- 📜 [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — Community guidelines

---

## 🌍 Roadmap

| Period | Milestone |
|--------|-----------|
| **Shipped** | `@me2em/core` 0.6–0.7 alpha — attestations, verification modes, passphrase, UKS-safe channels |
| **Shipped** | `@me2em/react` 0.1 alpha — identity hooks, seed UX, session management, context cache |
| **Shipped** | `@me2em/crypto` 0.1 alpha — X3DH, E2EE channels, envelopes, Argon2id guard rails |
| **Shipped** | [me2em.com](https://me2em.com) — protocol blog: guides, tutorials, deep dives (RU) |
| **Shipped** | `1.0.0-rc.1` — release-candidate line adopted (specs/v1.0.md §12), threat model, LTS security policy |
| **Shipped** | Payment layer M0–M2 — `@me2em/core` rc.5–rc.7 (contracts + x402 v2 wire), `@me2em/x402` 1.0.0-rc.1 (transport), `@me2em/solana` 1.1.0-rc.1 (chain adapter: wallet tree, verification, pay, x402 signer), `@me2em/crypto` 1.1.0-rc.1 (SLIP-0010) |
| **Next** | DevSecOps hardening — branch protection, coverage thresholds (CI pipeline live) |
| **Next** | `@me2em/facilitator` — self-hosted x402 verify/settle service; SPL (token) transfers in `@me2em/solana` |
| **Next** | `@me2em/messenger` (0.9) — first vertical; `@me2em/server` reference backend |
| **Next** | `@me2em/core` v1.0.0 GA — opens the 24-month LTS support window (7-day critical SLA) |
| **Later** | ZK-proof integration (anonymous attribute verification) |

Forward-looking items: [BACKLOG.md](./BACKLOG.md).

---

## 📜 Protocol Specifications

The normative, implementation-independent specification lives in **[`specs/v1.0.md`](./specs/v1.0.md)** (v1.0 program): derivation formulas and info strings, token formats, payload schemas, both verification modes, limits, and the issuance/Signer contract. Its machine-checkable form is **[`specs/test-vectors.json`](./specs/test-vectors.json)** — real conformance vectors regenerated by `packages/core/scripts/generate-vectors.ts` and enforced by the golden test `packages/core/test/vectors.spec.ts`. The pre-attestation draft was removed from the working tree (DR-7; retrievable from git history); the OpenAPI server spec remains planned (BL-22, with `@me2em/server`).

The payment layer is specified separately: **[`specs/tz-x402.md`](./specs/tz-x402.md)** — the x402 v2 transport ТЗ (codec, client/server orchestration, facilitator contract, `extra.me2em`), implemented by `@me2em/x402` and `@me2em/solana` and pinned to the upstream x402 v2 golden vectors (upstream commit `51a0664c`, 2026-10-26).

---

## 📜 License

This project is licensed under the **Apache License 2.0** — see the [`LICENSE`](./LICENSE) file for details.

```
Copyright 2026 Me2eM Organization

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

---

## 🙏 Acknowledgments

Me2eM builds on the shoulders of giants:

- [`@noble/curves`](https://github.com/paulmillr/noble-curves) — Audited Ed25519/X25519 implementations
- [`@noble/ed25519`](https://github.com/paulmillr/noble-ed25519) — Ed25519 (legacy sync path)
- [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) — HKDF, SHA-256
- [`@scure/bip39`](https://github.com/paulmillr/scure-bip39) — BIP39 mnemonic support
- [`@scure/base`](https://github.com/paulmillr/scure-base) — base58 encoding (Solana addresses, payment references)
- [`@solana/kit`](https://github.com/anza-xyz/kit) — Solana RPC client and transaction submission (`pay` path)
- [`@solana-program/system`](https://github.com/solana-program/system) / [`@solana-program/memo`](https://github.com/solana-program/memo) — program clients for transfer and memo instructions
- [`hash-wasm`](https://github.com/Daninet/hash-wasm) — Argon2id (WASM)
- [`fake-indexeddb`](https://github.com/dumbmatter/fakeIndexedDB) — IndexedDB test double
- [`tsup`](https://tsup.egoist.dev/) / [`typedoc`](https://typedoc.org/) / [`vitest`](https://vitest.dev/) — Build, docs, and test tooling

---

**Built for privacy, openness, and user sovereignty.** 🌐

🔗 [github.com/me2em-org](https://github.com/me2em-org) · [core.me2em.com](https://core.me2em.com) · [crypto.me2em.com](https://crypto.me2em.com) · [react.me2em.com](https://react.me2em.com) · [me2em.com](https://me2em.com)