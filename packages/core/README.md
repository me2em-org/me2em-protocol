Отлично! Сейчас создам детальный `packages/core/README.md` — это будет профессиональная документация API для npm-пакета `@me2em/core`.

Замените содержимое файла `packages/core/README.md` на этот код:

```markdown
# 📦 `@me2em/core` — Core Cryptographic Primitives

> Core primitives for the Me2em authorization protocol: `Identity`, `Handle`, and secure channel derivation with Ed25519 cryptography.

[![npm version](https://img.shields.io/npm/v/@me2em/core.svg)](https://www.npmjs.com/package/@me2em/core)
[![License](https://img.shields.io/npm/l/@me2em/core.svg)](https://github.com/me2em-org/me2em-protocol/blob/main/LICENSE)
[![Docs](https://img.shields.io/badge/docs-docs.me2em.com-blue)](https://docs.me2em.com)

---

## 🎯 Overview

`@me2em/core` provides the cryptographic foundation for the Me2em protocol — a decentralized multi-context identity system. It enables:

- **Hierarchical Deterministic Identities**: One seed → multiple isolated Handles
- **Zero-Knowledge Password Management**: Deterministic password derivation without storage
- **Secure Channel Communication**: Encrypted channels between Identity and Handles without key exchange
- **Stateless Authentication**: Cryptographic proof without server-side session storage

---

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

---

## 🚀 Quick Start

### Basic Usage

```typescript
import { Identity, Handle } from '@me2em/core';

// 1. Create Identity from seed (32 bytes)
const seed = new Uint8Array(32).fill(42); // Replace with your secure seed
const identity = await Identity.fromSeed(seed);

// 2. Derive a contextual Handle
const workHandle = await identity.deriveHandle('work', {
  displayName: 'Alice @ Work',
  avatar: 'https://example.com/avatar.png'
});

// 3. Use Handle for cryptographic operations
const message = new TextEncoder().encode('Hello, world!');
const signature = await workHandle.sign(message);
const isValid = await Handle.verify(signature, message, workHandle.getPublicKey());

console.log('Handle ID:', workHandle.getId()); // base64url(publicKey)
console.log('Signature valid:', isValid); // true
```

### Integration with BIP39 (Recommended)

For production applications, use BIP39 mnemonic phrases. `@me2em/core` provides built-in utilities to handle generation, validation, and conversion to the required 32-byte Ed25519 seed.

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

// 2. (Optional) Validate a user-provided phrase
const validation = validateSeedPhrase(phrase);
if (!validation.isValid) throw new Error(validation.error);

// 3. Convert to 32-byte seed and create Identity
const seedBytes = await get32ByteSeedFromMnemonic(phrase);
const identity = await Identity.fromSeed(seedBytes);
```

**Why is this better?** 
BIP39 produces a 64-byte seed, but Ed25519 requires exactly 32 bytes. The `get32ByteSeedFromMnemonic` utility handles the SHA-256 hashing deterministically and safely, so you don't have to write boilerplate crypto code.


---

## 📖 API Reference

### `Identity` Class

The root cryptographic identity, derived from a seed phrase.

```typescript
class Identity {
  // Create Identity from seed (32-byte Uint8Array)
  static fromSeed(seed: Uint8Array): Promise<Identity>;

  // Derive a new Handle with optional metadata
  deriveHandle(name: string, metadata?: HandleMetadata): Promise<Handle>;

  // Get root public key (for verification, never share private key)
  getPublicKey(): Uint8Array;
}
```

#### `Identity.fromSeed(seed)`

Creates an Identity from a 32-byte seed.

```typescript
const seed = new Uint8Array(32);
crypto.getRandomValues(seed); // Generate secure random seed
const identity = await Identity.fromSeed(seed);
```

**Security:** The seed must be kept secret. Never log, transmit, or store it in plaintext.

#### `Identity.deriveHandle(name, metadata?)`

Derives a new Handle deterministically from the Identity.

```typescript
const handle = await identity.deriveHandle('google', {
  displayName: 'Alice Personal',
  avatar: 'https://example.com/alice.png'
});
```

**Parameters:**
- `name`: Unique identifier for this Handle (case-insensitive, trimmed)
- `metadata`: Optional public data attached to the Handle

**Returns:** A `Handle` instance with its own keypair, derived deterministically from the Identity.

**Key Properties:**
- 🔁 **Deterministic**: Same seed + same name → same Handle (always)
- 🔗 **Isolated**: Each Handle has its own keypair; compromise of one does not affect others
- 🔒 **One-way**: Cannot derive Identity key from Handle key

