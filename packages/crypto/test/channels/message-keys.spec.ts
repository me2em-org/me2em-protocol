// packages/crypto/test/channels/message-keys.spec.ts
import { describe, it, expect } from 'vitest';
import {
  establishChannel,
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

describe('establishChannel', () => {
  it('creates a channel with epoch=0 and valid channelId', async () => {
    const secret = randomSecret();
    const channel = await establishChannel(secret, 'test-salt');
    expect(channel.channelId).toBeDefined();
    expect(typeof channel.channelId).toBe('string');
    expect(channel.channelId.length).toBe(32);
    expect(channel.epoch).toBe(0);
    expect(channel.role).toBe('initiator');
  });

  it('creates a channel with recipient role', async () => {
    const secret = randomSecret();
    const channel = await establishChannel(secret, 'role-test', 'recipient');
    expect(channel.role).toBe('recipient');
    expect(channel.epoch).toBe(0);
  });

  it('same secret + same salt → identical channelId on both sides', async () => {
    const secret = randomSecret();
    const a = await establishChannel(secret, 'chat-42');
    const b = await establishChannel(secret, 'chat-42');
    expect(a.channelId).toBe(b.channelId);
  });

  it('different salt → different channelId', async () => {
    const secret = randomSecret();
    const a = await establishChannel(secret, 'salt-a');
    const b = await establishChannel(secret, 'salt-b');
    expect(a.channelId).not.toBe(b.channelId);
  });

  it('rejects sharedSecret with wrong length', async () => {
    const bad = new Uint8Array(16);
    await expect(establishChannel(bad, 'salt')).rejects.toMatchObject({
      code: 'INVALID_LENGTH',
      level: 'KEY',
    });
  });
});

describe('encryptChannelMessage → decryptChannelMessage', () => {
  it('roundtrip: encrypt(seq=0) → decrypt → original plaintext', async () => {
    const secret = randomSecret();
    const channel = await establishChannel(secret, 'roundtrip-test');
    const plaintext = randomPlaintext();

    const msg = await encryptChannelMessage(channel, 0, plaintext);
    expect(msg.epoch).toBe(0);
    expect(msg.sequence).toBe(0);
    expect(msg.ciphertext.length).toBeGreaterThan(0);
    expect(msg.iv.length).toBe(12);

    const decrypted = await decryptChannelMessage(channel, msg);
    expect(decrypted).toEqual(plaintext);
  });

  it('encrypt seq=0,1,2 → decrypt in order works', async () => {
    const secret = randomSecret();
    const channel = await establishChannel(secret, 'seq-test');
    const msgs: Awaited<typeof encryptChannelMessage>[] = [];

    for (let i = 0; i < 3; i++) {
      msgs.push(await encryptChannelMessage(channel, i, new Uint8Array([i])));
    }

    for (let i = 0; i < 3; i++) {
      const decrypted = await decryptChannelMessage(channel, msgs[i]);
      expect(decrypted[0]).toBe(i);
    }
  });

  it('replay window: out-of-order decrypt within window accepted (F7)', async () => {
    const secret = randomSecret();
    const channel = await establishChannel(secret, 'ooo-test');
    const msgs = [
      await encryptChannelMessage(channel, 0, new Uint8Array([0])),
      await encryptChannelMessage(channel, 1, new Uint8Array([1])),
      await encryptChannelMessage(channel, 2, new Uint8Array([2])),
    ];

    // Decrypt highest seq first — succeeds
    const d2 = await decryptChannelMessage(channel, msgs[2]);
    expect(d2[0]).toBe(2);

    // Sliding window: seq 1 and seq 0 are inside the window → accepted
    const d1 = await decryptChannelMessage(channel, msgs[1]);
    expect(d1[0]).toBe(1);
    const d0 = await decryptChannelMessage(channel, msgs[0]);
    expect(d0[0]).toBe(0);
  });

  it('duplicate decrypt of seq=0 → replay error (inside the window)', async () => {
    const secret = randomSecret();
    const channel = await establishChannel(secret, 'replay-test');
    const msg0 = await encryptChannelMessage(channel, 0, new Uint8Array([0]));

    await decryptChannelMessage(channel, msg0);
    await expect(decryptChannelMessage(channel, msg0)).rejects.toMatchObject({
      code: 'REPLAY_DETECTED',
      level: 'CIPHER',
    });
  });

  it('encrypt twice with same seq → different ciphertext, second decrypt → replay', async () => {
    const secret = randomSecret();
    const channel = await establishChannel(secret, 'fresh-iv-test');
    const msg1 = await encryptChannelMessage(channel, 5, new Uint8Array([42]));
    const msg2 = await encryptChannelMessage(channel, 5, new Uint8Array([42]));

    expect(msg1.ciphertext).not.toEqual(msg2.ciphertext);
    expect(msg1.iv).not.toEqual(msg2.iv);

    // First decrypt succeeds
    const d1 = await decryptChannelMessage(channel, msg1);
    expect(d1[0]).toBe(42);

    // Second decrypt with same seq → replay (sequence still in window)
    await expect(decryptChannelMessage(channel, msg2)).rejects.toMatchObject({
      code: 'REPLAY_DETECTED',
      level: 'CIPHER',
    });
  });

  it('failed decrypt attempt does not consume a window slot', async () => {
    const secret = randomSecret();
    const channel = await establishChannel(secret, 'slot-test');
    const msg = await encryptChannelMessage(channel, 7, new Uint8Array([7]));

    // Tampered ciphertext → authentication failure
    const tampered = { ...msg, ciphertext: new Uint8Array(msg.ciphertext) };
    tampered.ciphertext[0] ^= 0xff;
    await expect(decryptChannelMessage(channel, tampered)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
      level: 'CIPHER',
    });

    // seq 7 was never recorded — the honest message still decrypts
    const d = await decryptChannelMessage(channel, msg);
    expect(d[0]).toBe(7);
  });

  it('replay window eviction: after 1001 messages the oldest sequence can replay (documented trade-off)', async () => {
    const secret = randomSecret();
    const channel = await establishChannel(secret, 'evict-test');
    const msgs: Awaited<typeof encryptChannelMessage>[] = [];
    for (let i = 0; i <= 1000; i++) {
      msgs.push(
        await encryptChannelMessage(channel, i, new Uint8Array([i % 256]))
      );
    }
    for (const m of msgs) {
      await decryptChannelMessage(channel, m);
    }

    // Window now holds seq 1..1000 — seq 0 was evicted (FIFO)
    const d0 = await decryptChannelMessage(channel, msgs[0]);
    expect(d0[0]).toBe(0);

    // Adding seq 0 evicted seq 1 — it replays too
    const d1 = await decryptChannelMessage(channel, msgs[1]);
    expect(d1[0]).toBe(1);

    // Sequences still inside the window stay replay-protected
    await expect(decryptChannelMessage(channel, msgs[1000])).rejects.toMatchObject({
      code: 'REPLAY_DETECTED',
      level: 'CIPHER',
    });
  }, 30000);

  it('rotate resets the replay window: new-epoch seq reuse accepted', async () => {
    const { rotateChannel } = await import('../../src/index.js');
    const secret = randomSecret();
    const channel0 = await establishChannel(secret, 'window-rotate');

    const m0 = await encryptChannelMessage(channel0, 0, new Uint8Array([10]));
    await decryptChannelMessage(channel0, m0);

    const channel1 = await rotateChannel(channel0);
    const m1 = await encryptChannelMessage(channel1, 0, new Uint8Array([20]));
    const d1 = await decryptChannelMessage(channel1, m1);
    expect(d1[0]).toBe(20);
  });

  it('decryption with wrong channel (different salt) → DECRYPTION_FAILED', async () => {
    const secret = randomSecret();
    const channelA = await establishChannel(secret, 'salt-a');
    const channelB = await establishChannel(secret, 'salt-b');
    const plaintext = randomPlaintext();

    const msg = await encryptChannelMessage(channelA, 0, plaintext);
    await expect(decryptChannelMessage(channelB, msg)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
      level: 'CIPHER',
    });
  });

  it('msg.epoch !== channel.epoch → previous epoch error', async () => {
    const secret = randomSecret();
    const channel = await establishChannel(secret, 'epoch-test');
    const plaintext = randomPlaintext();

    const msg = await encryptChannelMessage(channel, 0, plaintext);

    // Tamper with epoch in the message
    const tampered = { ...msg, epoch: 99 };
    await expect(decryptChannelMessage(channel, tampered)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
      level: 'CIPHER',
    });
  });

  it('decrypt with seq < 0 rejected by encrypt', async () => {
    const secret = randomSecret();
    const channel = await establishChannel(secret, 'neg-seq');
    await expect(encryptChannelMessage(channel, -1, new Uint8Array([1]))).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      level: 'KEY',
    });
  });

  it('unknown channel after rotation → INVALID_KEY', async () => {
    const secret = randomSecret();
    const channel = await establishChannel(secret, 'dead-channel');
    const plaintext = randomPlaintext();

    // Import rotateChannel to invalidate the channel
    const { rotateChannel } = await import('../../src/index.js');
    await rotateChannel(channel);

    await expect(encryptChannelMessage(channel, 0, plaintext)).rejects.toMatchObject({
      code: 'INVALID_KEY',
      level: 'KEY',
    });
  });
});
