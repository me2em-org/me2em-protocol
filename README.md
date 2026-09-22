# 🌐 Me2em Protocol

**A decentralized, seed-derived identity and authorization protocol built on Ed25519 cryptography.**

[![CI & Security](https://github.com/me2em-org/me2em-protocol/actions/workflows/ci-security.yml/badge.svg)](https://github.com/me2em-org/me2em-protocol/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![npm org](https://img.shields.io/badge/npm-@me2em-cb3837?logo=npm)](https://www.npmjs.com/org/me2em)
[![Docs](https://img.shields.io/badge/docs-me2em.com%2Fdocs-blue)](https://me2em.com/docs)

---

## 🎯 What is Me2em?

Me2em is a **cryptographic identity protocol**: a set of formats, derivation rules, and verification procedures that let independent implementations establish authenticated, delegatable, end-to-end encrypted relationships — without ever persisting a private key.

The protocol addresses a growing class of problems in identity and authorization. Today these include:

| Problem | Me2em Solution |
|---------|----------------|
| **Context collision** — one profile for everything (work, personal, IoT, agents) | Multiple isolated `Handle`s per `Identity`, each with its own keypair |
| **IoT scalability** — managing thousands of devices | Hierarchical derivation: `Identity` → `Handle` → `SubHandle` (MAX_DEPTH = 2), fully offline |
| **Delegatable trust** — granting scoped, time-boxed access to partners, clients, employees, AI agents | **Attestation chains**: parent-signed grants, verifiable by third parties with the root *public* key only |
| **Non-persistent keys** — private key material must never be stored on devices | **Seed-Derived Identity**: keys are recomputed from a seed phrase; only encrypted caches of derived material persist |
| **Privacy & trust** — requiring email/phone for registration | Anonymous, key-based authentication via seed phrases |

*This list is open: the protocol is a mechanism, not a product catalog. See the [use cases](#-use-cases) for the three scenarios we document today — and note that new ones (e.g. AI agent authentication) map naturally onto the same primitives.*

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

---

## 📖 Terminology

Protocol terms are **domain-neutral** — each use case assigns them its own meaning.

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

**Domain interpretations** — the same primitives, read through different lenses:

| Use case | Handle is… | SubHandle is… |
|----------|------------|----------------|
| **AI Agent Delegation** | An AI agent acting on behalf of a user | A capability of that agent |
| **IoT Device Hierarchy** | A physical device | A component of that device |
| **Multi-Context Identity** | A user persona (work, personal) | Delegated access within a persona |

Full glossary and the method-to-relationship map: see the [Terminology section](#-use-cases) and each package README.

---

## 📦 Repository Structure

This is a **pnpm monorepo** containing the Me2em protocol implementation and documentation.

```
me2em-protocol/
├── packages/
│   ├── core/                    # 🧬 Core cryptographic primitives
│   │   ├── src/
│   │   │   ├── crypto/          # Ed25519, HKDF, derivation paths
│   │   │   ├── identity.ts      # Root Identity (+ attestHandle)
│   │   │   ├── handle.ts        # Contextual Handle (+ attestSubHandle)
│   │   │   ├── subhandle.ts     # Hierarchical SubHandle (leaf node)
│   │   │   ├── attestation.ts   # Parent-signed attestation chains
│   │   │   ├── session.ts       # Stateless sessions (verifyStateless + verifyAttested)
│   │   │   ├── seed.ts          # BIP39 mnemonic utilities (+ passphrase)
│   │   │   └── index.ts         # Public API
│   │   ├── test/                # 186 tests
│   │   ├── README.md            # Package documentation
│   │   ├── USE_CASES.md         # Production examples
│   │   └── CHANGELOG.md         # Release notes
│   ├── crypto/                  # 🔐 Protocol crypto mechanisms
│   │   ├── src/
│   │   │   ├── x3dh/            # Canonical Signal X3DH + pre-key management
│   │   │   ├── channels/        # Long-lived E2EE channels, epoch rotation
│   │   │   ├── envelopes/       # X3DH key wrapping, media chunk encryption
│   │   │   ├── kdf/             # hashIdentityMaterial, Argon2id
│   │   │   ├── core/            # HKDF, X25519, AEAD, signatures, wipe
│   │   │   └── validation/      # Seed + password validation, HIBP
│   │   └── test/                # 151 tests
│   └── react/                   # ⚛️ React bindings & UX components
│       ├── src/
│       │   ├── react/           # Hooks + seed phrase UX components
│       │   └── headless/        # Framework-agnostic logic (no React imports)
│       └── test/                # 101 tests
│
├── BACKLOG.md                   # Development backlog (advisory)
├── specs/draft/                 # Archived pre-attestation spec drafts
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

- **Node.js** ≥ 20.0.0 (LTS recommended)
- **pnpm** ≥ 9.0.0 (`npm install -g pnpm`) — or use `corepack enable`

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

The protocol is domain-neutral: protocol terms (Handle, Attestation, Channel) are mechanical, and each scenario assigns them its own meaning. We document three use cases — and **all Quick Start examples below follow UC-3** for a consistent, end-to-end walkthrough across all three packages.

| # | Use case | Handle is… | Key mechanisms |
|---|----------|------------|----------------|
| **UC-1** | **AI Agent Delegation** | An AI agent acting on behalf of a user | `attestHandle` (the agent's mandate), `deriveSharedSecret` (agent ↔ known service), attestation revocation |
| **UC-2** | **IoT Device Hierarchy** | A physical device | `attestHandle`/`attestSubHandle` (provisioning), `deriveChannelKey` (owner ↔ device), offline sessions |
| **UC-3** | **Multi-Context Identity** | A user persona (work, personal) | `deriveHandle`/`deriveSubHandle`, `Session.create`, `verifyAttested` for external services |

> 📖 **More examples:** See [`packages/core/USE_CASES.md`](./packages/core/USE_CASES.md) for production-ready scenarios (EV Charging Stations, Drone Fleet access marketplace, Corporate Messengers).

---

## 🚀 Quick Start — UC-3: Multi-Context Identity

One scenario, three packages, end to end: a user with two personas (work and personal) creates sessions for each — and a partner service verifies them using only the root public key.

### Using `@me2em/core` — identity, handles, sessions

```typescript
import { Identity, generateSeedPhrase, get32ByteSeedFromMnemonic } from '@me2em/core';

// 1. Identity from a seed phrase (or 32 raw bytes)
const phrase = generateSeedPhrase(128);            // 12 words — user writes them down
const seed = await get32ByteSeedFromMnemonic(phrase);
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

*Note: Me2em never persists your seed. The seed phrase exists in two places only — your paper and transient memory during login. Browser storage holds only encrypted caches of derived material.*

📖 **Deeper scenarios:** [`packages/core/USE_CASES.md`](./packages/core/USE_CASES.md) — EV Charging Stations, Drone Fleet access marketplace, Corporate Messengers.

---

## 📚 Packages

| Package | Status | Description |
|---------|--------|-------------|
| [`@me2em/core`](./packages/core) | 🧪 **alpha (v0.7.0-alpha.1)** | Core primitives: `Identity`, `Handle`, `SubHandle`, `Session`, `Attestation` |
| [`@me2em/crypto`](./packages/crypto) | 🧪 **alpha (v0.1.0-alpha.1)** | Protocol crypto: canonical X3DH, pre-keys, E2EE channels with epoch rotation, envelopes, Argon2id |
| [`@me2em/react`](./packages/react) | 🧪 **alpha (v0.1.0-alpha.1)** | React bindings: identity lifecycle hooks, seed phrase UX components, session management, encrypted context cache |
| `@me2em/messenger` | 🚧 Planned (0.9) | Vertical: E2EE chats, groups with epoch key rotation |
| `@me2em/iot` | 💤 Deferred | Vertical: managed attested devices (EV, drones) |
| `@me2em/server` | 🚧 Planned | Reference NestJS backend: verification middleware, revocation store |

### `@me2em/core` — Current Features

| Feature | Status | Description |
|---------|--------|-------------|
| `Identity` | ✅ | Root identity from 32-byte seed (or BIP39 phrase) |
| `Handle` | ✅ | Contextual Ed25519 keypair |
| `SubHandle` | ✅ | Hierarchical leaf node (MAX_DEPTH = 2) |
| `Session` | ✅ | Stateless tokens — `verifyStateless` (direct) + `verifyAttested` (chain) |
| **`Attestation`** | ✅ | Parent-signed grants: audiences, scopes, TTL caps, name wildcards; offline third-party verification; branch revocation |
| `RevocationChecker` | ✅ | Optional interface — covers session **and** attestation `jti` |
| `derivePassword` | ✅ | Deterministic password derivation |
| `deriveChannelKey` | ✅ | Symmetric key for encrypted channels |
| `deriveSharedSecret` | ✅ | X25519 ECDH with peer-key binding (UKS-safe, `p2p-channel/v2`) |
| BIP39 utilities | ✅ | 12/24-word mnemonic + passphrase ("25th word") support |

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

### `@me2em/react` — Current Features

| Feature | Status | Description |
|---------|--------|-------------|
| Identity hooks | ✅ | `useCreateIdentity`, `useImportSeed`, `useHandle`, `useSubHandle` |
| **Seed UX components** | ✅ | `SeedPhraseDisplay` (show-once, single copy), `SeedPhraseVerify` (order-verification grid), `SeedPhraseImport` (per-word validation), `PassphraseInput` |
| Session management | ✅ | `useSession` — create, auto-renew at half-life, expiry tracking |
| Encrypted context cache | ✅ | `useIdentityContext` + per-identity IndexedDB isolation, non-extractable persisted CryptoKey |
| Headless layer | ✅ | Framework-agnostic state machines (no React imports) — future `@me2em/sdk` |

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

## 🔐 Cryptographic Constants

All derivation paths are centralized in `packages/core/src/crypto/derivation-paths.ts`:

```typescript
DERIVATION_PATHS.identity       // "me2em/identity/v1/root"
DERIVATION_PATHS.handle(name)   // "me2em/handle/v1/{name}"
DERIVATION_PATHS.subhandle(h, s) // "me2em/subhandle/v1/{h}/{s}"
DERIVATION_PATHS.p2pChannelV2   // "me2em/p2p-channel/v2" (peer-key bound)
```

⚠️ **Changing any of these strings is a BREAKING CHANGE** and requires a new protocol version.

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

**438 tests** across 38 suites (vitest, three packages):

- **core — 186**: derivation & canonical names, session lifecycle (create, verify, tamper, expiry, revocation), SubHandle constraints and leaf enforcement, attestation issuance/decode/determinism, the full attested-verification chain (nesting, wildcards, revocation at every level, signature robustness), BIP39 passphrase & wordlist
- **crypto — 151**: HKDF (RFC 5869 vectors), X25519 ECDH (symmetry, full-32B pin), AEAD tamper cases, Argon2id profiles, seed & password validation (HIBP), canonical X3DH (roundtrip, MITM defense, canonical-order pin, no-OTK rejection), pre-key batches, channels (replay, epoch forward secrecy), envelopes (self-contained unwrap, deterministic-IV isolation)
- **react — 101**: identity flow state machines, seed verification grid, Provider lifecycle, context cache isolation (two identities, one device), session auto-renewal, component suites

### Code Style

- **TypeScript** strict mode · **ESLint** + **Prettier**
- **TSDoc** on all public APIs — generated **per package**: [core.me2em.com](https://core.me2em.com) · [crypto.me2em.com](https://crypto.me2em.com) · [react.me2em.com](https://react.me2em.com) — zero-warning builds

---

## 📖 Documentation

| Resource | Link |
|----------|------|
| **Core package README** (attestation guide + error table) | [`packages/core/README.md`](./packages/core/README.md) |
| **Crypto package README** (X3DH, channels, envelopes) | [`packages/crypto/README.md`](./packages/crypto/README.md) |
| **React package README** (hooks, components, context cache) | [`packages/react/README.md`](./packages/react/README.md) |
| **Use Cases Guide** | [`packages/core/USE_CASES.md`](./packages/core/USE_CASES.md) |
| **Development Backlog** | [`BACKLOG.md`](./BACKLOG.md) |
| **Changelog (core)** | [`packages/core/CHANGELOG.md`](./packages/core/CHANGELOG.md) |
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

For security concerns or to report vulnerabilities, see [`SECURITY.md`](./SECURITY.md).

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
| **Shipped** | `@me2em/crypto` 0.1 alpha — canonical X3DH, pre-keys, channels with epoch rotation, envelopes, Argon2id |
| **Next** | DevSecOps hardening — branch protection, coverage thresholds (CI pipeline live) |
| **Next** | `@me2em/messenger` (0.9) — first vertical; `@me2em/server` reference backend |
| **Q1 2027** | [me2em.com](https://me2em.com) — guides, tutorials, articles |
| **Q3 2027** | `@me2em/core` v1.0 — stable API freeze |
| **Q4 2027** | ZK-proof integration (anonymous attribute verification) |

Forward-looking items: [BACKLOG.md](./BACKLOG.md).

---

## 📜 Protocol Specifications

Implementation-independent protocol specifications (derivation formulas, token formats, test vectors) are required for third-party implementations and are planned as part of the v1.0 track — see the [Backlog](./BACKLOG.md) (BL-20–22). Archived pre-attestation drafts: [specs/draft](./specs/draft). Until the rewrite ships, the behavior contract lives in [`packages/core/README.md`](./packages/core/README.md) and the [Use Cases](./packages/core/USE_CASES.md).

---

## 📜 License

This project is licensed under the **Apache License 2.0** — see the [`LICENSE`](./LICENSE) file for details.

```
Copyright 2026 Me2em Organization

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

---

## 🙏 Acknowledgments

Me2em builds on the shoulders of giants:

- [`@noble/curves`](https://github.com/paulmillr/noble-curves) — Audited Ed25519/X25519 implementations
- [`@noble/ed25519`](https://github.com/paulmillr/noble-ed25519) — Ed25519 (legacy sync path)
- [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) — HKDF, SHA-256
- [`@scure/bip39`](https://github.com/paulmillr/scure-bip39) — BIP39 mnemonic support
- [`hash-wasm`](https://github.com/Daninet/hash-wasm) — Argon2id (WASM)
- [`fake-indexeddb`](https://github.com/dumbmatter/fakeIndexedDB) — IndexedDB test double
- [`tsup`](https://tsup.egoist.dev/) / [`typedoc`](https://typedoc.org/) / [`vitest`](https://vitest.dev/) — Build, docs, and test tooling

---

**Built for privacy, openness, and user sovereignty.** 🌐

🔗 [github.com/me2em-org](https://github.com/me2em-org) · [core.me2em.com](https://core.me2em.com) · [crypto.me2em.com](https://crypto.me2em.com) · [react.me2em.com](https://react.me2em.com) · [me2em.com](https://me2em.com)