// test/transport.spec.ts — M1.6: Channel contract + ReferenceX3DH
// (ТЗ §3.6 / PACTS C4/D44): X3DH-authenticated offer/accept, GENESIS
// co-signing, D34 context check-verification, fail-closed ordering.

import { describe, it, expect } from 'vitest';
import { crypto } from '@me2em/core';
import { b64urlEncode, evHash, tbsBytes, ZERO32 } from '../src/codec.js';
import { ReferenceX3DH } from '../src/transport/ReferenceX3DH.js';
import type { Offer } from '../src/transport/Channel.js';
import { verifyJournal } from '../src/verify.js';
import { assembleAct } from '../src/assemble/index.js';
import { MemoryStore } from '../src/store/MemoryStore.js';
import type { Constitution, Event, Founder } from '../src/types.js';
import { CH, clockAt, CN2, CONTEXT, Member, PID, T0 } from './journal-utils.js';

const founderEntries = (members: Member[], cn: Constitution): Founder[] => {
  const list = members.map((m) => ({ p: m.pub, pp: m.anchorPub(), an: 'identity' as const, ...(cn.w ? { w: m.w } : {}) }));
  list.sort((x, y) => (x.p < y.p ? -1 : x.p > y.p ? 1 : 0));
  return list;
};

/** Authority-signed half of GENESIS (the initiator co-signs via the channel). */
function halfSignedGenesis(authority: Member, initiator: Member): Event {
  const raw: Omit<Event, 'sig'> = {
    typ: 'me2em/pact-event/v1',
    pid: PID,
    sq: 0,
    ph: ZERO32,
    ty: 'GENESIS',
    pl: { ch: CH, cx: CONTEXT, cn: CN2, ft: founderEntries([authority, initiator], CN2) },
    iat: T0,
  };
  return { ...raw, sig: [{ p: authority.pub, s: b64urlEncode(crypto.sign(tbsBytes(raw as Event), authority.key)) }] };
}

const makeChannel = (): { channel: ReferenceX3DH; authority: Member; initiator: Member } => {
  const authority = new Member(1);
  const initiator = new Member(2);
  const channel = new ReferenceX3DH({
    responder: { privateKey: authority.key, publicKey: crypto.getPublicKey(authority.key) },
    initiator: { privateKey: initiator.key, publicKey: crypto.getPublicKey(initiator.key) },
    responderPactKey: authority.key,
    initiatorPactKey: initiator.key,
  });
  return { channel, authority, initiator };
};

