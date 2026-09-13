# 📦 `@me2em/core` — Core Cryptographic Primitives

Core primitives for the Me2em authorization protocol: hierarchical
deterministic identities (`Identity` → `Handle` → `SubHandle`), stateless
signed sessions, and parent-signed **attestation chains** for delegatable,
externally verifiable authorization — all on Ed25519.

[![npm version](https://img.shields.io/npm/v/@me2em/core.svg)](https://www.npmjs.com/package/@me2em/core)
[![License](https://img.shields.io/npm/l/@me2em/core.svg)](https://github.com/me2em/core/blob/main/LICENSE)
[![Docs](https://img.shields.io/badge/docs-docs.me2em.com-blue)](https://docs.me2em.com)

## 🎯 Overview

- **Hierarchical Deterministic Identities** — one seed → isolated
  `Handle`s and `SubHandle`s (MAX_DEPTH = 2), derived offline via HKDF.
- **Stateless Authentication** — self-contained signed session tokens,
  verified without server-side storage, with optional revocation.
- **Attestations** — a parent cryptographically binds a child key to a
  name and a grant (audiences, scopes, TTL caps, name patterns). Chains
  are verified **offline by third parties using only the root public
  key** — the root private key never leaves its owner.
- **Zero-Knowledge Password Management** — deterministic password
  derivation without storage.
- **Secure Channels** — symmetric channel keys and X25519 shared
  secrets derived without key exchange.

## 📦 Installation

```bash
npm install @me2em/core
# or
pnpm add @me2em/core
```

**Dependencies:** `@noble/curves` (Ed25519/X25519), `@noble/ed25519`,
`@noble/hashes` (HKDF, SHA-256), `@scure/bip39` (mnemonic handling).

## 🚀 Quick Start

```typescript
import { Identity, Session } from '@me2em/core';

// 1. Create an Identity from a 32-byte seed
const seed = new Uint8Array(32).fill(42); // use a CSPRNG in production
const identity = await Identity.fromSeed(seed);

// 2. Derive a contextual Handle
const station = await identity.deriveHandle('station-001', {
  displayName: 'Station Berlin #001',
});

// 3. Derive a SubHandle with constraints
const connector = await station.deriveSubHandle('connector-ccs', {
  allowedAudiences: ['ev-app.com'],
  allowedScopes: ['charge:start', 'charge:stop'],
  maxSessionTtl: 7200,
});

// 4. Create a stateless session (signed by the SubHandle)
const session = await Session.create(connector, {
  audience: 'ev-app.com',
  scopes: ['charge:start'],
  ttl: 1800,
});

console.log(session.token); // base64url(payload).base64url(signature)
```

### Integration with BIP39 (recommended)

```typescript
import {
  Identity, generateSeedPhrase,
  get32ByteSeedFromMnemonic, validateSeedPhrase,
} from '@me2em/core';

const phrase = generateSeedPhrase(128);          // 12 words (256 → 24 words)
const check = validateSeedPhrase(phrase);
if (!check.isValid) throw new Error(check.error);

const seedBytes = await get32ByteSeedFromMnemonic(phrase);
const identity = await Identity.fromSeed(seedBytes);
```

> ⚠️ Passphrases (BIP39 "25th word") ARE supported:
> `get32ByteSeedFromMnemonic(words, passphrase)`. The passphrase is
> case-sensitive, not recoverable, and silently derives a different
> identity if mistyped. Store it with the same care as the words.

## 🔗 Attestations (verifiable delegation)

An **attestation** is a parent-signed statement:

> "the public key `K` belongs to the name `N` and is valid within grant `G`".

Chains (`root → handle → subhandle → session`) let **third parties verify
sessions offline using only the root *public* key** — with grant
constraints enforced at verification time, not just at creation.

```text
Identity ──attestHandle──▶ Handle (e.g. a charging station, issued once)
                             │  offline, no Identity, no network:
                             ├─ deriveSubHandle('connector-ccs')
                             ├─ attestSubHandle('connector-ccs', grant)
                             └─ Session.create(subHandle, ...)
                             ▼
        third-party verifier: verifyAttested(token, rootPublicKey, [A, B], audience)
```

### Issuing

```typescript
// Root owner (once per handle lifetime):
const A = await identity.attestHandle('station-001', {
  audiences: ['ev-app.com'],
  scopes: ['charge:start', 'charge:stop', 'charge:status'],
  maxSessionTtl: 7200,
  subNamePatterns: ['connector-*', 'meter-*'], // wildcard: trailing '*' only
});

// Handle (autonomous, offline, per subhandle):
const B = await station.attestSubHandle('connector-ccs', {
  audiences: ['ev-app.com'],
  scopes: ['charge:start', 'charge:stop'],
  maxSessionTtl: 7200,
});
```

The attested public key is always **derived internally** — a parent
cannot attest a foreign key, and `B.subjectId` always equals the key
reconstructed via `identity.deriveSubHandle('station-001', 'connector-ccs')`.

### Verifying (on any third-party server)

```typescript
import { Session, AttestationError } from '@me2em/core';

try {
  const s = await Session.verifyAttested(
    session.token,
    rootPublicKey,        // Uint8Array — public key only
    [A.token, B.token],   // chain, root first; length 1 for handle sessions
    'ev-app.com',
    revocationChecker?,   // optional; checks attestation and session jti
  );
  await startCharging(s.path![1]);
} catch (e) {
  if (e instanceof AttestationError) {
    console.error(e.code, e.level); // e.g. SCOPE_EXCEEDED / SESSION
  }
  throw new Error('Unauthorized');
}
```

### Error model

All failures throw `AttestationError` with `code` and `level`
(`ROOT | HANDLE_ATTESTATION | SUB_ATTESTATION | SESSION | FORMAT`):

| code | levels |
|---|---|
| `MALFORMED`, `CHAIN_INCOMPLETE` | FORMAT |
| `BAD_SIGNATURE` | ROOT, HANDLE_ATTESTATION, SESSION |
| `EXPIRED`, `NOT_YET_VALID`, `REVOKED` | ROOT, HANDLE_ATTESTATION, SESSION |
| `PATH_MISMATCH` | ROOT, HANDLE_ATTESTATION, SESSION |
| `NAME_NOT_PERMITTED`, `SCOPE_EXCEEDED`, `TTL_EXCEEDED` | ROOT |
| `SCOPE_EXCEEDED`, `TTL_EXCEEDED`, `AUDIENCE_NOT_PERMITTED`, `SESSION_OUTLIVES_ATTESTATION` | SESSION |
| `SUBJECT_MISMATCH` | ROOT, SUB_ATTESTATION |

"Note on error types. Failures detected during token parsing — wrongshape, invalid Base64URL, payload over 4096 bytes, non-JSON payload,missing required fields — throw a plain Error, before any attestationlayer is consulted. Every failure after parsing throwsAttestationError. Integration code should handle both."

### Verification modes

The library provides two ways to verify a session token. Both answer the
same question — *"is this signature valid, unexpired, unrevoked, and what
does it allow?"* — but they differ in **who is able to verify** and in
**what is actually enforced**.

**Mode 1 — `Session.verifyStateless` (direct verification).**
The verifier re-derives the signer's public key from the token's
`hNm`/`hPath` using an `Identity` instance and checks the signature.
Re-derivation requires the **private root key**, so Mode 1 is only
available to the key holder itself or to backend infrastructure trusted
with the root. Scopes, audience, TTL and revocation are checked from the
token itself — but SubHandle *constraints* (`allowedScopes`,
`maxSessionTtl`, …) are enforced only at session **creation**. A party
that has obtained a SubHandle private key can sign a session with any
scopes and TTL, and Mode 1 verification will accept it.

**Mode 2 — `Session.verifyAttested` (attestation-chain verification).**
The verifier checks the session signature against the key bound by a
parent-signed attestation, and each attestation against its parent's
signature, up to the root **public** key. Because every chain link
carries a signed grant, the verifier **enforces grants at verification
time**: session scopes must fit the grant, TTL caps and audiences hold,
and child grants must nest inside parent grants. This makes delegation
externally verifiable — a partner service verifies sessions with the
root public key only — and revoking an attestation `jti` disables the
entire branch: current **and** future sessions under it.

**Which mode should I use?**

| Situation | Mode |
|---|---|
| Verifier is your own trusted backend that already holds the root key | Mode 1 |
| Verifier is a third party / partner / customer who must not receive the root private key | Mode 2 |
| You need branch revocation (disable a device, an employee, a sold deal entirely) | Mode 2 |
| SubHandle constraints must be *enforced*, not just advisory | Mode 2 |

| | `Session.verifyStateless` (Mode 1) | `Session.verifyAttested` (Mode 2) |
|---|---|---|
| Verifier needs | `Identity` (**private** root) | root **public** key + chain |
| Trust model | verifier is the root owner | any third party |
| SubHandle constraints | enforced at creation only | **enforced at verification** |
| Revoke a handle/branch | per-session `jti` only | revoke attestation `jti` |
| Use when | closed perimeter, own services | external audiences, delegation, selling access |

The modes coexist naturally: internal telemetry verified with Mode 1,
external access granted via Mode 2 — see
[USE_CASES.md](./USE_CASES.md) for full production scenarios (EV
charging, drone fleets, corporate messenger).

## 📖 API Reference

### `Identity`

```typescript
class Identity {
  static fromSeed(seed: Uint8Array | string): Promise<Identity>; // 32 bytes or 64-char hex
  deriveHandle(name: string, metadata?: HandleMetadata): Promise<Handle>;
  deriveSubHandle(handleName: string, subName: string,
                  metadata?: SubHandleMetadata): Promise<SubHandle>; // atomic, for verification
  attestHandle(name: string, grant: AttestationGrant,
               opts?: { ttlSeconds?, expiresAt?, jti?, now? }): Promise<Attestation>;
  getPublicKey(): Uint8Array;
}
```

### `Handle`

```typescript
class Handle {
  getId(): string;                    // base64url of the public key
  getName(): string;                  // canonical (normalized) name
  getMetadata(): HandleMetadata | undefined;
  getPublicKey(): Uint8Array;
  getPath(): string[] | undefined;    // undefined for Handle, path for SubHandle
  sign(data: Uint8Array): Promise<Uint8Array>;
  static verify(sig: Uint8Array, data: Uint8Array, pub: Uint8Array): Promise<boolean>;
  derivePassword(context: string, length?: number): string;   // base64url secret
  deriveChannelKey(context: string): Uint8Array;              // 32-byte AES key
  deriveSharedSecret(otherPublicKey: Uint8Array): Promise<Uint8Array>; // X25519 + HKDF
  deriveSubHandle(name: string, metadata?: SubHandleMetadata): Promise<SubHandle>;
  attestSubHandle(subName: string, grant: AttestationGrant,
                  opts?: { ttlSeconds?, expiresAt?, jti?, now? }): Promise<Attestation>;
  validateSessionOptions(options: { audience: string; scopes: string[]; ttl: number }): void;
}
```

### `SubHandle` (leaf, MAX_DEPTH = 2)

```typescript
class SubHandle extends Handle {
  getPath(): string[];                // ['station-001', 'connector-ccs']
  getPathString(): string;            // 'station-001/connector-ccs'
  getDepth(): number;                 // always 2
  isLeaf(): boolean;                  // always true
  getSubMetadata(): SubHandleMetadata;
  validateSessionOptions(options: { audience: string; scopes: string[]; ttl: number }): void;
  // deriveSubHandle is overridden and ALWAYS throws (leaf node)
}
```

### `Session`

```typescript
class Session {
  static create(handle: Handle | SubHandle, options: SessionOptions): Promise<Session>;
  static verifyStateless(token: string, companyIdentity: Identity,
                         expectedAudience: string,
                         revocationChecker?: RevocationChecker): Promise<Session>;
  static verifyAttested(token: string, rootPublicKey: Uint8Array,
                        attestationChain: string[], expectedAudience: string,
                        revocationChecker?: RevocationChecker): Promise<Session>;
  isExpired(): boolean;
  readonly handleId, handleName, audience, scopes, expiresAt, token, path, sessionId;
}

interface SessionOptions {
  audience: string; scopes: string[]; ttl: number; sessionId?: string;
}

interface SessionPayload {            // signed token contents
  hId: string; hNm: string; hPath?: string[];
  aud: string; scp: string[]; exp: number; iat: number; jti: string;
}

interface RevocationChecker {
  isRevoked(jti: string): Promise<boolean>;
}
```

### `Attestation`

```typescript
class Attestation {
  static issue(signerPrivateKey: Uint8Array, subjectPublicKey: Uint8Array,
               subjectName: string, grant: AttestationGrant,
               opts?: { ttlSeconds?, expiresAt?, jti?, now? }): Promise<Attestation>;
  static decode(token: string): AttestationPayload;      // structure only — no sig, no time
  static verifySignature(token: string, signerPublicKey: Uint8Array): Promise<boolean>;
  static matchNamePattern(name: string, patterns: string[]): boolean;
  get payload(): AttestationPayload;
  get token(): string;
  get jti(): string;
}

interface AttestationGrant {
  audiences?: string[];        // undefined = unrestricted; [] = deny all
  scopes: string[];            // exact strings, no wildcards
  maxSessionTtl: number;       // seconds, > 0
  subNamePatterns?: string[];  // root→handle only; trailing '*' only
}

class AttestationError extends Error {
  readonly code: AttestationErrorCode;
  readonly level: AttestationLevel;
}
```

### Name normalization

All derivation inputs are canonicalized: `NFKC → lowercase → trim`,
then validated against `/^[a-z0-9][a-z0-9._@-]{0,62}$/`. Names with `/`,
non-ASCII letters, or > 64 chars **throw**. Identical inputs always
produce identical keys across platforms and entry points.

## 🎯 Core Use Cases

1. **Deterministic password manager** — derive secrets per service, store nothing.
2. **IoT fleets with encrypted channels** — devices operate fully offline.
3. **Stateless multi-device sync** — same seed → same handles everywhere.
4. **Delegatable access control** — attestation chains grant scope- and
   time-limited access to components, verifiable by external parties.

👉 **[USE_CASES.md](./USE_CASES.md)** — EV charging stations, drone fleet
access marketplace, corporate messenger, and a production Redis
`RevocationChecker`.

## 🔐 Cryptographic Details

- **Identity:** `Ed25519 key = HKDF-SHA256(seed, salt="", info="me2em/identity/v1/root", 32)`
- **Handle:** `HKDF-SHA256(identityKey, salt="", info="me2em/handle/v1/{name}", 32)`
- **SubHandle:** `HKDF-SHA256(handleKey, salt="", info="me2em/subhandle/v1/{handle}/{sub}", 32)`
- **Signatures:** Ed25519 (RFC 8032); tokens are `base64url(payload).base64url(signature)`
- **Attestation payload limit:** 2048 bytes; **session payload limit:** 4096 bytes
- **Clock skew tolerance:** ±30 seconds on all time checks

## 🛡️ Security Best Practices

✅ **Do**:
- Store seeds encrypted (PIN/biometric + AES-GCM); keep the root offline
  except for issuance ceremonies.
- Use short session TTLs (≤ 1 hour recommended).
- Implement a `RevocationChecker` (e.g., Redis SET) — it is consulted for
  attestation **and** session `jti` in `verifyAttested`.
- Prefer `verifyAttested` for any external audience; reserve
  `verifyStateless` for infrastructure you fully control.
- Scope `subNamePatterns` as narrowly as possible — a holder can do
  everything *inside* its wildcard.

❌ **Don't**:
- Never transmit seeds; keep derivation client-side.
- Don't reuse Handles across unrelated contexts.
- Don't log private keys or seed phrases.
- Don't rely on zeroing buffers as a hard guarantee — GC/JIT may retain
  copies (tracked in [BACKLOG](./BACKLOG.md) BL-07).

## 🧪 Testing

```bash
cd packages/core && pnpm test
```

166 tests cover: deterministic derivation and cross-entry-point key
consistency, name canonicalization, session lifecycle (create, verify,
tamper, expiry, iat), revocation, SubHandle constraint enforcement,
MAX_DEPTH leaf enforcement, attestation issue/decode/signature
determinism and validation, and the full `verifyAttested` chain
(20+ cases including nesting, wildcard permitting, revocation at every
level, and signature robustness).

## 🗺️ Roadmap

Recommendations for further development — including BIP39 passphrase
support, revocation lineage (`sid`), key zeroing, and attestation
reference compression — live in [BACKLOG.md](./BACKLOG.md).
The backlog is advisory and not part of the shipped API contract.

## 📜 License

Apache License 2.0 — see [LICENSE](../../LICENSE).

© 2026 Me2em Organization. Built for privacy, openness, and user sovereignty.
