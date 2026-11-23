// resource-keys.spec.ts
//
// rc.9 Фаза 3 (states ТЗ §4) — Handle.deriveResourceKey, the third
// derivation domain (salt `me2em/resource/`, info `me2em/resource/v1`):
//   §4.2 — state-integer guards: revision ≥ 0 (0 = locked state — the
//          deliberate difference from assertRevision), epoch ≥ 0,
//          upper bound 2^53 − 1.
//   §4.3 — charset/length patterns: injective components (no '/', no ':',
//          no whitespace), NFKC canonicalization, 63/64 and 128/129 edges.
//   §4.4 — injectivity property: any field difference ⇒ different salt,
//          different key.
//   §4.5 — epoch/revision independence; default ≡ explicit 1 byte-parity.
//   §4.6 — lifecycle: dispose first, SubHandle inheritance parity.
//   §4.7 — guard separation regression: password/channel still reject 0;
//          DERIVATION_PATHS.resource pins.

import { describe, it, expect, beforeAll } from 'vitest';
import { Identity, SubHandle } from '../src/index.js';
import { DERIVATION_PATHS } from '../src/crypto/derivation-paths.js';
import { TEST_SEED, expectAttestationErrorSync } from './test-utils.js';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** Deterministic PRNG for the injectivity property test (fixed seed). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Handle.deriveResourceKey (rc.9, states ТЗ)', () => {
  // -------------------------------------------------------------------------
  // §4.5 — default ≡ explicit 1 (byte-parity with the frozen base path)
  // -------------------------------------------------------------------------
  describe('default ≡ explicit 1 (byte-parity)', () => {
    it('omitted options ≡ {} ≡ { epoch: 1, revision: 1 }', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      const omitted = handle.deriveResourceKey('chat-msg', 'msg-105');
      const empty = handle.deriveResourceKey('chat-msg', 'msg-105', {});
      const explicit1 = handle.deriveResourceKey('chat-msg', 'msg-105', {
        epoch: 1, revision: 1,
      });

      expect(empty).toEqual(omitted);
      expect(explicit1).toEqual(omitted);
      expect(omitted.length).toBe(32);
    });

    it('epoch and revision are independently omissible', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      expect(handle.deriveResourceKey('chat-msg', 'x', { epoch: 2 }))
        .toEqual(handle.deriveResourceKey('chat-msg', 'x', { epoch: 2, revision: 1 }));
      expect(handle.deriveResourceKey('chat-msg', 'x', { revision: 0 }))
        .toEqual(handle.deriveResourceKey('chat-msg', 'x', { epoch: 1, revision: 0 }));
    });
  });

  // -------------------------------------------------------------------------
  // §4.2 — state-integer guards (revision ≥ 0, epoch ≥ 0, ≤ 2^53 − 1)
  // -------------------------------------------------------------------------
  describe('state-integer guards (§4.2)', () => {
    it('accepts revision 0 (the locked state) and epoch 0', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      const locked = handle.deriveResourceKey('chat-msg', 'msg-105', { revision: 0 });
      const epoch0 = handle.deriveResourceKey('chat-msg', 'msg-105', { epoch: 0 });
      expect(locked.length).toBe(32);
      expect(epoch0.length).toBe(32);
      // Both are valid and independent of the default derivation.
      expect(hex(locked)).not.toBe(
        hex(handle.deriveResourceKey('chat-msg', 'msg-105'))
      );
    });

    it('rejects non-integers, negatives and values beyond 2^53 − 1', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      for (const bad of [-1, 2.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
        expectAttestationErrorSync(
          () => handle.deriveResourceKey('chat-msg', 'msg-105', { revision: bad as number }),
          'MALFORMED',
          'FORMAT'
        );
        expectAttestationErrorSync(
          () => handle.deriveResourceKey('chat-msg', 'msg-105', { epoch: bad as number }),
          'MALFORMED',
          'FORMAT'
        );
      }
      // The upper bound itself is accepted.
      expect(
        handle.deriveResourceKey('chat-msg', 'msg-105', {
          epoch: Number.MAX_SAFE_INTEGER,
        }).length
      ).toBe(32);
    });
  });

  // -------------------------------------------------------------------------
  // §4.3 — charset/length patterns and canonicalization
  // -------------------------------------------------------------------------
  describe('component charset, length and canonicalization (§4.3)', () => {
    let handle: Awaited<ReturnType<Identity['deriveHandle']>>;

    beforeAll(async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      handle = await identity.deriveHandle('work');
    });

    it('rejects separators, empty-after-canonicalization and non-strings', () => {
      // '/' in a component would break the injective salt join.
      expectAttestationErrorSync(
        () => handle.deriveResourceKey('chat/a', 'msg'), 'MALFORMED', 'FORMAT');
      expectAttestationErrorSync(
        () => handle.deriveResourceKey('chat', 'a/b'), 'MALFORMED', 'FORMAT');
      // ':' is likewise rejected (URI-like ids must be hashed/slugged).
      expectAttestationErrorSync(
        () => handle.deriveResourceKey('chat', 'uri:xyz'), 'MALFORMED', 'FORMAT');
      // Empty after canonicalization.
      expectAttestationErrorSync(
        () => handle.deriveResourceKey('   ', 'msg'), 'MALFORMED', 'FORMAT');
      expectAttestationErrorSync(
        () => handle.deriveResourceKey('chat-msg', ''), 'MALFORMED', 'FORMAT');
      // API misuse is a TypeError, not an AttestationError.
      expect(() => handle.deriveResourceKey(42 as unknown as string, 'msg'))
        .toThrow(TypeError);
      expect(() => handle.deriveResourceKey('chat-msg', undefined as unknown as string))
        .toThrow(TypeError);
    });

    it('length edges: 63/64 type, 128/129 id', () => {
      const a63 = 'a'.repeat(63);
      const a64 = 'a'.repeat(64);
      const b128 = 'b'.repeat(128);
      const b129 = 'b'.repeat(129);

      expect(handle.deriveResourceKey(a63, b128).length).toBe(32);
      expectAttestationErrorSync(
        () => handle.deriveResourceKey(a64, 'msg'), 'MALFORMED', 'FORMAT');
      expectAttestationErrorSync(
        () => handle.deriveResourceKey('chat-msg', b129), 'MALFORMED', 'FORMAT');
      // A 64-character sha256 hex id fits the 128 bound.
      const shaHex = 'e'.repeat(64);
      expect(handle.deriveResourceKey('chat-msg', shaHex).length).toBe(32);
    });

    it('NFKC → lowercase → trim: fullwidth/uppercase/padded inputs agree', () => {
      const canonical = handle.deriveResourceKey('chat-msg', 'msg-105');
      expect(handle.deriveResourceKey('Chat-Msg', 'msg-105')).toEqual(canonical);
      expect(handle.deriveResourceKey('  CHAT-MSG  ', 'msg-105')).toEqual(canonical);
      expect(handle.deriveResourceKey('Ｃhat-Msg ', 'msg-105')).toEqual(canonical);
    });
  });

  // -------------------------------------------------------------------------
  // §4.4 — injectivity property (deterministic PRNG, 100 samples)
  // -------------------------------------------------------------------------
  describe('injectivity property (§4.4)', () => {
    it('any field difference changes the key; equal inputs are byte-stable', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');
      const rand = mulberry32(0x5eed);

      const seen = new Map<string, string>();
      for (let i = 0; i < 100; i++) {
        const type = `rt${Math.floor(rand() * 1e9)}`;
        const id = `id${Math.floor(rand() * 1e9)}`;
        const epoch = Math.floor(rand() * 1e6);
        const revision = Math.floor(rand() * 5);
        const key = hex(handle.deriveResourceKey(type, id, { epoch, revision }));
        const coords = `${type}|${id}|${epoch}|${revision}`;
        // Determinism: identical coordinates reproduce the identical key.
        expect(handle.deriveResourceKey(type, id, { epoch, revision }))
          .toEqual(handle.deriveResourceKey(type, id, { epoch, revision }));
        // No two distinct coordinate tuples share a key.
        const collision = seen.get(key);
        if (collision !== undefined) {
          expect(collision).toBe(coords); // only the canonicalization pair may repeat
        }
        seen.set(key, coords);
      }
    });

    it('single-field differences never collide (type/id/epoch/revision)', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');
      const base = hex(handle.deriveResourceKey('chat-msg', 'msg-105', { epoch: 5, revision: 1 }));

      expect(hex(handle.deriveResourceKey('file', 'msg-105', { epoch: 5 }))).not.toBe(base);
      expect(hex(handle.deriveResourceKey('chat-msg', 'msg-106', { epoch: 5 }))).not.toBe(base);
      expect(hex(handle.deriveResourceKey('chat-msg', 'msg-105', { epoch: 6 }))).not.toBe(base);
      expect(hex(handle.deriveResourceKey('chat-msg', 'msg-105', { epoch: 5, revision: 2 })))
        .not.toBe(base);
    });
  });

  // -------------------------------------------------------------------------
  // §4.5 — epoch/revision independence
  // -------------------------------------------------------------------------
  describe('state independence (§4.5)', () => {
    it('rev0 ≠ rev1 ≠ rev2 and epoch 2 ≠ epoch 1', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      const keys = new Set([
        hex(handle.deriveResourceKey('stream', 'ch-42', { revision: 0 })),
        hex(handle.deriveResourceKey('stream', 'ch-42', { revision: 1 })),
        hex(handle.deriveResourceKey('stream', 'ch-42', { revision: 2 })),
        hex(handle.deriveResourceKey('stream', 'ch-42', { revision: 3 })),
        hex(handle.deriveResourceKey('stream', 'ch-42', { epoch: 2 })),
        hex(handle.deriveResourceKey('stream', 'ch-42', { epoch: 20261105 })),
      ]);
      expect(keys.size).toBe(6);
    });
  });

  // -------------------------------------------------------------------------
  // §4.6 — lifecycle: dispose first; SubHandle inheritance parity
  // -------------------------------------------------------------------------
  describe('lifecycle and inheritance (§4.6)', () => {
    it('disposed Handle throws DisposedError even with bad options', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');
      handle.dispose();

      expect(() => handle.deriveResourceKey('chat-msg', 'msg-105')).toThrow(/DISPOSED/);
      // Guard order: dispose() is checked before option/component validation.
      expect(() => handle.deriveResourceKey('chat/a', 'msg', { revision: -1 }))
        .toThrow(/DISPOSED/);
    });

    it('SubHandle inherits the method with full derivation parity', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');
      const twoStep = await handle.deriveSubHandle('connector-1');
      const atomic = await identity.deriveSubHandle('work', 'connector-1');
      expect(twoStep).toBeInstanceOf(SubHandle);

      const key = { epoch: 20261105, revision: 0 };
      expect(atomic.deriveResourceKey('chat-msg', 'msg-105', key))
        .toEqual(twoStep.deriveResourceKey('chat-msg', 'msg-105', key));
      expect(atomic.deriveResourceKey('chat-msg', 'msg-105', key).length).toBe(32);
    });
  });

  // -------------------------------------------------------------------------
  // §4.7 — DERIVATION_PATHS.resource pins; guard separation regression
  // -------------------------------------------------------------------------
  describe('DERIVATION_PATHS.resource pins and guard separation (§4.7)', () => {
    it('info builder: base path frozen, /e before /r, 0 and ≥ 2 get segments', () => {
      expect(DERIVATION_PATHS.resource()).toBe('me2em/resource/v1');
      expect(DERIVATION_PATHS.resource(1, 1)).toBe('me2em/resource/v1');
      expect(DERIVATION_PATHS.resource(1, 0)).toBe('me2em/resource/v1/r0');
      expect(DERIVATION_PATHS.resource(1, 2)).toBe('me2em/resource/v1/r2');
      expect(DERIVATION_PATHS.resource(20261105, 1)).toBe('me2em/resource/v1/e20261105');
      expect(DERIVATION_PATHS.resource(20261105, 0)).toBe('me2em/resource/v1/e20261105/r0');
    });

    it('password/channel keep rejecting revision 0 (guard separation)', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      expectAttestationErrorSync(
        () => handle.derivePassword('github', { revision: 0 }), 'MALFORMED', 'FORMAT');
      expectAttestationErrorSync(
        () => handle.deriveChannelKey('telemetry-v1', { revision: 0 }), 'MALFORMED', 'FORMAT');
    });
  });
});
