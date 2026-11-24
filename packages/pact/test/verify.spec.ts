// test/verify.spec.ts — M1.3: verifyJournal / verifyPrefix / verifyAct
// (ТЗ §3.3; vectors §6.4–6.9). Every journal below is built from real
// pact keys and real Ed25519 signatures over TBS (journal-utils).

import { describe, it, expect } from 'vitest';
import { b64urlEncode, ZERO32 } from '../src/codec.js';
import { evHash } from '../src/codec.js';
import { verifyAct, verifyJournal, verifyPrefix, SKEW_SECONDS, createJournalVerifier } from '../src/verify.js';
import { PactError } from '../src/errors.js';
import type { Constitution, Event, VoucherChain } from '../src/types.js';
import {
  bytes,
  CH,
  clockAt,
  CN2,
  foundersOf,
  Journal,
  Member,
  PID,
  T0,
} from './journal-utils.js';

const bytes32 = (fill: number) => b64urlEncode(bytes(32, fill));

function expectCode(result: { ok: boolean; error?: PactError }, code: string): void {
  expect(result.ok).toBe(false);
  expect(result.error).toBeInstanceOf(PactError);
  expect(result.error!.code).toBe(code);
}

/** Dated revocation mock (PACTS D17 semantics, unix seconds inclusive). */
class DatedChecker {
  private at = new Map<string, number>();
  async isRevoked(jti: string): Promise<boolean> {
    return this.at.has(jti);
  }
  async isRevokedAt(jti: string, at: number): Promise<boolean> {
    const t = this.at.get(jti);
    return t !== undefined && at >= t;
  }
  revokeAt(jti: string, at: number): void {
    this.at.set(jti, at);
  }
}

