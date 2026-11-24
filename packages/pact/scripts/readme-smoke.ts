// packages/pact/scripts/readme-smoke.ts
//
// Validates every code example destined for packages/pact/README.md.
// Runs against ../dist (same import face as downstream users) with
// `node --experimental-strip-types` after `tsc -p tsconfig.json`.
// Not committed — a README-authoring aid.

import { Attestation, crypto } from '@me2em/core';
import type { RevocationChecker } from '@me2em/core';
import {
  assembleGenesis, assembleInvite, assembleEnroll, assembleAct,
  assembleReverseAct, assembleRotate, assembleExit, assembleDissolve,
  assembleEvict, assembleAmend, assembleRevokeInvite,
  derivePactKey, verifyJournal, verifyPrefix, verifyAct,
  createJournalVerifier, MemoryStore, exportJournal, importJournal,
  evHash, b64urlEncode, ZERO32, PactError,
} from '../dist/index.js';
import type { Clock, Constitution, Event, Founder, VoucherChain } from '../dist/index.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const sha256b64 = (s: string): string => b64urlEncode(crypto.sha256(utf8(s)));
const clockAt = (t: number): Clock => ({ now: () => t });
const T0 = 1700000000;

const assert = (cond: boolean, label: string): void => {
  if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
  console.log(`ok: ${label}`);
};

// ---------------------------------------------------------------------------
// Example 1 — quickstart: 2-party pact with a third member joining
// ---------------------------------------------------------------------------

// Anchor keys: raw private keys of the hierarchy nodes (Identity here).
const rootA = crypto.deriveRootKey(utf8('alice-seed-material'));
const rootB = crypto.deriveRootKey(utf8('bob-seed-material'));
const rootC = crypto.deriveRootKey(utf8('carol-seed-material'));

// The pact identity: random 16-byte pid + the context commitment (D4).
const pid = b64urlEncode(globalThis.crypto.getRandomValues(new Uint8Array(16)));
const cx = 'joint charging agreement, tariff schedule v3';
const ch = sha256b64(cx); // SHA-256(UTF-8(cx)) — the D4 context binding

// Pact keys derive from the anchor keys (D3/D38) — one per member.
const keyA = derivePactKey(rootA, pid, ch, 0);
const keyB = derivePactKey(rootB, pid, ch, 0);
const keyC = derivePactKey(rootC, pid, ch, 0);
const pubA = b64urlEncode(crypto.getPublicKey(keyA));
const pubB = b64urlEncode(crypto.getPublicKey(keyB));
const pubC = b64urlEncode(crypto.getPublicKey(keyC));

// Founders are sorted by pactPub (PACTS §7.3) and cover ft.p exactly.
const ft: Founder[] = [
  { p: pubA, pp: b64urlEncode(crypto.getPublicKey(rootA)), an: 'identity' },
  { p: pubB, pp: b64urlEncode(crypto.getPublicKey(rootB)), an: 'identity' },
];
ft.sort((a, b) => (a.p < b.p ? -1 : 1));

const cn2p: Constitution = { th: { DISSOLVE: { m: 'any' } }, im: 'bearer', w: false };

const genesis = assembleGenesis({
  pid, ch, cx, cn: cn2p, ft,
  founderKeys: ft.map((f) => (f.p === pubA ? keyA : keyB)),
  clock: clockAt(T0),
});

let events: Event[] = [genesis];

// The joiner derives its own key from the OFFER (pid + ch) and enrolls.
const invite = assembleInvite(events, { an: 'identity', dn: 'Carol' }, [keyA, keyB], clockAt(T0));
events = [...events, invite];
const enroll = assembleEnroll(events, { ref: evHash(invite), dn: 'Carol' }, [keyC], clockAt(T0));
events = [...events, enroll];

// An act: either a bare commitment (dh) or inline doc check-verified against dh.
const doc = 'Session 7 delivered 42 kWh at station D-12.';
const act = assembleAct(events, { dh: sha256b64(doc), doc }, [keyA, keyB, keyC], clockAt(T0));
events = [...events, act];
const actHash = evHash(act);

