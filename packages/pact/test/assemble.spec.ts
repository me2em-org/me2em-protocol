// test/assemble.spec.ts — M1.4: 2-party assembly of all 11 event types
// (ТЗ §3.4; PACTS §7.5). Every assembled event is re-verified against
// the passed prefix (B-7, fail-closed) — the killer test assembles the
// full lifecycle and replays it clean.

import { describe, it, expect } from 'vitest';
import { crypto } from '@me2em/core';
import { b64urlEncode, evHash, ZERO32 } from '../src/codec.js';
import {
  assembleAct,
  assembleAmend,
  assembleDissolve,
  assembleEnroll,
  assembleEvict,
  assembleExit,
  assembleGenesis,
  assembleInvite,
  assembleReverseAct,
  assembleRevokeInvite,
  assembleRotate,
} from '../src/assemble/index.js';
import { PactError } from '../src/errors.js';
import { verifyJournal } from '../src/verify.js';
import type { Constitution, Founder } from '../src/types.js';
import { CH, clockAt, CN2, Member, PID, T0 } from './journal-utils.js';

const ctxHash = (s: string) => b64urlEncode(crypto.sha256(new TextEncoder().encode(s)));

const founderEntries = (members: Member[], cn: Constitution): Founder[] => {
  const list = members.map((m) => ({ p: m.pub, pp: m.anchorPub(), an: 'identity' as const, ...(cn.w ? { w: m.w } : {}) }));
  list.sort((x, y) => (x.p < y.p ? -1 : x.p > y.p ? 1 : 0));
  return list;
};

function expectPactThrow(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable('should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(PactError);
    expect((e as PactError).code).toBe(code);
  }
}