describe('verifyJournal — Tier 1+2 (sync)', () => {
  it('§6.4 full 2-party lifecycle replays clean', () => {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const b2 = new Member(2, 1); // B after ROTATE_KEY (gen 1)
    const j = new Journal();

    const genesis = j.push('GENESIS', { ch: CH, cx: 'joint charging agreement', cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const invite = j.push('INVITE', { an: 'identity' }, [a, b]);
    const enroll = j.push('ENROLL', { ref: j.hash(invite) }, [c]);
    const act = j.push('ACT', { no: 'session-1' }, [a, b, c]);
    const reverse = j.push('REVERSE_ACT', { ref: j.hash(act), k: 'supersede', rs: 'wrong tariff' }, [a, b, c]);
    const cn2: Constitution = { th: { DISSOLVE: { m: 'any' } }, im: 'bearer', w: false };
    const amend = j.push('AMEND', { cn: cn2 }, [a, b, c]);
    const rotate = j.push('ROTATE_KEY', { np: b2.pub }, [b, b2]);
    const exit = j.push('EXIT', { rs: 'leaving' }, [a]);
    const dissolve = j.push('DISSOLVE', { rs: 'done' }, [b2]);

    const result = verifyJournal(j.events, clockAt(T0));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.pactRoot).toBe(evHash(genesis));
    expect(result.journalHead).toBe(evHash(dissolve));
    expect(result.seq).toBe(8);
    // Roster evolution: c joined and never left; b rotated to b2; a exited.
    expect(result.roster!.map((r) => r.p)).toEqual([c.pub, b2.pub].sort());
    // Chained references resolved:
    expect(j.hash(invite)).not.toBe(j.hash(enroll));
    void rotate; void amend; void reverse; void exit; void genesis; void enroll; void cn2;
  });

  it('§6.4 N-party replay with weights and k-of-active (hand-built)', () => {
    const cn: Constitution = { th: { ACT: { m: 'k-of-active', k: 5 } }, im: 'bearer', w: true };
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    a.w = 3;
    b.w = 2;
    c.w = 1;
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn, ft: foundersOf([a, b, c], cn) }, [a, b, c]);
    // Mass: 3+2+1 = 6; requirement min(5, 6) = 5 → A+B (5) passes.
    j.push('ACT', { no: 'ok' }, [a, b]);
    const result = verifyJournal(j.events, clockAt(T0));
    expect(result.ok).toBe(true);
    expect(result.roster!.map((r) => r.w)).toEqual([3, 2, 1].sort());
  });

  it('k-of-active below min(k, active mass) → INVALID_QUORUM', () => {
    const cn: Constitution = { th: { ACT: { m: 'k-of-active', k: 5 } }, im: 'bearer', w: true };
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    a.w = 3;
    b.w = 2;
    c.w = 1;
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn, ft: foundersOf([a, b, c], cn) }, [a, b, c]);
    j.push('ACT', { no: 'short' }, [a, c]); // mass 4 < 5
    expectCode(verifyJournal(j.events, clockAt(T0)), 'INVALID_QUORUM');
  });

  it('GENESIS requires all founder signatures; extra signers tolerated', () => {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a]); // B missing
    expectCode(verifyJournal(j.events, clockAt(T0)), 'INVALID_QUORUM');

    const j2 = new Journal();
    j2.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b, c]); // C extra
    expect(verifyJournal(j2.events, clockAt(T0)).ok).toBe(true);
  });

  it('default all-quorum: INVITE by one of two fails, DISSOLVE by one passes (any)', () => {
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    j.push('INVITE', { an: 'identity' }, [a]); // default 'all' — needs both
    expectCode(verifyJournal(j.events, clockAt(T0)), 'INVALID_QUORUM');

    const j2 = new Journal();
    j2.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    j2.push('DISSOLVE', {}, [b]); // default 'any'
    expect(verifyJournal(j2.events, clockAt(T0)).ok).toBe(true);
  });

  it('founder mode requires every founder', () => {
    const cn: Constitution = { th: { DISSOLVE: { m: 'founder' } }, im: 'pinned', w: false };
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn, ft: foundersOf([a, b], cn) }, [a, b]);
    j.push('DISSOLVE', {}, [a]);
    expectCode(verifyJournal(j.events, clockAt(T0)), 'INVALID_QUORUM');

    const j2 = new Journal();
    j2.push('GENESIS', { ch: CH, cn, ft: foundersOf([a, b], cn) }, [a, b]);
    j2.push('DISSOLVE', {}, [a, b]);
    expect(verifyJournal(j2.events, clockAt(T0)).ok).toBe(true);
  });

  it('B-5: k(DISSOLVE) > n_founders rejected on GENESIS and AMEND', () => {
    const bad: Constitution = { th: { DISSOLVE: { m: 'k-of-active', k: 3 } }, im: 'pinned', w: false };
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: bad, ft: foundersOf([a, b], bad) }, [a, b]);
    expectCode(verifyJournal(j.events, clockAt(T0)), 'MALFORMED');

    const j2 = new Journal();
    j2.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    j2.push('AMEND', { cn: bad }, [a, b]);
    expectCode(verifyJournal(j2.events, clockAt(T0)), 'MALFORMED');
  });

  it('B-6: ENROLL weight must repeat the INVITE weight verbatim', () => {
    const cn: Constitution = { th: {}, im: 'bearer', w: true };
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    a.w = 2;
    b.w = 2;
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn, ft: foundersOf([a, b], cn) }, [a, b]);
    const invite = j.push('INVITE', { an: 'identity', w: 3 }, [a, b]);
    j.push('ENROLL', { ref: j.hash(invite), w: 4 }, [c]);
    expectCode(verifyJournal(j.events, clockAt(T0)), 'WEIGHT_MISMATCH');

    const j2 = new Journal();
    j2.push('GENESIS', { ch: CH, cn, ft: foundersOf([a, b], cn) }, [a, b]);
    const inv2 = j2.push('INVITE', { an: 'identity', w: 3 }, [a, b]);
    j2.push('ENROLL', { ref: j2.hash(inv2) }, [c]); // weight dropped
    expectCode(verifyJournal(j2.events, clockAt(T0)), 'WEIGHT_MISMATCH');

    const j3 = new Journal();
    j3.push('GENESIS', { ch: CH, cn, ft: foundersOf([a, b], cn) }, [a, b]);
    const inv3 = j3.push('INVITE', { an: 'identity', w: 3 }, [a, b]);
    j3.push('ENROLL', { ref: j3.hash(inv3), w: 3, dn: 'carol' }, [c]);
    expect(verifyJournal(j3.events, clockAt(T0)).ok).toBe(true);
  });

  it('D14: revoked and reused invites reject; ENROLL of an ACTIVE member rejects', () => {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const inv = j.push('INVITE', { an: 'identity' }, [a, b]);
    j.push('REVOKE_INVITE', { ref: j.hash(inv) }, [a, b]);
    j.push('ENROLL', { ref: j.hash(inv) }, [c]);
    expectCode(verifyJournal(j.events, clockAt(T0)), 'MALFORMED');

    const j2 = new Journal();
    j2.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const inv2 = j2.push('INVITE', { an: 'identity' }, [a, b]);
    j2.push('ENROLL', { ref: j2.hash(inv2) }, [c]);
    j2.push('ENROLL', { ref: j2.hash(inv2) }, [c]); // reuse
    expectCode(verifyJournal(j2.events, clockAt(T0)), 'MALFORMED');
  });

  it('REVERSE_ACT ref must point to a journal ACT; EVICT target must be ACTIVE', () => {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const inv = j.push('INVITE', { an: 'identity' }, [a, b]);
    j.push('REVERSE_ACT', { ref: j.hash(inv), k: 'reversal' }, [a, b]); // ref → INVITE
    expectCode(verifyJournal(j.events, clockAt(T0)), 'MALFORMED');

    const j2 = new Journal();
    j2.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const inv2 = j2.push('INVITE', { an: 'identity' }, [a, b]);
    j2.push('ENROLL', { ref: j2.hash(inv2) }, [c]);
    // 'all' quorum needs all ACTIVE members (a, b, c) — then the target check rejects:
    j2.push('EVICT', { tp: bytes32(0xdd) }, [a, b, c]); // not a member
    expectCode(verifyJournal(j2.events, clockAt(T0)), 'MALFORMED');
  });

  it('EXIT by a non-member → INVALID_QUORUM', () => {
    const a = new Member(1);
    const b = new Member(2);
    const stranger = new Member(9);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    j.push('EXIT', {}, [stranger]);
    expectCode(verifyJournal(j.events, clockAt(T0)), 'INVALID_QUORUM');
  });

  it('§6.5 fork: ph mismatch, sq gap, pid change; history before the fork stays valid (D27)', () => {
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    j.push('ACT', { no: 'x' }, [a, b]);
    const forked: Event[] = JSON.parse(JSON.stringify(j.events));
    forked[1] = { ...forked[1], ph: bytes32(0xee) }; // ph mismatch
    expectCode(verifyJournal(forked, clockAt(T0)), 'FORK_DETECTED');

    const gap: Event[] = JSON.parse(JSON.stringify(j.events));
    gap[1] = { ...gap[1], sq: 5 };
    expectCode(verifyJournal(gap, clockAt(T0)), 'FORK_DETECTED');

    const otherPid: Event[] = JSON.parse(JSON.stringify(j.events));
    otherPid[1] = { ...otherPid[1], pid: b64urlEncode(bytes(16, 0x99)) };
    expectCode(verifyJournal(otherPid, clockAt(T0)), 'FORK_DETECTED');

    // The prefix [0..1) before the fork verifies fine:
    expect(verifyPrefix([j.events[0]], evHash(j.events[0]), clockAt(T0)).ok).toBe(true);
  });

  it('§6.5 verifyPrefix controls the head; empty journal and empty prefix', () => {
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    j.push('ACT', { no: 'x' }, [a, b]);
    const head = j.hash(j.events[1]);

    expect(verifyPrefix(j.events, head, clockAt(T0)).ok).toBe(true);
    expect(verifyPrefix(j.events, bytes32(0x01), clockAt(T0)).ok).toBe(false);
    expectCode(verifyPrefix(j.events, bytes32(0x01), clockAt(T0)), 'FORK_DETECTED');

    const empty = verifyJournal([], clockAt(T0));
    expect(empty.ok).toBe(true);
    expect(empty.journalHead).toBe(ZERO32);
    expect(empty.roster).toEqual([]);

    expect(verifyPrefix([], ZERO32, clockAt(T0)).ok).toBe(true);
    expectCode(verifyPrefix([], head, clockAt(T0)), 'FORK_DETECTED');
  });

  it('§6.9 skew: ±30 s inclusive; SKEW beyond', () => {
    const a = new Member(1);
    const b = new Member(2);
    const okHi = new Journal();
    okHi.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b], T0 + SKEW_SECONDS);
    expect(verifyJournal(okHi.events, clockAt(T0)).ok).toBe(true);

    const okLo = new Journal();
    okLo.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b], T0 - SKEW_SECONDS);
    expect(verifyJournal(okLo.events, clockAt(T0)).ok).toBe(true);

    const late = new Journal();
    late.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b], T0 + SKEW_SECONDS + 1);
    expectCode(verifyJournal(late.events, clockAt(T0)), 'SKEW');

    const early = new Journal();
    early.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b], T0 - SKEW_SECONDS - 1);
    expectCode(verifyJournal(early.events, clockAt(T0)), 'SKEW');
  });

  it('§6.4 SIGNATURE_INVALID: tampered signature or payload', () => {
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const tamperedSig: Event = JSON.parse(JSON.stringify(j.events[0]));
    const raw = Buffer.from(tamperedSig.sig[0].s, 'base64url');
    raw[0] ^= 0x01;
    tamperedSig.sig[0].s = b64urlEncode(new Uint8Array(raw));
    expectCode(verifyJournal([tamperedSig], clockAt(T0)), 'SIGNATURE_INVALID');

    // iat has no check-hash — the tamper passes validation and dies at Ed25519:
    const tamperedIat: Event = { ...JSON.parse(JSON.stringify(j.events[0])), iat: T0 + 1 };
    expectCode(verifyJournal([tamperedIat], clockAt(T0 + 1)), 'SIGNATURE_INVALID');
  });

  it('unknown event type → UNKNOWN_EVENT_TYPE; non-GENESIS start → MALFORMED', () => {
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const weird: Event = {
      typ: 'me2em/pact-event/v1',
      pid: PID,
      sq: 1,
      ph: j.head,
      ty: 'SIDE_DEAL' as never,
      pl: {},
      iat: T0,
      sig: [],
    };
    expectCode(verifyJournal([...j.events, weird], clockAt(T0)), 'UNKNOWN_EVENT_TYPE');

    const j2 = new Journal();
    j2.push('INVITE', { an: 'identity' }, [a, b]); // no GENESIS
    expectCode(verifyJournal(j2.events, clockAt(T0)), 'MALFORMED');
  });

  it('founder weight required when weights enabled; one voucher per membership event', () => {
    const cn: Constitution = { th: {}, im: 'bearer', w: true };
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    const ft = foundersOf([a, b], cn);
    delete (ft[0] as Record<string, unknown>)['w'];
    j.push('GENESIS', { ch: CH, cn, ft }, [a, b]);
    expectCode(verifyJournal(j.events, clockAt(T0)), 'MALFORMED');

    const j2 = new Journal();
    const vc = { rh: bytes32(1), rp: bytes32(2) };
    const ft2 = foundersOf([a, b], CN2, new Map([
      [a, vc],
      [b, vc],
    ]));
    j2.push('GENESIS', { ch: CH, cn: CN2, ft: ft2 }, [a, b]);
    expectCode(verifyJournal(j2.events, clockAt(T0)), 'MALFORMED');
  });
});