---

### Seed Utilities

Built-in helpers for human-friendly key generation and validation.

```typescript
// Generate a new phrase (128 bits = 12 words, 256 bits = 24 words)
function generateSeedPhrase(strength: 128 | 256 = 128): string[];

// Normalize input (handles extra spaces, lowercase)
function normalizeSeedPhrase(input: string | string[]): string[];

// Validate word count, wordlist, and BIP39 checksum
function validateSeedPhrase(words: string[]): { isValid: boolean; error?: string };

// Convert validated mnemonic to a secure 32-byte Uint8Array for Ed25519
async function get32ByteSeedFromMnemonic(phrase: string | string[]): Promise<Uint8Array>;
```

✅ **Benefit**: Developers don't need to manually manage `@scure/bip39` imports or remember to hash the 64-byte output. Everything is handled securely within the protocol.

---

### `Handle` Class

A derived Ed25519 keypair representing a specific context (work, personal, IoT device).

```typescript
class Handle {
  // Get public identifier (safe to share)
  getId(): string;  // base64url-encoded public key

  // Sign arbitrary data with Handle's private key
  sign(data: Uint8Array): Promise<Uint8Array>;

  // Verify a signature using a public key (static method)
  static verify(signature: Uint8Array, data: Uint8Array, publicKey: Uint8Array): Promise<boolean>;

  // Deterministically derive a password/secret for a specific context
  derivePassword(context: string, length?: number): string;

  // Derive a symmetric channel key for encrypted communication
  deriveChannelKey(context: string): Uint8Array;

  // Accessors
  getName(): string;
  getMetadata(): HandleMetadata | undefined;
  getPublicKey(): Uint8Array;
}
```

#### `Handle.getId()`

Returns a URL-safe base64 string representing the Handle's public key:

```typescript
const handleId = handle.getId();
// Example: "pK7xJ2mN8vQ3rL5wY9zB1cD4eF6gH8iJ0kL2mN4oP6qR8sT0uV2wX4yZ6aB8cD0"
```

This is the identifier you send to servers for authentication and routing.

#### `Handle.sign(data)`

Signs arbitrary binary data using Ed25519:

```typescript
const payload = new TextEncoder().encode('{"action":"post","content":"Hello"}');
const signature = await handle.sign(payload);

// Send to server:
fetch('https://api.example.com/endpoint', {
  method: 'POST',
  headers: {
    'X-Handle-ID': handle.getId(),
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    payload: btoa(String.fromCharCode(...payload)),
    signature: btoa(String.fromCharCode(...signature))
  })
});
```

#### `Handle.verify(signature, data, publicKey)`

Static method for server-side signature verification:

```typescript
// Server receives: handleId, signature, payload
const publicKey = Uint8Array.from(atob(handleId), c => c.charCodeAt(0));
const data = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
const sig = Uint8Array.from(atob(signature), c => c.charCodeAt(0));

const isValid = await Handle.verify(sig, data, publicKey);
if (!isValid) throw new Error('Invalid signature');
```

#### `Handle.derivePassword(context, length?)`

Deterministically derives a secret (e.g., a password or API key) for a specific service context. The private key **never leaves this class**, ensuring maximum security.

```typescript
// Derive a password for a specific service
const googlePassword = workHandle.derivePassword('google'); 
// Example output: "xK9mP2qL5wY9zB1cD4eF6g"

// Derive a longer secret (e.g., 32 bytes for an API key)
const apiKey = workHandle.derivePassword('aws-api', 32);
```

**Parameters:**
- `context`: A unique identifier for the service (e.g., `'google'`, `'github'`, `'wifi-router'`)
- `length`: Length of the derived raw bytes (default: 16 bytes = ~22 chars base64url)

**Returns:** A URL-safe base64 string suitable for use as a strong password.

**Security Benefit:** The `privateKey` remains strictly encapsulated within the `Handle` instance. It is used internally by HKDF-SHA256 and is never returned, logged, or serialized.

**Use Case:** Zero-knowledge password management. No database of passwords is required on the server. If a service forces a password change, the user simply derives a new handle (e.g., `'google-v2'`) or adds a version suffix to the context.

#### `Handle.deriveChannelKey(context)`

Derives a symmetric 256-bit key for establishing a secure, encrypted communication channel between the Identity (controller) and this Handle (device/context). Both parties can independently compute this key without any key exchange protocol, because they both have access to the Handle's private key.

