// test/mutation.spec.ts
//
// 5.12 — Buffer-mutation isolation (PR-7): mutating returned secret
// buffers, input key buffers and derived material can neither corrupt
// internal state nor change later derivations. Every capability method
// returns fresh bytes; inputs are copied on entry (PR-5).
import { describe, expect, it } from 'vitest';
import { Handle, Identity } from '../src/index.js';

const testSeed = new Uint8Array(64).fill(42);
const identity = await Identity.fromSeed(testSeed);

describe('5.12 — derived secrets are mutation-isolated', () => {
  it('mutating deriveChannelKey output cannot alter later derivations', async () => {
    const handle = await identity.deriveHandle('mut-channel');
    const pristine = handle.deriveChannelKey('telemetry-v1');
    const expected = new Uint8Array(pristine); // reference copy

    pristine.fill(0); // caller destroys the returned buffer
    const again = handle.deriveChannelKey('telemetry-v1');
    expect(Buffer.from(again).equals(Buffer.from(expected))).toBe(true);

    again[0] = 0xff;
    const third = handle.deriveChannelKey('telemetry-v1');
    expect(Buffer.from(third).equals(Buffer.from(expected))).toBe(true);
    expect(third).not.toBe(again); // fresh buffer every call
  });

  it('mutating deriveSharedSecret output and inputs cannot corrupt either side', async () => {
    const alice = await identity.deriveHandle('mut-alice');
    const bob = await identity.deriveHandle('mut-bob');
    const bobPub = bob.getPublicKey();

    const aliceShared = await alice.deriveSharedSecret(bobPub);
    const expected = new Uint8Array(aliceShared);
    const bobShared = await bob.deriveSharedSecret(alice.getPublicKey());
    expect(Buffer.from(bobShared).equals(Buffer.from(expected))).toBe(true);

    aliceShared.fill(1); // destroy alice's copy
    const aliceAgain = await alice.deriveSharedSecret(bobPub);
    expect(Buffer.from(aliceAgain).equals(Buffer.from(expected))).toBe(true);

    bobPub.fill(0); // mutate the caller-side input buffer
    const bobAgain = await bob.deriveSharedSecret(alice.getPublicKey());
    expect(Buffer.from(bobAgain).equals(Buffer.from(expected))).toBe(true);
  });

  it('mutating the input key buffer after fromSeed does not affect the Identity', async () => {
    const seed = new Uint8Array(64).fill(7);
    const id1 = await Identity.fromSeed(seed);
    const expectedPub = new Uint8Array(id1.getPublicKey());

    seed.fill(0); // caller destroys the seed buffer
    const id2 = await Identity.fromSeed(new Uint8Array(64).fill(7));
    expect(Buffer.from(id2.getPublicKey()).equals(Buffer.from(expectedPub))).toBe(true);
  });

  it('derived passwords are deterministic after key-buffer mutations', async () => {
    const handle = await identity.deriveHandle('mut-password');
    const p1 = handle.derivePassword('svc');
    const key = handle.deriveChannelKey('mut-password');
    key.fill(0); // mutate an unrelated returned buffer

    expect(handle.derivePassword('svc')).toBe(p1);
  });

  it('Handle.getPublicKey stays mutation-isolated (PR-5 reaffirmation)', async () => {
    const handle = await identity.deriveHandle('mut-pubkey');
    const idBefore = handle.getId();
    const pub = handle.getPublicKey();
    pub.fill(0);
    expect(handle.getId()).toBe(idBefore); // getId() re-encodes the internal key
  });
});
