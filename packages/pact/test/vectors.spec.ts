// test/vectors.spec.ts — golden vectors for the pact machine (rc.3,
// F-rc3-5): every row of specs/test-vectors.json §pact is recomputed
// from the stored inputs through the public runtime API and must match
// exactly. The generator (scripts/generate-vectors.ts) writes the
// section from the same deterministic fixtures — any implementation
// deviation fails here first.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { crypto } from '@me2em/core';
import type { RevocationChecker } from '@me2em/core';
import { evHash, encodeEvent, tbsBytes } from '../src/codec.js';
import { derivePactKey } from '../src/derive.js';
import { verifyAct, verifyJournal } from '../src/verify.js';
import { exportJournal, importJournal } from '../src/store/index.js';
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
} from '../src/assemble/index.js';
import { CH, clockAt, foundersOf, Journal, Member, PID, T0 } from './journal-utils.js';
import type { Constitution, Event, Voucher } from '../src/types.js';

interface DeriveRow {
  id: string;
  input: { anchorSecretKey_hex: string; pid: string; ch: string };
  outputs: Array<{ gen: number; pactKey_hex: string; pactPub_hex: string }>;
  note?: string;
}
interface EnvelopeRow {
  id: string;
  input: { pid: string; ch: string; cx: string; cn: Constitution; ft: Array<{ p: string; pp: string; an: string }>; member_seeds_hex: string[] };
  canonical_hex: string;
  tbs_hex: string;
  evHash: string;
}
interface LifecycleRow {
  id: string;
  members: Record<string, unknown>;
  events: Array<{ ty: string; sq: number; evHash: string; signers: string[]; ep?: string | undefined }>;
  roster_final?: Array<{ p: string; w: number; e: string }>;
  pactRoot?: string;
  journalHead?: string;
  seq?: number;
  expected?: { ok: boolean; code?: string };
}
interface LivenessRow {
  id: string;
  input: { jtis: string[]; timing: { now: number; ttlSeconds: number }; anchor: 'identity' | 'handle' };
  expected: { ok: boolean; tier3?: string; code?: string };
}
interface ExportRow {
  id: string;
  journal_hex: string;
  idempotent: boolean;
  reimport_verifies: boolean;
}

const file = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../specs/test-vectors.json', import.meta.url)), 'utf8')
) as {
  vector_file_version: number;
  pact: { vector_file_version: number; vectors: Array<{ id: string }> };
};

const rowOf = <T>(id: string): T => {
  const row = file.pact.vectors.find((v) => v.id === id);
  expect(row, `missing vector ${id}`).toBeDefined();
  return row as T;
};

// ---------------------------------------------------------------------------
// The deterministic builders — same construction as the generator
// ---------------------------------------------------------------------------

const CN2: Constitution = { th: { DISSOLVE: { m: 'any' } }, im: 'bearer', w: false };
const CNP: Constitution = { th: { DISSOLVE: { m: 'any' } }, im: 'pinned', w: false };

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

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const fromHex = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'hex'));

