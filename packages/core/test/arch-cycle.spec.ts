// arch-cycle.spec.ts
//
// PR-10 (core/arch-cycle) — architecture pins:
//   D4    — the `handle ↔ subhandle` module cycle is broken for good:
//           no dynamic `import()` anywhere in src/, and the module graph
//           stays loadable from ANY root (see import-order-*.spec.ts —
//           a naive static cross-file import would crash with
//           "Cannot access 'Handle' before initialization").
//   3.2   — the derivation formulas live in crypto/derivation.ts and
//           BOTH SubHandle entry points share `deriveSubHandleKey`;
//           these tests pin the helpers byte-parity against the public
//           methods (5.3.3 complements this in derivation.spec.ts).
//   3.3.1 — no @noble import outside crypto/ (the wrapper boundary).
//   5.3.4 — P2P raw ECDH helper is symmetric.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  Identity,
  Handle,
  SubHandle,
  crypto,
} from '../src/index.js';
import { TEST_SEED, createTestHandle } from './test-utils.js';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Strips // and /* *\/ comments so code scans don't trip on prose. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('PR-10 architecture pins (D4 / 3.2 / 3.3.1)', () => {
  describe('D4 — static module graph, no dynamic imports', () => {
    it('no src module contains a dynamic import() (code, not comments)', () => {
      const offenders = listTsFiles(SRC_DIR).filter((f) =>
        /\bimport\s*\(/.test(stripComments(readFileSync(f, 'utf8')))
      );
      expect(offenders).toEqual([]);
    });
  });

  describe('3.3.1 — @noble imports only inside crypto/', () => {
    it('no direct @noble import outside src/crypto', () => {
      const cryptoDir = join(SRC_DIR, 'crypto');
      const offenders = listTsFiles(SRC_DIR)
        .filter((f) => !f.startsWith(cryptoDir))
        .filter((f) =>
          /from\s+'@noble\//.test(stripComments(readFileSync(f, 'utf8')))
        );
      expect(offenders).toEqual([]);
    });
  });

  describe('3.2 — crypto.derivation* byte-parity with the public methods', () => {
    it('deriveRootKey reproduces Identity.fromSeed exactly', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const rootKey = crypto.deriveRootKey(TEST_SEED);

      expect(rootKey.length).toBe(32);
      expect(Array.from(ed25519.getPublicKey(rootKey))).toEqual(
        Array.from(identity.getPublicKey())
      );
    });

    it('deriveHandleKey reproduces Identity.deriveHandle exactly', async () => {
      const { identity, handle } = await createTestHandle('work');
      const rootKey = crypto.deriveRootKey(TEST_SEED);
      const handleKey = crypto.deriveHandleKey(rootKey, 'work');

      expect(handleKey.length).toBe(32);
      expect(Array.from(ed25519.getPublicKey(handleKey))).toEqual(
        Array.from(handle.getPublicKey())
      );
      // Normalization parity: non-canonical name hits the same info string.
      const handleKeyNoisy = crypto.deriveHandleKey(rootKey, '  Work ');
      expect(Array.from(ed25519.getPublicKey(handleKeyNoisy))).toEqual(
        Array.from(handle.getPublicKey())
      );
      expect(identity).toBeInstanceOf(Identity);
    });

    it('deriveSubHandleKey reproduces Handle.deriveSubHandle exactly', async () => {
      const { handle } = await createTestHandle('work');
      const rootKey = crypto.deriveRootKey(TEST_SEED);
      const handleKey = crypto.deriveHandleKey(rootKey, 'work');
      const subKey = crypto.deriveSubHandleKey(handleKey, 'work', 'connector-1');

      const sub = await handle.deriveSubHandle('connector-1');
      expect(sub).toBeInstanceOf(SubHandle);
      expect(Array.from(ed25519.getPublicKey(subKey))).toEqual(
        Array.from(sub.getPublicKey())
      );
    });

    it('both SubHandle entry points share deriveSubHandleKey — byte-parity', async () => {
      const { identity, handle } = await createTestHandle('work');

      const subViaHandle = await handle.deriveSubHandle('connector-1');
      const subViaIdentity = await identity.deriveSubHandle('work', 'connector-1');

      expect(subViaIdentity.getPublicKey()).toEqual(subViaHandle.getPublicKey());
      expect(subViaIdentity.getPath()).toEqual(['work', 'connector-1']);
      expect(subViaIdentity.getPath()).toEqual(subViaHandle.getPath());
      // And the shared helper reproduces both:
      const rootKey = crypto.deriveRootKey(TEST_SEED);
      const subKey = crypto.deriveSubHandleKey(
        crypto.deriveHandleKey(rootKey, 'work'),
        'work',
        'connector-1'
      );
      expect(Array.from(ed25519.getPublicKey(subKey))).toEqual(
        Array.from(subViaIdentity.getPublicKey())
      );
    });
  });

  describe('5.3.4 — rawX25519SharedSecret (crypto/ecdh.ts) is raw ECDH', () => {
    it('ECDH symmetry: raw(sk1, pk2) === raw(sk2, pk1), 32 bytes', () => {
      const sk1 = ed25519.utils.randomPrivateKey();
      const sk2 = ed25519.utils.randomPrivateKey();
      const pk1 = ed25519.getPublicKey(sk1);
      const pk2 = ed25519.getPublicKey(sk2);

      const s12 = crypto.rawX25519SharedSecret(sk1, pk2);
      const s21 = crypto.rawX25519SharedSecret(sk2, pk1);

      expect(s12.length).toBe(32);
      expect(Array.from(s12)).toEqual(Array.from(s21));
    });

    it('Handle.deriveSharedSecret builds on the shared helper (both peers agree)', async () => {
      const a = await Identity.fromSeed(TEST_SEED);
      const hA = await a.deriveHandle('alice');
      const hB = await a.deriveHandle('bob');

      const ab = await hA.deriveSharedSecret(hB.getPublicKey());
      const ba = await hB.deriveSharedSecret(hA.getPublicKey());

      expect(ab.length).toBe(32);
      expect(Array.from(ab)).toEqual(Array.from(ba));
      expect(hA).toBeInstanceOf(Handle);
    });
  });
});