```typescript
// On the device (Handle side):
const channelKey = droneHandle.deriveChannelKey('telemetry-v1');
// channelKey is a 32-byte Uint8Array, ready for AES-256-GCM

// On the controller (Identity side):
const droneHandle = await centerIdentity.deriveHandle('drone-001');
const channelKey = droneHandle.deriveChannelKey('telemetry-v1');
// Identical key, derived independently
```

**Parameters:**
- `context`: Channel identifier for domain separation (e.g., `'drone-001'`, `'session-abc'`). Both parties **must** use the same context to derive the same key.

**Returns:** 32-byte `Uint8Array` suitable for AES-256-GCM encryption.

**Security Benefit:** The `privateKey` remains strictly encapsulated within the `Handle` instance. No key exchange protocol (ECDH, etc.) is needed — both parties derive the same key independently from the shared Handle private key.

**Note:** This method returns raw bytes (Uint8Array), unlike `derivePassword` which returns a base64url string. Use the returned bytes directly with AES-256-GCM via Web Crypto API or similar.

---

## 🎯 Use Cases

### 1. Deterministic Password Manager (Access Key Keeper)

Instead of storing passwords in a database, derive them deterministically from the Handle. The user only needs to remember their root Seed and the service name.

```typescript
// 1. User restores Identity from Seed (e.g., after entering a PIN)
const identity = await Identity.fromSeed(userSeed);

// 2. Derive the specific service Handle
const googleHandle = await identity.deriveHandle('google', {
  displayName: 'Alice Personal'
});

// 3. Deterministically generate the password on the fly
const password = googleHandle.derivePassword('google');

// 4. Auto-fill the login form
console.log('Login:', 'alice@example.com');
console.log('Password:', password); // Always the same for this seed + handle + context
```

✅ **Benefit**: Zero-knowledge password management. No database of passwords is required on the server. If a service forces a password change, the user simply derives a new handle (e.g., `'google-v2'`) or adds a version suffix to the context (e.g., `derivePassword('google-v2')`).

---

### 2. IoT Fleet with Encrypted Channels

Control a fleet of devices (drones, sensors, robots) with zero-knowledge encrypted communication. The control center derives a channel key for each device, and the device independently derives the same key — no key exchange protocol required.

```typescript
// === CONTROL CENTER (Identity) ===
const centerIdentity = await Identity.fromSeed(centerSeed);

// Minimal registry: just device names (no public keys stored!)
const allowedDevices = ['drone-001', 'drone-002', 'sensor-warehouse-a'];

// Receiving telemetry from a drone
async function receiveTelemetry(message: { name: string, signature: Uint8Array, encrypted: Uint8Array }) {
  // 1. Check if device is in registry
  if (!allowedDevices.includes(message.name)) {
    throw new Error('Unknown device');
  }
  
  // 2. Derive the Handle (deterministic, no DB lookup)
  const deviceHandle = await centerIdentity.deriveHandle(message.name);
  
  // 3. Verify signature (proves device owns the private key)
  const dataToVerify = concatBytes(
    new TextEncoder().encode(message.name),
    message.encrypted
  );
  const isValid = await Handle.verify(message.signature, dataToVerify, deviceHandle.getPublicKey());
  if (!isValid) throw new Error('Invalid signature');
  
  // 4. Derive the SAME channel key the device used for encryption
  const channelKey = deviceHandle.deriveChannelKey('telemetry-v1');
  
  // 5. Decrypt the message
  const telemetry = await decryptAESGCM(message.encrypted, channelKey);
  return telemetry;
}

// === DRONE (Handle, provisioned at factory) ===
// Drone is provisioned with its Handle's private key and name
async function sendTelemetry(telemetry: object) {
  const name = 'drone-001';
  const privateKey = /* loaded from secure enclave */;
  const droneHandle = new Handle(privateKey, name);
  
  // 1. Derive the SAME channel key the center will use for decryption
  const channelKey = droneHandle.deriveChannelKey('telemetry-v1');
  
  // 2. Encrypt telemetry
  const telemetryBytes = new TextEncoder().encode(JSON.stringify(telemetry));
  const encrypted = await encryptAESGCM(telemetryBytes, channelKey);
  
  // 3. Sign (name + encrypted data)
  const dataToSign = concatBytes(new TextEncoder().encode(name), encrypted);
  const signature = await droneHandle.sign(dataToSign);
  
  return { name, signature, encrypted };
}
```

