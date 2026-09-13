# 🌐 Me2em Protocol

**A decentralized, multi-context identity and authorization protocol built on Ed25519 cryptography.**

[![CI](https://github.com/me2em-org/me2em-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/me2em-org/me2em-protocol/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-cc00ff.svg)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)](https://www.typescriptlang.org/)
[![Docs](https://img.shields.io/badge/docs-docs.me2em.com-blue)](https://docs.me2em.com)

---

## 🎯 What is Me2em?

Me2em is a **cryptographic identity protocol** that solves three fundamental problems in modern authorization:

| Problem | Me2em Solution |
|---------|----------------|
| **Context collision** — one profile for everything (work, personal, IoT) | Multiple isolated `Handle`s per `Identity`, each with its own keypair |
| **IoT scalability** — managing thousands of devices | Hierarchical derivation: `Identity` → `Handle` → `SubHandle` (MAX_DEPTH = 2) |
| **Privacy & trust** — requiring email/phone for registration | Anonymous, key-based authentication via seed phrases |

### Core Architecture

```
Identity (Root — from seed phrase)
  │
  ├─ Handle: @alice_work        ──→  Session → "work-app.com"
  ├─ Handle: @alice_private     ──→  Session → "messenger.app"
  │
  └─ Handle: station-001        ──→  Autonomous IoT device
       ├─ SubHandle: connector-1   (leaf, MAX_DEPTH = 2)
       └─ SubHandle: connector-2   (leaf, MAX_DEPTH = 2)
```

**Key properties:**
- 🔐 **Zero-knowledge** — private keys never leave the device
- 🔁 **Deterministic** — same seed + same name → same key (always)
- 🧩 **Isolated** — compromise of one Handle does not affect others
- 🌐 **Stateless** — servers verify signatures without database lookups
- 🏗️ **Hierarchical** — `SubHandle` enables granular IoT/Enterprise access control

---

## 📦 Repository Structure

This is a **pnpm monorepo** containing the Me2em protocol implementation and specifications.

```
me2em-protocol/
├── packages/
│   └── core/                    # 🧬 Core cryptographic primitives
│       ├── src/
│       │   ├── crypto/          # Ed25519, HKDF, derivation paths
│       │   ├── identity.ts      # Root Identity
│       │   ├── handle.ts        # Contextual Handle
│       │   ├── subhandle.ts     # Hierarchical SubHandle (leaf node)
│       │   ├── session.ts       # Stateless session tokens
│       │   ├── seed.ts          # BIP39 mnemonic utilities
│       │   └── index.ts         # Public API
│       ├── test/                # 96 tests (vitest)
│       ├── README.md            # Package documentation
│       └── USE_CASES.md         # Production examples (EV, Drone, Messenger)
│
├── specs/                       # 📜 Protocol specifications
│   ├── core.md                  # Core protocol specification
│   ├── test-vectors.json        # Canonical derivation examples
│   └── openapi/
│       └── server-ref.yaml      # Reference server API (OpenAPI 3.0)
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
# Clone the repository
git clone https://github.com/me2em-org/me2em-protocol.git
cd me2em-protocol

# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Run tests
pnpm -r test
```

### Using `@me2em/core`

```typescript
import { Identity, Handle, SubHandle, Session } from '@me2em/core';

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

📖 **More examples:** See [`packages/core/USE_CASES.md`](./packages/core/USE_CASES.md) for production-ready scenarios (EV Charging Stations, Drone Fleets, Corporate Messengers).

---

## 📚 Packages

| Package | Status | Description |
|---------|--------|-------------|
| [`@me2em/core`](./packages/core) | ✅ **Stable (v0.6.0-alpha.1)** | Core cryptographic primitives: `Identity`, `Handle`, `SubHandle`, `Session` |
| `@me2em/sdk` | 🚧 Planned | Browser wrapper: IndexedDB, PIN, biometric, session management |
| `@me2em/react` | 🚧 Planned | React components: `SeedDisplay`, `HandleManager`, etc. |
| `@me2em/auth-middleware` | 🚧 Planned | NestJS/Express middleware for `Handle.verify()` |
| `@me2em/server` | 🚧 Planned | Reference NestJS backend implementation |

### `@me2em/core` — Current Features

| Feature | Status | Description |
|---------|--------|-------------|
| `Identity` | ✅ | Root identity from 32-byte seed |
| `Handle` | ✅ | Contextual Ed25519 keypair |
| `SubHandle` | ✅ | Hierarchical leaf node (MAX_DEPTH = 2) |
| `Session` | ✅ | Stateless token with `hPath` + `jti` |
| `RevocationChecker` | ✅ | Optional interface for instant revocation |
| `derivePassword` | ✅ | Deterministic password derivation |
| `deriveChannelKey` | ✅ | Symmetric key for encrypted channels |
| `deriveSharedSecret` | ✅ | ECDH (X25519) for P2P key exchange |
| BIP39 seed utilities | ✅ | 12/24-word mnemonic support |

---

## 📜 Protocol Specifications

The `specs/` directory contains the **authoritative protocol definitions**:

| File | Purpose |
|------|---------|
| [`specs/core.md`](./specs/core.md) | Core protocol specification (derivation, signing, sessions) |
| [`specs/test-vectors.json`](./specs/test-vectors.json) | Canonical test vectors for cross-implementation compatibility |
| [`specs/openapi/server-ref.yaml`](./specs/openapi/server-ref.yaml) | Reference server API (OpenAPI 3.0) |

### Key Cryptographic Constants

All derivation paths are centralized in `packages/core/src/crypto/derivation-paths.ts`:

```typescript
DERIVATION_PATHS.identity           // "me2em/identity/v1/root"
DERIVATION_PATHS.handle(name)       // "me2em/handle/v1/{name}"
DERIVATION_PATHS.subhandle(h, s)    // "me2em/subhandle/v1/{h}/{s}"
```

⚠️ **Changing any of these strings is a BREAKING CHANGE** and requires a new protocol version.

---

## 🛠️ Development

### Available Scripts

```bash
# From the repository root:
pnpm -r build          # Build all packages
pnpm -r test           # Run tests across all packages
pnpm -r lint           # Lint all packages
pnpm -r typecheck      # TypeScript type checking

# For a specific package:
pnpm --filter @me2em/core test
pnpm --filter @me2em/core build
```

### Testing

The protocol is covered by **96 unit tests** (vitest):

```
packages/core/test/
├── derivation.spec.ts   # 27 tests — Identity, Handle, SubHandle derivation
├── session.spec.ts      # 27 tests — Session create/verify, revocation
└── subhandle.spec.ts    # 42 tests — SubHandle constraints, path, leaf behavior
```

Run with coverage:
```bash
cd packages/core
pnpm test --coverage
```

### Code Style

- **TypeScript** with strict mode
- **ESLint** + **Prettier** for formatting
- **TSDoc** comments for all public APIs (used for auto-generated docs)

---

## 📖 Documentation

| Resource | Link |
|----------|------|
| **Package README** | [`packages/core/README.md`](./packages/core/README.md) |
| **Use Cases Guide** | [`packages/core/USE_CASES.md`](./packages/core/USE_CASES.md) |
| **Protocol Spec** | [`specs/core.md`](./specs/core.md) |
| **API Reference** | [docs.me2em.com](https://docs.me2em.com) (auto-generated from TSDoc) |
| **OpenAPI Spec** | [`specs/openapi/server-ref.yaml`](./specs/openapi/server-ref.yaml) |

---

## 🔐 Security

Me2em is built with security as a first-class concern:

- ✅ **Ed25519** signatures (RFC 8032) — fast, secure, widely audited
- ✅ **HKDF-SHA256** for key derivation — industry standard
- ✅ **Private key encapsulation** — keys never leave their owning class
- ✅ **Domain separation** — different contexts produce different keys
- ✅ **Stateless verification** — no server-side state to compromise

For security concerns or to report vulnerabilities, see [`SECURITY.md`](./SECURITY.md).

---

## 🤝 Contributing

We welcome contributions! Please read:

- 📄 [`CONTRIBUTING.md`](./CONTRIBUTING.md) — How to contribute code and docs
- 🗳️ [`GOVERNANCE.md`](./GOVERNANCE.md) — Project decision-making process
- 🔐 [`SECURITY.md`](./SECURITY.md) — Responsible disclosure policy
- 📜 [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — Community guidelines

### Quick Start for Contributors

```bash
git clone https://github.com/me2em-org/me2em-protocol.git
cd me2em-protocol
pnpm install
pnpm -r build
pnpm -r test
```

---

## 🌍 Roadmap

| Quarter | Milestone |
|---------|-----------|
| **Q4 2026** | `@me2em/core` v1.0 stable release |
| **Q1 2027** | `@me2em/sdk` — browser wrapper with IndexedDB + biometric |
| **Q2 2027** | `@me2em/react` — UI components for seed management |
| **Q3 2027** | `@me2em/server` — reference NestJS backend |
| **Q4 2027** | ZK-proof integration (anonymous attribute verification) |

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

- [`@noble/ed25519`](https://github.com/paulmillr/noble-ed25519) — Audited Ed25519 implementation
- [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) — HKDF, SHA-256
- [`@scure/bip39`](https://github.com/paulmillr/scure-bip39) — BIP39 mnemonic support
- [`vitest`](https://vitest.dev/) — Fast unit testing framework

---

**Built for privacy, openness, and user sovereignty.** 🌐

🔗 [github.com/me2em-org](https://github.com/me2em-org) · [docs.me2em.com](https://docs.me2em.com) · [me2em.com](https://me2em.com)