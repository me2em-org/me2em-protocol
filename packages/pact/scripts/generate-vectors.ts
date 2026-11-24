// packages/pact/scripts/generate-vectors.ts
//
// Regenerates the `pact` section of specs/test-vectors.json — a golden
// snapshot of the current @me2em/pact implementation (rc.3, F-rc3-5).
// Every value is computed through the PUBLIC runtime API of the built
// dist, so the golden test `packages/pact/test/vectors.spec.ts` can
// re-compute every row from the stored inputs and fail on any
// deviation.
//
// Determinism (same argument as the core generator): Ed25519 is
// deterministic; the test fixtures (src/testing/fixtures.ts) pin the
// anchor seeds, PID, CH and T0; Attestation.issue is byte-deterministic
// when (grant, jti, now, ttlSeconds) are pinned. Nothing in the vector
// build touches the wall clock or Math.random.
//
// The script READS the existing vector file and replaces only the
// `pact` section (the core generator owns its own categories) —
// bumping both file versions and appending a note.
//
// Usage:
//   pnpm --filter @me2em/pact vectors
//   (equivalent to: tsc -p tsconfig.json && node scripts/generate-vectors.ts)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crypto } from '@me2em/core';
import {
  assembleAct,
  assembleAmend,
  assembleDissolve,
  assembleEnroll,
  assembleExit,
  assembleGenesis,
  assembleInvite,
  assembleReverseAct,
  assembleRotate,
  derivePactKey,
  encodeEvent,
  evHash,
  exportJournal,
  importJournal,
  tbsBytes,
  verifyAct,
  verifyJournal,
} from '../dist/index.js';
import type { RevocationChecker } from '@me2em/core';
import {
  CH,
  clockAt,
  foundersOf,
  Journal,
  Member,
  PID,
  T0,
} from '../dist/testing/fixtures.js';
import type { Constitution, Event, Voucher } from '../dist/types.js';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

const CN2: Constitution = { th: { DISSOLVE: { m: 'any' } }, im: 'bearer', w: false };
const CNP: Constitution = { th: { DISSOLVE: { m: 'any' } }, im: 'pinned', w: false };

const members = {
  a: new Member(1),
  b: new Member(2),
  c: new Member(3),
  b2: new Member(2, 1), // B after ROTATE_KEY (gen 1)
};

const founderEntriesOf = (list: Member[]): Array<{ p: string; pp: string; an: 'identity' | 'handle' }> => {
  const ft = list.map((m) => ({ p: m.pub, pp: m.anchorPub(), an: m.anchor }));
  ft.sort((x, y) => (x.p < y.p ? -1 : x.p > y.p ? 1 : 0));
  return ft;
};

const summaryOf = (events: Event[], extra?: (e: Event) => Record<string, unknown>) =>
  events.map((e) => ({
    ty: e.ty,
    sq: e.sq,
    evHash: evHash(e),
    signers: e.sig.map((s) => s.p),
    ...(extra ? extra(e) : {}),
  }));

// ---------------------------------------------------------------------------
// 1. Derivation vectors (D2/D3/D4)
// ---------------------------------------------------------------------------
const anchorHex = '42'.repeat(32);
const anchorKey = Buffer.from(anchorHex, 'hex');
const pidHex = '21'.repeat(16);
const pidB64 = Buffer.from(pidHex, 'hex').toString('base64url');

const deriveRows = [0, 1, 2].map((gen) => {
  const key = derivePactKey(anchorKey, pidB64, CH, gen);
  return { gen, pactKey_hex: hex(key), pactPub_hex: hex(crypto.getPublicKey(key)) };
});

const chSwapped = Buffer.from('0a'.repeat(32), 'hex').toString('base64url');
const deriveRowsSwapped = [0].map((gen) => {
  const key = derivePactKey(anchorKey, pidB64, chSwapped, gen);
  return { gen, pactKey_hex: hex(key), pactPub_hex: hex(crypto.getPublicKey(key)) };
});

// ---------------------------------------------------------------------------
// 2. Envelope vector — GENESIS, byte-exact (D32)
// ---------------------------------------------------------------------------
const genesis = assembleGenesis({
  pid: PID,
  ch: CH,
  cx: 'joint charging agreement',
  cn: CNP,
  ft: founderEntriesOf([members.a, members.b]),
  founderKeys: [members.a.key, members.b.key],
  clock: clockAt(T0),
});

