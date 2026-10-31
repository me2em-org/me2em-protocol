// revisions.spec.ts
//
// PR-8 (core/revisions) — the derivation revision model and NFKC context
// canonicalization:
//   5.6  — revision rotation for derivePassword / deriveChannelKey:
//          default ≡ revision 1 byte-parity, revision independence,
//          DERIVATION_PATHS pins, options validation.
//   5.16 — contexts canonicalized NFKC → lowercase → trim (breaking vs
//          the pre-revision lowercase → trim rule for non-NFKC inputs).
//
// The revision-1 info strings (`me2em/secret/v1`, `me2em/channel/v1`) are
// frozen; vectors.spec.ts + specs/test-vectors.json pin the bytes.

import { describe, it, expect } from 'vitest';
import { Identity } from '../src/index.js';
import { DERIVATION_PATHS } from '../src/crypto/derivation-paths.js';
import { base64urlEncode, base64urlDecode } from '../src/util.js';
import { TEST_SEED, expectAttestationErrorSync } from './test-utils.js';

describe('Derivation revisions (PR-8, 5.6/5.16)', () => {
  // -------------------------------------------------------------------------
  // 5.6 — revision model: byte-parity of the default with revision 1
  // -------------------------------------------------------------------------
  describe('default ≡ revision 1 (byte-parity with the frozen v1.0)', () => {
    it('derivePassword: omitted options ≡ { revision: 1 } ≡ pre-revision value', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      const omitted = handle.derivePassword('github');
      const explicit1 = handle.derivePassword('github', { revision: 1 });
      const empty = handle.derivePassword('github', {});

      expect(explicit1).toBe(omitted);
      expect(empty).toBe(omitted);
      // 16 bytes → exactly 22 unpadded base64url chars.
      expect(omitted).toMatch(/^[A-Za-z0-9_-]{22}$/);
    });

    it('deriveChannelKey: omitted options ≡ { revision: 1 }', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      const omitted = handle.deriveChannelKey('telemetry-v1');
      const explicit1 = handle.deriveChannelKey('telemetry-v1', { revision: 1 });
      const empty = handle.deriveChannelKey('telemetry-v1', {});

      expect(explicit1).toEqual(omitted);
      expect(empty).toEqual(omitted);
      expect(omitted.length).toBe(32);
    });

    it('revision 1 keeps the frozen v1 info strings reachable via the paths module', () => {
      // The default path is the frozen pre-revision derivation: the info
      // strings the vectors file pins are exactly what revision 1 yields.
      expect(DERIVATION_PATHS.password()).toBe('me2em/secret/v1');
      expect(DERIVATION_PATHS.password(1)).toBe('me2em/secret/v1');
      expect(DERIVATION_PATHS.channel()).toBe('me2em/channel/v1');
      expect(DERIVATION_PATHS.channel(1)).toBe('me2em/channel/v1');
    });
  });

  // -------------------------------------------------------------------------
  // 5.6 — revision independence (rotation without changing the context)
  // -------------------------------------------------------------------------
  describe('revision independence', () => {
    it('revision 2 password differs from revision 1 and is deterministic', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      const r1 = handle.derivePassword('github');
      const r2a = handle.derivePassword('github', { revision: 2 });
      const r2b = handle.derivePassword('github', { revision: 2 });
      const r3 = handle.derivePassword('github', { revision: 3 });

      expect(r2a).toBe(r2b);
      expect(r2a).not.toBe(r1);
      expect(r3).not.toBe(r1);
      expect(r3).not.toBe(r2a);
    });

    it('revision 2 channel key differs from revision 1 and is deterministic', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      const r1 = handle.deriveChannelKey('telemetry-v1');
      const r2a = handle.deriveChannelKey('telemetry-v1', { revision: 2 });
      const r2b = handle.deriveChannelKey('telemetry-v1', { revision: 2 });
      const r3 = handle.deriveChannelKey('telemetry-v1', { revision: 3 });

      expect(r2a).toEqual(r2b);
      expect(Array.from(r2a)).not.toEqual(Array.from(r1));
      expect(Array.from(r3)).not.toEqual(Array.from(r1));
      expect(Array.from(r3)).not.toEqual(Array.from(r2a));
    });

    it('revisions are per-context: rotation on one service does not move another', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      const gitlabR1 = handle.derivePassword('gitlab');
      const gitlabR2 = handle.derivePassword('gitlab', { revision: 2 });
      const githubR1 = handle.derivePassword('github');
      const githubR2 = handle.derivePassword('github', { revision: 2 });

      expect(gitlabR1).not.toBe(gitlabR2);
      expect(githubR1).not.toBe(githubR2);
      // Cross-context independence in both directions.
      expect(gitlabR1).not.toBe(githubR1);
      expect(gitlabR2).not.toBe(githubR2);
    });

    it('same seed → same revisioned secret across independent instances', async () => {
      const id1 = await Identity.fromSeed(TEST_SEED);
      const id2 = await Identity.fromSeed(TEST_SEED);
      const h1 = await id1.deriveHandle('work');
      const h2 = await id2.deriveHandle('work');

      expect(h1.derivePassword('github', { revision: 2 }))
        .toBe(h2.derivePassword('github', { revision: 2 }));
      expect(Array.from(h1.deriveChannelKey('telemetry-v1', { revision: 2 })))
        .toEqual(Array.from(h2.deriveChannelKey('telemetry-v1', { revision: 2 })));
    });

    it('SubHandle inherits the revision model on its own key material', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');
      const sub = await handle.deriveSubHandle('connector-1');

      const subR1 = sub.derivePassword('github');
      const subR2 = sub.derivePassword('github', { revision: 2 });
      const handleR1 = handle.derivePassword('github');

      expect(subR2).not.toBe(subR1);
      expect(subR1).not.toBe(handleR1); // different keys, same context
      expect(sub.derivePassword('github', { revision: 2 })).toBe(subR2);
    });

    it('byteLength is prefix-stable (RFC 5869 HKDF-Expand block truncation)', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      const short = base64urlDecode(handle.derivePassword('github'));
      const long = base64urlDecode(handle.derivePassword('github', { byteLength: 64 }));

      expect(short.length).toBe(16);
      expect(long.length).toBe(64);
      expect(Array.from(long.slice(0, 16))).toEqual(Array.from(short));
    });

    it('byteLength: explicit 32 default revision matches the vectors row contract', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      const pwd32 = handle.derivePassword('github', { byteLength: 32 });
      expect(base64urlDecode(pwd32).length).toBe(32);
      expect(pwd32).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });
  });

  // -------------------------------------------------------------------------
  // 5.6 — options validation (MALFORMED/FORMAT, Session.create ttl pattern)
  // -------------------------------------------------------------------------
  describe('options validation', () => {
    it('rejects non-positive-integer revisions', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      for (const bad of [0, -1, 2.5, NaN, Infinity, '2', null]) {
        expectAttestationErrorSync(
          () => handle.derivePassword('github', { revision: bad as number }),
          'MALFORMED',
          'FORMAT'
        );
        expectAttestationErrorSync(
          () => handle.deriveChannelKey('github', { revision: bad as number }),
          'MALFORMED',
          'FORMAT'
        );
      }
    });

    it('rejects byteLength outside [1, 8160] or non-integer', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      for (const bad of [0, -16, 8.5, NaN, Infinity]) {
        expectAttestationErrorSync(
          () => handle.derivePassword('github', { byteLength: bad as number }),
          'MALFORMED',
          'FORMAT'
        );
      }
      expectAttestationErrorSync(
        () => handle.derivePassword('github', { byteLength: 255 * 32 + 1 }),
        'MALFORMED',
        'FORMAT'
      );
      // The RFC 5869 bound itself is accepted.
      expect(
        base64urlDecode(handle.derivePassword('github', { byteLength: 255 * 32 })).length
      ).toBe(255 * 32);
    });

    it('rejects contexts empty after canonicalization; non-string context is TypeError', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      expectAttestationErrorSync(() => handle.derivePassword('   '), 'MALFORMED', 'FORMAT');
      expectAttestationErrorSync(() => handle.deriveChannelKey(''), 'MALFORMED', 'FORMAT');
      expect(() => handle.derivePassword(42 as unknown as string)).toThrow(TypeError);
      expect(() => handle.deriveChannelKey(undefined as unknown as string)).toThrow(TypeError);
    });

    it('disposed Handle: options validation never bypasses the lifecycle guard', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');
      handle.dispose();

      expect(() => handle.derivePassword('github')).toThrow(/DISPOSED/);
      expect(() => handle.derivePassword('github', { revision: 2 })).toThrow(/DISPOSED/);
      expect(() => handle.deriveChannelKey('github', { revision: 2 })).toThrow(/DISPOSED/);
      // Revision validation happens after dispose() — bad options on a
      // disposed handle still surface DisposedError first.
      expect(() => handle.derivePassword('github', { revision: 0 }))
        .toThrow(/DISPOSED/);
    });
  });

  // -------------------------------------------------------------------------
  // 5.6 — DERIVATION_PATHS.password / .channel pins
  // -------------------------------------------------------------------------
  describe('DERIVATION_PATHS.password / .channel', () => {
    it('revision 1 (and default) yield the frozen v1 info strings', () => {
      expect(DERIVATION_PATHS.password()).toBe('me2em/secret/v1');
      expect(DERIVATION_PATHS.password(1)).toBe('me2em/secret/v1');
      expect(DERIVATION_PATHS.channel()).toBe('me2em/channel/v1');
      expect(DERIVATION_PATHS.channel(1)).toBe('me2em/channel/v1');
    });

    it('revision N ≥ 2 appends a /rN path segment', () => {
      expect(DERIVATION_PATHS.password(2)).toBe('me2em/secret/v1/r2');
      expect(DERIVATION_PATHS.password(10)).toBe('me2em/secret/v1/r10');
      expect(DERIVATION_PATHS.channel(2)).toBe('me2em/channel/v1/r2');
      expect(DERIVATION_PATHS.channel(3)).toBe('me2em/channel/v1/r3');
    });

    it('manual HKDF via DERIVATION_PATHS reproduces the method output end-to-end', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');
      const { hkdf } = await import('@noble/hashes/hkdf.js');
      const { sha256 } = await import('@noble/hashes/sha2.js');

      // Rebuild the Handle key from the seed exactly as specs/v1.0.md §3
      // pins it: root = HKDF(seed, "", "me2em/identity/v1/root", 32), then
      // handle = HKDF(root, "", "me2em/handle/v1/work", 32) — and derive
      // the revision-2 password manually with DERIVATION_PATHS.password(2):
      // the paths module must be the single source of truth.
      const rootKey = hkdf(
        sha256,
        TEST_SEED,
        new Uint8Array(0),
        new TextEncoder().encode(DERIVATION_PATHS.identity),
        32
      );
      const handleKey = hkdf(
        sha256,
        rootKey,
        new Uint8Array(0),
        new TextEncoder().encode(DERIVATION_PATHS.handle('work')),
        32
      );
      const manual = hkdf(
        sha256,
        handleKey,
        new TextEncoder().encode('me2em/secret/github'),
        new TextEncoder().encode(DERIVATION_PATHS.password(2)),
        16
      );
      expect(base64urlEncode(manual)).toBe(handle.derivePassword('github', { revision: 2 }));
      // Same end-to-end for the channel key, revision 3.
      const manualChannel = hkdf(
        sha256,
        handleKey,
        new TextEncoder().encode('me2em/channel/telemetry-v1'),
        new TextEncoder().encode(DERIVATION_PATHS.channel(3)),
        32
      );
      expect(Array.from(manualChannel))
        .toEqual(Array.from(handle.deriveChannelKey('telemetry-v1', { revision: 3 })));
    });
  });

  // -------------------------------------------------------------------------
  // 5.16 — NFKC context canonicalization (breaking vs lowercase → trim)
  // -------------------------------------------------------------------------
  describe('NFKC context canonicalization (5.16)', () => {
    it('fullwidth ＧitHub (U+FF27) yields the same secret as github', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      const canonical = handle.derivePassword('github');
      const fullwidth = handle.derivePassword('ＧitHub');
      const fullwidthChannel = handle.deriveChannelKey('ＴＥＬＥＭＥＴＲＹ');
      const canonicalChannel = handle.deriveChannelKey('telemetry');

      // Pre-revision (lowercase → trim only) these derived DIFFERENT
      // secrets: 'ｇithub' ≠ 'github'.
      expect(fullwidth).toBe(canonical);
      expect(Array.from(fullwidthChannel)).toEqual(Array.from(canonicalChannel));
    });

    it('NFD-decomposed accents canonicalize to the NFC form', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      const nfc = handle.derivePassword('caf\u00e9');      // é precomposed
      const nfd = handle.derivePassword('cafe\u0301');      // e + combining acute

      expect(nfd).toBe(nfc);
    });

    it('mixed forms compose: whitespace, case and NFKC in one context', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const handle = await identity.deriveHandle('work');

      const canonical = handle.derivePassword('github');
      const noisy = handle.derivePassword('  GitHub  ');
      const fullwidth = handle.derivePassword(' ＧitHub ');
      const rotated = handle.derivePassword('github', { revision: 2 });
      const noisyRotated = handle.derivePassword('  GitHub ', { revision: 2 });

      expect(noisy).toBe(canonical);
      expect(fullwidth).toBe(canonical);
      expect(noisyRotated).toBe(rotated);
      expect(rotated).not.toBe(canonical);
    });

    it('canonical form survives the salt boundary: same secret via normalized context', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const h1 = await identity.deriveHandle('work');
      const h2 = await identity.deriveHandle('work');

      // Two handles, same seed — canonicalization must be pure & stable.
      expect(h1.derivePassword('ＧｉｔＨｕｂ')).toBe(h2.derivePassword('github'));
      expect(Array.from(h1.deriveChannelKey('ＴＥＬＥＭＥＴＲＹ')))
        .toEqual(Array.from(h2.deriveChannelKey('telemetry')));
    });
  });
});
