## 📦 Pact — Horizontal Trust Between Independent Identities

Signed agreements between independent Identities **without merging trust
roots** — the horizontal primitive of the Me2eM authorization protocol.

[![version](https://img.shields.io/badge/version-1.0.0--rc.4-blue)](https://github.com/me2em-org/me2em-protocol/blob/main/packages/pact/CHANGELOG.md)
[![License](https://img.shields.io/github/license/me2em-org/me2em-protocol)](../../LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.6-green)](https://nodejs.org)

Me2eM attestation chains are **vertical**: a parent *has authority over* a
child and signs its existence. Between two independent Identities no vertical
relation exists — and core deliberately forbids attesting foreign keys. A
**pact** is the horizontal counterpart: independent parties *agree*. Nobody
attests anybody; each party records itself into a shared, signed document
(the Pact Journal). The pact exists only because its members signed it.

As a federation model this is **context-intersection**: domains are never
joined by signing each other (no cross-signing, no bridge CA, no DID-resolver
mesh). Instead, a *third context* is created with its own derived keys:

- Root keys of the domains never meet. Zero trust between domains by default;
  consent is explicit per pact.
- Cross-domain unlinkability holds **by construction**: different pacts derive
  different keys from different HKDF info strings — even the same
  counterparty cannot link two of your pacts.
- No central database: the journal is a replicated public artifact whose
  integrity is checked by hash equality of heads, not by consensus.

Constraints honored: no seed ever leaves its owner; federation is opt-in;
non-federated usage of the core is unaffected.

**The two-axis principle.** Every node of the Me2eM tree can act in two
directions: *down* (attest children) and *sideways* (enter pacts). The level
you act from determines both the breadth of authority and the horizon of
obligations.

---

## 📖 Terminology

| Term | Definition |
|---|---|
| **Pact** | A signed agreement-context between independent Identities: `pid` + canonical context + journal. Covers pair contracts and cohorts alike ("corporation" = long-lived pact). |
| **Pact ID (`pid`)** | b64url(16) random bytes; set when GENESIS is assembled, lives until DISSOLVE. Uniqueness even for identical context texts. |
| **Context (`cx` / `ch`)** | The subject of the agreement. Normative form `ch` = b64url(SHA-256(UTF-8(cx))); inline `cx` (≤ 2048 B) is check-verified against `ch`. The context may travel fully out-of-band — then `ch` is a pure commitment. |
| **Pact Key** | Deterministic Ed25519 key derived from an anchor node's raw private key, bound to `(pid, ch, gen)` ([§5](#-key-derivation)). |
| **Anchor** | The tree node the Pact Key derives from: `identity` / `handle` / `subhandle`. Declares the lifetime policy ([§4](#-anchors--lifetime-policy)). |
| **Enrollment** | Signed journal event binding a Pact Key to the pact. Its evHash is the **membership id** (founders share the evHash of GENESIS). |
| **Roster** | Canonical set of ACTIVE members at a given seq: `{ p, w, e }[]` sorted by `p` (lexicographic, normative). |
| **Pact Root** | `evHash(GENESIS)` — the deterministic pact *name* and root of trust (PACTS §2), stable for the whole pact lifetime. Not a roster digest: the transparency-feed digest is a separate computed field, `rosterDigest` ([§7.4](#-wire-format)) — never a redefinition of `pactRoot`. |
| **JournalHead** | evHash of the last journal event — the integrity fingerprint of the whole history (`ZERO32` when empty). |
| **Pact Journal** | Append-only, hash-chained event log; the single source of truth about membership and constitution. |
| **Act** | A co-signed journal event carrying a document commitment — `ACT` (new), `REVERSE_ACT` (supersede/reversal), `AMEND` (constitution replacement). Acts are never deleted or edited (D19). |
| **Voucher (`vc`)** | Hash-commit `{ rh, rp }` linking a membership to an attestation chain: `rh` = SHA-256(JCS(chain)), `rp` = the root Identity pub. The privacy/accountability dial (D6). |

## 📦 Installation

```sh
pnpm add @me2em/pact        # pulls @me2em/core as a peer
pnpm add @me2em/crypto      # optional — only for the reference X3DH adapter
```

> 💡 The package depends on nothing but `@me2em/core` (peer
> `>=1.0.0-rc.9`); `@me2em/crypto >=1.1.0-rc.2` is an optional peer, needed
> only for the reference X3DH transport adapter (loaded lazily — importing
> the transport subpath never pulls it). Real deployments inject their own
> transport and storage (see
> [Storage, sneakernet, transport](#-storage-sneakernet-transport)).
> Public surface:
> - **root** — `types` · `errors` · `codec` · `derive` · `verify` ·
>   `assemble` · `store`;
> - **`@me2em/pact/transport`** (since rc.5) — the `Channel` contract,
>   OFFER/ACCEPT wire types and the reference `ReferenceX3DH` adapter;
> - **`@me2em/pact/testing`** (since rc.5) — deterministic test fixtures
>   (members, journal builder, voucher chains). The subpaths are
>   integration material, not protocol surface: they may evolve within
>   the rc line without a major bump.

## 🚀 Quick Start

A two-party pact (A, B founders) that admits C, records an act, supersedes
it, and dissolves. Every assembly call re-verifies the extended journal
fail-closed (B-7); verification is sync (Tier 1+2).

```ts
import { crypto } from '@me2em/core';
import {
  assembleGenesis, assembleInvite, assembleEnroll, assembleAct,
  assembleReverseAct, assembleExit, assembleDissolve,
  derivePactKey, verifyJournal, evHash, b64urlEncode,
} from '@me2em/pact';
import type { Clock, Constitution, Event, Founder } from '@me2em/pact';

const utf8 = (s: string) => new TextEncoder().encode(s);
const sha256b64 = (s: string) => b64urlEncode(crypto.sha256(utf8(s)));
const clockAt = (t: number): Clock => ({ now: () => t });
const T0 = 1700000000;

// 1. Pact identity: random 16-byte pid + the context commitment (D4).
//    (globalThis.crypto is the Web Crypto global, Node ≥ 19 — the `crypto`
//    imported from @me2em/core is the primitives namespace and has no RNG.)
const pid = b64urlEncode(globalThis.crypto.getRandomValues(new Uint8Array(16)));
const cx = 'joint charging agreement, tariff schedule v3';
const ch = sha256b64(cx);                      // SHA-256(UTF-8(cx)) == ch

// 2. Pact keys derive from the anchor nodes' raw private keys.
//    Identity anchor here: crypto.deriveRootKey(seed). Handle anchors use
//    crypto.deriveHandleKey(rootKey, name); SubHandle: deriveSubHandleKey.
const rootA = crypto.deriveRootKey(utf8('alice-seed-material'));
const rootB = crypto.deriveRootKey(utf8('bob-seed-material'));
const rootC = crypto.deriveRootKey(utf8('carol-seed-material'));
const keyA = derivePactKey(rootA, pid, ch, 0); // gen 0 on joining
const keyB = derivePactKey(rootB, pid, ch, 0);
const keyC = derivePactKey(rootC, pid, ch, 0);
const pubA = b64urlEncode(crypto.getPublicKey(keyA));
const pubB = b64urlEncode(crypto.getPublicKey(keyB));
const pubC = b64urlEncode(crypto.getPublicKey(keyC));

// 3. Constitution: defaults are `all` for every event type except
//    DISSOLVE, which defaults to `any` (deadlock-free exit, A2).
const cn: Constitution = { th: { DISSOLVE: { m: 'any' } }, im: 'bearer', w: false };

// 4. GENESIS — every founder co-signs (regardless of thresholds).
//    Founders are sorted by pactPub, strictly ascending (PACTS §7.3).
const ft: Founder[] = [
  { p: pubA, pp: b64urlEncode(crypto.getPublicKey(rootA)), an: 'identity' },
  { p: pubB, pp: b64urlEncode(crypto.getPublicKey(rootB)), an: 'identity' },
];
ft.sort((a, b) => (a.p < b.p ? -1 : 1));

let events: Event[] = [assembleGenesis({
  pid, ch, cx, cn, ft,
  founderKeys: ft.map((f) => (f.p === pubA ? keyA : keyB)), // must cover ft.p exactly
  clock: clockAt(T0),
})];

// 5. Two-phase join (D25): INVITE (ACTIVE members sign) → ENROLL
//    (signed by the joiner only; nobody is enrolled against their will).
const invite = assembleInvite(events, { an: 'identity', dn: 'Carol' }, [keyA, keyB], clockAt(T0));
events = [...events, invite];
const enroll = assembleEnroll(events, { ref: evHash(invite), dn: 'Carol' }, [keyC], clockAt(T0));
events = [...events, enroll];

// 6. An act: a bare commitment (`dh`) or inline `doc` check-verified
//    against `dh` (D34). Heavy material may always travel out-of-band.
const doc = 'Session 7 delivered 42 kWh at station D-12.';
const act = assembleAct(events, { dh: sha256b64(doc), doc }, [keyA, keyB, keyC], clockAt(T0));
events = [...events, act];

// 7. Supersede the act (D19) — acts are never edited, only countered.
events = [...events,
  assembleReverseAct(events, { ref: evHash(act), k: 'supersede', rs: 'tariff corrected' },
    [keyA, keyB, keyC], clockAt(T0))];

// 8. Verify (Tier 1+2, sync): signatures + deterministic roster replay.
const result = verifyJournal(events, clockAt(T0));
result.ok;                    // true
result.pactRoot;              // evHash(GENESIS) — the deterministic pact name
result.journalHead;           // evHash of the last event
result.seq;                   // last event's sq
result.roster;                // [{ p, w, e }] sorted by p — 3 members, e = membership evHash
result.rosterDigest;          // b64url(SHA-256(JCS(roster))) — the transparency-feed fingerprint
result.warnings;              // [] — Tier 3 findings live in verifyAct only

// 9. Exit and dissolve (unilateral EXIT, D18a; DISSOLVE default `any`).
events = [...events, assembleExit(events, { rs: 'leaving' }, [keyC], clockAt(T0))];
events = [...events, assembleDissolve(events, { rs: 'done' }, [keyB], clockAt(T0))];
verifyJournal(events, clockAt(T0)).ok; // true — history stays verifiable forever
```

> **Throws vs results.** `verifyJournal` / `verifyPrefix` / `verifyAct`
> *return* `{ ok: false, error }` instead of throwing; the assemblers, the
> codec and the stores *throw* `PactError` (fail-closed — a caller never
> gets a usable event out of a failed assembly). Match on
> `error.code` + `error.context`, never on message text
> ([Errors and warnings](#-errors-and-warnings)).

## 🧭 Anchors = lifetime policy

The parent level of the Pact Key is not an implementation detail — it is a
declared **death policy** for the pact (PACTS D1–D3, ТЗ §3.2). The anchor
type is declared on the INVITE (field `an`, required) and in the founder
entries, and the voucher chain must match it fail-closed (D12):
**identity → 1 attestation, handle → 2, subhandle → 3** (`ANCHOR_MISMATCH`
otherwise).

| | Identity | Handle | SubHandle |
|---|---|---|---|
| Analogy | personal signature | corporate seal / mandate | power of attorney |
| Anchor key derives via | `crypto.deriveRootKey(seed)` | `crypto.deriveHandleKey(rootKey, name)` | `crypto.deriveSubHandleKey(…)` |
| Pact dies by | dissolution only | revoke/TTL of the handle attestation | TTL of B / revoke B.jti / cascade from A — **passive death possible** |
| Outlives people | — | ✅ | ❌ by design |
| Ceremony per pact | root deployment | attestHandle (once) | **none** (leaf acts autonomously) |
| Privacy | root pub is a global correlator | per-mandate (M1: unlinkable) | minimal; pacts unlinkable even per employee |
| Blast radius | — | one pact / department | narrowest grant in the chain |
| Voucher chain | `[A]` (1) | `[A, B]` (2) | `[A, B, C]` (3) — root first |
| Typical pact TTL | years–decades | months–years | hours–months |

Anchor **public** keys do enter the journal as commitments (founder `pp`,
`vc.rp`); anchor **private** keys never do — only HKDF derivatives sign.

Profiles (deployment patterns over the same mechanism):

- **M1 "seal per pact" (default)**: root → Handle `pact-{hex(pid)}` per pact;
  the pact key derives from that handle. Turnover-immune; blast radius = 1 pact.
- **M2 "contracting department"**: root → `contracts` Handle (once) → role
  subhandles per pact.
- **M3 "personal root"**: the Identity anchors directly (solo operators;
  opt-in, worst privacy).

Canonical scenario (SubHandle anchor, self-destructing pact):

```
Identity: Building-Corp (cold)
  └─ Handle: security-office ◀─ A: patterns ['officer-*'], scopes ['access:grant']
       └─ SubHandle: officer-7734 ◀─ B: TTL = employment contract term
            └─(HKDF me2em/pact/v1)→ PactKey ── ENROLL ──▶ pact "FaceID @ lobby-3"
```

Offboarding = revoke `B.jti` (through core's revocation service): the
officer's authority in the pact terminates — `verifyAct` returns
`REVOKED @ (SUB_ATTESTATION)`; past acts remain verifiable forever (the audit
trail is not rewritten; [Verification](#-verification)). Reinstatement = a new
attestation `B′` with a fresh `jti` over the **same** subject key — the Pact
Key derives from the node key, not from `jti`, so roster, seq and pact are
untouched (D22).

The right to form pacts is expressed through ordinary grant mechanics of
core (design D9: reserved scope `pact:sign`, audience `pact:{pid}`); a
personal signature of a natural person on acts is a dual-signature, opt-in,
out-of-chain flow (D10). Cross-principal attestation (attesting a foreign
personal key) is out of scope — that is federation territory.

## 🔑 Key derivation

```
pactKey(anchorNode, gen) = Ed25519.from(HKDF-SHA256(
  IKM  = anchorNode.rawPrivateKey,
  salt = "",
  info = "me2em/pact/v1/{pid}/{ch}/g{gen}",   // versioned info string (D38)
  L    = 32 ))
```

```ts
import { crypto } from '@me2em/core';
import { derivePactKey, b64urlEncode } from '@me2em/pact';

const pactKey = derivePactKey(handleKey /* crypto.deriveHandleKey(rootKey, name) */, pid, ch, 0);
const pactPub = b64urlEncode(crypto.getPublicKey(pactKey)); // Р1: no separate derivation
```

- `pid` — b64url(16) random bytes: uniqueness even for identical texts.
- `ch` — SHA-256 of the canonical context; **inside the info string** ⇒ any
  amendment of the context text = different keys = fail-closed detection (D4).
- `gen` — 0 at enrollment, `+1` per ROTATE_KEY (D38): rotation stays
  deterministic; recovery = anchor key + public journal (gen is public data).
- The raw key exists only in the caller's memory; anchor *instances*
  (`Identity`/`Handle` objects) are deliberately not accepted — pass raw
  private keys obtained through core's namespace exports.

## 📓 The journal model

Append-only, hash-chained (D11): `sq` strictly monotonic from 0,
`ph[i] == evHash(prev)`, `ph[0] == ZERO32`, one `pid` per journal. Any
divergence ⇒ `FORK_DETECTED` (fail-closed; history before the split point
stays valid, D27).

### 6.1 Events and payloads (normative, PACTS §7.3)

| Type | Payload fields | Signed by |
|---|---|---|
| `GENESIS` | `ch` · `cx?` · `cn` Constitution · `ft` Founder[] (1..16, sorted by `p`, ≤ 1 `vc` total) | all founders (co-signature, regardless of `th`) |
| `INVITE` | `dn?` ≤64 · `w?` ≥1 · `an` (required) · `ep?` — invitee pactPub (required under `im: 'pinned'`) | ACTIVE ≥ constitution `INVITE` |
| `REVOKE_INVITE` | `ref` = evHash(INVITE) · `rs?` ≤256 | ACTIVE ≥ constitution; acts only on an **unused** invite (D14) |
| `ENROLL` | `ref` = evHash(INVITE) · `dn?` ≤64 · `w?` (repeats INVITE verbatim, B-6) · `vc?` | **joiner only** (self-event) |
| `EXIT` | `rs?` ≤256 | exiting member's **current** key (self-event, D18a) |
| `EVICT` | `tp` = target pactPub · `rs?` ≤256 | ACTIVE ≥ constitution `EVICT` |
| `ROTATE_KEY` | `np` (new pactPub ≠ old) · `ca?` = compromisedAt (D20) | **exactly two**: current key + new key (D39) |
| `ACT` | `dh?` b64url(32) · `doc?` ≤2048 (requires `dh`, SHA-256 == `dh`) · `no?` ≤32 | ACTIVE, Σw ≥ k(`ACT`) |
| `REVERSE_ACT` | `ref` = evHash(ACT) · `k`: `'supersede' \| 'reversal'` · `rs?` ≤256 | ACTIVE, Σw ≥ k |
| `AMEND` | `cn` = FULL new constitution · `no?` ≤32 | threshold in force **before** the event (B-4/D23) |
| `DISSOLVE` | `rs?` ≤256 | ACTIVE, default `{ m: 'any' }` |

Membership lifecycle: `INVITE` creates a pending invite; `ENROLL` consumes
it (one-time — a used/revoked/unknown `ref` ⇒ `MALFORMED`, D14). EXIT and
EVICT remove the member from the roster; re-entry is possible through a
**new** invite — a fresh membership chain with its own id (D18).
`REVOKE_INVITE` cancels an unused invite. `AMEND` replaces the constitution
wholesale (fail-closed — nothing merges). `DISSOLVE` is terminal for the
pact itself.

### 6.2 Constitution and quorum (PACTS §4)

```ts
interface Constitution {
  th: Partial<Record<EventType, Threshold>>;  // per event type
  im: 'pinned' | 'bearer';                    // invite mode (D13)
  w: boolean;                                 // weights enabled (B-6)
}
interface Threshold { m: 'all' | 'any' | 'k-of-active' | 'founder'; k?: number }
```

- **Defaults** for unset `th[ty]`: everything is `{ m: 'all' }`, except
  `DISSOLVE` = `{ m: 'any' }` (deadlock-free exit). `im` and `w` have no
  defaults — they are required constitution fields.
- **Quorum mass** (over ACTIVE members at the event's seq; weights when
  `w: true`, else counts): `any` → 1; `all` → the whole ACTIVE mass;
  `k-of-active` → `min(k, active mass)` (B-5 compression); `founder` → all
  founders (from GENESIS). Signatures from non-ACTIVE keys do not count.
- **Freeze per type (D28):** `n_active` below the requirement freezes only
  that event type (`INVALID_QUORUM`); EXIT (a self-event) and DISSOLVE
  (default `any`) stay reachable. Recommend headroom — `k(ACT)=2-of-5`,
  not 4-of-5.
- **B-5 validation:** a constitution with `k(DISSOLVE) > n_founders`
  rejects at GENESIS and at every AMEND (dissolution must stay reachable).
- **D13 invite modes:** `pinned` — every INVITE must carry `ep` (the
  invitee's pactPub); an ENROLL by any other key ⇒ `INVALID_QUORUM`.
  `bearer` — whoever presents it; `ep` is still allowed as a per-invite
  tightening. Nobody can be enrolled against their will either way (the
  joiner signs).
- **EVICT and the target (D26′):** the target must be ACTIVE; the target
  does not assemble their own eviction. Under the default `all` every
  ACTIVE member must sign — including the target — which makes EVICT
  unreachable in 2-party (EVICT ≡ DISSOLVE there). Real eviction setups set
  `EVICT: k-of-active` with `k < n`.
- **Multisig, not threshold signatures (D24):** m individual Ed25519
  signatures in one `sig[]` — personal attribution is a legal property
  ("signed by Ivanov and Petrov"). ≤ 16 signatures per event (enforced);
  m ≤ 7 recommended.

### 6.3 N-party in code

Continues the quickstart bindings (`pid`, `ch`, the roots, member keys,
`sha256b64`, types from `@me2em/pact`). No clock is injected here —
assemblers and the verifier then default to the system clock (skew ±30 s
applies); pass an injected `Clock` for deterministic replays, as the
quickstart does.

```ts
import { assembleGenesis, assembleInvite, assembleEnroll, assembleAct,
         assembleEvict, assembleRotate, assembleAmend, verifyJournal,
         derivePactKey, b64urlEncode } from '@me2em/pact';
import { crypto } from '@me2em/core';

const cn: Constitution = {
  th: {
    ACT:   { m: 'k-of-active', k: 2 },
    EVICT: { m: 'k-of-active', k: 2 },   // the two non-target members suffice
    DISSOLVE: { m: 'any' },
  },
  im: 'pinned',                           // every INVITE must carry ep
  w: true,
};

const ft: Founder[] = [
  { p: pubA, pp: b64urlEncode(crypto.getPublicKey(rootA)), an: 'identity', w: 2 },
  { p: pubB, pp: b64urlEncode(crypto.getPublicKey(rootB)), an: 'identity', w: 1 },
];
ft.sort((a, b) => (a.p < b.p ? -1 : 1));
let events: Event[] = [assembleGenesis({ pid, ch, cx, cn, ft, founderKeys: [keyA, keyB] })];

// pinned: the INVITE carries the invitee's pactPub; ENROLL repeats `w` verbatim (B-6).
const invC = assembleInvite(events, { an: 'identity', dn: 'Carol', w: 1, ep: pubC }, [keyA, keyB]);
events = [...events, invC];
events = [...events, assembleEnroll(events, { ref: evHash(invC), dn: 'Carol', w: 1 }, [keyC])];

// k-of-active: any 2 of the 3 ACTIVE members carry the act (Σw ≥ min(k, mass)).
events = [...events, assembleAct(events, { dh: sha256b64('maintenance window approved') }, [keyB, keyC])];

// EVICT: the target does not sign; k=2 of 3 active ⇒ A and B evict C.
events = [...events, assembleEvict(events, { tp: pubC, rs: 'breach of schedule' }, [keyA, keyB])];

// ROTATE_KEY (D39): exactly the current key + the new key sign; the new key
// derives from the same anchor with gen + 1. `ca` (unix seconds) opens a
// compromise window (D20) — omitted here, this is a planned rotation.
const keyB1 = derivePactKey(rootB, pid, ch, 1);
events = [...events, assembleRotate(events, { np: b64urlEncode(crypto.getPublicKey(keyB1)) }, [keyB, keyB1])];

// AMEND: full replacement; the quorum uses the constitution BEFORE the event.
events = [...events, assembleAmend(events, { cn: { ...cn, th: { ...cn.th, ACT: { m: 'all' } } }, no: 'raise ACT bar' }, [keyA, keyB1])];

verifyJournal(events).ok; // true
```

### 6.4 Fork policy (D27)

Two competing events at the same seq — or any chain divergence — reject with
`FORK_DETECTED`; history **before** the split point stays valid. Prevention
is honestly out of scope (no consensus layer). The detection amplifier is
BL-12: publish `(seq, PactRoot, JournalHead, rosterDigest)` to a
transparency feed. Institutional resolution: consolidate off-protocol, or
dissolve and re-form. Stores make the race explicit with CAS-append
([Storage, sneakernet, transport](#-storage-sneakernet-transport)).

## 📡 Wire format

### 7.1 Encoding and envelope (D31–D33)

Canonical form: **JSON per RFC 8785 (JCS)** — sorted keys, no whitespace,
UTF-8. All hashes and signatures are computed **only** over the JCS form.
Binary fields: unpadded base64url (RFC 4648 §5, canonical — re-encode must
match). Time: unix seconds, integer; skew ±30 s against the injected Clock
(inclusive bounds, C3). Numbers: integers only. Strict parse inside `v1`:
unknown envelope or payload fields ⇒ reject (D33, fail-closed). The payload
string fields are taken as-is (no NFKC/case-fold normalization — byte and
character caps are the only slack; D35).

```jsonc
{
  "typ": "me2em/pact-event/v1",
  "pid": "b64url(16)",          // pact id
  "sq":  0,                     // strictly monotonic from 0
  "ph":  "b64url(32)",          // evHash of the previous event; ZERO32 at sq 0
  "ty":  "GENESIS",             // one of the 11 registry types (D28: closed)
  "pl":  { /* per type — §6.1 */ },
  "iat": 1730000000,
  "sig": [ { "p": "b64url(32)", "s": "b64url(64)" } ]   // pactPub + Ed25519(TBS)
}
```

- **TBS = JCS(event without `sig`)** — all signers sign identical bytes;
  `evHash` is stable under incremental k-quorum assembly.
- **evHash = b64url(SHA-256(TBS))** — the universal event id. `typ` inside
  TBS ⇒ domain separation; `pid` inside TBS ⇒ no cross-pact replay (D32).
- Duplicate signers in `sig[]` ⇒ `MALFORMED`; the codec accepts only
  canonical base64url.

### 7.2 Limits (D35)

payload (JCS `pl`) ≤ 4096 B · inline `doc`/`cx` ≤ 2048 B · ≤ 16
signatures/event · ≤ 16 founders · `dn` ≤ 64 chars · `rs` ≤ 256 · `no` ≤ 32.
Violations ⇒ `PAYLOAD_TOO_LARGE` (codec, export, import — nothing is
skipped, Р8). A 5-founder GENESIS with inline context ≈ 1.3 KB.

### 7.3 Hash-commit (D34)

The journal stores hashes; heavy material (contract text, act documents,
voucher chains) travels out-of-band once. Inline fields are optional and
check-verified: `SHA-256(UTF-8(cx)) == ch`; `doc` requires `dh` and
`SHA-256(UTF-8(doc)) == dh`. A `vc` commits to a chain by `rh` — the
artifact must match at verification time or the act fails
(`MALFORMED`, [Verification](#-verification)).

### 7.4 Fingerprints (D36)

```
roster(seq)      = ACTIVE members sorted by pactPub; entry = { p, w, e }
PactRoot(seq)    = evHash(GENESIS)          // the pact name — constant
JournalHead(seq) = evHash(last event)       // whole history
RosterDigest(seq)= b64url(SHA-256(JCS(roster(seq))))   // rc.4, BL-12/F8
```

`pactRoot` + `journalHead` are the public anchors for the transparency feed
(BL-12/BL-13) and for blind comparison UX (group the b64url in 5-char
blocks, Signal-style); `rosterDigest` (rc.4) adds the roster fingerprint —
a separate field by design (`pactRoot` is never redefined, PACTS §2),
replica-safe by construction: the canonical roster carries no signature
sets (B-8), so two replicas with differing `sig[]` share the digest. A
verifier anchored on a known JournalHead re-checks a foreign journal
cheaply: the committed prefix costs a hash-integrity pass (no signatures),
only the suffix is verified in full — the BL-10 pattern (loss of the cache
degrades performance, not security).

## ✅ Verification

### 8.1 Tier 1+2 — sync replay

```ts
verifyJournal(events, clock?, opts?)            // full journal
verifyPrefix(events, head, clock?)              // prefix must end at `head`
createJournalVerifier(clock?, opts?)            // incremental (rc.3)
```

Order is normative (PACTS §7.7): **(1)** chain — sq/`ph`/pid, `ph[0] ==
ZERO32` ⇒ `FORK_DETECTED`; **(2)** envelope — strict parse, limits, skew,
distinct signers, Ed25519 over TBS (`SIGNATURE_INVALID`); **(3)** quorum and
semantics — the constitution in force **at the event's seq** (freeze, D28);
self-events (`ENROLL`/`EXIT`/`ROTATE_KEY`) are exempt from the
ACTIVE-signer rule.

`verifyJournal` returns `{ ok, roster, rosterDigest, pactRoot, journalHead,
seq, warnings: [] }` or `{ ok: false, error }` — Tier 3 never runs here
(Р9). `opts`: `{ skewCheck: 'all' | 'none' }` — `'none'` skips the skew
comparison for structural replays outside the reference era (assembly
`finalize`, archive replay); everything else verifies in full.

`JournalVerifier` is the streaming face of the same replay — there is no
second "fast" verification path:

```ts
const v = createJournalVerifier(clockAt(T0));
v.applySuffix(events.slice(0, 4));   // full check per event; height/head update
v.applySuffix(events);               // committed prefix = cheap hash-integrity pass
v.height; v.head;                    // 4; evHash(events[3])
v.snapshot();                        // same shape as a clean verifyJournal
```

- The committed prefix is protected by a hash-commitment re-derived from the
  caller's actual array on every call — a diverged journal rejects with
  `FORK_DETECTED` (fail-closed, no silent recompute; run `verifyJournal`
  for a from-scratch diagnosis of the exact cause).
- **Atomicity invariant:** a failed `apply`/`applySuffix` leaves the
  committed state byte-identical (every check precedes every mutation —
  pinned by tests, including a failed *first* apply and a suffix failing
  mid-way). A failed apply also latches nothing: `pid` commits with the
  event.
- Sequential lifecycles cost ~9 µs/event (integrity pass + one event) vs
  ~2.9 ms/event for a foreign-prefix full replay — measured on the bench
  baseline (`specs/tz-pact-rc3-incremental.md`).

```ts
// A subscriber with a pinned head (BL-10): the prefix must end exactly there.
const r = verifyPrefix(events.slice(0, 4), pinnedHead, clockAt(T0));
r.ok; // false with FORK_DETECTED if the prefix diverges — the prefix itself stays valid (D27)
```

### 8.2 Tier 3 — async act verification

```ts
await verifyAct(events, actEvHash, revocations?, chains?, clock?)
```

Full journal replay first (Tier 1+2), then the normative dated-revocation
flow (Р3). The "act" is any of `ACT` / `REVERSE_ACT` / `AMEND`.

1. **Compromise windows (D20)** — journal-deterministic: an act signed by a
   key later rotated with `ca` rejects with `REVOKED @ (ROTATE_KEY)` when
   `act.iat > ca`; older acts pass with warning `PRE_COMPROMISE_ACT`
   (history is not rewritten). Rotation without `ca` is planned — no window.
2. **Tier 3 gate:** a `RevocationChecker` without `isRevokedAt` (or no
   checker at all) ⇒ `tier3: 'unsupported'`, warning `TIER3_UNSUPPORTED`,
   `ok: true` — a graceful degradation to Tier 2, never a false "clean".
3. **Voucher chains** — out-of-band artifacts `{ chain: string[] }` keyed by
   membership id (`evHash` of the membership event; founders share the
   GENESIS id). Per signer: no `vc` ⇒ warning `NO_VOUCHER` (the dial is
   off, D6); a `vc` without an artifact ⇒ warning `VOUCHER_UNRESOLVED`;
   `SHA-256(JCS(chain)) != vc.rh` ⇒ `MALFORMED`; a chain that does not
   verify ⇒ `IDP_UNRESOLVABLE` (a `vc` is a checkable promise of
   accountability — fail-closed).
4. **Chain rules (D12/§5.4):** root-first serialized core attestations;
   length must match the anchor (`ANCHOR_MISMATCH`); each token verifies
   against the previous subject (root against `vc.rp`; founders must bind
   to the journal's `pp`); the chain must be **alive at the act** —
   `iat ≤ act.iat < exp` for every attestation (`IDP_UNRESOLVABLE`
   otherwise).
5. **Dated revocation:** every chain `jti` is checked with
   `revocations.isRevokedAt(jti, act.iat)` (inclusive on `at`); `true` ⇒
   `ok: false`, `REVOKED @ (SUB_ATTESTATION)`.

```ts
import { Attestation, crypto, canonicalize } from '@me2em/core';
import { verifyAct, b64urlEncode } from '@me2em/pact';
// clockAt, T0, actHash, membershipId — from the earlier examples.

// Out-of-band artifact (built once when the membership is created):
const chain = { chain: [(
  await Attestation.issue(
    { sign: async (data) => crypto.sign(data, rootKey) },   // root Identity signer
    crypto.getPublicKey(rootKey), 'pact-root',
    { scopes: ['pact'], maxSessionTtl: 300 },
    { jti: 'att-a1', now: T0, ttlSeconds: 3600 },
  )
).token] };
const vc = { rh: b64urlEncode(crypto.sha256(canonicalize(chain.chain))), rp: rootPubB64 };
// ... the journal entry (founder `ft[].vc` / ENROLL `pl.vc`) carries only `vc`.

const checker = {
  isRevoked: async () => false,
  isRevokedAt: async (jti, at) => revocationStore.isRevokedAt(jti, at), // dated lookup
};
const r = await verifyAct(events, actHash, checker, new Map([[membershipId, chain]]), clockAt(T0));
r.ok; r.tier3;         // true; 'supported'
r.warnings;            // e.g. [{ code: 'NO_VOUCHER', evHash: membershipId }]
```

`verifyAct` returns `roster` / `rosterDigest` / `pactRoot` / `journalHead`
and `seq` of the act — everything needed to attach a Tier-3 verdict to an
audit record.

## 💾 Storage, sneakernet, transport

### 9.1 Storage — CAS-append (C1/C2/D41)

```ts
interface JournalStore {
  append(expectedHead: string, event: Event): Promise<void>; // CAS ⇒ FORK_DETECTED
  read(): Promise<Event[]>;                                  // snapshot
  head(): Promise<string>;                                   // ZERO32 when empty
}
```

`append` fails with `FORK_DETECTED` when the store head has moved — the
caller re-reads, re-verifies and retries on the winning branch (optimistic
concurrency; history before the split stays valid, D27). `MemoryStore` is
the reference implementation (O(1) head, early chain checks). Persistence,
replication and retention belong to the implementation.

```ts
import { MemoryStore, exportJournal, importJournal, evHash, ZERO32 } from '@me2em/pact';

const store = new MemoryStore();
let head = ZERO32;
for (const e of events) { await store.append(head, e); head = evHash(e); }

// Sneakernet (D47): newline-delimited canonical JCS, byte-exact both ways;
// signature sets are preserved (B-8 — evHash equality alone does not prove
// byte equality of replicas).
const bytes = exportJournal(events);
const replica = importJournal(bytes);       // strict per-line parse, nothing skipped
Buffer.compare(bytes, exportJournal(replica)) === 0; // true
```

### 9.2 Transport — offer/accept over an authenticated channel (C4/D44/D8)

OFFER/ACCEPT are **wire types, not journal events** — they never enter the
journal:

```
0. OFFER (any channel): { typ: 'me2em/pact-offer/v1', pid, ch, cx?, ep? }
   — context finalized; `ep` is the X25519 ephemeral key of the initiator.
1. B derives pactKey_B(pid, ch, 0) → ACCEPT { typ: 'me2em/pact-accept/v1', pid, pactPub }
   — over an authenticated channel (X3DH; @me2em/crypto 1.1.0-rc.2).
2. A assembles GENESIS(fd=[A, B]) → signs → B verifies the signature and
   co-signs the same TBS → journal[0].
```

Founders skip INVITE — they are born in GENESIS. A mismatched `ch` at step 1
fails derivation — the context binding of D4 detects text divergence with
zero extra protocol. The transport MUST be authenticated: the MITM window on
`ch` finalization is the documented first-contact problem (Signal's), and
`pactRoot` blind comparison is the amplifier (BL-12, out of v0.1).

The reference adapter (`ReferenceX3DH`) is a complete real-crypto loopback —
X3DH against the authority's prekey bundle, then GENESIS co-signing. It and
the `Channel` interface are exported from the **`@me2em/pact/transport`**
subpath (rc.5); the adapter loads `@me2em/crypto` lazily, so the subpath
stays core-only at import time (B2). Wire your own `Channel` (server relay,
messenger, sneakernet) for production — the subpath exists so real delivery
can start from the reference adapter and swap the transport later without
touching the journal.

## 🚨 Errors and warnings

One error type — `PactError { code, context }`, message `CODE @ CONTEXT`
(D36; the code table is normative, ТЗ §5). Consumers match on `code` +
`context`, never on message text.

| Code | Meaning | Contexts |
|---|---|---|
| `MALFORMED` | Grammar: unknown/missing field, non-canonical b64url, bad invite state, sorted-order violation, commitment mismatch | codec, derive, verify, assemble, store, export, import, transport |
| `FORK_DETECTED` | Chain divergence: sq/ph/pid mismatch, two events at one seq, CAS head moved, committed-prefix divergence | verify, store |
| `INVALID_QUORUM` | Signatures below the constitution's requirement (or a pinned-`ep`/self-event signer mismatch) | verify |
| `REVOKED` | Act signed after `compromisedAt` (ROTATE_KEY) or an attestation `jti` revoked at/before `act.iat` (SUB_ATTESTATION) | verify |
| `SKEW` | `iat` outside ±30 s of the Clock (skippable with `skewCheck: 'none'`) | verify |
| `UNKNOWN_EVENT_TYPE` | Event type outside the closed v1 registry | codec, verify |
| `ANCHOR_MISMATCH` | Voucher chain length ≠ anchor type (identity↔1, handle↔2, subhandle↔3) | verify |
| `WEIGHT_MISMATCH` | ENROLL weight ≠ INVITE weight (B-6) | verify |
| `IDP_UNRESOLVABLE` | Voucher chain undecodable, not alive at `act.iat`, or not binding to `vc.rp`/`pp` | verify |
| `PAYLOAD_TOO_LARGE` | D35 limits exceeded (payload/inline/sigs/founders/string caps) | codec, verify |
| `SIGNATURE_INVALID` | Ed25519 verification over TBS failed | verify, transport |

Warnings (non-fatal, on the `VerifyResult.warnings` list, each tagged with
the act's evHash or the membership id): `PRE_COMPROMISE_ACT` (act before the
rotation's `ca`), `TIER3_UNSUPPORTED` (no dated checker), `NO_VOUCHER`
(signer without a voucher — the dial is off, D6), `VOUCHER_UNRESOLVED`
(`vc` present, artifact missing). Sync `verifyJournal` always returns
`warnings: []` (Р9 — Tier 3 findings live in the async `verifyAct` only).

```ts
try {
  await store.append(head, event);
} catch (e) {
  if (e instanceof PactError) {
    // e.g. 'FORK_DETECTED @ store: expected head ... != current ...'
    log.warn(`${e.code} @ ${e.context}`);
  }
}
```

## 🛡️ Privacy and security summary

- **Unlinkability by construction** — different pacts, different info
  strings, different keys; even the same counterparty cannot link two of
  your pacts (M1 anchors make pacts unlinkable across mandates as well).
- **Recovery without secrets** — anchor key + public journal rebuild
  everything (gen is public data); nothing to back up except the anchor
  material itself.
- **MITM window** — enrollment/finalization of `ch` (the first-contact
  problem); mitigations: X3DH-authenticated transport, PactRoot/JournalHead
  blind comparison (BL-12), pinned invites (`ep`).
- **Compromise containment** — anchor private keys never appear in pacts;
  ROTATE_KEY requires both the current and the new key (D39); `ca` bounds
  retro-trust honestly (acts after `ca` die, acts before keep a warning).
- **Non-repudiation** — personal multisig signatures; acts never deleted,
  only countered (`REVERSE_ACT`); dated revocations (D17) make past
  verifiability precise instead of absolute.
- **Fail-closed everywhere** — strict codec, closed event registry, CAS
  stores, hash-committed verifier state, check-verified inline material;
  nothing is skipped, coerced or repaired on the wire.

## ⚠️ Limitations (honest blast radius)

- **2-party assembly** — the verifier is N-party-generic; assembly ships the
  co-signature flows above (k-signature events are assembled by passing the
  corresponding signer key sets).
- **Assembly replay cost** — a sequential lifecycle verifies only the new
  event (the `JournalVerifier` fast path, rc.3: ~9 µs/event integrity pass
  vs ~2.9 ms/event full replay); a *foreign* prefix (cache miss) still costs
  a full O(N) replay, fail-closed by design (Б2 closed;
  `specs/tz-pact-rc3-incremental.md`). Strict O(1) per assembly would need
  commitments in the wire format — out of scope before the v1 byte freeze.
- **No invite TTL** — invites expire by revocation (`REVOKE_INVITE`) or
  single use (D14), not by time; a TTL field is a v1-byte-freeze decision.
- **One voucher per membership event** — founders share the GENESIS
  membership id, so at most one founder `vc` per GENESIS resolves
  unambiguously (codec-enforced).
- **Raw string fields** — no NFKC/trim normalization in the pact codec;
  byte/char caps are the only slack. Keep context/doc bytes canonical
  before hashing (`SHA-256(UTF-8(cx)) == ch` is checked verbatim).
- **`verifyJournal` warnings** — always `[]` (Р9): Tier 3 lives only in the
  async `verifyAct`.
- **Deferred by design** — threshold signatures (FROST/BLS, D24), nested
  pacts (D30), roles (D29), zombie N-party expiry (D37), binary transport
  (D40), the transparency feed itself (BL-12/13 — the interface points
  shipped: `pactRoot`/`journalHead`/`rosterDigest`), dual personal
  signature (D10). Do not improvise these in production (P-4).

## 🌐 Relation to the ecosystem

| Item | Relation |
|---|---|
| BL-12 | `pactRoot` + `journalHead` + `rosterDigest` (rc.4) are natural transparency-feed entries; the fork-detection amplifier (D27) |
| BL-13 | the same feed detects re-enrollment/re-attestation patterns |
| BL-15 | `pact:`-namespace convention (design D21): journal-local revocation keeps the checker load off the hot path |
| BL-10 | journal-suffix verification against a pinned JournalHead (`JournalVerifier` integrity pass, `verifyPrefix`) |
| BL-58 | this package: the pact machine of PACTS (design → `specs/tz-pact.md` → `@me2em/pact`) |

Positioning: a pact key ≈ a pairwise DID computable offline, before any
registration; the journal ≈ a replicated DID document without hosting;
`pactRoot` ≈ a Signal safety number; roster + constitution ≈ SPIFFE
registration without a SPIRE server. X.509 cross-certification solves the
same problem by *merging* trust roots — pacts avoid merging entirely.
Matrix identity servers (central, linkable) are the anti-pattern this design
avoids.

## ❓ Open questions

1. **Nested pacts** (holding structures) — verification induction, privacy (D30).
2. **Threshold signatures** (FROST/BLS) for large cohorts — sacrifices
   personal attribution (D24).
3. **Zombie members at N-party** — inactivity expiry via AMEND? (D37).
4. **Roles / scoped quorums** — treasurer, admin; AMEND extension (D29).
5. **Binary transport** (CBOR deterministic / protobuf) with a bit-exact
   round-trip invariant, for constrained verticals (D40).
6. **Journal replication profile** — gossip/relay conventions and the
   hosting-free guarantee; reference server endpoints are product scope
   (the former BL-22 / `@me2em/server` reference, annulled 2026-11-24).
7. **Session adapter** — the PactKey as a Handle-compatible signer for
   `audience: pact:{pid}` sessions, or a dedicated API (pairs with D9's
   `pact:sign` scope — both unimplemented in crypto/core today).

## 📚 Design decisions and normative documents

The decision log D1–D47 with the full rationale lives in
[`docs/PACTS.md`](../../docs/PACTS.md) §9 (adopted design; the numbering in
early planning drafts is superseded by it). The implementable spec is
[`specs/tz-pact.md`](../../specs/tz-pact.md) (v1.0, rev. 2); the rc.3
incremental-verification track is
[`specs/tz-pact-rc3-incremental.md`](../../specs/tz-pact-rc3-incremental.md).
Golden vectors: [`specs/test-vectors.json`](../../specs/test-vectors.json),
section `pact` (derivation, envelope, replay, pinned invites, liveness,
export) — 11 rows, each pinned to a consumer in the test suite
(`test/vectors.spec.ts`). 128 tests, coverage 97/92/98/97 (lines/branches/
functions/statements), `tsc` (src, scripts and tests) and eslint clean.

Package facts: ESM only (`"type": "module"`, exports `.` → `dist/`), ships
`dist` + `src` + types; peer deps `@me2em/core >=1.0.0-rc.9` and optional
`@me2em/crypto >=1.1.0-rc.2`; Node ≥ 22.6; Apache-2.0.

## 📜 License

Apache License 2.0.

© 2026 Me2eM Organization. Built for privacy, openness, and user sovereignty.
