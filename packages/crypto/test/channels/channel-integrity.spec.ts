// packages/crypto/test/channels/channel-integrity.spec.ts
//
// Channel object integrity: D1 (runtime brand validation), D2
// (readonly + Object.freeze) and D4 (destroyChannel).
import { describe, it, expect, vi } from 'vitest';
import {
  establishChannel,
  rotateChannel,
  encryptChannelMessage,
  decryptChannelMessage,
  destroyChannel,
  CryptoError,
  type Channel,
  type ChannelMessage,
} from '../../src/index.js';

function randomSecret(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomPlaintext(): Uint8Array {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return bytes;
}

function fakeMessage(): ChannelMessage {
  return {
    epoch: 0,
    sequence: 0,
    ciphertext: new Uint8Array(16),
    iv: new Uint8Array(12),
  };
}

/** A Channel-shaped impostor: right fields, no runtime brand. */
function fakeChannel(): Channel {
  return {
    channelId: 'a'.repeat(32),
    epoch: 0,
    role: 'initiator',
  };
}

describe('D1 — runtime brand validation', () => {
  it('impostor object → INVALID_ARGUMENT on every channel API', async () => {
    const fake = fakeChannel();
    const pt = randomPlaintext();

    await expect(encryptChannelMessage(fake, 0, pt)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      level: 'KEY',
    });
    await expect(decryptChannelMessage(fake, fakeMessage())).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      level: 'KEY',
    });
    await expect(rotateChannel(fake)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      level: 'KEY',
    });
    expect(() => destroyChannel(fake)).toThrow(CryptoError);
    try {
      destroyChannel(fake);
    } catch (e) {
      expect((e as CryptoError).code).toBe('INVALID_ARGUMENT');
    }
  });

  it('spread-clone of a real channel loses the non-enumerable brand → INVALID_ARGUMENT', async () => {
    const channel = await establishChannel(randomSecret(), 'brand-spread');
    const clone = { ...channel };

    await expect(decryptChannelMessage(clone, fakeMessage())).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      level: 'KEY',
    });
  });

  it('null / undefined / primitives → INVALID_ARGUMENT', async () => {
    const garbage = [null, undefined, 42, 'channel'] as unknown as Channel[];
    for (const g of garbage) {
      await expect(decryptChannelMessage(g, fakeMessage())).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        level: 'KEY',
      });
    }
  });

  it('rotated-away channel keeps its brand → still INVALID_KEY (not INVALID_ARGUMENT)', async () => {
    const channel0 = await establishChannel(randomSecret(), 'brand-rotate');
    const channel1 = await rotateChannel(channel0);
    expect(channel1.epoch).toBe(1);

    await expect(encryptChannelMessage(channel0, 0, randomPlaintext())).rejects.toMatchObject({
      code: 'INVALID_KEY',
      level: 'KEY',
    });
  });
});

describe('D2 — frozen readonly channels', () => {
  it('channel is frozen after establish and after rotate', async () => {
    const channel0 = await establishChannel(randomSecret(), 'freeze-test');
    expect(Object.isFrozen(channel0)).toBe(true);

    const channel1 = await rotateChannel(channel0);
    expect(Object.isFrozen(channel1)).toBe(true);
  });

  it('mutation attempt throws TypeError and leaves the value intact (strict mode)', async () => {
    const channel = await establishChannel(randomSecret(), 'freeze-mutate');

    expect(() => {
      (channel as { epoch: number }).epoch = 5;
    }).toThrow(TypeError);
    expect(channel.epoch).toBe(0);
  });

  it('crypto operations keep working on a frozen channel', async () => {
    const channel = await establishChannel(randomSecret(), 'freeze-crypto');
    const pt = randomPlaintext();

    const msg = await encryptChannelMessage(channel, 0, pt);
    const decrypted = await decryptChannelMessage(channel, msg);
    expect(decrypted).toEqual(pt);

    // Rotation (creates a fresh frozen object, drops the old internals)
    const channel1 = await rotateChannel(channel);
    const msg1 = await encryptChannelMessage(channel1, 0, pt);
    const decrypted1 = await decryptChannelMessage(channel1, msg1);
    expect(decrypted1).toEqual(pt);
  });
});

describe('D4 — destroyChannel', () => {
  it('wipes the 32-byte root material exactly once, then the channel is dead', async () => {
    const wipeNs = await import('../../src/core/wipe.js');
    const wipeSpy = vi.spyOn(wipeNs, 'secureWipe');

    const channel = await establishChannel(randomSecret(), 'destroy-wipe');
    const wipesBefore = wipeSpy.mock.calls.length;

    destroyChannel(channel);

    const destroyedWipes = wipeSpy.mock.calls.slice(wipesBefore);
    expect(destroyedWipes).toHaveLength(1);

    const wipedBuf = destroyedWipes[0][0] as Uint8Array;
    expect(wipedBuf.length).toBe(32);
    expect(wipedBuf.every((b) => b === 0)).toBe(true);

    wipeSpy.mockRestore();
  });

  it('after destroy every operation throws INVALID_KEY, including repeated destroy', async () => {
    const channel = await establishChannel(randomSecret(), 'destroy-dead');
    destroyChannel(channel);

    const pt = randomPlaintext();
    await expect(encryptChannelMessage(channel, 0, pt)).rejects.toMatchObject({
      code: 'INVALID_KEY',
      level: 'KEY',
    });
    await expect(decryptChannelMessage(channel, fakeMessage())).rejects.toMatchObject({
      code: 'INVALID_KEY',
      level: 'KEY',
    });
    await expect(rotateChannel(channel)).rejects.toMatchObject({
      code: 'INVALID_KEY',
      level: 'KEY',
    });

    // Second destroy → internals already dropped → INVALID_KEY
    try {
      destroyChannel(channel);
      throw new Error('expected destroyChannel to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CryptoError);
      expect((e as CryptoError).code).toBe('INVALID_KEY');
    }
  });

  it('destroy is per-channel: sibling channels on the same secret keep working', async () => {
    const secret = randomSecret();
    const channelA = await establishChannel(secret, 'sibling-a');
    const channelB = await establishChannel(secret, 'sibling-b');

    destroyChannel(channelA);

    const pt = randomPlaintext();
    const msg = await encryptChannelMessage(channelB, 0, pt);
    const decrypted = await decryptChannelMessage(channelB, msg);
    expect(decrypted).toEqual(pt);
  });

  it('after rotate the OLD object is already dead — destroy on it throws, new epoch unaffected', async () => {
    const channel0 = await establishChannel(randomSecret(), 'destroy-rotate');
    const channel1 = await rotateChannel(channel0);

    // rotate already dropped channel0's internals — destroying the
    // stale object is a no-op attempt that throws INVALID_KEY
    try {
      destroyChannel(channel0);
      throw new Error('expected destroyChannel to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CryptoError);
      expect((e as CryptoError).code).toBe('INVALID_KEY');
    }

    // The new epoch channel is unaffected
    const pt = randomPlaintext();
    const msg = await encryptChannelMessage(channel1, 0, pt);
    const decrypted = await decryptChannelMessage(channel1, msg);
    expect(decrypted).toEqual(pt);

    // Destroying the CURRENT object works and kills it
    destroyChannel(channel1);
    await expect(encryptChannelMessage(channel1, 0, pt)).rejects.toMatchObject({
      code: 'INVALID_KEY',
      level: 'KEY',
    });
  });
});
