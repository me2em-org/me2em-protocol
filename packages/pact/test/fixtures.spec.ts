// test/fixtures.spec.ts — M1.7 public fixtures: gen-coherent signing
// (Б8) and the real root→handle voucher chain (Б4, §5.4/D2).

import { describe, it, expect } from 'vitest';
import { Attestation, crypto } from '@me2em/core';
import { b64urlEncode, ZERO32 } from '../src/codec.js';
import { bytes, Member, PID } from './journal-utils.js';
import type { Constitution, Event } from '../src/types.js';

const rawEvent = (): Omit<Event, 'sig'> => ({
  typ: 'me2em/pact-event/v1',
  pid: PID,
  sq: 0,
  ph: ZERO32,
  ty: 'GENESIS',
  pl: { ch: b64urlEncode(new Uint8Array(32)), cn: { th: {}, im: 'bearer', w: false } as Constitution, ft: [] },
  iat: 1700000000,
});

describe('fixtures — Member signing and voucher chains', () => {
  it('signEvent: p and the signature always come from the same gen (Б8)', () => {
    const m0 = new Member(2);
    const m1 = new Member(2, 1);
    const raw = rawEvent();
    const s1 = m0.signEvent(raw, 1);
    expect(s1.p).toBe(m1.pub);
    // Same key + same TBS → identical deterministic Ed25519 signature:
    expect(s1.s).toBe(m1.signEvent(raw).s);
  });

  it('identity voucher chain: a single root self-attestation', async () => {
    const m = new Member(5);
    const { chain, vc, pp } = await m.voucherChain('identity', ['jti-a']);
    expect(chain.chain.length).toBe(1);
    expect(pp).toBe(m.anchorPub());
    expect(vc.rp).toBe(m.rootPub);
    const payload = Attestation.decode(chain.chain[0]);
    expect(payload.subjectId).toBe(m.rootPub);
    expect(await Attestation.verifySignature(chain.chain[0], crypto.getPublicKey(bytes(32, 5)))).toBe(true);
  });

  it('handle voucher chain: the root attests the handle pub, then the handle self-attests (Б4)', async () => {
    const m = Member.handle(7);
    const { chain, vc, pp } = await m.voucherChain('handle', ['jti-h-root', 'jti-h-handle']);
    expect(chain.chain.length).toBe(2);
    // pp is the anchor node — the Handle; rp is the root Identity:
    expect(pp).toBe(m.anchorPub());
    expect(pp).not.toBe(m.rootPub);
    expect(vc.rp).toBe(m.rootPub);
    const rootPubBytes = crypto.getPublicKey(bytes(32, 7));
    const handlePubBytes = crypto.getPublicKey(m.anchorKey);
    // Both attestations bind the handle pub:
    expect(Attestation.decode(chain.chain[0]).subjectId).toBe(b64urlEncode(handlePubBytes));
    expect(Attestation.decode(chain.chain[1]).subjectId).toBe(b64urlEncode(handlePubBytes));
    // Issuers differ: [A] by the root, [B] by the handle:
    expect(await Attestation.verifySignature(chain.chain[0], rootPubBytes)).toBe(true);
    expect(await Attestation.verifySignature(chain.chain[0], handlePubBytes)).toBe(false);
    expect(await Attestation.verifySignature(chain.chain[1], handlePubBytes)).toBe(true);
    expect(await Attestation.verifySignature(chain.chain[1], rootPubBytes)).toBe(false);
  });
});
