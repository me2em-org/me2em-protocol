# README (rc.2)

# @me2em/pact

Horizontal trust primitive for the Me2eM authorization protocol: signed
agreements between independent Identities **without merging trust roots**.

```
@me2em/pact 1.0.0-rc.2
  peer:         @me2em/core   >=1.0.0-rc.9 <2.0.0-0   // hkdf, sha256, ed25519, jcs.canonicalize, RevocationChecker.isRevokedAt?
  peerOptional: @me2em/crypto >=1.1.0-rc.2 <2.0.0-0   // only for ReferenceX3DH (transport)
```

## What it gives you

| Surface | Entry points |
|---|---|
| **Deterministic Pact Keys** (D3/D38) | `derivePactKey(anchorSecretKey, pid, ch, gen)` — HKDF `me2em/pact/v1/{pid}/{ch}/g{gen}`; `pactPub = crypto.getPublicKey(pactKey)` (Р1) |
| **Append-only Pact Journal** | 11 event types (`GENESIS … DISSOLVE`), `evHash = SHA-256(JCS(event without sig))` chaining, strict codec (`encodeEvent`/`decodeEvent`, D35 limits) |
| **Verification — Tier 1+2** (sync) | `verifyJournal(events, clock?, opts?)` (`skewCheck: 'all' \| 'none'`), `verifyPrefix(events, head, clock?)` — signatures + roster/constitution replay |
| **Verification — Tier 3** (async) | `verifyAct(events, evHash, revocations?, chains?, clock?)` — dated revocation via core rc.9 `isRevokedAt`, voucher chains (hash-commit D34), compromise windows (D20) |
| **2-party assembly** (A2) | `assembleGenesis` + 10 follow-up builders; every builder re-verifies the extended journal (B-7, fail-closed) |
| **Storage** (C1/D41) | `JournalStore` (CAS-append ⇒ `FORK_DETECTED`), `MemoryStore` |
| **Sneakernet** (D47) | `exportJournal` / `importJournal` — newline-delimited canonical JCS, byte-exact, signature sets preserved (B-8) |
| **Transport** (C4/D44) | `Channel` interface (inject your own), `ReferenceX3DH` — real-crypto loopback adapter over `@me2em/crypto` |
| **Testing fixtures** | deterministic members, chained journal builder, real voucher chains — see `src/testing/fixtures.ts` |

## 60-second tour

```ts
import { crypto } from '@me2em/core';
import { derivePactKey, assembleGenesis, verifyJournal, MemoryStore, evHash, ZERO32 } from '@me2em/pact';

// 1. Pact keys derive from the anchor node's raw private key (Р2):
const pactKey = derivePactKey(handleKey /* from crypto.deriveHandleKey */, pid, ch, 0);
const pactPub = crypto.getPublicKey(pactKey);

// 2. Assemble GENESIS — every founder co-signs:
const genesis = assembleGenesis({
  pid, ch, cx: 'joint charging agreement',
  cn: { th: {}, im: 'pinned', w: false },
  ft: [{ p: pubA, pp: anchorPubA, an: 'identity' }, { p: pubB, pp: anchorPubB, an: 'identity' }],
  founderKeys: [keyA, keyB],
});

// 3. Verify (Tier 1+2) and store (CAS):
const result = verifyJournal([genesis], { now: () => genesis.iat });
const store = new MemoryStore();
await store.append(ZERO32, genesis);
```

## Errors

One error type — `PactError { code, context }`, message `CODE @ CONTEXT`
(ТЗ §5): `MALFORMED · FORK_DETECTED · INVALID_QUORUM · REVOKED · SKEW ·
UNKNOWN_EVENT_TYPE · ANCHOR_MISMATCH · WEIGHT_MISMATCH · IDP_UNRESOLVABLE ·
PAYLOAD_TOO_LARGE · SIGNATURE_INVALID`.

## Limitations (v0.1)

- **2-party assembly** — the verifier is N-party-generic; k-signature
  assembly arrives in v0.2 (PACTS F1).
- **O(N²) replay in assembly** — `finalize` re-verifies the whole
  prefix per event (O(N) each); fine for 2-party journals, an
  incremental `verifyPrefix` is scheduled for rc.3 (audit Б2).
- **`pactRoot` = evHash(GENESIS)** (PACTS §2) — the deterministic pact
  *name*, not a roster fingerprint. A roster digest for the
  transparency feed (BL-12/F8) would be a separate future field —
  never a redefinition of `pactRoot`.
- **Binary transport (CBOR)** — v1.0 (F5); the wire format is
  canonical JCS.
- **`verifyJournal` warnings** — always `[]` (Р9): Tier 3 lives only
  in the async `verifyAct`.

## Normative documents

- Implementable spec: `specs/tz-pact.md` (v1.0, rev. 2)
- Design base: `docs/PACTS.md` (D1–D47, payload tables §7.3, signing §7.5,
  verification order §7.7)
- Test vectors: `specs/test-vectors.json`, section `pact` (derivation,
  envelope, replay, export)