describe('ReferenceX3DH — authenticated channel (M1.6)', () => {
  it('offer → accept: X3DH secrets converge, pactPub is the authority member', async () => {
    const { channel, authority } = makeChannel();
    const offer: Offer = { typ: 'me2em/pact-offer/v1', pid: PID, ch: CH, cx: CONTEXT };
    const accept = await channel.offer(offer);
    expect(accept.typ).toBe('me2em/pact-accept/v1');
    expect(accept.pid).toBe(PID);
    expect(accept.pactPub).toBe(authority.pub);
  });

  it('genesis flow: authority signs first, initiator co-signs, journal replays clean', async () => {
    const { channel, authority, initiator } = makeChannel();
    await channel.offer({ typ: 'me2em/pact-offer/v1', pid: PID, ch: CH, cx: CONTEXT });
    const coSigned = await channel.genesis(halfSignedGenesis(authority, initiator));
    expect(coSigned.sig.length).toBe(2);
    const result = verifyJournal([coSigned], clockAt(T0));
    expect(result.ok).toBe(true);
    // The act after GENESIS assembles over the co-signed journal:
    const act = assembleAct([coSigned], { no: 'first-act' }, [authority.key, initiator.key], clockAt(T0));
    expect(verifyJournal([coSigned, act], clockAt(T0)).ok).toBe(true);
  });

  it('full loop with the store: accept → co-signed genesis → CAS append', async () => {
    const { channel, authority, initiator } = makeChannel();
    const accept = await channel.offer({ typ: 'me2em/pact-offer/v1', pid: PID, ch: CH });
    const coSigned = await channel.genesis(halfSignedGenesis(authority, initiator));
    const store = new MemoryStore();
    await store.append(ZERO32, coSigned);
    expect(await store.head()).toBe(evHash(coSigned));
    expect(accept.pid).toBe(PID);
  });

  it('D34: offer with cx not hashing to ch → MALFORMED', async () => {
    const { channel } = makeChannel();
    const offer: Offer = { typ: 'me2em/pact-offer/v1', pid: PID, ch: CH, cx: 'different context' };
    await expect(channel.offer(offer)).rejects.toMatchObject({ code: 'MALFORMED' });
  });

  it('genesis() before offer() → MALFORMED', async () => {
    const { channel, authority, initiator } = makeChannel();
    await expect(channel.genesis(halfSignedGenesis(authority, initiator))).rejects.toMatchObject({ code: 'MALFORMED' });
  });

  it('genesis: foreign first signature → SIGNATURE_INVALID', async () => {
    const { channel, authority, initiator } = makeChannel();
    await channel.offer({ typ: 'me2em/pact-offer/v1', pid: PID, ch: CH, cx: CONTEXT });
    const foreign = new Member(9);
    const g = halfSignedGenesis(foreign, initiator);
    await expect(channel.genesis(g)).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
    void authority;
  });

  it('genesis: broken authority signature → SIGNATURE_INVALID', async () => {
    const { channel, authority, initiator } = makeChannel();
    await channel.offer({ typ: 'me2em/pact-offer/v1', pid: PID, ch: CH, cx: CONTEXT });
    const g = halfSignedGenesis(authority, initiator);
    const raw = Buffer.from(g.sig[0].s, 'base64url');
    raw[10] ^= 0xff;
    g.sig[0].s = b64urlEncode(new Uint8Array(raw));
    await expect(channel.genesis(g)).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  });

  it('genesis: wrong ph / pid / type → MALFORMED', async () => {
    const { channel, authority, initiator } = makeChannel();
    await channel.offer({ typ: 'me2em/pact-offer/v1', pid: PID, ch: CH, cx: CONTEXT });
    const g = halfSignedGenesis(authority, initiator);
    await expect(channel.genesis({ ...g, ph: b64urlEncode(new Uint8Array(32).fill(1)) })).rejects.toMatchObject({ code: 'MALFORMED' });
    await expect(channel.genesis({ ...g, pid: b64urlEncode(new Uint8Array(16).fill(2)) })).rejects.toMatchObject({ code: 'MALFORMED' });
    await expect(channel.genesis({ ...g, ty: 'ACT' })).rejects.toMatchObject({ code: 'MALFORMED' });
  });

  it('genesis: non-canonical base64url signature → MALFORMED (strict codec, Б7)', async () => {
    const { channel, authority, initiator } = makeChannel();
    await channel.offer({ typ: 'me2em/pact-offer/v1', pid: PID, ch: CH, cx: CONTEXT });
    const g = halfSignedGenesis(authority, initiator);
    // The final sextet of a canonical 64-byte value carries 4 zero padding
    // bits — a canonical signature never ends in 'B'; setting it keeps the
    // alphabet valid but re-encodes differently (strict decode rejects).
    g.sig[0].s = `${g.sig[0].s.slice(0, -1)}B`;
    await expect(channel.genesis(g)).rejects.toMatchObject({ code: 'MALFORMED' });
  });

  it('genesis: pre-co-signed GENESIS (two signatures) → MALFORMED (В12)', async () => {
    const { channel, authority, initiator } = makeChannel();
    await channel.offer({ typ: 'me2em/pact-offer/v1', pid: PID, ch: CH, cx: CONTEXT });
    const g = halfSignedGenesis(authority, initiator);
    g.sig.push({ p: initiator.pub, s: b64urlEncode(crypto.sign(tbsBytes(g), initiator.key)) });
    await expect(channel.genesis(g)).rejects.toMatchObject({ code: 'MALFORMED' });
  });
});