✅ **Benefits**:
- **Minimal registry**: Control center stores only device names (strings), not public keys
- **No key exchange**: Both parties derive the same key independently
- **Stateless verification**: Signature check proves device authenticity
- **Isolation**: Compromise of one device doesn't affect others (different Handles → different channel keys)

---

### 3. Stateless Multi-Device Synchronization

A user with the same Identity on multiple devices (phone, laptop, tablet) can derive identical Handles and secrets on each device without any synchronization protocol.

```typescript
// On the phone:
const identity = await Identity.fromSeed(userSeed);
const messengerHandle = await identity.deriveHandle('messenger-main');
const handleId = messengerHandle.getId();
// Send handleId to server for registration

// On the laptop (later, no sync needed):
const identity = await Identity.fromSeed(userSeed); // Same seed
const messengerHandle = await identity.deriveHandle('messenger-main'); // Same name
const handleId = messengerHandle.getId(); // Identical handleId!
// Server recognizes the same user automatically
```

✅ **Benefit**: Zero-knowledge multi-device support. No QR codes, no server-side key sync, no backup servers. The mathematics guarantees identity across devices.

---

### 4. Break-Glass Recovery and Inheritance

A user's entire digital identity can be recovered from a single seed phrase, even years later, on any device, without contacting any service provider.

```typescript
// User stores seed phrase in a physical safe (or via Shamir's Secret Sharing with trusted heirs)

// Years later, on a new device:
const identity = await Identity.fromSeed(recoveredSeed);

// All handles are instantly recoverable:
const googleHandle = await identity.deriveHandle('google');
const bankHandle = await identity.deriveHandle('bank');
const messengerHandle = await identity.deriveHandle('messenger-main');

// All passwords are instantly recoverable:
const googlePassword = googleHandle.derivePassword('google');
const bankPassword = bankHandle.derivePassword('bank');

// All channel keys are instantly recoverable:
const messengerChannelKey = messengerHandle.deriveChannelKey('session-2026');
```

✅ **Benefit**: True self-sovereignty. No company can lock you out of your identity. Recovery is a mathematical certainty, not a customer support ticket.

---

### 5. Ephemeral Delegated Access

Grant time-limited access to a contractor or temporary service by deriving a Handle with a time-bound name.

```typescript
// Grant access to contractor until 2026-12-31
const contractorHandle = await identity.deriveHandle('contractor-acme-2026-12-31', {
  displayName: 'ACME Corp Contractor',
  role: 'auditor',
  expiresAt: '2026-12-31T23:59:59Z'
});

// Share the Handle ID with the contractor's system
// Contractor uses this Handle for authenticated access

// After expiration:
// - Server rejects requests (checks expiresAt metadata)
// - User simply stops using this Handle
// - No cleanup needed — the Handle is just a name in the derivation tree
```

✅ **Benefit**: Clean delegation without polluting the permanent identity. Expired Handles become inert cryptographic artifacts.

---

## 🔐 Cryptographic Details

### Handle Derivation Algorithm

Handles are derived using **HKDF-SHA256** with domain separation:

```
HandlePrivateKey = HKDF-SHA256(
  inputKeyMaterial = IdentityPrivateKey,
  salt = empty,
  info = "me2em/handle/v1/" + lowercase(name),
  length = 32
)
HandlePublicKey = Ed25519.PublicKey(HandlePrivateKey)
HandleId = Base64Url(HandlePublicKey)
```

**Properties:**
- 🔁 **Deterministic**: Same inputs → same output across all implementations
- 🔒 **One-way**: Cannot derive Identity key from Handle key
- 🧩 **Isolated**: Each Handle uses independent Ed25519 keypair

### Password Derivation Algorithm

Passwords are derived using **HKDF-SHA256** with the Handle's private key as input key material:

```
PasswordBytes = HKDF-SHA256(
  inputKeyMaterial = HandlePrivateKey,
  salt = "me2em/secret/" + lowercase(context),
  info = "me2em/secret/v1",
  length = 16 (default)
)
Password = Base64Url(PasswordBytes)
```

**Properties:**
- 🔁 **Deterministic**: Same Handle + same context → same password
- 🔐 **Encapsulated**: Private key never leaves the Handle instance
- 🧩 **Domain-separated**: Different contexts produce different passwords

### Channel Key Derivation

Channel keys are derived using **HKDF-SHA256** with the Handle's private key as input key material:

```
ChannelKey = HKDF-SHA256(
  inputKeyMaterial = HandlePrivateKey,
  salt = "me2em/channel/" + lowercase(context),
  info = "me2em/channel/v1",
  length = 32
)
```

