# 📖 Me2eM Protocol — Glossary

Normative terminology for the Me2eM protocol. Protocol terms are
**domain-neutral** — each use case assigns them its own meaning
(domain interpretations: [Domain interpretations](#domain-interpretations)
below and the root [README → Use Cases](./README.md#-use-cases)).

This file is the single source of term definitions for all READMEs,
specs, and articles. Package READMEs keep only a short selection of the
terms most relevant to the package and link here. Changes to term
definitions are protocol-level decisions and go through a Decision
Record in [BACKLOG.md](./BACKLOG.md).

---

## Core terms

| Term | Definition |
|------|------------|
| **Identity** | Root cryptographic identity derived from a seed phrase (BIP39, optionally with passphrase) or 32 raw bytes. Constant forever; every other key in the hierarchy derives from it. |
| **Handle** | A derived, attested, named key representing a distinct identity context — a persona, a device, an app persona. |
| **SubHandle** | A child of a Handle, always a leaf (MAX_DEPTH = 2). Derived deterministically from the Handle key; cannot derive children. |
| **Attestation** | A parent-signed statement binding a child key to a name and a grant. |
| **Session** | A stateless signed authorization token: `base64url(payload).base64url(signature)`. |
| **Channel** | A long-lived E2EE relationship derived from an X3DH shared secret. |
| **Transient material** | Key bytes existing only in RAM at the moment of use. |
| **Ephemeral material** | TTL-bound rotating material (SPK/OTK, cache keys, session tokens). |

---

## Sessions & verification

| Term | Definition |
|------|------------|
| **verifyStateless (Mode 1)** | Direct verification: the verifier re-derives the signer's public key from the token using an `Identity` — the root **private** key. Only for the key holder or backend trusted with the root. SubHandle constraints are enforced at session **creation** only. |
| **verifyAttested (Mode 2)** | Chain verification against the root **public** key: grants are **enforced at verification time**, and revoking an attestation disables the whole branch. For external audiences and delegation. |
| **Attestation chain** | Ordered attestation tokens, root first, one per level; the session token is verified against the key bound by the last link. |
| **Session payload** | Signed token contents: `hId`, `hNm`, `hPath?`, `aud`, `scp`, `exp`, `iat`, `jti`. |
| **jti** | Unique session/attestation identifier; the key used for revocation checks. |
| **RevocationChecker** | Optional consumer interface (`isRevoked(jti)`); in `verifyAttested` it is consulted for attestation **and** session `jti`. |
| **Branch revocation** | Revoking an attestation `jti` disables current **and** future sessions under that branch. |
| **Attestation payload limit** | 2048 bytes (session payload: 4096 bytes). |
| **Clock skew tolerance** | ±30 seconds on all time checks. |

---

## Attestation grants

`AttestationGrant` — the signed grant carried by every attestation:

| Field | Meaning |
|-------|---------|
| `audiences` | Allowed `aud` values for sessions under this attestation. `undefined` = unrestricted; `[]` = deny all (fail-closed). |
| `scopes` | Exact permission strings, no wildcards. Child grants must nest inside parent grants. |
| `maxSessionTtl` | Upper bound for session `ttl`, seconds, > 0. |
| `subNamePatterns` | Root→handle attestation only: which SubHandle names may be derived; wildcard — trailing `*` only. |

---

## Names & derivation

| Term | Definition |
|------|------------|
| **Canonical name** | All derivation inputs are canonicalized: NFKC → lowercase → trim, then validated against `/^[a-z0-9][a-z0-9._@-]{0,62}$/`. Names containing `/`, non-ASCII letters, or longer than 64 chars throw. Identical inputs always produce identical keys across platforms and entry points. |
| **Derivation path** | HKDF info strings centralized in `packages/core/src/crypto/derivation-paths.ts`: `me2em/identity/v1/root`, `me2em/handle/v1/{name}`, `me2em/subhandle/v1/{h}/{s}`, `me2em/p2p-channel/v2`. Changing any of these strings is a BREAKING CHANGE and requires a new versioned `/v2` path. |
| **MAX_DEPTH** | 2 — `Identity` → `Handle` → `SubHandle`; `SubHandle` is always a leaf. |

---

## @me2em/crypto terms

| Term | Definition |
|------|------------|
| **X3DH** | Extended Triple Diffie–Hellman key agreement, canonical per Signal spec §3.3: OTK mandatory on both sides, zero-fallback prohibited. |
| **SPK** | Signed Pre-Key — pre-published key signed by the identity key. |
| **OTK** | One-Time Pre-Key — consumed per handshake; mandatory for canonical X3DH. |
| **PreKeyBundle** | The published set (identity key + SPK + OTKs) a peer initiates an X3DH handshake against. |
| **Epoch** | Channel rotation unit; forward secrecy holds at epoch rotation points. |
| **Envelope** | Self-contained X3DH key wrapping for offline recipients; deterministic-IV media chunk encryption. |
| **UKS** | Unknown key-share attack. Prevented by binding both peers' public keys into the KDF (`p2p-channel/v2`). |
| **Argon2id** | Password KDF with named profiles (INTERACTIVE / SENSITIVE) plus verification. |
| **HIBP** | "Have I Been Pwned" breach check guarding password creation. |

---

## @me2em/react terms

| Term | Definition |
|------|------------|
| **Headless layer** | Framework-agnostic state machines and logic (no React imports), `src/headless/`; the future `@me2em/sdk`. |
| **Context cache** | Per-identity encrypted storage of derived Handle context: IndexedDB + AES-GCM with a non-extractable persisted CryptoKey. |
| **Seed UX** | Show-once seed display, order-verification grid, per-word import validation against the BIP39 wordlist, passphrase input. |

---

## Brand forms

Writing canon: **Me2eM** for everything human-facing and **me2em** for
machine contexts (npm, code identifiers, domains, URLs, CLI);
`Me2em` is a forbidden typo form. The canon governs prose only —
existing code identifiers (e.g. `Me2emProvider`, `useMe2emContext`)
are code artifacts and are not renamed. Normative text:
[README → Brand & Naming](./README.md#-brand--naming).

---

## Domain interpretations

The same primitives, read through different lenses:

| Use case | Handle is… | SubHandle is… |
|----------|------------|----------------|
| **AI Agent Delegation** (UC-1) | An AI agent acting on behalf of a user | — (the agent signs sessions directly) |
| **IoT Device Hierarchy** (UC-2) | A physical device | A component of that device |
| **Multi-Context Identity** (UC-3) | A user persona (work, personal) | Delegated access within a persona |
| **Multi-App SSO** (UC-4) | A per-app persona of the user | — |
| **Deterministic Password Manager** (UC-5) | A service context | — |
| **E2EE Messaging** (UC-6) | The user's messaging identity | An optional device identity |

Full scenarios: [`packages/core/USE_CASES.md`](./packages/core/USE_CASES.md).