describe('invite modes (D13 — pinned/bearer)', () => {
  const CNP: Constitution = { th: { DISSOLVE: { m: 'any' } }, im: 'pinned', w: false };

  it('pinned constitution: INVITE without ep → MALFORMED', () => {
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CNP, ft: foundersOf([a, b], CNP) }, [a, b]);
    j.push('INVITE', { an: 'identity' }, [a, b]); // pinned, no ep
    expectCode(verifyJournal(j.events, clockAt(T0)), 'MALFORMED');
  });

  it('pinned invite: the committed invitee enrolls, a stranger does not', () => {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const stranger = new Member(9);

    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CNP, ft: foundersOf([a, b], CNP) }, [a, b]);
    const inv = j.push('INVITE', { an: 'identity', ep: c.pub }, [a, b]);
    j.push('ENROLL', { ref: j.hash(inv) }, [c]); // p === ep → ok
    expect(verifyJournal(j.events, clockAt(T0)).ok).toBe(true);

    const j2 = new Journal();
    j2.push('GENESIS', { ch: CH, cn: CNP, ft: foundersOf([a, b], CNP) }, [a, b]);
    const inv2 = j2.push('INVITE', { an: 'identity', ep: c.pub }, [a, b]);
    j2.push('ENROLL', { ref: j2.hash(inv2) }, [stranger]); // p ≠ ep
    expectCode(verifyJournal(j2.events, clockAt(T0)), 'INVALID_QUORUM');
  });

  it('bearer invite with ep: per-invite pinning is honored', () => {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const stranger = new Member(9);

    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const inv = j.push('INVITE', { an: 'identity', ep: c.pub }, [a, b]);
    j.push('ENROLL', { ref: j.hash(inv) }, [stranger]); // p ≠ ep
    expectCode(verifyJournal(j.events, clockAt(T0)), 'INVALID_QUORUM');

    const j2 = new Journal();
    j2.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const inv2 = j2.push('INVITE', { an: 'identity', ep: c.pub }, [a, b]);
    j2.push('ENROLL', { ref: j2.hash(inv2) }, [c]); // p === ep → ok
    expect(verifyJournal(j2.events, clockAt(T0)).ok).toBe(true);
  });
});

