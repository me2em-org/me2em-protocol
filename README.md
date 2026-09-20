# 🌐 Me2em Protocol

**A decentralized, multi-context identity and authorization protocol built on Ed25519 cryptography.**

[![CI](https://github.com/me2em-org/me2em-protocol/actions/workflows/ci-security.yml/badge.svg)](https://github.com/me2em-org/me2em-protocol/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-cc00ff.svg)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)](https://www.typescriptlang.org/)
[![Docs](https://img.shields.io/badge/docs-docs.me2em.com-blue)](https://docs.me2em.com)

---

## 🎯 What is Me2em?

Me2em is a **cryptographic identity protocol** that solves four fundamental problems in modern authorization:

| Problem | Me2em Solution |
|---------|----------------|
| **Context collision** — one profile for everything (work, personal, IoT) | Multiple isolated `Handle`s per `Identity`, each with its own keypair |
| **IoT scalability** — managing thousands of devices | Hierarchical derivation: `Identity` → `Handle` → `SubHandle` (MAX_DEPTH = 2), fully offline |
| **Delegatable trust** — granting scoped, time-boxed access to partners, clients, employees | **Attestation chains**: parent-signed grants, verifiable by third parties with the root *public* key only |
| **Privacy & trust** — requiring email/phone for registration | Anonymous, key-based authentication via seed phrases |

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

---

## 📦 Repository Structure

This is a **pnpm monorepo** containing the Me2em protocol implementation and documentation.

```
me2em-protocol/
├── packages/
│   ├── core/                    # 🧬 Core cryptographic primitives
│       ├── src/
│       │   ├── crypto/          # Ed25519, HKDF, derivation paths
│       │   ├── identity.ts      # Root Identity (+ attestHandle)
│       │   ├── handle.ts        # Contextual Handle (+ attestSubHandle)
│       │   ├── subhandle.ts     # Hierarchical SubHandle (leaf node)
│       │   ├── attestation.ts   # Parent-signed attestation chains
│       │   ├── session.ts       # Stateless sessions (verifyStateless + verifyAttested)
│       │   ├── seed.ts          # BIP39 mnemonic utilities
│       │   └── index.ts         # Public API
│       ├── test/                # 178 tests (vitest, 7 suites)
│       ├── README.md            # Package documentation
│       ├── USE_CASES.md         # Production examples (EV, Drone, Messenger)
│       └── CHANGELOG.md         # Release notes
│   └── react/                   # ⚛️  React bindings & UX components
│
├── docs/                        # 📚 Project documentation
│   └── BACKLOG.md               # Development backlog (advisory)
│
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

- **Node.js** ≥ 18.0.0
- **pnpm** ≥ 8.0.0 (`npm install -g pnpm`)

### Installation

```bash
git clone https://github.com/me2em-org/me2em-protocol.git
cd me2em-protocol
pnpm install
pnpm -r build
pnpm -r test
```

### Using `@me2em/core`

```typescript
import { Identity, Session } from '@me2em/core';

// 1. Create Identity from seed
const seed = new Uint8Array(32).fill(42); // Use a real secure seed!
const identity = await Identity.fromSeed(seed);

// 2. Derive a Handle for a specific context
const workHandle = await identity.deriveHandle('work', {
  displayName: 'Alice @ Acme Corp'
});

// 3. Derive a SubHandle for hierarchical access (IoT, delegation)
const connector = await workHandle.deriveSubHandle('connector-1', {
  allowedScopes: ['charge:start'],
  maxSessionTtl: 3600
});

// 4. Create a stateless session
const session = await Session.create(connector, {
  audience: 'ev-app.com',
  scopes: ['charge:start'],
  ttl: 1800
});

console.log('Token:', session.token);
console.log('Path:', session.path); // ['work', 'connector-1']
```

📖 **More examples:** See [`packages/core/USE_CASES.md`](./packages/core/USE_CASES.md) for production-ready scenarios (EV Charging Stations, Drone Fleet access marketplace, Corporate Messengers).

---

## 📚 Packages

| Package | Status | Description |
|---------|--------|-------------|
| [`@me2em/core`](./packages/core) | 🧪 **alpha (v0.7.0-alpha.1)** | Core cryptographic primitives: `Identity`, `Handle`, `SubHandle`, `Session`, `Attestation` |
| [`@me2em/react`](./packages/react) | 🧪 **alpha (v0.1.0-alpha.1)** | React bindings: identity lifecycle hooks, seed phrase UX components, session management, encrypted context cache |
| `@me2em/crypto` | 🧪 **alpha (v0.1.0-alpha.1)** | Protocol-level crypto mechanisms: channels, pre-key management, Argon2id envelopes |
| `@me2em/messenger` | 🚧 Planned (0.9) | Vertical: E2EE chats, groups with epoch key rotation |
| `@me2em/iot` | 💤 Deferred | Vertical: managed attested devices (EV, drones) |
| `@me2em/server` | 🚧 Planned | Reference NestJS backend: verification middleware, revocation store |

### `@me2em/core` — Current Features

| Feature | Status | Description |
|---------|--------|-------------|
| `Identity` | ✅ | Root identity from 32-byte seed |
| `Handle` | ✅ | Contextual Ed25519 keypair |
| `SubHandle` | ✅ | Hierarchical leaf node (MAX_DEPTH = 2) |
| `Session` | ✅ | Stateless tokens — `verifyStateless` (direct) + `verifyAttested` (chain) |
| **`Attestation`** | ✅ | Parent-signed grants: audiences, scopes, TTL caps, name wildcards; offline third-party verification; branch revocation |
| `RevocationChecker` | ✅ | Optional interface — covers session **and** attestation `jti` |
| `derivePassword` | ✅ | Deterministic password derivation |
| `deriveChannelKey` | ✅ | Symmetric key for encrypted channels |
| `deriveSharedSecret` | ✅ | X25519 ECDH with peer-key binding (UKS-safe, `p2p-channel/v2`) |
| BIP39 seed utilities | ✅ | 12/24-word mnemonic support |

---

## 🔗 Attestations in 30 Seconds

The 0.6 headline feature. A parent **attests** a child key:

> “public key `K` belongs to name `N`, valid within grant `G`, until time `T`.”

```typescript
// Root owner (once per handle):
const A = await identity.attestHandle('station-001', {
  audiences: ['ev-app.com'],
  scopes: ['charge:start', 'charge:stop'],
  maxSessionTtl: 7200,
  subNamePatterns: ['connector-*'],
});

// The device, fully offline:
const B = await station.attestSubHandle('connector-ccs', { /* child grant */ });
const session = await Session.create(connector, { /* ... */ });

// Any third party verifies with the PUBLIC root key:
await Session.verifyAttested(session.token, rootPublicKey, [A.token, B.token], 'ev-app.com');
```

No shared secrets, no databases of delegations, no trust in the relay — and revoking `A.jti` disables the entire branch instantly. **Full guide:** [`packages/core/README.md` → Attestations](./packages/core/README.md#-attestations-verifiable-delegation).

Two verification modes:

| | `verifyStateless` (Mode 1) | `verifyAttested` (Mode 2) |
|---|---|---|
| Verifier needs | `Identity` (**private** root) | root **public** key + chain |
| Use when | your own trusted backend | external audiences, delegation, selling access |

---

## 🔐 Cryptographic Constants

All derivation paths are centralized in `packages/core/src/crypto/derivation-paths.ts`:

```typescript
DERIVATION_PATHS.identity      // "me2em/identity/v1/root"
DERIVATION_PATHS.handle(name)  // "me2em/handle/v1/{name}"
DERIVATION_PATHS.subhandle(h, s) // "me2em/subhandle/v1/{h}/{s}"
DERIVATION_PATHS.p2pChannelV2  // "me2em/p2p-channel/v2" (peer-key bound)
```

⚠️ **Changing any of these strings is a BREAKING CHANGE** and requires a new protocol version.

---

## 🛠️ Development

### Available Scripts

```bash
pnpm -r build          # Build all packages
pnpm -r test           # Run tests across all packages
pnpm build-docs        # Generate API docs (typedoc → ./docs)

# For a specific package:
pnpm --filter @me2em/core test
```

### Testing

**178 tests** across 7 suites (vitest): derivation & canonical names, session lifecycle (create, verify, tamper, expiry, revocation), SubHandle constraints and leaf enforcement, attestation issuance/decode/determinism, and the full attested-verification chain (nesting, wildcards, revocation at every level, signature robustness).

### Code Style

- **TypeScript** strict mode · **ESLint** + **Prettier**
- **TSDoc** on all public APIs — auto-generated into [docs.me2em.com](https://docs.me2em.com) with zero-warning build

---

## 📖 Documentation

| Resource | Link |
|----------|------|
| **Package README** (incl. attestation guide + error table) | [`packages/core/README.md`](./packages/core/README.md) |
| **Use Cases Guide** | [`packages/core/USE_CASES.md`](./packages/core/USE_CASES.md) |
| **Development Backlog** | [`packages/core/BACKLOG.md`](./BACKLOG.md) |
| **Changelog** | [`packages/core/CHANGELOG.md`](./packages/core/CHANGELOG.md) |
| **API Reference** | [docs.me2em.com](https://docs.me2em.com) (auto-generated from TSDoc) |

---

## 🔐 Security

- ✅ **Ed25519** signatures (RFC 8032) — fast, widely audited
- ✅ **HKDF-SHA256** derivation with strict domain separation
- ✅ **Peer-key binding** in ECDH channel derivation (UKS protection)
- ✅ **Private key encapsulation** — keys never leave their owning class
- ✅ **Canonical name normalization** (NFKC) — no homoglyph or separator collisions
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
| **Next (0.8)** | `@me2em/crypto` — session-bound profile, channels, pre-key management |
| **Q1 2027** | [me2em.com](https://me2em.com) — guides, tutorials |
| **Q2–Q3 2027** | `@me2em/messenger` + `@me2em/server` — first vertical + reference backend |
| **Q3 2027** | `@me2em/core` v1.0 — stable API freeze |
| **Q4 2027** | ZK-proof integration |

Forward-looking items: [BACKLOG.md](./BACKLOG.md).

---

## 📜 Protocol Specifications

Implementation-independent protocol specs (derivation formulas, token
formats, test vectors) are being rewritten against 0.6.0 — see
[specs/draft](./specs/draft) for the archived pre-attestation drafts and
the [Backlog](./BACKLOG.md) (BL-20–22) for the plan.
Until then, the behavior contract lives in
[`packages/core/README.md`](./packages/core/README.md) and the
[Use Cases](./packages/core/USE_CASES.md).

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
- [`vitest`](https://vitest.dev/) — Fast unit testing framework
- [`fake-indexeddb`](https://github.com/dumbmatter/fakeIndexedDB) - pure JS in-memory implementation of the IndexedDB API.

---

**Built for privacy, openness, and user sovereignty.** 🌐

🔗 [github.com/me2em-org](https://github.com/me2em-org) · [docs.me2em.com](https://docs.me2em.com) · [me2em.com](https://me2em.com)
