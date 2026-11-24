## 📦 Core Cryptographic Primitives

Core primitives for the Me2eM authorization protocol: hierarchical
deterministic identities (`Identity` → `Handle` → `SubHandle`), stateless
signed sessions, and parent-signed **attestation chains** for delegatable,
externally verifiable authorization — all on Ed25519. Since 1.0.0-rc.3 the
package also hosts the **payment-layer contracts** — chain-agnostic
`PaymentRequest`/`PaymentResult`, `WalletAdapter`/`PaymentAdapter` with a
CAIP-2 registry, wallet binding, and the x402 v2 wire types (`payment.ts` /
`payment-x402.ts` / `wallet-binding.ts`) — while execution lives in chain
packages ([`@me2em/solana`](https://www.npmjs.com/package/@me2em/solana)) and
transport in [`@me2em/x402`](https://www.npmjs.com/package/@me2em/x402).

[![npm version](https://img.shields.io/npm/v/@me2em/core.svg)](https://www.npmjs.com/package/@me2em/core)
[![License](https://img.shields.io/npm/l/@me2em/core.svg)](https://github.com/me2em-org/me2em-protocol/blob/main/LICENSE)
[![Docs](https://img.shields.io/badge/docs-core.me2em.com-blue)](https://core.me2em.com)

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
- **BIP39 Passphrase** — optional "25th word" support: the
  passphrase silently derives a different identity if changed.
- **UKS-Safe ECDH** — `deriveSharedSecret` binds both peers'
  public keys into the KDF (`p2p-channel/v2`), preventing
  unknown key-share attacks.
- **Payment-Layer Base** — `PaymentRequest`/`PaymentResult` with a
  fail-closed reason model, `WalletAdapter`/`PaymentAdapter` contracts
  and a process-wide CAIP-2 adapter registry, the default
  `verifyWalletBinding` check, and the x402 v2 wire types with
  structural guards (`isX402*`, `X402_VERSION = 2`). No network, no
  chain code — adapters and transport are separate packages.

---

## 📖 Terminology

Protocol terms are **domain-neutral** — each use case assigns them
its own meaning. The five terms most relevant to this package:

| Term | Definition |
|------|------------|
| **Identity** | Root cryptographic identity derived from a seed phrase. Constant forever. |
| **Handle** | A derived, attested, named key representing a distinct identity context. |
| **SubHandle** | A leaf child of a Handle (MAX_DEPTH = 2). |
| **Attestation** | A parent-signed statement binding a child key to a name and a grant. |
| **Session** | A stateless signed authorization token. |

**Domain interpretations** — the same primitives, read through
different lenses:

| Use case | Handle is… | SubHandle is… |
|----------|------------|----------------|
| **AI Agent Delegation** (UC-1) | An AI agent acting on behalf of a user | — (the agent signs sessions directly) |
| **IoT Device Hierarchy** (UC-2) | A physical device | A component of that device |
| **Multi-Context Identity** (UC-3) | A user persona (work, personal) | Delegated access within a persona |
| **Multi-App SSO** (UC-4) | A per-app persona of the user | — |
| **Deterministic Password Manager** (UC-5) | A service context | — |
| **E2EE Messaging** (UC-6) | The user's messaging identity | An optional device identity |

Full glossary (including Channel and material-class terms):
see `GLOSSARY.md` in the repository.

---

## 📦 Installation

```bash
npm install @me2em/core
# or
pnpm add @me2em/core
```

**Dependencies:** `@noble/curves` (Ed25519/X25519), `@noble/ed25519`,
`@noble/hashes` (HKDF, SHA-256), `@scure/bip39` (mnemonic handling).

> 💡 This package is self-contained. For E2EE channels, X3DH key
>  agreement, and Argon2id use [`@me2em/crypto`](https://www.npmjs.com/package/@me2em/crypto).
>  For React hooks and seed phrase UX components use
>  [`@me2em/react`](https://www.npmjs.com/package/@me2em/react). For the x402 v2 payment
>  transport use [`@me2em/x402`](https://www.npmjs.com/package/@me2em/x402); for the Solana
>  chain adapter (wallet trees, verification, pay, the x402 signer) use
>  [`@me2em/solana`](https://www.npmjs.com/package/@me2em/solana). The five packages are
>  designed to work together — see the
>  [repository README](https://github.com/me2em-org/me2em-protocol) for the full package map.

## 🚀 Quick Start

```typescript
import { Identity, Session } from '@me2em/core';

// 1. Create an Identity from a 64-byte seed
const seed = new Uint8Array(64).fill(42); // use a CSPRNG in production
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
  get64ByteSeedFromMnemonic, validateSeedPhrase,
} from '@me2em/core';

const phrase = generateSeedPhrase(128);          // 12 words (256 → 24 words)
const check = validateSeedPhrase(phrase);
if (!check.isValid) throw new Error(check.error);

const seedBytes = await get64ByteSeedFromMnemonic(phrase); // full 64-byte BIP39 seed
const identity = await Identity.fromSeed(seedBytes);
```

> ⚠️ Passphrases (BIP39 "25th word") ARE supported:
> `get64ByteSeedFromMnemonic(words, passphrase)`. The passphrase is
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
(`ROOT | HANDLE_ATTESTATION | SUB_ATTESTATION | SESSION | FORMAT`) —
including token parsing, `Session.verifyStateless` and session-creation
constraint checks (PR-7). Match on `code`/`level`, never on messages:

| code | levels |
|---|---|
| `MALFORMED`, `CHAIN_INCOMPLETE`, `MAX_DEPTH_EXCEEDED`, `DISPOSED` | FORMAT |
| `BAD_SIGNATURE` | ROOT, HANDLE_ATTESTATION, SESSION |
| `EXPIRED`, `NOT_YET_VALID`, `REVOKED` | ROOT, HANDLE_ATTESTATION, SESSION |
| `PATH_MISMATCH` | ROOT, HANDLE_ATTESTATION, SESSION |
| `NAME_NOT_PERMITTED`, `SCOPE_EXCEEDED`, `TTL_EXCEEDED` | ROOT, SESSION |
| `SCOPE_EXCEEDED`, `TTL_EXCEEDED`, `AUDIENCE_NOT_PERMITTED`, `SESSION_OUTLIVES_ATTESTATION` | SESSION |
| `SUBJECT_MISMATCH` | ROOT, SUB_ATTESTATION, SESSION |

`MAX_DEPTH_EXCEEDED` signals the derivation-tree limit (a leaf `SubHandle`
cannot derive children); `DISPOSED` signals a capability call on a disposed
`Identity`/`Handle` — `DisposedError` is an `AttestationError` subclass
carrying that code, so `e.name === 'DisposedError'` still works for targeted
handling.

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
[USE_CASES.md](./USE_CASES.md) for all nine production scenarios.

## 📖 API Reference

### `Identity`

```typescript
class Identity {
  static fromSeed(seed: Uint8Array | string): Promise<Identity>; // 64 bytes or 128-char hex
  deriveHandle(name: string, metadata?: HandleMetadata): Promise<Handle>;
  deriveSubHandle(handleName: string, subName: string,
                  metadata?: SubHandleMetadata): Promise<SubHandle>; // atomic, for verification
  sign(data: Uint8Array): Promise<Uint8Array>; // implements Signer (root key)
  attestHandle(name: string, grant: AttestationGrant,
               opts?: { ttlSeconds?, expiresAt?, jti?, now? }): Promise<Attestation>;
  getPublicKey(): Uint8Array;
  bindWallet(descriptor: WalletDescriptor): void;  // attach a chain wallet (rc.3)
  getWallet(chain: string): WalletDescriptor | null;
  dispose(): void;                    // zeroize key; capability methods throw DisposedError
}
```

### `Handle`

```typescript
class Handle {
  getId(): string;                    // base64url of the public key
  getName(): string;                  // canonical (normalized) name
  getMetadata(): HandleMetadata | undefined;   // defensive copy
  getPublicKey(): Uint8Array;         // defensive copy
  getPath(): string[] | undefined;    // undefined for Handle, path for SubHandle
  sign(data: Uint8Array): Promise<Uint8Array>;
  static verify(sig: Uint8Array, data: Uint8Array, pub: Uint8Array): Promise<boolean>;
  derivePassword(context: string, options?: { revision?: number; byteLength?: number }): string;   // base64url secret
  deriveChannelKey(context: string, options?: { revision?: number }): Uint8Array;             // 32-byte AES key
  deriveResourceKey(resourceType: string, resourceId: string,
                    options?: { epoch?: number; revision?: number }): Uint8Array;  // 32-byte access-state key (rc.9)
  deriveSharedSecret(otherPublicKey: Uint8Array): Promise<Uint8Array>; // X25519 + HKDF
  deriveSubHandle(name: string, metadata?: SubHandleMetadata): Promise<SubHandle>;
  attestSubHandle(subName: string, grant: AttestationGrant,
                  opts?: { ttlSeconds?, expiresAt?, jti?, now? }): Promise<Attestation>;
  validateSessionOptions(options: { audience: string; scopes: string[]; ttl: number }): void;
  bindWallet(descriptor: WalletDescriptor): void;  // attach a chain wallet (rc.3)
  getWallet(chain: string): WalletDescriptor | null;   // SubHandle inherits both
  dispose(): void;                    // zeroize key; capability methods throw DisposedError
}
```

### `SubHandle` (leaf, MAX_DEPTH = 2)

```typescript
class SubHandle extends Handle {
  getPath(): string[];                // ['station-001', 'connector-ccs'] — a copy
  getPathString(): string;            // 'station-001/connector-ccs'
  getDepth(): number;                 // always 2
  isLeaf(): boolean;                  // always true
  getSubMetadata(): SubHandleMetadata; // defensive copy of constraints
  validateSessionOptions(options: { audience: string; scopes: string[]; ttl: number }): void;
  // deriveSubHandle is overridden and ALWAYS throws (leaf node)
}
```

### Object lifecycle (`dispose()`)

`Identity` and `Handle` own true `#private` key material. `dispose()`
zeroizes the private key and permanently revokes every capability method
(`sign`, derivations, attestation issuance) — they then throw
`DisposedError`. Informational getters (`getName`, `getId`,
`getPublicKey`, metadata) keep working: public keys are not secrets.
Serialization is redacted by design — `JSON.stringify(handle)` and
`console.log(handle)` emit only `{ kind, id, name, path? }`, never key
material. Defensive copies on inputs and getters mean caller-side
mutation never reaches the stored keys.

```typescript
const handle = await identity.deriveHandle('station-001');
try {
  // ... use the handle ...
} finally {
  handle.dispose(); // key material zeroized; idempotent
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
  readonly sid;   // lineage id (rc.10) — undefined on legacy tokens
}

interface SessionOptions {
  audience: string; scopes: string[]; ttl: number; sessionId?: string;
  sid?: string;   // lineage id: random by default; pass the previous
                  // session's sid to keep a renewal in the same lineage
}

interface SessionPayload {            // signed token contents
  hId: string; hNm: string; hPath?: string[];
  aud: string; scp: string[]; exp: number; iat: number; jti: string;
  sid?: string;                       // lineage id (rc.10): random at
                                      // creation, stable across renewals
}

interface RevocationChecker {
  isRevoked(jti: string): Promise<boolean>;
  // consulted with BOTH the session jti and the lineage sid (when
  // present): revoking the sid disables the whole renewal lineage,
  // revoking a jti disables exactly one token.
}
```

### `Attestation`

```typescript
class Attestation {
  static issue(signer: Signer, subjectPublicKey: Uint8Array,
               subjectName: string, grant: AttestationGrant,
               opts?: { ttlSeconds?, expiresAt?, jti?, now? }): Promise<Attestation>;
  static decode(token: string): AttestationPayload;      // structure only — no sig, no time
  static verifySignature(token: string, signerPublicKey: Uint8Array): Promise<boolean>;
  static matchNamePattern(name: string, patterns: string[]): boolean;
  get payload(): AttestationPayload;
  get token(): string;
  get jti(): string;
}

interface Signer {                  // the issuance contract (D2)
  sign(data: Uint8Array): Promise<Uint8Array>;
}
// Identity, Handle and SubHandle implement Signer; custom
// (remote/HSM-backed) signers are accepted structurally. Raw private
// keys are NOT accepted as of 1.0.0-rc.1 — the signer's key stays encapsulated.

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

### Payment layer (`payment.ts` / `payment-x402.ts` / `wallet-binding.ts`)

The chain-agnostic payment surface (landed rc.3–rc.7; execution lives in
[`@me2em/solana`](https://www.npmjs.com/package/@me2em/solana), transport in
[`@me2em/x402`](https://www.npmjs.com/package/@me2em/x402)):

```typescript
interface PaymentRequest {          // what the buyer must execute (v1.2 §3)
  chain: string;                    // exact CAIP-2 chain id
  payTo: string;                    // recipient address on that chain
  amount: string;                   // decimal string in WHOLE token units
  asset: string;                    // chain-native sentinel or token id (Solana native: 'sol')
  reference: string;                // 32-byte correlation key — chain-level REPLAYED detection
  expiresAt: number;                // unix seconds — observations after this are EXPIRED
  extra?: Me2emExtra;               // sellerId?, buyerId?, memo?, reference?, agreementProof?
}

type PaymentResult =
  | { status: 'success'; observedAt: number }
  | { status: 'failure'; reason: PaymentFailureReason; observedAt: number };

type PaymentFailureReason =
  | 'NOT_FOUND' | 'UNDERPAID' | 'WRONG_RECIPIENT' | 'WRONG_ASSET'
  | 'EXPIRED' | 'REPLAYED' | 'CHAIN_UNAVAILABLE' | 'REJECTED'
  | 'REFERENCE_MISMATCH'            // the tx exists but is not an execution of THIS request
  | 'PACT_INVALID' | 'BUYER_NOT_ATTESTED' | 'SELLER_NOT_ATTESTED';
// fail-safe rule for consumers: unknown runtime values MUST be treated as 'REJECTED'

interface WalletDescriptor {        // a wallet bound to an entity — never carries key material
  chain: string; address: string; derivationPath?: string; label?: string;
}

interface WalletAdapter {           // registered per exact CAIP-2 chain (registry key = chain)
  readonly chain: string;
  resolveWallet(entity: WalletEntityRef, opts?: { seed?: Uint8Array; index?: number }):
    Promise<WalletDescriptor>;      // deterministic adapters require opts.seed → else TypeError
  isValidAddress(address: string): boolean;   // structural format check only
  nextIndex?(usedPaths: string[]): number;    // chain-scoped allocation; core has no fallback
}

interface PaymentAdapter extends WalletAdapter {
  pay(from: WalletDescriptor, request: PaymentRequest,
      opts?: { seed?: Uint8Array; memo?: string }): Promise<string>;  // → txRef; throws on failure
  verifyPayment(txRef: string, request: PaymentRequest): Promise<PaymentResult>;
  verifyWalletBinding?(wallet: WalletDescriptor, entity: WalletEntityRef,
                       attestation: Attestation): Promise<boolean>; // chain-specific strength
}

registerWalletAdapter(adapter: WalletAdapter): () => void;  // last-wins per chain; idempotent disposer
getWalletAdapter(chain: string): WalletAdapter | null;
parseChain(chain: string): { namespace: string; reference: string } | null;  // CAIP-2 grammar
isValidChain(chain: string): boolean;
```

The x402 v2 wire types (`payment-x402.ts` — types + structural guards
only, no network; `X402_VERSION = 2`):

```typescript
interface X402PaymentRequirements {  // one payable option inside a 402 response
  scheme: string;                    // 'exact', 'eip3009', 'permit2-exact', …
  network: string;                   // exact CAIP-2 chain id
  amount: string;                    // ATOMIC units — decimal string, /^[0-9]+$/
  asset: string;                     // contract address or ISO 4217 code
  payTo: string;                     // recipient address on network
  maxTimeoutSeconds: number;         // integer ≥ 1
  extra?: Readonly<Record<string, unknown>>;
}
interface X402ResourceInfo { url: string; description?; mimeType?; serviceName?; tags? }
// + X402PaymentRequired / X402PaymentPayload / X402SettleResponse / X402VerifyResponse / X402Supported
isX402PaymentRequired(v) / isX402PaymentRequirements(v) / isX402PaymentPayload(v) /
isX402SettleResponse(v) / isX402VerifyResponse(v) / isX402Supported(v)   // never throw
```

Wallet binding (`wallet-binding.ts` — the default Mode-1/Mode-2 check,
v1.2 §6): three fail-closed checks, `false` on any miss, never throws:

```typescript
verifyWalletBinding(wallet, entity, attestation, { issuerPublicKey }): Promise<boolean>
//   1. attestation signature verifies under the issuer's public key
//   2. attestation.subjectId === entity.id   (subject agreement)
//   3. attestation.subjectWallet === wallet.address
// Chain adapters may add strength (Solana: on-curve check) — see @me2em/solana.
```

### Name normalization

All string derivation inputs are canonicalized: `NFKC → lowercase →
trim`. NFKC applies to string inputs only — `revision` (a positive
integer) is canonical by construction and is never normalized.
Names are then validated against `/^[a-z0-9][a-z0-9._@-]{0,62}$/`; names
with `/`, non-ASCII letters, or > 64 chars **throw**. Password/channel
contexts use the same canonical form without the character-set pattern
(a context is a caller-defined label, not a wire identifier) but MUST
NOT be empty after canonicalization. Identical inputs always produce
identical keys across platforms and entry points.

### Secret revision model (rotation)

`derivePassword` and `deriveChannelKey` take a `revision` (positive
integer, default `1`). A `revision` is a monotonic integer — canonical
by construction; the NFKC canonicalization above applies to the string
`context` only. Revision 1 is the initial secret — byte-identical
to the frozen v1.0 derivation. Revision `N ≥ 2` derives a secret that is
cryptographically independent of revision 1 for the same context: the
sanctioned rotation path when a credential leaks, without changing the
context string. Both parties of a channel MUST bump the revision in
lockstep.

```typescript
const github = handle.derivePassword('github');                  // revision 1
const rotated = handle.derivePassword('github', { revision: 2 }); // after a breach
const long   = handle.derivePassword('github', { byteLength: 32 });
const channel = handle.deriveChannelKey('telemetry-v1', { revision: 2 }); // both peers!
```

Info strings: `me2em/secret/v1` → `me2em/secret/v1/rN`,
`me2em/channel/v1` → `me2em/channel/v1/rN` (centralized in
`DERIVATION_PATHS.password(revision?)` / `.channel(revision?)`).
`byteLength` accepts an integer in `[1, 8160]` (RFC 5869 bound); the
output is prefix-stable — the first `n` bytes of a longer derivation
equal the `n`-byte derivation.

**Choosing revision values (application-level convention).** A
`revision` is an opaque positive integer — the protocol deliberately
does not assign meaning to it (mechanism, not policy). Common
app-level conventions: date-stamped rotations (`20261009` = `YYYYMMDD`,
keeps the rotation history readable), small enum-like codes for named
credential generations, or a hash of a human-readable label mapped
into the integer range — the last one reproduces the same secret from
the label across implementations without storing the mapping. The
label↔revision mapping (where one exists) is public metadata: keep it
next to the credentials it describes (e.g. in the password manager's
notes) — the secret itself is protected by the seed alone.

### Resource-state keys (`deriveResourceKey`, since rc.9)

The third derivation domain (`me2em/resource/`): a 32-byte key for a
specific **access state** of a resource — the primitive behind
owner-controlled unlock, revocation and re-grant without a trusted
server. Two independent integer dimensions: `epoch` (which period of
the context — a day index, a block height, a subscription period) and
`revision` (the access state: `0` = locked — **valid here**, unlike
password/channel, where revision must be ≥ 1 — `1` = unlocked, `N ≥ 2`
= re-granted period or rotation). Components are canonicalized
(NFKC → lowercase → trim) and charset-validated (no `/`, `:`,
whitespace; type ≤ 63, id ≤ 128 characters — pass a content hash, a
UUID or a slug, not a URI), so the salt join
`me2em/resource/{type}/{id}` is injective. The normative contract and
usage examples live in the TSDoc of `Handle.deriveResourceKey` — the
single source of documentation.

```typescript
const hash = 'e3b0c442…'; // sha256 hex of the content = resource id
const original = handle.deriveResourceKey('chat-msg', hash);                  // unlocked
const blur     = handle.deriveResourceKey('chat-msg', hash, { revision: 0 }); // locked
const month2   = handle.deriveResourceKey('stream', 'ch-42', { revision: 2 }); // new period
const daily    = handle.deriveResourceKey('chat-msg', hash, { epoch: 20261105 });
```

Info strings: `me2em/resource/v1` → `…/e{epoch}` → `…/r{revision}`
(epoch precedes revision; a segment is omitted when the value equals
`1`), centralized in `DERIVATION_PATHS.resource(epoch?, revision?)`.

## 🎯 Core Use Cases

Mapped to the official registry — see [USE_CASES.md](./USE_CASES.md):

- **UC-5 — Deterministic password manager** — derive secrets per service, store nothing.
- **UC-2 — IoT fleets with encrypted channels** — devices operate fully offline.
- **Stateless multi-device sync** — same seed → same handles everywhere (spans UC-3/UC-4).
- **UC-1 / UC-2 — Delegatable access control** — attestation chains grant scope- and
  time-limited access, verifiable by external parties.

👉 **[USE_CASES.md](./USE_CASES.md)** — nine scenarios: AI agents, satellite capacity
marketplace, drone fleet management, multi-app SSO, multi-context identity, EV
charging, corporate messenger, password manager, E2EE messenger — plus a production
Redis `RevocationChecker`.

## 🔐 Cryptographic Details

- **Identity:** `Ed25519 key = HKDF-SHA256(seed, salt="", info="me2em/identity/v1/root", 32)`
- **Handle:** `HKDF-SHA256(identityKey, salt="", info="me2em/handle/v1/{name}", 32)`
- **SubHandle:** `HKDF-SHA256(handleKey, salt="", info="me2em/subhandle/v1/{handle}/{sub}", 32)`
- **Signatures:** Ed25519 (RFC 8032); tokens are `base64url(payload).base64url(signature)`
- **Attestation payload limit:** 2048 bytes; **session payload limit:** 4096 bytes
- **Clock skew tolerance:** ±30 seconds on all time checks
- **Derivation module:** the formulas above live in the `crypto`
  namespace — `crypto.deriveRootKey`, `crypto.deriveHandleKey`,
  `crypto.deriveSubHandleKey`, plus `crypto.rawX25519SharedSecret` for
  the raw X25519 (Montgomery) ECDH step of the P2P derivation. Both
  SubHandle entry points (`handle.deriveSubHandle` and
  `identity.deriveSubHandle`) share `crypto.deriveSubHandleKey`, so
  their outputs are byte-identical by construction.
- **Raw primitives in `crypto`:** besides the derivation module, the
  namespace exposes documented Ed25519 wrappers (`crypto.getPublicKey`,
  `crypto.sign`, `crypto.verify` and their `*Async` variants) and the
  `crypto.hkdf` / `crypto.sha256` helpers — building blocks for tooling
  outside the token flow (the protocol itself signs through
  `Identity`/`Handle`/`SubHandle`, which implement `Signer`). The
  wrappers are real functions rather than alias re-exports so TSDoc
  ownership and TypeDoc typing stay in-package (`treatWarningsAsErrors`);
  they are frozen public API (spec §12) — removal is a breaking 2.0.0
  decision, do not propose.
- **Auto-init:** importing `@me2em/core` synchronously configures the
  Ed25519 backend (sha512 wiring for `@noble/ed25519`). There is no
  init call to remember and no async setup — the first sign/verify/derive
  can run immediately after import. The guarantee is structural, not
  conventional: the package exposes a single entry point (the `exports`
  map allows only `.` — deep subpath imports such as
  `@me2em/core/crypto/*` are not part of the public API), and every
  module that touches Ed25519 imports the backend from
  `crypto/init.ts`, which configures it on module load. Any code path
  that can reach a crypto operation therefore loads the configured
  backend first, in any import order (pinned by `test/arch-cycle.spec.ts`;
  see specs/v1.0.md §11 for the module-structure contract).

## ⚙️ Runtime & Limits

**Runtimes**

- **Node.js ≥ 22.6** (`engines.node`, A2 — Node 18/20 are EOL; CI pins
  Node 22).
- Modern browsers and edge runtimes. Portability is pinned by tests:
  base64url comes from `@scure/base` — `btoa`/`atob` are banned from
  `src/` by a source-scan test; `jti` generation uses
  `crypto.randomUUID` with a `getRandomValues`-based v4 fallback.
- The Ed25519 backend auto-initializes at import (structural guarantee —
  see Cryptographic Details above); modules are side-effect-free at the
  top level otherwise.

**Limits**

| Limit | Value | Enforced |
|-------|-------|----------|
| Attestation payload | ≤ 2048 bytes (`ATTESTATION_MAX_PAYLOAD`, exported) | rejected before decode |
| Session payload | ≤ 4096 bytes | rejected before decode |
| Clock-skew tolerance | ±30 seconds on all time checks | `EXPIRED` / `NOT_YET_VALID` |
| Derivation tree depth | `MAX_DEPTH = 2` — a `SubHandle` is always a leaf | `MAX_DEPTH_EXCEEDED` |
| Password `byteLength` | integer 1–8160 (RFC 5869: 255 × SHA-256), default 16 | `MALFORMED`/`FORMAT` |
| Session `ttl` | positive integer (seconds), capped by the grant's `maxSessionTtl`; the session cannot outlive the earliest attestation expiry | `MALFORMED` / `TTL_EXCEEDED` |
| `jti` length | non-empty, ≤ 256 characters | `MALFORMED` |

**Key lifecycle:** `dispose()` zeroizes the private key (`fill(0)`) and
permanently revokes all capability methods (`DisposedError`); it is
idempotent. Hard zeroization cannot be guaranteed in a JS runtime —
GC/JIT may retain copies (see `THREAT_MODEL.md` §5.2 in the repository).

## 🛡️ Security Best Practices

✅ **Do**:
- Store seeds encrypted (PIN/biometric + AES-GCM); keep the root offline
  except for issuance ceremonies.
- Use short session TTLs (≤ 1 hour recommended).
- Implement a `RevocationChecker` (e.g., Redis SET) — in `verifyAttested`
  it is consulted for attestation `jti` values, and for the session
  `jti` **and** lineage `sid` (rc.10): revoking a session's `sid`
  disables every token of that renewal lineage in one move.
- Thread the `sid` through renewals (the `@me2em/react` `useSession`
  hook does this automatically) — a renewal with a fresh random `sid`
  starts a lineage the old id cannot revoke.
- Prefer `verifyAttested` for any external audience; reserve
  `verifyStateless` for infrastructure you fully control.
- Scope `subNamePatterns` as narrowly as possible — a holder can do
  everything *inside* its wildcard.

❌ **Don't**:
- Never transmit seeds; keep derivation client-side.
- Don't reuse Handles across unrelated contexts.
- Don't log private keys or seed phrases.
- Don't rely on zeroing buffers as a hard guarantee — GC/JIT may retain
  copies; zeroization hardening is tracked in the repository backlog.

## 🧪 Testing

```bash
cd packages/core && pnpm test
```

The test suite (502 tests) covers: deterministic derivation and
cross-entry-point key consistency, name canonicalization, derivation
revisions (r1 byte-parity, r2 independence, NFKC contexts), session
lifecycle (create, verify, tamper, expiry, iat), session lineage
revocation (`sid`: renewal threading, wholesale lineage revocation,
legacy tokens, malformed values), revocation, SubHandle
constraint enforcement, MAX_DEPTH leaf enforcement, attestation
issue/decode/signature determinism and validation, the full
`verifyAttested` chain (28 cases including nesting, wildcard permitting,
revocation at every level, signature robustness, BIP39 passphrase
derivation, and wordlist validation), module-structure and
crypto-boundary pins, and parser fuzz (~1 050 rounds) — plus the
payment surface: `PaymentRequest`/`PaymentResult` semantics, the
adapter-registry last-wins contract, CAIP-2 grammar, the `isX402*`
guards against upstream spec vectors, the `verifyWalletBinding`
fail-closed order, and `bindWallet`/`getWallet` on entities.

## 🗺️ Roadmap

Passphrase support and `dispose()` zeroization have shipped, and the
payment-layer surface landed additively in rc.3–rc.7 (contracts +
registry + wallet binding in rc.3, x402 wire types in rc.5, the `pay`
`opts` parameter in rc.6, the settle-response guard fix in rc.7) under
the payment-layer specification (`specs/tz-x402.md` in the repository).
Session lineage revocation (`sid`) shipped in rc.10: `Session.create`
stamps a random lineage id, renewals thread it, and revocation checks
both `jti` and `sid`. Remaining recommendations — zeroization
hardening, attestation reference compression, and the vertical
packages (`@me2em/messenger`, `@me2em/iot`) — are tracked in the
repository backlog, which is advisory and not part of the shipped API
contract.

The identity/session public API is **frozen** as of `1.0.0-rc.1` — see
`specs/v1.0.md` §12 in the repository for the evolution rules; the
payment surface follows the same freeze discipline per its own spec
(the only post-freeze breaking change, `PaymentFailureReason` growth in
rc.5, is recorded in the CHANGELOG).

## 📜 License

Apache License 2.0.

© 2026 Me2eM Organization. Built for privacy, openness, and user sovereignty.