describe('verifyAct — Tier 3 (async)', () => {
  interface Ctx {
    events: Event[];
    actHash: string;
    genesisHash: string;
    chain: VoucherChain;
    jtis: string[];
  }

  /** Journal with founder A carrying an identity voucher. */
  async function buildVoucherJournal(): Promise<Ctx> {
    const a = new Member(1);
    const b = new Member(2);
    const { chain, vc } = await a.voucherChain('identity', ['jti-a-root']);
    const vcs = new Map([[a, vc]]);
    const j = new Journal();
    const genesis = j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2, vcs) }, [a, b]);
    const act = j.push('ACT', { no: 'act-1' }, [a, b]);
    return { events: j.events, actHash: j.hash(act), genesisHash: j.hash(genesis), chain, jtis: ['jti-a-root'] };
  }

  it('no revocations → tier3 unsupported, ok stays true (Р3.5)', async () => {
    const ctx = await buildVoucherJournal();
    const result = await verifyAct(ctx.events, ctx.actHash, undefined, undefined, clockAt(T0));
    expect(result.ok).toBe(true);
    expect(result.tier3).toBe('unsupported');
    expect(result.warnings!.map((w) => w.code)).toEqual(['TIER3_UNSUPPORTED']);
  });

  it('rc.8-style checker (isRevoked only) degrades the same way', async () => {
    const ctx = await buildVoucherJournal();
    const legacy = { isRevoked: async () => false };
    const result = await verifyAct(ctx.events, ctx.actHash, legacy, undefined, clockAt(T0));
    expect(result.ok).toBe(true);
    expect(result.tier3).toBe('unsupported');
    expect(result.warnings!.map((w) => w.code)).toEqual(['TIER3_UNSUPPORTED']);
  });

  it('§6.8 supported checker: clean chain → ok true, tier3 supported', async () => {
    const ctx = await buildVoucherJournal();
    const result = await verifyAct(ctx.events, ctx.actHash, new DatedChecker(), new Map([[ctx.genesisHash, ctx.chain]]), clockAt(T0));
    expect(result.ok).toBe(true);
    expect(result.tier3).toBe('supported');
    // B (second founder) carries no voucher on the shared GENESIS membership:
    expect(result.warnings).toEqual([{ code: 'NO_VOUCHER', evHash: ctx.genesisHash }]);
  });

  it('§6.8 REVOKED @ SUB_ATTESTATION, inclusive on act.iat', async () => {
    const ctx = await buildVoucherJournal();
    // Revoked strictly after the act → valid:
    const before = new DatedChecker();
    before.revokeAt('jti-a-root', T0 + 5);
    const early = await verifyAct(ctx.events, ctx.actHash, before, new Map([[ctx.genesisHash, ctx.chain]]), clockAt(T0));
    expect(early.ok).toBe(true);

    // Revoked exactly at the act second → revoked («на at включительно»):
    const at = new DatedChecker();
    at.revokeAt('jti-a-root', T0);
    const hit = await verifyAct(ctx.events, ctx.actHash, at, new Map([[ctx.genesisHash, ctx.chain]]), clockAt(T0));
    expect(hit.ok).toBe(false);
    expectCode(hit, 'REVOKED');
    expect(hit.error!.message).toContain('SUB_ATTESTATION');
  });

  it('§6.8 missing chain artifact → VOUCHER_UNRESOLVED (not an error)', async () => {
    const ctx = await buildVoucherJournal();
    const result = await verifyAct(ctx.events, ctx.actHash, new DatedChecker(), undefined, clockAt(T0));
    expect(result.ok).toBe(true);
    expect(result.tier3).toBe('supported');
    expect(result.warnings).toEqual([
      { code: 'VOUCHER_UNRESOLVED', evHash: ctx.genesisHash }, // A: vc without artifact
      { code: 'NO_VOUCHER', evHash: ctx.genesisHash },         // B: no voucher at all
    ]);
  });

  it('§6.8 vc.rh mismatch → MALFORMED (fail-closed)', async () => {
    const ctx = await buildVoucherJournal();
    const stranger = new Member(7);
    const { chain: foreignChain } = await stranger.voucherChain('identity', ['jti-stranger']);
    const result = await verifyAct(ctx.events, ctx.actHash, new DatedChecker(), new Map([[ctx.genesisHash, foreignChain]]), clockAt(T0));
    expectCode(result, 'MALFORMED');
    expect(result.error!.message).toContain('vc.rh');
  });

  it('§6.8 chain not verifiable against vc.rp → IDP_UNRESOLVABLE', async () => {
    const a = new Member(1);
    const b = new Member(2);
    const stranger = new Member(7);
    const { chain: foreignChain, vc: foreignVc } = await stranger.voucherChain('identity', ['jti-foreign']);
    const vcs = new Map([[a, foreignVc]]);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2, vcs) }, [a, b]);
    const act = j.push('ACT', { no: 'act-1' }, [a, b]);
    // A's rp claims A's root, but the artifact is the stranger's chain.
    const forged: VoucherChain = { chain: foreignChain.chain };
    const result = await verifyAct(j.events, j.hash(act), new DatedChecker(), new Map([[j.hash(j.events[0]), forged]]), clockAt(T0));
    expectCode(result, 'IDP_UNRESOLVABLE');
  });

  it('§6.8 chain length vs anchor → ANCHOR_MISMATCH (D12)', async () => {
    const a = new Member(1);
    const b = new Member(2);
    // Identity anchor recorded in ft, but the artifact is a handle chain:
    const { chain, vc } = await a.voucherChain('handle', ['jti-root', 'jti-handle']);
    const vcs = new Map([[a, vc]]);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2, vcs) }, [a, b]);
    const act = j.push('ACT', { no: 'act-1' }, [a, b]);
    const result = await verifyAct(j.events, j.hash(act), new DatedChecker(), new Map([[j.hash(j.events[0]), chain]]), clockAt(T0));
    expectCode(result, 'ANCHOR_MISMATCH');
  });

  it('§6.8 signer without vc → NO_VOUCHER warning (D6, dial off)', async () => {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const { chain, vc } = await a.voucherChain('identity', ['jti-a-root']);
    const vcs = new Map([[a, vc]]);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2, vcs) }, [a, b]);
    const invite = j.push('INVITE', { an: 'identity' }, [a, b]);
    j.push('ENROLL', { ref: j.hash(invite) }, [c]); // no vc
    const act = j.push('ACT', { no: 'act-1' }, [a, b, c]);
    const result = await verifyAct(j.events, j.hash(act), new DatedChecker(), new Map([[j.hash(j.events[0]), chain]]), clockAt(T0));
    expect(result.ok).toBe(true);
    // a resolves via the founder voucher; b shares the GENESIS membership
    // (no own vc), c has its own ENROLL membership without vc:
    expect(result.warnings).toEqual([
      { code: 'NO_VOUCHER', evHash: j.hash(j.events[0]) },
      { code: 'NO_VOUCHER', evHash: j.hash(j.events[2]) },
    ]);
  });

  it('§6.7 compromisedAt: act after ca → REVOKED @ ROTATE_KEY; at/before ca → PRE_COMPROMISE_ACT', async () => {
    const a = new Member(1);
    const b = new Member(2);
    const a2 = new Member(1, 1);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b], T0);
    // Both acts are signed while `a` is still ACTIVE in the journal —
    // the rotation (with compromisedAt) lands later and opens the window.
    const actPre = j.push('ACT', { no: 'pre' }, [a, b], T0 + 10); // == ca (inclusive edge)
    const actPost = j.push('ACT', { no: 'post' }, [a, b], T0 + 15); // > ca
    j.push('ROTATE_KEY', { np: a2.pub, ca: T0 + 10 }, [a, a2], T0 + 20);

    const pre = await verifyAct(j.events, j.hash(actPre), undefined, undefined, clockAt(T0 + 10));
    expect(pre.ok).toBe(true);
    expect(pre.warnings!.map((w) => w.code)).toEqual(['PRE_COMPROMISE_ACT', 'TIER3_UNSUPPORTED']);

    const post = await verifyAct(j.events, j.hash(actPost), undefined, undefined, clockAt(T0 + 15));
    expect(post.ok).toBe(false);
    expectCode(post, 'REVOKED');
    expect(post.error!.message).toContain('ROTATE_KEY');

    // Plan rotation (no ca): acts by the old key stay clean.
    const j2 = new Journal();
    j2.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b], T0);
    const act = j2.push('ACT', { no: 'act-1' }, [a, b], T0);
    j2.push('ROTATE_KEY', { np: a2.pub }, [a, a2], T0);
    const clean = await verifyAct(j2.events, j2.hash(act), undefined, undefined, clockAt(T0));
    expect(clean.ok).toBe(true);
    expect(clean.tier3).toBe('unsupported');
    expect(clean.warnings!.map((w) => w.code)).toEqual(['TIER3_UNSUPPORTED']);
  });

  it('evHash not found / not an act → MALFORMED', async () => {
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const act = j.push('ACT', { no: 'act-1' }, [a, b]);
    expectCode(await verifyAct(j.events, bytes32(0xcc), undefined, undefined, clockAt(T0)), 'MALFORMED');
    expectCode(await verifyAct(j.events, j.hash(j.events[0]), undefined, undefined, clockAt(T0)), 'MALFORMED'); // GENESIS is not an act
    void act;
  });