function buildLifecycle(): Event[] {
  const a = new Member(1);
  const b = new Member(2);
  const c = new Member(3);
  const b2 = new Member(2, 1); // B after ROTATE_KEY (gen 1)
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

function buildPinnedAccept(): Journal {
  const a = new Member(1);
  const b = new Member(2);
  const c = new Member(3);
  const j = new Journal();
  j.push('GENESIS', { ch: CH, cn: CNP, ft: foundersOf([a, b], CNP) }, [a, b]);
  const invite = j.push('INVITE', { an: 'identity', ep: c.pub }, [a, b]);
  j.push('ENROLL', { ref: j.hash(invite) }, [c]);
  return j;
}

function buildPinnedReject(): Journal {
  const a = new Member(1);
  const b = new Member(2);
  const j = new Journal();
  j.push('GENESIS', { ch: CH, cn: CNP, ft: foundersOf([a, b], CNP) }, [a, b]);
  j.push('INVITE', { an: 'identity' }, [a, b]); // ep-less under pinned (D13)
  return j;
}

// ---------------------------------------------------------------------------

describe('golden vectors — specs/test-vectors.json §pact (rc.3, F-rc3-5)', () => {
  it('file and section versions are current', () => {
    expect(file.vector_file_version).toBe(4);
    expect(file.pact.vector_file_version).toBe(2);
    // Rows are addressed by id below, so the set may grow (rc.4+)
    // without editing this suite — only catastrophic shrinkage fails:
    expect(file.pact.vectors.length).toBeGreaterThanOrEqual(11);
  });

  it('pact-derive / pact-derive-negative-ch: HKDF pact keys (D2/D4)', () => {
    for (const id of ['pact-derive', 'pact-derive-negative-ch']) {
      const row = rowOf<DeriveRow>(id);
      for (const out of row.outputs) {
        const key = derivePactKey(fromHex(row.input.anchorSecretKey_hex), row.input.pid, row.input.ch, out.gen);
        expect(hex(key)).toBe(out.pactKey_hex);
        expect(hex(crypto.getPublicKey(key))).toBe(out.pactPub_hex);
      }
    }
  });

  it('pact-envelope-genesis: canonical/tbs/evHash byte-exact (D32)', () => {
    const row = rowOf<EnvelopeRow>('pact-envelope-genesis');
    const a = new Member(1);
    const b = new Member(2);
    expect(founderEntriesOf([a, b])).toEqual(row.input.ft);
    const genesis = assembleGenesis({
      pid: row.input.pid,
      ch: row.input.ch,
      cx: row.input.cx,
      cn: row.input.cn,
      ft: row.input.ft as Array<{ p: string; pp: string; an: 'identity' }>,
      founderKeys: [a.key, b.key],
      clock: clockAt(T0),
    });
    expect(hex(encodeEvent(genesis))).toBe(row.canonical_hex);
    expect(hex(tbsBytes(genesis))).toBe(row.tbs_hex);
    expect(evHash(genesis)).toBe(row.evHash);
  });

  it('pact-replay-lifecycle-2p: the lifecycle re-assembles to the stored roster/head', () => {
    const row = rowOf<LifecycleRow>('pact-replay-lifecycle-2p');
    const events = buildLifecycle();
    expect(summaryOf(events)).toEqual(row.events);
    const result = verifyJournal(events, clockAt(T0));
    expect(result.ok).toBe(true);
    expect(result.roster).toEqual(row.roster_final);
    expect(result.pactRoot).toBe(row.pactRoot);
    expect(result.journalHead).toBe(row.journalHead);
    expect(result.seq).toBe(row.seq);
  });

  it('pact-replay-pinned-ep: the committed invitee enrolls (D13)', () => {
    const row = rowOf<LifecycleRow>('pact-replay-pinned-ep');
    const j = buildPinnedAccept();
    expect(summaryOf(j.events, (e) => ({ ep: (e.pl as Record<string, unknown>)['ep'] }))).toEqual(row.events);
    const result = verifyJournal(j.events, clockAt(T0));
    expect(result.ok).toBe(true);
    expect(result.roster).toEqual(row.roster_final);
    expect(result.pactRoot).toBe(row.pactRoot);
    expect(result.journalHead).toBe(row.journalHead);
    expect(result.seq).toBe(row.seq);
  });

  it('pact-replay-pinned-ep-reject: an ep-less INVITE under pinned ⇒ MALFORMED (D13)', () => {
    const row = rowOf<LifecycleRow>('pact-replay-pinned-ep-reject');
    const j = buildPinnedReject();
    expect(summaryOf(j.events)).toEqual(row.events);
    const result = verifyJournal(j.events, clockAt(T0));
    expect(result.ok).toBe(row.expected?.ok ?? false);
    expect(result.error?.code).toBe(row.expected?.code);
  });

  it('pact-chain-liveness-*: aliveness is strict act.iat < exp (Б6)', async () => {
    const liveness = file.pact.vectors.filter((v) => v.id.startsWith('pact-chain-liveness-'));
    // Same growth-friendly pin as the suite total: new liveness rows
    // join by id prefix — only catastrophic shrinkage fails:
    expect(liveness.length).toBeGreaterThanOrEqual(4);
    for (const v of liveness) {
      const row = v as unknown as LivenessRow;
      const m = new Member(1);
      const other = new Member(2);
      const { chain, vc } = await m.voucherChain(row.input.anchor, row.input.jtis, row.input.timing);
      const vcs = new Map<Member, Voucher>([[m, vc]]);
      const j = new Journal();
      j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([m, other], CN2, vcs) }, [m, other]);
      const act = j.push('ACT', { no: 'act-1' }, [m, other]);
      const checker: RevocationChecker = {
        async isRevoked(): Promise<boolean> { return false; },
        async isRevokedAt(): Promise<boolean> { return false; },
      };
      const result = await verifyAct(j.events, j.hash(act), checker, new Map([[j.hash(j.events[0]), chain]]), clockAt(T0));
      if (row.expected.ok) {
        expect(result.ok, row.id).toBe(true);
        expect(result.tier3).toBe(row.expected.tier3);
      } else {
        expect(result.ok, row.id).toBe(false);
        expect(result.error?.code).toBe(row.expected.code);
      }
    }
  });

  it('pact-export-bytes: the export/import roundtrip is byte-exact (D47/B-8)', () => {
    const row = rowOf<ExportRow>('pact-export-bytes');
    const bytes1 = Buffer.from(row.journal_hex, 'hex');
    const events = importJournal(new Uint8Array(bytes1));
    expect(verifyJournal(events, clockAt(T0)).ok).toBe(row.reimport_verifies);
    const round = exportJournal(events);
    expect(Buffer.compare(bytes1, Buffer.from(round))).toBe(0);
    expect(row.idempotent).toBe(true);
  });
});
