# 📦 `@me2em/core` — Core Cryptographic Primitives

Core primitives for the Me2em authorization protocol: `Identity`, `Handle`, `SubHandle`, and stateless `Session` management with Ed25519 cryptography.

[![npm version](https://img.shields.io/npm/v/@me2em/core.svg)](https://www.npmjs.com/package/@me2em/core)
[![License](https://img.shields.io/npm/l/@me2em/core.svg)](https://github.com/me2em/core/blob/main/LICENSE)
[![Docs](https://img.shields.io/badge/docs-docs.me2em.com-blue)](https://docs.me2em.com)

## 🎯 Overview

`@me2em/core` provides the cryptographic foundation for the Me2em protocol — a decentralized multi-context identity system. It enables:

- **Hierarchical Deterministic Identities**: One seed → multiple isolated `Handle`s and `SubHandle`s (MAX_DEPTH = 2).
- **Zero-Knowledge Password Management**: Deterministic password derivation without storage.
- **Secure Channel Communication**: Encrypted channels between Identity and Handles without key exchange.
- **Stateless Authentication**: Cryptographic proof without server-side session storage, with optional revocation support.

📖 **Looking for real-world examples?** Check out our [Advanced Use Cases Guide](./USE_CASES.md) (EV Charging Stations, Drone Fleets, Corporate Messengers).

## 📦 Installation

```bash
npm install @me2em/core
# or
pnpm add @me2em/core
# or
yarn add @me2em/core
```

**Dependencies:**
- `@noble/ed25519` — Ed25519 signatures
- `@noble/hashes` — HKDF, SHA-256
- `@scure/bip39` — Mnemonic seed phrase generation

## 🚀 Quick Start

### Basic Usage

```typescript
import { Identity, Handle, Session } from '@me2em/core';

// 1. Create Identity from seed (32 bytes)
const seed = new Uint8Array(32).fill(42); // Replace with your secure seed
const identity = await Identity.fromSeed(seed);

// 2. Derive a contextual Handle
const workHandle = await identity.deriveHandle('work', {
  displayName: 'Alice @ Work',
  avatar: 'https://example.com/avatar.png'
});

// 3. Derive a SubHandle for granular access (e.g., IoT component or employee)
const connectorHandle = await workHandle.deriveSubHandle('connector-1', {
  allowedScopes: ['charge:start'],
  maxSessionTtl: 3600
});

// 4. Create a stateless session
const session = await Session.create(connectorHandle, {
  audience: 'ev-app.com',
  scopes: ['charge:start'],
  ttl: 1800
});

console.log('Session Token:', session.token);
```

### Integration with BIP39 (Recommended)

```typescript
import { 
  Identity, 
  generateSeedPhrase, 
  get32ByteSeedFromMnemonic,
  validateSeedPhrase 
} from '@me2em/core';

// 1. Generate a 12-word phrase (use 256 for 24 words)
const phrase = generateSeedPhrase(128); 
console.log('Your seed:', phrase.join(' '));

// 2. Validate a user-provided phrase
const validation = validateSeedPhrase(phrase);
if (!validation.isValid) throw new Error(validation.error);

// 3. Convert to 32-byte seed and create Identity
const seedBytes = await get32ByteSeedFromMnemonic(phrase);
const identity = await Identity.fromSeed(seedBytes);
```

## 📖 API Reference

### `Identity` Class
The root cryptographic identity, derived from a seed phrase.

```typescript
class Identity {
  static fromSeed(seed: Uint8Array | string): Promise<Identity>;
  deriveHandle(name: string, metadata?: HandleMetadata): Promise<Handle>;
  deriveSubHandle(handleName: string, subName: string, metadata?: SubHandleMetadata): Promise<SubHandle>; // Atomic derivation for server-side verification
  getPublicKey(): Uint8Array;
}
```

### `Handle` Class
A derived Ed25519 keypair representing a specific context.

```typescript
class Handle {
  getId(): string;
  getName(): string;
  getMetadata(): HandleMetadata | undefined;
  getPublicKey(): Uint8Array;
  sign(data: Uint8Array): Promise<Uint8Array>;
  static verify(signature: Uint8Array, data: Uint8Array, publicKey: Uint8Array): Promise<boolean>;
  derivePassword(context: string, length?: number): string;
  deriveChannelKey(context: string): Uint8Array;
  deriveSharedSecret(otherPublicKey: Uint8Array): Promise<Uint8Array>;
  deriveSubHandle(name: string, metadata?: SubHandleMetadata): Promise<SubHandle>; // Autonomous derivation
}
```

### `SubHandle` Class
A context-isolated child Handle (leaf node, MAX_DEPTH = 2). Inherits all `Handle` capabilities but adds constraint enforcement.

```typescript
class SubHandle extends Handle {
  getPath(): string[]; // e.g., ['station-001', 'connector-1']
  getPathString(): string;
  getDepth(): number; // Always 2
  isLeaf(): boolean; // Always true
  getSubMetadata(): SubHandleMetadata;
  validateSessionOptions(options: { audience: string; scopes: string[]; ttl: number }): void;
  // deriveSubHandle is overridden to throw an error (leaf node)
}
```

### `Session` Class
Stateless, cryptographically verifiable session tokens.

```typescript
class Session {
  static create(handle: Handle | SubHandle, options: SessionOptions): Promise<Session>;
  static verifyStateless(
    token: string, 
    companyIdentity: Identity, 
    expectedAudience: string, 
    revocationChecker?: RevocationChecker // Optional
  ): Promise<Session>;
  isExpired(): boolean;
}

interface RevocationChecker {
  isRevoked(sessionId: string): Promise<boolean>;
}
```

## 🎯 Core Use Cases

1. **Deterministic Password Manager**: Derive passwords on the fly. No database required.
2. **IoT Fleet with Encrypted Channels**: Control devices with zero-knowledge communication.
3. **Stateless Multi-Device Synchronization**: Identical handles across devices without sync protocols.
4. **Hierarchical Access Control**: Use `SubHandle` to grant time-limited, scope-restricted access to specific components (e.g., a single charging port, a specific drone camera, or a temporary contractor).

👉 **See [USE_CASES.md](./USE_CASES.md) for detailed, production-ready code examples.**

## 🔐 Cryptographic Details

- **Handle Derivation**: `HKDF-SHA256(IdentityPrivateKey, salt="", info="me2em/handle/v1/{name}", length=32)`
- **SubHandle Derivation**: `HKDF-SHA256(HandlePrivateKey, salt="", info="me2em/subhandle/v1/{handleName}/{subName}", length=32)`
- **Signature Scheme**: Ed25519 (RFC 8032)
- **Encoding**: Raw bytes → base64url for transport

## 🛡️ Security Best Practices

✅ **Do**:
- Store seeds encrypted (PIN/biometric + AES-GCM).
- Clear memory: Zero out seed/private key buffers after use.
- Use short TTLs for sessions (≤1 hour recommended).
- Implement a `RevocationChecker` (e.g., Redis SET) for instant access revocation.

❌ **Don't**:
- Never transmit seeds. Keep them client-side only.
- Don't reuse Handles across unrelated contexts.
- Don't log private keys or seed phrases.

## 🧪 Testing

```bash
cd packages/core
pnpm test
```

Tests cover:
- ✅ Deterministic derivation (Identity → Handle → SubHandle)
- ✅ Cryptographic consistency between autonomous and atomic derivation
- ✅ Signature generation and verification
- ✅ Session creation, validation, and revocation
- ✅ SubHandle constraint enforcement (audience, scopes, TTL, expiration)
- ✅ Edge cases and MAX_DEPTH = 2 enforcement

## 📜 License

Apache License 2.0 — see [LICENSE](../../LICENSE) for details.

© 2026 Me2em Organization. Built for privacy, openness, and user sovereignty.