const supersedes = assembleReverseAct(events, { ref: actHash, k: 'supersede', rs: 'tariff corrected' }, [keyA, keyB, keyC], clockAt(T0));
events = [...events, supersedes];

const result = verifyJournal(events, clockAt(T0));
assert(result.ok === true, 'verifyJournal ok');
assert(result.pactRoot === evHash(genesis), 'pactRoot == evHash(GENESIS)');
assert(result.roster?.length === 3, 'roster has 3 members');
assert(result.journalHead === evHash(events[events.length - 1]), 'journalHead == last evHash');
assert(result.seq === events.length - 1, 'seq == last sq');
console.log('roster:', JSON.stringify(result.roster));

// Exit of C and a unilateral dissolve by B (default threshold: any).
const exitC = assembleExit(events, { rs: 'leaving' }, [keyC], clockAt(T0));
events = [...events, exitC];
const dissolved = assembleDissolve(events, { rs: 'done' }, [keyB], clockAt(T0));
events = [...events, dissolved];
assert(verifyJournal(events, clockAt(T0)).ok === true, 'lifecycle through DISSOLVE verifies');

// ---------------------------------------------------------------------------
// Example 2 — N-party constitution: pinned invites, weights, k-of-active,
// EVICT, ROTATE_KEY, AMEND
// ---------------------------------------------------------------------------

const cnN: Constitution = {
  th: {
    ACT: { m: 'k-of-active', k: 2 },
    EVICT: { m: 'k-of-active', k: 2 },
    DISSOLVE: { m: 'any' },
  },
  im: 'pinned',
  w: true,
};

const ftN: Founder[] = [
  { p: pubA, pp: b64urlEncode(crypto.getPublicKey(rootA)), an: 'identity', w: 2 },
  { p: pubB, pp: b64urlEncode(crypto.getPublicKey(rootB)), an: 'identity', w: 1 },
];
ftN.sort((a, b) => (a.p < b.p ? -1 : 1));

let eventsN: Event[] = [assembleGenesis({ pid, ch, cx, cn: cnN, ft: ftN, founderKeys: [keyA, keyB], clock: clockAt(T0) })];

// pinned: the INVITE must carry the invitee's pactPub (ep).
const invC = assembleInvite(eventsN, { an: 'identity', dn: 'Carol', w: 1, ep: pubC }, [keyA, keyB], clockAt(T0));
eventsN = [...eventsN, invC];
const enrC = assembleEnroll(eventsN, { ref: evHash(invC), dn: 'Carol', w: 1 }, [keyC], clockAt(T0));
eventsN = [...eventsN, enrC];

// k-of-active: any 2 of the 3 ACTIVE members carry the act.
const actN = assembleAct(eventsN, { dh: sha256b64('maintenance window approved') }, [keyB, keyC], clockAt(T0));
eventsN = [...eventsN, actN];
assert(verifyJournal(eventsN, clockAt(T0)).ok === true, 'N-party journal (weights + k-of-active) verifies');

// EVICT: the two non-target members evict the target (k=2 of 3).
const evict = assembleEvict(eventsN, { tp: pubC, rs: 'breach of schedule' }, [keyA, keyB], clockAt(T0));
eventsN = [...eventsN, evict];
assert(verifyJournal(eventsN, clockAt(T0)).ok === true, 'EVICT by k-of-active (target excluded) verifies');

// ROTATE_KEY (D39/D20): exactly the current key + the new key sign;
// the new key derives from the same anchor with gen + 1.
const keyB1 = derivePactKey(rootB, pid, ch, 1);
const pubB1 = b64urlEncode(crypto.getPublicKey(keyB1));
const rotate = assembleRotate(eventsN, { np: pubB1, ca: T0 + 60 }, [keyB, keyB1], clockAt(T0));
eventsN = [...eventsN, rotate];

