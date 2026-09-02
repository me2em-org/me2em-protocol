# 📦 `@me2em/core` — Developer Documentation

> Core primitives for the Me2em authorization protocol: `Identity`, `Handle`, and `Session` management with Ed25519 cryptography.

[![npm version](https://img.shields.io/npm/v/@me2em/core.svg)](https://www.npmjs.com/package/@me2em/core)
[![License](https://img.shields.io/npm/l/@me2em/core)](https://github.com/me2em-org/me2em-protocol/blob/main/LICENSE)
[![Docs](https://img.shields.io/badge/docs-docs.me2em.com-blue)](https://docs.me2em.com)

---

## 🎯 Quick Start

```bash
npm install @me2em/core
# or
pnpm add @me2em/core
# or
yarn add @me2em/core
```

```typescript
import { Identity, Handle } from '@me2em/core';

// 1. Create or restore identity from seed
const seed = 'your-32-byte-hex-seed-or-24-words';
const identity = await Identity.fromSeed(seed);

// 2. Derive a contextual handle
const workHandle = await identity.deriveHandle('work', {
  displayName: 'Alice @ Work',
  avatar: 'https://example.com/avatar.png'
});

// 3. Use handle for cryptographic operations
const message = new TextEncoder().encode('Hello, world!');
const signature = await workHandle.sign(message);
const isValid = await Handle.verify(signature, message, workHandle.getPublicKey());

console.log('Handle ID:', workHandle.getId()); // base64url(publicKey)
console.log('Signature valid:', isValid); // true
```

---

## 📚 Table of Contents

1. [Core Concepts](#-core-concepts)
2. [API Reference](#-api-reference)
3. [Use Cases](#-use-cases)
4. [Cryptographic Details](#-cryptographic-details)
5. [Integration Guide](#-integration-guide)
6. [Security Best Practices](#-security-best-practices)
7. [Testing](#-testing)
8. [Contributing](#-contributing)

---

## 🔑 Core Concepts

### Identity — Cryptographic Root

`Identity` represents the root cryptographic identity derived from a seed phrase.

```
Seed (32 bytes / 24 words)
       │
       ▼
┌─────────────────┐
│   Identity      │
│ • Ed25519 key   │
│ • Deterministic │
│ • Client-only   │
└─────────────────┘
```

**Key properties:**
- 🔐 **Never transmitted**: The root private key never leaves the client device
- 🔄 **Deterministic**: Same seed → same Identity → same derived Handles
- 🧩 **Stateless**: No server storage required for cryptographic operations

### Handle — Contextual Profile

`Handle` is a derived Ed25519 keypair representing a specific context (work, personal, IoT device).

```
Identity
   │
   ├─ deriveHandle('work') → Handle(@alice_work)
   ├─ deriveHandle('private') → Handle(@alice_private)
   └─ deriveHandle('iot-device-001') → Handle(@device_001)
```

**Key properties:**
- 🔗 **Cryptographically isolated**: Each Handle has its own keypair; compromise of one does not affect others
- 🏷️ **Public identifier**: `Handle.getId()` returns `base64url(publicKey)` — safe to share
- 📦 **Metadata support**: Attach public metadata (displayName, avatar) without revealing Identity

### Session — Scoped Access Token

`Session` represents a time-limited, scoped authorization token for accessing a specific application.

```typescript
interface SessionOptions {
  audience: string;      // e.g., 'https://api.myapp.com'
  scopes: string[];      // e.g., ['read:profile', 'write:messages']
  ttl?: number;          // seconds until expiration (default: 3600)
}
```

**Key properties:**
- ⏱️ **Short-lived**: Tokens expire automatically; refresh via Handle re-authentication
- 🔐 **Scoped**: Each token grants only specified permissions
- 🌐 **Stateless verification**: Servers verify signatures using Handle public key — no database lookup required

---

## 📖 API Reference

### `Identity` Class

```typescript
class Identity {
  // Create Identity from seed (32-byte Uint8Array or hex string)
  static fromSeed(seed: Uint8Array | string): Promise<Identity>;

  // Derive a new Handle with optional metadata
  deriveHandle(name: string, metadata?: HandleMetadata): Promise<Handle>;

  // Get root public key (for verification, never share private key)
  getPublicKey(): Uint8Array;
}
```

#### `Identity.fromSeed(seed)`

```typescript
// From hex string (64 chars = 32 bytes)
const identity = await Identity.fromSeed('a1b2c3...');

// From Uint8Array
const seedBytes = new Uint8Array(32).fill(42);
const identity = await Identity.fromSeed(seedBytes);
```

⚠️ **Security**: The seed must be kept secret. Never log, transmit, or store it in plaintext.

#### `Identity.deriveHandle(name, metadata?)`

```typescript
const handle = await identity.deriveHandle('work', {
  displayName: 'Alice Developer',
  avatar: 'https://example.com/alice.png',
  org: 'Acme Corp'
});
```

- `name`: Unique identifier for this Handle within the Identity (case-insensitive, trimmed)
- `metadata`: Arbitrary public data attached to the Handle (visible to servers/other users)

Returns a `Handle` instance with its own keypair, derived deterministically from the Identity.

---

### `Handle` Class

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

  // Derive a symmetric 256-bit channel key for encrypted communication
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

Generates a deterministic, cryptographically strong secret (e.g., a password) for a specific service, without ever exposing the private key.

```typescript
// Derive a password for a specific service
const googlePassword = workHandle.derivePassword('google'); 
// Example output: "xK9mP2qL5wY9zB1cD4eF6g"

// Derive a longer secret (e.g., 32 bytes for an API key)
const apiKey = workHandle.derivePassword('aws-api', 32);
```

✅ **Security Benefit**: The `privateKey` remains strictly encapsulated within the `Handle` instance. It is used internally by HKDF-SHA256 and is never returned, logged, or serialized.

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

✅ **Security Benefit**: The `privateKey` remains strictly encapsulated within the `Handle` instance. No key exchange protocol (ECDH, etc.) is needed — both parties derive the same key independently from the shared Handle private key.

⚠️ **Note**: This method returns raw bytes (Uint8Array), unlike `derivePassword` which returns a base64url string. Use the returned bytes directly with AES-256-GCM via Web Crypto API or similar.

---

### `Session` Class (Planned)

> ⚠️ Session management is planned for v0.2. Current implementations should use custom token logic with Handle signatures.

```typescript
// Future API (not yet implemented)
const session = await handle.requestSession({
  audience: 'https://api.myapp.com',
  scopes: ['read:profile', 'write:messages'],
  ttl: 3600
});

// Use token
fetch('https://api.myapp.com/me', {
  headers: { Authorization: `Bearer ${session.token}` }
});
```

---

## 🎯 Use Cases

### 1. Multi-Context User Authentication

```typescript
// User logs in with seed
const identity = await Identity.fromSeed(userSeed);

// Derive work handle
const workHandle = await identity.deriveHandle('work', {
  displayName: 'Alice @ Acme',
  role: 'engineer'
});

// Authenticate to work app
const workSig = await workHandle.sign(challenge);
// Send workHandle.getId() + workSig to https://work.acme.com/auth

// Later, derive personal handle for social app
const personalHandle = await identity.deriveHandle('personal', {
  displayName: 'Alice',
  interests: ['hiking', 'photography']
});

// Authenticate to social app with different handle
const socialSig = await personalHandle.sign(challenge);
// Send personalHandle.getId() + socialSig to https://social.app/auth
```

✅ **Benefit**: One seed, multiple isolated identities. Apps see only the Handle they interact with.

---

### 2. IoT Device Hierarchy

```typescript
// Root identity for device fleet
const fleetIdentity = await Identity.fromSeed(fleetSeed);

// Derive handle for gateway
const gateway = await fleetIdentity.deriveHandle('gateway-001', {
  type: 'gateway',
  location: 'warehouse-a'
});

// Derive child handles for sensors (using name prefix for hierarchy)
const sensor1 = await fleetIdentity.deriveHandle('gateway-001/sensor-temp', {
  type: 'temperature',
  unit: 'celsius'
});

const sensor2 = await fleetIdentity.deriveHandle('gateway-001/sensor-humidity', {
  type: 'humidity',
  unit: 'percent'
});
```

✅ **Benefit**: Compromise of `sensor-temp` does not expose `gateway-001` or other sensors. Each device has isolated credentials.

---

### 3. Anonymous Guest Access

```typescript
// Generate ephemeral seed for guest session
const guestSeed = crypto.getRandomValues(new Uint8Array(32));
const guestIdentity = await Identity.fromSeed(guestSeed);

// Create anonymous handle
const guestHandle = await guestIdentity.deriveHandle('guest', {
  displayName: 'Anonymous User',
  ephemeral: true
});

// Use for limited-scope access
const guestSig = await guestHandle.sign(challenge);
// Send to server with scope: ['read:public-content']
```

✅ **Benefit**: No email, no phone, no tracking. Guest access with cryptographic accountability.

---

### 4. Cross-App Single Sign-On (SSO)

```typescript
// User authenticates once with Identity
const identity = await Identity.fromSeed(seed);

// App A requests session for 'app-a.example.com'
const handleA = await identity.deriveHandle('app-a', { app: 'example-a' });
const sessionA = { /* custom token logic */ };

// App B requests session for 'app-b.example.com'
const handleB = await identity.deriveHandle('app-b', { app: 'example-b' });
const sessionB = { /* custom token logic */ };

// User switches between apps without re-entering seed
// Each app sees only its Handle, not the others
```

✅ **Benefit**: Seamless SSO with privacy isolation — apps cannot correlate user activity across services.

---

### 5. Deterministic Password Manager (Access Key Keeper)

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

✅ **Benefit**: Zero-knowledge password management. No database of passwords is required on the server. If a service forces a password change, the user simply derives a new handle (e.g., `'google-v2'`) or adds a version suffix to the context (e.g., `derivePassword('google', 16, 2)`).

### 6. IoT Fleet with Encrypted Channels

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

### 7. Stateless Multi-Device Synchronization

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

### 8. Break-Glass Recovery and Inheritance

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

### 9. Ephemeral Delegated Access

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

## 🔐 Cryptographic Details

### Key Derivation Algorithm

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

**Properties**:
- 🔁 **Deterministic**: Same Handle + same context → same 32-byte key
- 🔐 **Encapsulated**: Private key never leaves the Handle instance
- 🧩 **Domain-separated**: Different contexts produce different keys (e.g., `'telemetry-v1'` vs `'command-v1'`)
- ⚡ **No key exchange**: Both parties derive the key independently, no ECDH needed

### Signature Scheme

- **Algorithm**: Ed25519 (RFC 8032)
- **Hash**: SHA-512 (via `@noble/ed25519`)
- **Encoding**: Raw bytes → base64url for transport

### Test Vectors

See [`specs/test-vectors.json`](../../specs/test-vectors.json) for canonical derivation examples to ensure cross-implementation compatibility.

Example vector:
```json
{
  "seed_hex": "2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a",
  "handle_name": "work",
  "expected_handle_id": "pK7xJ2mN8vQ3rL5wY9zB1cD4eF6gH8iJ0kL2mN4oP6qR8sT0uV2wX4yZ6aB8cD0",
  "expected_public_key_hex": "a4b5c6d7e8f90123456789abcdef0123456789abcdef0123456789abcdef0123"
}
```

---

## 🔌 Integration Guide

### Backend Verification (Node.js Example)

```typescript
import { Handle } from '@me2em/core';

// Middleware to verify Handle-signed requests
export async function me2emAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const handleId = req.headers['x-handle-id'] as string;
  const signature = req.headers['x-signature'] as string;
  const payload = JSON.stringify(req.body);

  if (!handleId || !signature) {
    return res.status(401).json({ error: 'Missing authentication headers' });
  }

  try {
    // Decode base64url to Uint8Array
    const publicKey = base64urlToBytes(handleId);
    const sig = base64urlToBytes(signature);
    const data = new TextEncoder().encode(payload);

    // Verify signature
    const isValid = await Handle.verify(sig, data, publicKey);
    if (!isValid) throw new Error('Invalid signature');

    // Attach handle info to request for downstream use
    req.me2em = { handleId, publicKey };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}

function base64urlToBytes(str: string): Uint8Array {
  const padding = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + padding;
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}
```

### Frontend Secure Key Handling

```typescript
// Store encrypted seed in IndexedDB (never plaintext)
import { encryptWithPin } from './crypto/local';

async function saveIdentity(seed: string, pin: string) {
  const encrypted = await encryptWithPin(seed, pin);
  await db.identities.add({
    id: 'current',
    encryptedSeed: encrypted,
    // seed is NEVER stored in plaintext
  });
}

// Load and decrypt on login
async function loadIdentity(pin: string) {
  const record = await db.identities.get('current');
  if (!record) throw new Error('No identity found');
  
  const seed = await decryptWithPin(record.encryptedSeed, pin);
  return Identity.fromSeed(seed);
}
```

✅ **Best practice**: Use Web Crypto API or secure enclave for PIN/biometric decryption.

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
[Sign challenge / data]
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
cd packages/protocol-core
pnpm test
```

Tests cover:
- ✅ Deterministic derivation (same seed + name → same HandleId)
- ✅ Signature generation and verification
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

### Cross-Implementation Testing

Use [`specs/test-vectors.json`](../../specs/test-vectors.json) to verify your implementation matches the reference:

```typescript
import vectors from '@me2em/core/specs/test-vectors.json';

for (const vector of vectors) {
  const identity = await Identity.fromSeed(vector.seed_hex);
  const handle = await identity.deriveHandle(vector.handle_name);
  
  expect(handle.getId()).toBe(vector.expected_handle_id);
  expect(bytesToHex(handle.getPublicKey())).toBe(vector.expected_public_key_hex);
}
```

---

## 🤝 Contributing

We welcome contributions! See:

- 📄 [CONTRIBUTING.md](../../CONTRIBUTING.md) — How to contribute code/docs
- 🗳️ [GOVERNANCE.md](../../GOVERNANCE.md) — Project decision-making process
- 🔐 [SECURITY.md](../../SECURITY.md) — Responsible disclosure policy

### Quick Start for Contributors

```bash
git clone https://github.com/me2em-org/me2em-protocol.git
cd me2em-protocol
pnpm install

# Run tests
pnpm -r test

# Build all packages
pnpm -r build

# Lint
pnpm -r lint
```

### Adding a New Feature

1. Open a [Discussion](https://github.com/me2em-org/me2em-protocol/discussions) to propose the change
2. Implement in a feature branch
3. Add tests covering new functionality
4. Update `specs/core.md` if protocol behavior changes
5. Submit PR with clear description and test results

---

## 📦 Package Info

```json
{
  "name": "@me2em/core",
  "version": "0.3.0-alpha.1",
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
    "@noble/hashes": "^2.2.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

## 🌐 Ecosystem

This package is part of the Me2em ecosystem:

@me2em/core              ← криптография (Identity, Handle, derivePassword, deriveChannelKey)
@me2em/sdk               ← browser wrapper (IndexedDB, PIN, biometric, session management)
@me2em/react             ← UI компоненты (SeedDisplay, SeedVerification, HandleManager)
@me2em/auth-middleware   ← NestJS/Express middleware для Handle.verify()
@me2em/server            ← (опционально) готовый NestJS backend из Phase 1

🔗 Learn more: [github.com/me2em-org](https://github.com/me2em-org) | [docs.me2em.com](https://docs.me2em.com)

---

## 📜 License

Apache License 2.0 — see [LICENSE](../../LICENSE) for details.

© 2026 Me2em Organization. Built for privacy, openness, and user sovereignty.