describe('2-party assembly (M1.4)', () => {
  it('assembleGenesis: sq 0, ph ZERO32, co-signature; replay clean', () => {
    const a = new Member(1);
    const b = new Member(2);
    const genesis = assembleGenesis({
      pid: PID,
      ch: ctxHash('ctx'),
      cx: 'ctx',
      cn: CN2,
      ft: founderEntries([a, b], CN2),
      founderKeys: [a.key, b.key],
      clock: clockAt(T0),
    });
    expect(genesis.sq).toBe(0);
    expect(genesis.ph).toBe(ZERO32);
    expect(genesis.iat).toBe(T0);
    expect(genesis.sig.length).toBe(2);
    const result = verifyJournal([genesis], clockAt(T0));
    expect(result.ok).toBe(true);
  });

  it('§6.4 full lifecycle through assemblers replays clean', () => {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const b2 = new Member(2, 1);
    let events = [
      assembleGenesis({
        pid: PID, ch: CH, cx: 'joint charging agreement', cn: CN2,
        ft: founderEntries([a, b], CN2), founderKeys: [a.key, b.key], clock: clockAt(T0),
      }),
    ];
    const genesisHash = evHash(events[0]);

    events = [...events, assembleInvite(events, { an: 'identity' }, [a.key, b.key], clockAt(T0))];
    const inviteHash = evHash(events[1]);
    events = [...events, assembleEnroll(events, { ref: inviteHash, dn: 'carol' }, [c.key], clockAt(T0))];
    events = [...events, assembleAct(events, { no: 'session-1' }, [a.key, b.key, c.key], clockAt(T0))];
    const actHash = evHash(events[3]);
    events = [...events, assembleReverseAct(events, { ref: actHash, k: 'supersede', rs: 'wrong tariff' }, [a.key, b.key, c.key], clockAt(T0))];
    const cn2: Constitution = { th: { DISSOLVE: { m: 'any' } }, im: 'bearer', w: false };
    events = [...events, assembleAmend(events, { cn: cn2 }, [a.key, b.key, c.key], clockAt(T0))];
    events = [...events, assembleRotate(events, { np: b2.pub }, [b.key, b2.key], clockAt(T0))];
    events = [...events, assembleExit(events, { rs: 'leaving' }, [a.key], clockAt(T0))];
    events = [...events, assembleDissolve(events, { rs: 'done' }, [b2.key], clockAt(T0))];

    expect(events.length).toBe(9);
    const result = verifyJournal(events, clockAt(T0));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.pactRoot).toBe(genesisHash);
    expect(result.seq).toBe(8);
  });

  it('REVOKE_INVITE and EVICT assemble and verify', () => {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const events = [
      assembleGenesis({ pid: PID, ch: CH, cn: CN2, ft: founderEntries([a, b], CN2), founderKeys: [a.key, b.key], clock: clockAt(T0) }),
    ];
    const invite = assembleInvite(events, { an: 'identity' }, [a.key, b.key], clockAt(T0));
    const withInvite = [...events, invite];
    const revoked = assembleRevokeInvite(withInvite, { ref: evHash(invite), rs: 'unused' }, [a.key, b.key], clockAt(T0));
    expect(verifyJournal([...withInvite, revoked], clockAt(T0)).ok).toBe(true);

    const evictEvents = [
      assembleGenesis({ pid: PID, ch: CH, cn: CN2, ft: founderEntries([a, b], CN2), founderKeys: [a.key, b.key], clock: clockAt(T0) }),
    ];
    const inv2 = assembleInvite(evictEvents, { an: 'identity' }, [a.key, b.key], clockAt(T0));
    const evictWithInvite = [...evictEvents, inv2];
    const enrolled = [...evictWithInvite, assembleEnroll(evictWithInvite, { ref: evHash(inv2) }, [c.key], clockAt(T0))];
    const evicted = assembleEvict(enrolled, { tp: c.pub, rs: 'breach' }, [a.key, b.key, c.key], clockAt(T0));
    const result = verifyJournal([...enrolled, evicted], clockAt(T0));
    expect(result.ok).toBe(true);
    expect(result.roster!.map((r) => r.p)).toEqual([a.pub, b.pub].sort());
  });

  it('INVALID_QUORUM at assembly: INVITE by one of two (default all)', () => {
    const a = new Member(1);
    const b = new Member(2);
    const events = [
      assembleGenesis({ pid: PID, ch: CH, cn: CN2, ft: founderEntries([a, b], CN2), founderKeys: [a.key, b.key], clock: clockAt(T0) }),
    ];
    expectPactThrow(() => assembleInvite(events, { an: 'identity' }, [a.key], clockAt(T0)), 'INVALID_QUORUM');
  });

  it('founderKeys must cover ft.p exactly', () => {
    const a = new Member(1);
    const b = new Member(2);
    expectPactThrow(
      () =>
        assembleGenesis({
          pid: PID, ch: CH, cn: CN2, ft: founderEntries([a, b], CN2),
          founderKeys: [a.key], clock: clockAt(T0), // b missing
        }),
      'MALFORMED'
    );
    const stranger = new Member(9);
    expectPactThrow(
      () =>
        assembleGenesis({
          pid: PID, ch: CH, cn: CN2, ft: founderEntries([a, b], CN2),
          founderKeys: [a.key, stranger.key], clock: clockAt(T0), // wrong key
        }),
      'MALFORMED'
    );
  });

  it('B-7 / §6.5 fork protection: two branches on one sq → FORK_DETECTED', () => {
    const a = new Member(1);
    const b = new Member(2);
    const genesis = assembleGenesis({
      pid: PID, ch: CH, cn: CN2, ft: founderEntries([a, b], CN2),
      founderKeys: [a.key, b.key], clock: clockAt(T0),
    });
    const prefix = [genesis];
    // Two independently valid events on the same position (sq 1):
    const branchA = assembleAct(prefix, { no: 'branch-a' }, [a.key, b.key], clockAt(T0));
    const branchB = assembleAct(prefix, { no: 'branch-b' }, [a.key, b.key], clockAt(T0));
    expect(verifyJournal([...prefix, branchA], clockAt(T0)).ok).toBe(true);
    expect(verifyJournal([...prefix, branchB], clockAt(T0)).ok).toBe(true);
    // Combined: a fork — sq 1 repeats, ph diverges (D27: each branch alone stays valid).
    const combined = verifyJournal([...prefix, branchA, branchB], clockAt(T0));
    expect(combined.ok).toBe(false);
    expect(combined.error!.code).toBe('FORK_DETECTED');
  });

  it('SKEW at assembly: a shifted clock produces a skewed event the builder refuses', () => {
    const a = new Member(1);
    const b = new Member(2);
    const events = [
      assembleGenesis({ pid: PID, ch: CH, cn: CN2, ft: founderEntries([a, b], CN2), founderKeys: [a.key, b.key], clock: clockAt(T0) }),
    ];
    expectPactThrow(
      () => assembleInvite(events, { an: 'identity' }, [a.key, b.key], clockAt(T0 + SKEW_FAR)),
      'SKEW'
    );
  });

  it('payload limits fail closed at assembly (ACT doc without dh)', () => {
    const a = new Member(1);
    const b = new Member(2);
    const events = [
      assembleGenesis({ pid: PID, ch: CH, cn: CN2, ft: founderEntries([a, b], CN2), founderKeys: [a.key, b.key], clock: clockAt(T0) }),
    ];
    expectPactThrow(() => assembleAct(events, { doc: 'no commitment' }, [a.key, b.key], clockAt(T0)), 'MALFORMED');
  });
});

const SKEW_FAR = T0 + 3600;