// AMEND: full constitution replacement; quorum per the constitution
// in force BEFORE the event.
const eventsForAmend = [...eventsN];
const cnAmended: Constitution = { ...cnN, th: { ...cnN.th, ACT: { m: 'all' } } };
const amend = assembleAmend(eventsForAmend, { cn: cnAmended, no: 'raise ACT bar' }, [keyA, keyB1], clockAt(T0));
eventsN = [...eventsN, amend];
assert(verifyJournal(eventsN, clockAt(T0)).ok === true, 'ROTATE_KEY + AMEND verify');

// ---------------------------------------------------------------------------
// Example 3 — verification surface: incremental verifier, prefix check,
// tamper detection
// ---------------------------------------------------------------------------

const v = createJournalVerifier(clockAt(T0));
v.applySuffix(events.slice(0, 4)); // GENESIS..ACT
assert(v.height === 4 && v.head === evHash(events[3]), 'incremental verifier height/head');
v.applySuffix(events); // the rest — cheap integrity pass over the prefix
assert(v.snapshot().ok === true, 'verifier snapshot ok');

// Anchored suffix verification (BL-10): a subscriber with the pinned head.
const headAt4 = evHash(events[3]);
const prefixResult = verifyPrefix(events.slice(0, 4), headAt4, clockAt(T0));
assert(prefixResult.ok === true, 'verifyPrefix ok');

// A tampered event anywhere in the committed prefix ⇒ FORK_DETECTED.
const tampered = events.map((e) => ({ ...e }));
tampered[1] = { ...tampered[1], iat: tampered[1].iat + 1 };
const bad = verifyJournal(tampered, clockAt(T0));
assert(bad.ok === false && bad.error?.code === 'SIGNATURE_INVALID', 'tampered iat rejected (sig no longer matches TBS)');

const v2 = createJournalVerifier(clockAt(T0));
try {
  v2.applySuffix(tampered);
  throw new Error('should have thrown');
} catch (e) {
  assert(e instanceof PactError && e.code === 'SIGNATURE_INVALID', 'verifier throws PactError on tamper');
}

// ---------------------------------------------------------------------------
// Example 4 — Tier 3 (async): verifyAct with real voucher chains
// ---------------------------------------------------------------------------

// Voucher chains travel out-of-band, keyed by the membership id
// (evHash of the membership event: GENESIS for founders, ENROLL for joiners).
const chainA: VoucherChain = { chain: [(
  await Attestation.issue(
    { sign: async (data: Uint8Array) => crypto.sign(data, rootA) },
    crypto.getPublicKey(rootA), 'pact-root',
    { scopes: ['pact'], maxSessionTtl: 300 },
    { jti: 'att-a1', now: T0, ttlSeconds: 3600 },
  )
).token] };
const vcA = { rh: b64urlEncode(crypto.sha256(new TextEncoder().encode(JSON.stringify(chainA.chain)))), rp: b64urlEncode(crypto.getPublicKey(rootA)) };

// The journal carries only the hash-commit (founder entry vc + ENROLL vc).
const genesisV: Event = assembleGenesis({
  pid, ch, cx,
  cn: { th: { DISSOLVE: { m: 'any' } }, im: 'bearer', w: false },
  ft: [{ p: pubA, pp: b64urlEncode(crypto.getPublicKey(rootA)), an: 'identity', vc: vcA }],
  founderKeys: [keyA],
  clock: clockAt(T0),
});
const actV = assembleAct([genesisV], { dh: sha256b64('delivery note #1') }, [keyA], clockAt(T0));
const midA = evHash(genesisV); // founders share the GENESIS membership id

const checker: RevocationChecker = {
  isRevoked: async () => false,
  isRevokedAt: async () => false,
};
const res3 = await verifyAct(
  [genesisV, actV], evHash(actV), checker,
  new Map([[midA, chainA]]), clockAt(T0),
);
assert(res3.ok === true && res3.tier3 === 'supported' && res3.warnings?.length === 0, 'Tier 3: clean act');