describe('defensive branches (coverage)', () => {
  it('a second GENESIS mid-journal rejects', () => {
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    j.push('ACT', { no: 'x' }, [a, b]);
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    expectCode(verifyJournal(j.events, clockAt(T0)), 'MALFORMED');
  });

  it('INVITE without weight under a weight-constitution rejects', () => {
    const cn: Constitution = { th: {}, im: 'bearer', w: true };
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn, ft: foundersOf([a, b], cn) }, [a, b]);
    j.push('INVITE', { an: 'identity' }, [a, b]); // no w
    expectCode(verifyJournal(j.events, clockAt(T0)), 'MALFORMED');
  });

  it('ENROLL with an unknown invite ref rejects', () => {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    j.push('ENROLL', { ref: bytes32(0x77) }, [c]);
    expectCode(verifyJournal(j.events, clockAt(T0)), 'MALFORMED');
  });

  it('EXIT with two signatures rejects', () => {
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    j.push('EXIT', {}, [a, b]);
    expectCode(verifyJournal(j.events, clockAt(T0)), 'INVALID_QUORUM');
  });

  it('ROTATE_KEY signer-set rules (D39)', () => {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const b2 = new Member(2, 1);
    const stranger = new Member(9);

    const one = new Journal();
    one.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    one.push('ROTATE_KEY', { np: b2.pub }, [b]); // one signature
    expectCode(verifyJournal(one.events, clockAt(T0)), 'INVALID_QUORUM');

    const unsigned = new Journal();
    unsigned.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    unsigned.push('ROTATE_KEY', { np: b2.pub }, [a, b]); // np never signed
    expectCode(verifyJournal(unsigned.events, clockAt(T0)), 'INVALID_QUORUM');

    const toActive = new Journal();
    toActive.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const inv = toActive.push('INVITE', { an: 'identity' }, [a, b]);
    toActive.push('ENROLL', { ref: toActive.hash(inv) }, [c]);
    toActive.push('ROTATE_KEY', { np: a.pub }, [c, a]); // np signed and already ACTIVE
    expectCode(verifyJournal(toActive.events, clockAt(T0)), 'MALFORMED');

    const foreignParent = new Journal();
    foreignParent.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    foreignParent.push('ROTATE_KEY', { np: b2.pub }, [stranger, b2]); // parent not a member
    expectCode(verifyJournal(foreignParent.events, clockAt(T0)), 'INVALID_QUORUM');
  });

  it('DISSOLVE signed only by a non-member → no ACTIVE signer', () => {
    const a = new Member(1);
    const b = new Member(2);
    const stranger = new Member(9);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    j.push('DISSOLVE', {}, [stranger]);
    expectCode(verifyJournal(j.events, clockAt(T0)), 'INVALID_QUORUM');
  });

  it('no clock injected → system clock path (SKEW on historical journals)', async () => {
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const act = j.push('ACT', { no: 'x' }, [a, b]);
    const head = j.hash(act);
    expectCode(verifyJournal(j.events), 'SKEW');
    expectCode(verifyPrefix(j.events, head), 'SKEW');
    expectCode(await verifyAct(j.events, head), 'SKEW');
  });

  it('subhandle anchor with a 2-length chain → ANCHOR_MISMATCH (D12)', async () => {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const { chain: cChain, vc: cVc } = await c.voucherChain('handle', ['j1', 'j2']);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const inv = j.push('INVITE', { an: 'subhandle' }, [a, b]);
    j.push('ENROLL', { ref: j.hash(inv), vc: cVc }, [c]);
    const act = j.push('ACT', { no: 'x' }, [a, b, c]);
    const result = await verifyAct(
      j.events,
      j.hash(act),
      new DatedChecker(),
      new Map([[j.hash(j.events[2]), cChain]]),
      clockAt(T0)
    );
    expectCode(result, 'ANCHOR_MISMATCH');
  });

  it('§5.4 chain not alive at act.iat: expired (exp < act.iat) → IDP_UNRESOLVABLE', async () => {
    const a = new Member(1);
    const b = new Member(2);
    // exp = (T0 − 7200) + 3600 = T0 − 3600 — dead long before the act.
    const { chain, vc } = await a.voucherChain('identity', ['jti-expired'], { now: T0 - 7200, ttlSeconds: 3600 });
    const vcs = new Map([[a, vc]]);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2, vcs) }, [a, b]);
    const act = j.push('ACT', { no: 'act-1' }, [a, b]);
    const result = await verifyAct(j.events, j.hash(act), new DatedChecker(), new Map([[j.hash(j.events[0]), chain]]), clockAt(T0));
    expectCode(result, 'IDP_UNRESOLVABLE');
  });

  it('§5.4 chain issued after the act (iat > act.iat) → IDP_UNRESOLVABLE', async () => {
    const a = new Member(1);
    const b = new Member(2);
    const { chain, vc } = await a.voucherChain('identity', ['jti-future'], { now: T0 + 100, ttlSeconds: 3600 });
    const vcs = new Map([[a, vc]]);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2, vcs) }, [a, b]);
    const act = j.push('ACT', { no: 'act-1' }, [a, b]);
    const result = await verifyAct(j.events, j.hash(act), new DatedChecker(), new Map([[j.hash(j.events[0]), chain]]), clockAt(T0));
    expectCode(result, 'IDP_UNRESOLVABLE');
  });

  it('§5.4 chain alive at act.iat (boundary: exp = act.iat + 1) → ok', async () => {
    const a = new Member(1);
    const b = new Member(2);
    const { chain, vc } = await a.voucherChain('identity', ['jti-alive'], { now: T0, ttlSeconds: 1 });
    const vcs = new Map([[a, vc]]);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2, vcs) }, [a, b]);
    const act = j.push('ACT', { no: 'act-1' }, [a, b]);
    const result = await verifyAct(j.events, j.hash(act), new DatedChecker(), new Map([[j.hash(j.events[0]), chain]]), clockAt(T0));
    expect(result.ok).toBe(true);
    expect(result.tier3).toBe('supported');
  });

  it('§5.4 chain expiring exactly at act.iat (exp = act.iat) → IDP_UNRESOLVABLE (strict < exp)', async () => {
    const a = new Member(1);
    const b = new Member(2);
    // iat = T0 − 3600, exp = T0 = act.iat — the chain dies AT the act's
    // moment: aliveness requires act.iat < exp (no closed right bound —
    // pins the implementation against `≤ exp` regressions).
    const { chain, vc } = await a.voucherChain('identity', ['jti-dies-at-act'], { now: T0 - 3600, ttlSeconds: 3600 });
    const vcs = new Map([[a, vc]]);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2, vcs) }, [a, b]);
    const act = j.push('ACT', { no: 'act-1' }, [a, b]);
    const result = await verifyAct(j.events, j.hash(act), new DatedChecker(), new Map([[j.hash(j.events[0]), chain]]), clockAt(T0));
    expectCode(result, 'IDP_UNRESOLVABLE');
  });

  it('handle-anchored founder: real root→handle chain binds to pp (D2/D12)', async () => {
    const ha = Member.handle(1);
    const b = new Member(2);
    const { chain, vc } = await ha.voucherChain('handle', ['jti-h-root', 'jti-h-handle']);
    const vcs = new Map([[ha, vc]]);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([ha, b], CN2, vcs) }, [ha, b]);
    const act = j.push('ACT', { no: 'act-1' }, [ha, b]);
    const result = await verifyAct(j.events, j.hash(act), new DatedChecker(), new Map([[j.hash(j.events[0]), chain]]), clockAt(T0));
    expect(result.ok).toBe(true);
    // The chain resolves founder A; founder B shares the GENESIS
    // membership without its own voucher (D6 — dial is off):
    expect(result.warnings).toEqual([{ code: 'NO_VOUCHER', evHash: j.hash(j.events[0]) }]);
  });
});
});

