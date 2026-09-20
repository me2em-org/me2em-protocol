// packages/crypto/test/channels/rotate.spec.ts
import { describe, it, expect } from 'vitest';
import {
  establishChannel,
  rotateChannel,
  encryptChannelMessage,
  decryptChannelMessage,
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

describe('rotateChannel', () => {
  it('establish → encrypt(epoch0, seq0) → rotate → encrypt(epoch1, seq0) → decrypt both', async () => {
    const secret = randomSecret();
    const channel0 = await establishChannel(secret, 'rotate-fs-test');
    const pt0 = randomPlaintext();

    const msg0 = await encryptChannelMessage(channel0, 0, pt0);

    // Rotate
    const channel1 = await rotateChannel(channel0);
    expect(channel1.epoch).toBe(1);

    const pt1 = randomPlaintext();
    const msg1 = await encryptChannelMessage(channel1, 0, pt1);

    // Epoch 0 message should fail after rotation
    await expect(decryptChannelMessage(channel1, msg0)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
      level: 'CIPHER',
    });

    // Epoch 1 message should succeed
    const decrypted1 = await decryptChannelMessage(channel1, msg1);
    expect(decrypted1).toEqual(pt1);
  });

  it('rotate → channelId does not change, epoch=1, seq reset', async () => {
    const secret = randomSecret();
    const channel0 = await establishChannel(secret, 'id-same-test');
    const originalId = channel0.channelId;

    const channel1 = await rotateChannel(channel0);

    expect(channel1.channelId).toBe(originalId);
    expect(channel1.epoch).toBe(1);
    // seq=0 should work after rotation
    const pt = randomPlaintext();
    const msg = await encryptChannelMessage(channel1, 0, pt);
    const dec = await decryptChannelMessage(channel1, msg);
    expect(dec).toEqual(pt);
  });

  it('double rotate → epoch=2', async () => {
    const secret = randomSecret();
    const ch0 = await establishChannel(secret, 'double-rotate');

    const ch1 = await rotateChannel(ch0);
    expect(ch1.epoch).toBe(1);

    const ch2 = await rotateChannel(ch1);
    expect(ch2.epoch).toBe(2);
  });

  it('rotate immediately invalidates old channel object', async () => {
    const secret = randomSecret();
    const oldChannel = await establishChannel(secret, 'dead-channel');
    const pt = randomPlaintext();

    await rotateChannel(oldChannel);

    // Old channel should be dead — encrypt/decrypt should throw
    await expect(encryptChannelMessage(oldChannel, 0, pt)).rejects.toMatchObject({
      code: 'INVALID_KEY',
      level: 'KEY',
    });
  });

  it('forward secrecy: messages from epoch 0 cannot be decrypted after rotate', async () => {
    const secret = randomSecret();
    const ch0 = await establishChannel(secret, 'fs-complete');

    // Encrypt several messages in epoch 0
    const messages: Awaited<typeof encryptChannelMessage>[] = [];
    for (let i = 0; i < 5; i++) {
      messages.push(await encryptChannelMessage(ch0, i, new Uint8Array([i])));
    }

    // Decrypt first one to advance lastDecryptedSeq
    await decryptChannelMessage(ch0, messages[0]);

    // Rotate
    const ch1 = await rotateChannel(ch0);

    // All epoch 0 messages should fail
    for (const msg of messages) {
      await expect(decryptChannelMessage(ch1, msg)).rejects.toMatchObject({
        code: 'DECRYPTION_FAILED',
        level: 'CIPHER',
      });
    }

    // New epoch works
    const newMsg = await encryptChannelMessage(ch1, 0, new Uint8Array([99]));
    const dec = await decryptChannelMessage(ch1, newMsg);
    expect(dec[0]).toBe(99);
  });

  it('rotate preserves role', async () => {
    const secret = randomSecret();
    const ch0 = await establishChannel(secret, 'role-pres');

    const ch1 = await rotateChannel(ch0);
    expect(ch1.role).toBe(ch0.role);
  });

  it('recipient role set on establish is preserved through rotate', async () => {
    const secret = randomSecret();
    const ch0 = await establishChannel(secret, 'recipient-role', 'recipient');
    expect(ch0.role).toBe('recipient');

    const ch1 = await rotateChannel(ch0);
    expect(ch1.role).toBe('recipient');
    expect(ch1.epoch).toBe(1);
  });
});
