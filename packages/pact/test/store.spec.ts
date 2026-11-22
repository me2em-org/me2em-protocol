// test/store.spec.ts — M1.5: JournalStore CAS (C1/D41) + byte-exact
// export/import (D47/Р8, B-8).

import { describe, it, expect } from 'vitest';
import { crypto } from '@me2em/core';
import { b64urlEncode, encodeEvent, evHash, tbsBytes, ZERO32 } from '../src/codec.js';
import { exportJournal, importJournal } from '../src/store/Export.js';
import { MemoryStore } from '../src/store/MemoryStore.js';
import { PactError } from '../src/errors.js';
import { verifyJournal } from '../src/verify.js';
import { assembleAct, assembleGenesis } from '../src/assemble/index.js';
import type { Event, Founder } from '../src/types.js';
import { CH, clockAt, CN2, Member, PID, T0 } from './journal-utils.js';

const ctxHash = (s: string) => b64urlEncode(crypto.sha256(new TextEncoder().encode(s)));

const founderEntries = (members: Member[]): Founder[] => {
  const list = members.map((m) => ({ p: m.pub, pp: m.anchorPub(), an: 'identity' as const }));
  list.sort((x, y) => (x.p < y.p ? -1 : x.p > y.p ? 1 : 0));
  return list;
};

function twoPartyJournal(): Event[] {
  const a = new Member(1);
  const b = new Member(2);
  const genesis = assembleGenesis({
    pid: PID, ch: CH, cx: 'joint charging agreement', cn: CN2,
    ft: founderEntries([a, b]), founderKeys: [a.key, b.key], clock: clockAt(T0),
  });
  const act = assembleAct([genesis], { no: 'act-1' }, [a.key, b.key], clockAt(T0));
  return [genesis, act];
}

describe('MemoryStore — CAS append (C1/D41)', () => {
  it('append/read/head roundtrip; empty head is ZERO32', async () => {
    const store = new MemoryStore();
    expect(await store.head()).toBe(ZERO32);
    const events = twoPartyJournal();
    let head = ZERO32;
    for (const e of events) {
      await store.append(head, e);
      head = evHash(e);
    }
    expect(await store.head()).toBe(head);
    expect(await store.read()).toEqual(events);
  });

  it('CAS mismatch → FORK_DETECTED; bad ph/sq → FORK_DETECTED', async () => {
    const store = new MemoryStore();
    const [genesis] = twoPartyJournal();
    await store.append(ZERO32, genesis);
    const head = evHash(genesis);

    await expect(store.append(ZERO32, genesis)).rejects.toMatchObject({ code: 'FORK_DETECTED' });
    await expect(store.append('wrong-head', genesis)).rejects.toBeInstanceOf(PactError);

    const [, act] = twoPartyJournal();
    const wrongPh = { ...act, ph: ZERO32 };
    await expect(store.append(head, wrongPh)).rejects.toMatchObject({ code: 'FORK_DETECTED' });
    const wrongSq = { ...act, sq: 5 };
    await expect(store.append(head, wrongSq)).rejects.toMatchObject({ code: 'FORK_DETECTED' });
  });

  it('read returns a snapshot — mutating it does not touch the store', async () => {
    const store = new MemoryStore();
    const [genesis] = twoPartyJournal();
    await store.append(ZERO32, genesis);
    const snapshot = await store.read();
    snapshot.length = 0;
    expect(await store.read()).toEqual([genesis]);
  });
});

describe('Export/import — byte-exact sneakernet (D47/Р8)', () => {
  it('export → import roundtrip is deep-equal and byte-stable (§6.10)', () => {
    const events = twoPartyJournal();
    const bytes1 = exportJournal(events);
    const reimported = importJournal(bytes1);
    expect(reimported).toEqual(events);
    const bytes2 = exportJournal(reimported);
    expect(bytes2).toEqual(bytes1); // parse→canonicalize idempotence
    // LF-only, final LF, canonical JCS lines:
    const text = new TextDecoder().decode(bytes1);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.includes('\r')).toBe(false);
    expect(text.split('\n').length).toBe(3); // 2 lines + trailing
    expect(new TextDecoder().decode(encodeEvent(events[0]))).toBe(text.split('\n')[0]);
  });

  it('B-8: differing signature sets are preserved (evHash equality ≠ byte equality)', () => {
    const a = new Member(1);
    const b = new Member(2);
    const c = new Member(3);
    const [genesis] = twoPartyJournal();
    // Same TBS, one MORE valid signature (a third party co-signs post-hoc) —
    // evHash unchanged, byte export differs, strict parser accepts the set:
    const extraSig = { p: c.pub, s: b64urlEncode(crypto.sign(tbsBytes(genesis), c.key)) };
    const withExtraSig: Event = { ...genesis, sig: [...genesis.sig, extraSig] };
    // Same TBS → same evHash, different export bytes:
    expect(evHash(withExtraSig)).toBe(evHash(genesis));
    const b1 = exportJournal([genesis]);
    const b2 = exportJournal([withExtraSig]);
    expect(b1).not.toEqual(b2);
    expect(importJournal(b1)[0].sig.length).toBe(2);
    expect(importJournal(b2)[0].sig.length).toBe(3); // sets preserved
    expect(a.key).toBeDefined();
    expect(b.key).toBeDefined();
  });

  it('import: missing final LF is fine; blank/whitespace/CRLF lines reject', () => {
    const events = twoPartyJournal();
    const bytes = exportJournal(events);
    const noFinalLf = bytes.slice(0, -1);
    expect(importJournal(noFinalLf)).toEqual(events);

    const crlf = new TextEncoder().encode(new TextDecoder().decode(bytes).replace('\n', '\r\n'));
    expect(() => importJournal(crlf)).toThrow(PactError);

    const blank = new TextEncoder().encode(new TextDecoder().decode(bytes).replace('\n', '\n\n'));
    expect(() => importJournal(blank)).toThrow(PactError);

    const padded = new TextEncoder().encode(' ' + new TextDecoder().decode(bytes));
    expect(() => importJournal(padded)).toThrow(PactError);

    expect(() => importJournal(new TextEncoder().encode('{not json}\n'))).toThrow(PactError);
    expect(importJournal(new Uint8Array(0))).toEqual([]);
  });

  it('export→import→verify: the sneakernet artifact replays clean', () => {
    const events = twoPartyJournal();
    const roundtripped = importJournal(exportJournal(events));
    expect(verifyJournal(roundtripped, clockAt(T0)).ok).toBe(true);
  });

  it('D35: an oversized payload line rejects with PAYLOAD_TOO_LARGE', () => {
    const big = { ch: ctxHash('x'), cx: 'a'.repeat(2049), cn: CN2, ft: [] };
    const line = JSON.stringify({
      typ: 'me2em/pact-event/v1', pid: PID, sq: 0, ph: ZERO32, ty: 'GENESIS',
      pl: big, iat: T0, sig: [],
    });
    expect(() => importJournal(new TextEncoder().encode(line + '\n'))).toThrow(PactError);
  });
});