// ---------------------------------------------------------------------------
// 3. Bearer lifecycle replay vector (ТЗ §6.4) — built by the assemblers
// ---------------------------------------------------------------------------
function buildLifecycle(): Event[] {
  const { a, b, c, b2 } = members;
  const k = clockAt(T0);
  const events = [
    assembleGenesis({ pid: PID, ch: CH, cx: 'joint charging agreement', cn: CN2, ft: founderEntriesOf([a, b]), founderKeys: [a.key, b.key], clock: k }),
  ];
  const invite = assembleInvite(events, { an: 'identity' }, [a.key, b.key], k);
  events.push(invite);
  events.push(assembleEnroll(events, { ref: evHash(invite) }, [c.key], k));
  const act1 = assembleAct(events, { no: 'session-1' }, [a.key, b.key, c.key], k);
  events.push(act1);
  events.push(assembleReverseAct(events, { ref: evHash(act1), k: 'supersede', rs: 'wrong tariff' }, [a.key, b.key, c.key], k));
  events.push(assembleAmend(events, { cn: CN2 }, [a.key, b.key, c.key], k));
  events.push(assembleRotate(events, { np: b2.pub }, [b.key, b2.key], k));
  events.push(assembleAct(events, { no: 'session-2' }, [a.key, b2.key, c.key], k));
  events.push(assembleExit(events, { rs: 'leaving' }, [a.key], k));
  events.push(assembleDissolve(events, { rs: 'done' }, [b2.key], k));
  return events;
}

const lifecycle = buildLifecycle();
const lifecycleResult = verifyJournal(lifecycle, clockAt(T0));
if (!lifecycleResult.ok) throw lifecycleResult.error;

// ---------------------------------------------------------------------------
// 4. Pinned-ep vectors (rc.2 D13, F-rc3-5) — raw Journal.push (the
// reject case must be representable: the builder itself refuses it)
// ---------------------------------------------------------------------------
const pinned = new Journal();
pinned.push('GENESIS', { ch: CH, cn: CNP, ft: foundersOf([members.a, members.b], CNP) }, [members.a, members.b]);
const pinnedInvite = pinned.push('INVITE', { an: 'identity', ep: members.c.pub }, [members.a, members.b]);
pinned.push('ENROLL', { ref: pinned.hash(pinnedInvite) }, [members.c]);
const pinnedResult = verifyJournal(pinned.events, clockAt(T0));
if (!pinnedResult.ok) throw pinnedResult.error;

const pinnedReject = new Journal();
pinnedReject.push('GENESIS', { ch: CH, cn: CNP, ft: foundersOf([members.a, members.b], CNP) }, [members.a, members.b]);
pinnedReject.push('INVITE', { an: 'identity' }, [members.a, members.b]); // ep-less under pinned (D13)
const pinnedRejectResult = verifyJournal(pinnedReject.events, clockAt(T0));
if (pinnedRejectResult.ok || pinnedRejectResult.error?.code !== 'MALFORMED') {
  throw new Error(`pinned reject vector sanity: got ${JSON.stringify(pinnedRejectResult.error)}`);
}

// ---------------------------------------------------------------------------
// 5. Chain-liveness vectors (rc.2 Б6 / PACTS §5.4, F-rc3-5)
// ---------------------------------------------------------------------------
const LIVENESS_CASES: Array<{
  id: string;
  jtis: string[];
  timing: { now: number; ttlSeconds: number };
  ok: boolean;
  code?: string;
}> = [
  { id: 'alive-at-act-iat', jtis: ['vec-live-1'], timing: { now: T0, ttlSeconds: 1 }, ok: true },
  { id: 'expired-before-act-iat', jtis: ['vec-exp-1'], timing: { now: T0 - 3600, ttlSeconds: 1800 }, ok: false, code: 'IDP_UNRESOLVABLE' },
  { id: 'future-after-act-iat', jtis: ['vec-fut-1'], timing: { now: T0 + 3600, ttlSeconds: 3600 }, ok: false, code: 'IDP_UNRESOLVABLE' },
  { id: 'exp-equals-act-iat', jtis: ['vec-bnd-1'], timing: { now: T0 - 3600, ttlSeconds: 3600 }, ok: false, code: 'IDP_UNRESOLVABLE' },
];

const livenessVectors: Array<Record<string, unknown>> = [];
for (const lc of LIVENESS_CASES) {
  const m = new Member(1);
  const other = new Member(2);
  const { chain, vc } = await m.voucherChain('identity', lc.jtis, lc.timing);
  const vcs = new Map<Member, Voucher>([[m, vc]]);
  const j = new Journal();
  j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([m, other], CN2, vcs) }, [m, other]);
  const act = j.push('ACT', { no: 'act-1' }, [m, other]);
  const checker: RevocationChecker = { async isRevokedAt(): Promise<boolean> { return false; } };
  const result = await verifyAct(j.events, j.hash(act), checker, new Map([[j.hash(j.events[0]), chain]]), clockAt(T0));
  if (result.ok !== lc.ok || (!result.ok && result.error?.code !== lc.code)) {
    throw new Error(`liveness case ${lc.id}: got ${JSON.stringify({ ok: result.ok, code: result.error?.code })}`);
  }
  livenessVectors.push({
    id: `pact-chain-liveness-${lc.id}`,
    source: 'PACTS §5.4 (rc.2 Б6) — iat ≤ act.iat < exp for every attestation',
    members: { a_seed_hex: '01', b_seed_hex: '02' },
    input: { jtis: lc.jtis, timing: lc.timing, anchor: 'identity' },
    expected: lc.ok ? { ok: true, tier3: 'supported' } : { ok: false, code: lc.code },
  });
}