// A revoked attestation kills the act retroactively (dated revocation).
const checkerRevoked: RevocationChecker = {
  isRevoked: async () => false,
  isRevokedAt: async (_jti: string, at: number) => at >= T0,
};
const res3r = await verifyAct(
  [genesisV, actV], evHash(actV), checkerRevoked,
  new Map([[midA, chainA]]), clockAt(T0),
);
assert(res3r.ok === false && res3r.error?.code === 'REVOKED', 'Tier 3: revoked attestation ⇒ REVOKED');

// No checker (or without isRevokedAt) ⇒ tier3 'unsupported' + warning.
const res3u = await verifyAct([genesisV, actV], evHash(actV), undefined, undefined, clockAt(T0));
assert(res3u.ok === true && res3u.tier3 === 'unsupported', 'Tier 3 unsupported degrades gracefully');

// A signer without a voucher ⇒ NO_VOUCHER warning (the dial is off, D6).
const genesisNoVc: Event = assembleGenesis({
  pid, ch, cx,
  cn: { th: { DISSOLVE: { m: 'any' } }, im: 'bearer', w: false },
  ft: [{ p: pubA, pp: b64urlEncode(crypto.getPublicKey(rootA)), an: 'identity' }],
  founderKeys: [keyA],
  clock: clockAt(T0),
});
const actNoVc = assembleAct([genesisNoVc], { dh: sha256b64('x') }, [keyA], clockAt(T0));
const res3n = await verifyAct([genesisNoVc, actNoVc], evHash(actNoVc), checker, new Map(), clockAt(T0));
assert(res3n.ok === true && res3n.warnings?.some((w) => w.code === 'NO_VOUCHER') === true, 'NO_VOUCHER warning, ok stays true');

// ---------------------------------------------------------------------------
// Example 5 — storage (CAS), sneakernet, error handling
// ---------------------------------------------------------------------------

const store = new MemoryStore();
await store.append(ZERO32, genesis);
await store.append(evHash(genesis), events[1]);
const fromStore = await store.read();
assert(fromStore.length === 2 && (await store.head()) === evHash(events[1]), 'MemoryStore CAS append + head');

// CAS conflict ⇒ FORK_DETECTED (optimistic concurrency, D41).
try {
  await store.append(ZERO32, events[1]);
  throw new Error('should have thrown');
} catch (e) {
  assert(e instanceof PactError && e.code === 'FORK_DETECTED', 'stale CAS append ⇒ FORK_DETECTED');
}

// Sneakernet: byte-exact export/import (D47/B-8).
const bytes = exportJournal(events);
const reimported = importJournal(bytes);
assert(Buffer.compare(bytes, exportJournal(reimported)) === 0, 'export/import byte-exact roundtrip');
assert(verifyJournal(reimported, clockAt(T0)).ok === true, 'reimported journal verifies');

// Error handling: match on code + context, never on message text.
try {
  assembleEnroll(events, { ref: evHash(invite) }, [keyC], clockAt(T0)); // invite already used
  throw new Error('should have thrown');
} catch (e) {
  assert(e instanceof PactError && e.code === 'MALFORMED' && e.context === 'verify', 'PactError code @ context');
  console.log('error message:', (e as PactError).message);
}

// D14: cancelling an unused invite.
let ev2: Event[] = [genesis];
const invD = assembleInvite(ev2, { an: 'identity' }, [keyA, keyB], clockAt(T0));
ev2 = [...ev2, invD];
const revInv = assembleRevokeInvite(ev2, { ref: evHash(invD), rs: 'no longer needed' }, [keyA, keyB], clockAt(T0));
ev2 = [...ev2, revInv];
assert(verifyJournal(ev2, clockAt(T0)).ok === true, 'REVOKE_INVITE on unused invite verifies');

console.log('\nALL SMOKE EXAMPLES PASSED');