**Properties:**
- 🔁 **Deterministic**: Same Handle + same context → same 32-byte key
- 🔐 **Encapsulated**: Private key never leaves the Handle instance
- 🧩 **Domain-separated**: Different contexts produce different keys (e.g., `'telemetry-v1'` vs `'command-v1'`)
- ⚡ **No key exchange**: Both parties derive the key independently, no ECDH needed

### Signature Scheme

- **Algorithm**: Ed25519 (RFC 8032)
- **Hash**: SHA-512 (via `@noble/ed25519`)
- **Encoding**: Raw bytes → base64url for transport

---

## 🛡️ Security Best Practices

### ✅ Do

- **Store seeds encrypted**: Use PIN/biometric + AES-GCM before persisting to IndexedDB
- **Clear memory**: Zero out seed/private key buffers after use (`buffer.fill(0)`)
- **Use short TTLs**: Rotate session tokens frequently (≤1 hour recommended)
- **Validate metadata server-side**: Never trust client-provided Handle metadata without verification
- **Pin dependencies**: Lock `@me2em/core` to specific version in `package.json`

### ❌ Don't

- **Never transmit seeds**: The seed is the root of trust — keep it client-side only
- **Don't reuse Handles across contexts**: Derive separate Handles for different apps/services
- **Don't log private keys**: Ensure debugging output never includes key material
- **Don't disable signature verification**: Always verify Ed25519 signatures server-side

### Key Lifecycle

```
[User enters seed]
        │
        ▼
[Derive Identity in RAM]
        │
        ▼
[Derive Handle(s) as needed]
        │
        ▼
[Sign challenge / data / derive password / derive channel key]
        │
        ▼
[Zero out private key buffers] ← Critical!
        │
        ▼
[Keep only public HandleId for future use]
```

---

## 🧪 Testing

### Unit Tests

```bash
cd packages/core
pnpm test
```

Tests cover:
- ✅ Deterministic derivation (same seed + name → same HandleId)
- ✅ Signature generation and verification
- ✅ Password derivation (same Handle + context → same password)
- ✅ Channel key derivation (same Handle + context → same key)
- ✅ Edge cases (empty metadata, long names, unicode)

### Integration Test Example

```typescript
import { Identity } from '@me2em/core';

test('full auth flow', async () => {
  // Client side
  const identity = await Identity.fromSeed(testSeed);
  const handle = await identity.deriveHandle('test');
  const challenge = new TextEncoder().encode('nonce-123');
  const signature = await handle.sign(challenge);

  // Server side
  const isValid = await Handle.verify(
    signature,
    challenge,
    handle.getPublicKey()
  );
  expect(isValid).toBe(true);
  expect(handle.getId()).toMatch(/^[A-Za-z0-9_-]{43}$/);
});
```

---

## 📦 Package Info

```json
{
  "name": "@me2em/core",
  "version": "0.4.1-alpha.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "dependencies": {
    "@noble/ed25519": "^3.1.0",
    "@noble/hashes": "^2.2.0",
    "@scure/bip39": "^1.3.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

## 🤝 Contributing

We welcome contributions! See:

- 📄 [CONTRIBUTING.md](../../CONTRIBUTING.md) — How to contribute code/docs
- 🗳️ [GOVERNANCE.md](../../GOVERNANCE.md) — Project decision-making process
- 🔐 [SECURITY.md](../../SECURITY.md) — Responsible disclosure policy

---

## 📜 License

Apache License 2.0 — see [LICENSE](../../LICENSE) for details.

© 2026 Me2em Organization. Built for privacy, openness, and user sovereignty.
```

---

## ✅ Что сделано

Этот `README.md` теперь:

1. **Профессиональный API-документ** для npm-пакета `@me2em/core`
2. **Quick Start** с интеграцией BIP39 (как в BeSafeChat)
3. **Полный API Reference** для `Identity` и `Handle`
4. **Детальное описание** новых методов:
   - `derivePassword()` — для Password Manager
   - `deriveChannelKey()` — для IoT Fleet
5. **6 Use Cases** с реальными примерами кода:
   - Password Manager
   - IoT Fleet with Encrypted Channels
   - Multi-Device Sync
   - Break-Glass Recovery
   - Ephemeral Delegated Access
6. **Cryptographic Details** — описание алгоритмов деривации
7. **Security Best Practices** — рекомендации по безопасному использованию

Этот README будет отображаться на странице npm-пакета и станет основным источником документации для разработчиков, использующих `@me2em/core`.