// ---------------------------------------------------------------------------
// 6. Export byte-exactness (D47/B-8)
// ---------------------------------------------------------------------------
const journalBytes = exportJournal(lifecycle);
const roundBytes = exportJournal(importJournal(journalBytes));
const exportRow = {
  id: 'pact-export-bytes',
  source: 'ТЗ §6.10 / §3.5 — NL-canonical JCS with sig[], byte-exact (B-8/D47)',
  journal_hex: hex(journalBytes),
  idempotent: Buffer.compare(Buffer.from(journalBytes), Buffer.from(roundBytes)) === 0,
  reimport_verifies: verifyJournal(importJournal(journalBytes), clockAt(T0)).ok,
};

// ---------------------------------------------------------------------------
// Assemble the pact section and merge it into the shared vector file
// ---------------------------------------------------------------------------
const pactSection = {
  spec: 'Me2eM Pact Journal',
  spec_version: '1.0',
  vector_file_version: 2,
  algorithm: 'Ed25519 (RFC 8032) + JCS (RFC 8785) + SHA-256 + HKDF-SHA256 (pact key derivation, D2)',
  notes: [
    'Anchor seeds, PID and CH are the fixed testing fixtures (src/testing/fixtures.ts): root key = bytes(32, seed), pact key = derivePactKey(anchorKey, PID, CH, gen).',
    'Envelope/replay/export vectors are byte-exact; Attestation chains in the liveness vectors are byte-deterministic given (grant, jti, now, ttlSeconds) and are rebuilt by the golden test, not stored.',
    'rc.3 (F-rc3-5): pinned-ep accept/reject vectors (D13) and chain-liveness vectors (expired / future / exp = act.iat — the strict `< exp` bound) added alongside the M1.7 groups.',
  ],
  vectors: [
    {
      id: 'pact-derive',
      source: 'PACTS §4 (D2/D3)',
      input: { anchorSecretKey_hex: anchorHex, pid: pidB64, ch: CH },
      outputs: deriveRows,
    },
    {
      id: 'pact-derive-negative-ch',
      source: 'PACTS §4 (D4)',
      input: { anchorSecretKey_hex: anchorHex, pid: pidB64, ch: chSwapped },
      outputs: deriveRowsSwapped,
      note: 'different ch ⇒ different key (fail-closed, D4)',
    },
    {
      id: 'pact-envelope-genesis',
      source: 'PACTS §7.1–§7.2 (D32)',
      input: {
        pid: PID,
        ch: CH,
        cx: 'joint charging agreement',
        cn: CNP,
        ft: founderEntriesOf([members.a, members.b]),
        member_seeds_hex: ['01', '02'],
      },
      canonical_hex: hex(encodeEvent(genesis)),
      tbs_hex: hex(tbsBytes(genesis)),
      evHash: evHash(genesis),
    },
    {
      id: 'pact-replay-lifecycle-2p',
      source: 'ТЗ §6.4 — GENESIS→INVITE→ENROLL→ACT→REVERSE_ACT→AMEND→ROTATE→EXIT→DISSOLVE',
      members: { a_seed_hex: '01', b_seed_hex: '02', c_seed_hex: '03', b2_gen: 1 },
      events: summaryOf(lifecycle),
      roster_final: lifecycleResult.roster,
      pactRoot: lifecycleResult.pactRoot,
      journalHead: lifecycleResult.journalHead,
      seq: lifecycleResult.seq,
    },
    {
      id: 'pact-replay-pinned-ep',
      source: 'PACTS §5 / §7.3 / D13 (rc.2, F-rc3-5) — a pinned invite commits the invitee; ENROLL by the committed key',
      members: { a_seed_hex: '01', b_seed_hex: '02', c_seed_hex: '03' },
      events: summaryOf(pinned.events, (e) => ({ ep: (e.pl as Record<string, unknown>)['ep'] })),
      roster_final: pinnedResult.roster,
      pactRoot: pinnedResult.pactRoot,
      journalHead: pinnedResult.journalHead,
      seq: pinnedResult.seq,
    },
    {
      id: 'pact-replay-pinned-ep-reject',
      source: 'PACTS §5 / D13 (rc.2, F-rc3-5) — an ep-less INVITE under a pinned constitution rejects',
      members: { a_seed_hex: '01', b_seed_hex: '02' },
      events: summaryOf(pinnedReject.events),
      expected: { ok: false, code: 'MALFORMED' },
    },
    ...livenessVectors,
    exportRow,
  ],
};

const target = fileURLToPath(new URL('../../../specs/test-vectors.json', import.meta.url));
const current = JSON.parse(readFileSync(target, 'utf8'));
const merged = { ...current, pact: pactSection };
merged.vector_file_version = 4;
merged.notes = [
  ...current.notes,
  'Group pact (rc.3, F-rc3-5): pinned-ep accept/reject (D13) and chain-liveness (strict act.iat < exp) vectors; the pact section is a golden snapshot of @me2em/pact 1.0.0-rc.3, re-verified by packages/pact/test/vectors.spec.ts.',
];
writeFileSync(target, JSON.stringify(merged, null, 2) + '\n');
console.log(`Wrote ${target}`);
console.log(`Pact vectors: ${pactSection.vectors.map((v) => v.id).join(', ')}`);