describe('JournalVerifier — incremental replay (rc.3, F-rc3-1)', () => {
  /** Mixed lifecycle without DISSOLVE (10 events, real keys, real sigs). */
  function lifecycle(): Event[] {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const b2 = new Member(2, 1); // B after ROTATE_KEY (gen 1)
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cx: 'joint charging agreement', cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const invite = j.push('INVITE', { an: 'identity' }, [a, b]);
    j.push('ENROLL', { ref: j.hash(invite) }, [c]);
    const act1 = j.push('ACT', { no: 'session-1' }, [a, b, c]);
    j.push('REVERSE_ACT', { ref: j.hash(act1), k: 'supersede', rs: 'wrong tariff' }, [a, b, c]);
    j.push('AMEND', { cn: CN2 }, [a, b, c]);
    j.push('ROTATE_KEY', { np: b2.pub }, [b, b2]);
    j.push('ACT', { no: 'session-2' }, [a, b2, c]);
    j.push('EXIT', { rs: 'leaving' }, [a]);
    j.push('ACT', { no: 'session-3' }, [b2, c]);
    return j.events;
  }

  it('incremental apply == verifyJournal (full-lifecycle parity)', () => {
    const events = lifecycle();
    const batch = verifyJournal(events, clockAt(T0));
    expect(batch.ok).toBe(true);
    const v = createJournalVerifier(clockAt(T0));
    for (const e of events) v.apply(e);
    expect(v.height).toBe(events.length);
    expect(v.head).toBe(batch.journalHead);
    const snap = v.snapshot();
    expect(snap.ok).toBe(true);
    expect(snap.pactRoot).toBe(batch.pactRoot);
    expect(snap.journalHead).toBe(batch.journalHead);
    expect(snap.seq).toBe(batch.seq);
    expect(snap.roster).toEqual(batch.roster);
    expect(snap.warnings).toEqual([]);
  });

  it('applySuffix == batch; repeated suffix is an integrity-only no-op; shorter journal ⇒ FORK_DETECTED', () => {
    const events = lifecycle();
    const v = createJournalVerifier(clockAt(T0));
    v.applySuffix(events);
    const head = v.head;
    expect(head).toBe(verifyJournal(events, clockAt(T0)).journalHead);
    v.applySuffix(events); // same array — re-checked, nothing new to apply
    expect(v.head).toBe(head);
    expect(v.height).toBe(events.length);
    try {
      v.applySuffix(events.slice(0, events.length - 1));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PactError);
      expect((e as PactError).code).toBe('FORK_DETECTED');
    }
  });

  it('error parity: a tampered signature rejects identically (streaming throws, state untouched)', () => {
    const events = lifecycle();
    const tampered = events.map((e) => ({ ...e, sig: e.sig.map((s) => ({ ...s })) }));
    tampered[4] = { ...tampered[4], sig: [{ ...tampered[4].sig[0], s: tampered[4].sig[0].s.slice(0, -4) + 'AAAA' }] };
    expectCode(verifyJournal(tampered, clockAt(T0)), 'SIGNATURE_INVALID');
    const v = createJournalVerifier(clockAt(T0));
    let thrown: PactError | undefined;
    try {
      for (const e of tampered) v.apply(e);
      expect.unreachable('should have thrown');
    } catch (err) {
      thrown = err as PactError;
    }
    expect(thrown).toBeInstanceOf(PactError);
    expect(thrown!.code).toBe('SIGNATURE_INVALID');
    expect(thrown!.context).toBe('verify');
    // The failed apply left the verifier at the last good event:
    expect(v.height).toBe(4);
    expect(v.head).toBe(evHash(events[3]));
  });

  it('§3 attack: re-chained middle tamper ⇒ FORK_DETECTED on the committed state (RC3-D2/D3)', () => {
    const events = lifecycle();
    const v = createJournalVerifier(clockAt(T0));
    v.applySuffix(events);
    // Forge: swap the payload of a middle event and re-chain every
    // subsequent ph — chain-consistent, no attacker signatures needed
    // to reach the commitment check.
    const forged = events.map((e) => ({ ...e, sig: e.sig.map((s) => ({ ...s })) }));
    forged[2] = { ...forged[2], pl: { ref: bytes32(9) } };
    for (let i = 3; i < forged.length; i++) {
      forged[i] = { ...forged[i], ph: evHash(forged[i - 1]) };
    }
    // From-scratch verification names the precise cause:
    expectCode(verifyJournal(forged, clockAt(T0)), 'SIGNATURE_INVALID');
    // The committed verifier refuses the divergence without recomputing:
    try {
      v.applySuffix(forged);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PactError);
      expect((e as PactError).code).toBe('FORK_DETECTED');
    }
    // The committed state is intact — the honest array still applies:
    v.applySuffix(events);
    expect(v.head).toBe(evHash(events[events.length - 1]));
  });

  it('skew parity (RC3-D5): pinned stale clock rejects like the batch; skewCheck none streams through', () => {
    const events = lifecycle();
    const stale = createJournalVerifier(clockAt(T0 - 3600));
    try {
      stale.apply(events[0]);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PactError);
      expect((e as PactError).code).toBe('SKEW');
    }
    const none = createJournalVerifier(clockAt(T0 - 3600), { skewCheck: 'none' });
    for (const e of events) none.apply(e);
    expect(none.height).toBe(events.length);
    expect(none.head).toBe(evHash(events[events.length - 1]));
  });

  it('atomicity (review Б-rc3-1): an error inside applyEvent leaves the committed state untouched', () => {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    const invite = j.push('INVITE', { an: 'identity' }, [a, b]);
    j.push('ENROLL', { ref: j.hash(invite) }, [c]);
    const act = j.push('ACT', { no: 'session-1' }, [a, b, c]);
    // Quorum passes against the CURRENT constitution ('all' — a, b, c are
    // ACTIVE), but the proposed one violates B-5: k(DISSOLVE) = 5 > 2
    // founders ⇒ validateConstitutionQuorum throws INSIDE applyEvent,
    // after requireQuorum, before any state write.
    const badCn: Constitution = { th: { DISSOLVE: { m: 'k', k: 5 } }, im: 'bearer', w: false };
    const raw: Omit<Event, 'sig'> = {
      typ: 'me2em/pact-event/v1',
      pid: j.events[0].pid,
      sq: j.events.length,
      ph: j.head,
      ty: 'AMEND',
      pl: { cn: badCn },
      iat: T0,
    };
    const amend: Event = { ...raw, sig: [a.signEvent(raw), b.signEvent(raw), c.signEvent(raw)] };
    // From scratch the failure comes from applyEvent too (not earlier):
    expectCode(verifyJournal([...j.events, amend], clockAt(T0)), 'MALFORMED');
    // Streaming: the same throw — and the committed state is untouched:
    const v = createJournalVerifier(clockAt(T0));
    v.applySuffix(j.events);
    const before = v.snapshot();
    // The full committed state — snapshot() sees only roster/pactRoot/
    // journalHead/seq, so a regression that mutates constitution,
    // member records, invites, used invites, acts or rotated keys
    // before a failing check would be invisible to it (review Б-rc3-1):
    const beforeFull = v._debugState();
    try {
      v.apply(amend);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PactError);
      expect((e as PactError).code).toBe('MALFORMED');
    }
    expect(v.height).toBe(j.events.length);
    expect(v.head).toBe(j.hash(act));
    expect(v.snapshot()).toEqual(before);
    expect(v._debugState()).toEqual(beforeFull);
  });

  it('atomicity (review Б-rc3-1): a failed first apply does not latch a foreign pid', () => {
    const a = new Member(1);
    const b = new Member(2);
    const j = new Journal();
    j.push('GENESIS', { ch: CH, cn: CN2, ft: foundersOf([a, b], CN2) }, [a, b]);
    // A valid GENESIS envelope with a foreign pid (codec grammar holds);
    // the honest signatures do not verify against the foreign TBS, so
    // the apply fails at the signature stage — after the chain checks:
    const raw: Omit<Event, 'sig'> = {
      typ: 'me2em/pact-event/v1',
      pid: b64urlEncode(bytes(16, 0x99)),
      sq: 0,
      ph: ZERO32,
      ty: 'GENESIS',
      pl: j.events[0].pl,
      iat: T0,
    };
    const foreign: Event = { ...raw, sig: j.events[0].sig };
    const v = createJournalVerifier(clockAt(T0));
    const empty = v._debugState();
    try {
      v.apply(foreign);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PactError);
      expect((e as PactError).code).toBe('SIGNATURE_INVALID');
    }
    // Nothing latched — pid included (it committed with the event, not
    // in the chain pre-check; the old order poisoned the verifier so
    // that every honest apply afterwards died with FORK_DETECTED):
    expect(v._debugState()).toEqual(empty);
    // The verifier stays usable for the honest journal:
    for (const e of j.events) v.apply(e);
    expect(v.height).toBe(j.events.length);
    expect(v.head).toBe(j.hash(j.events[j.events.length - 1]));
  });
});
