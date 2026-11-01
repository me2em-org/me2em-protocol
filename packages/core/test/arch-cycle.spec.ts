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
//           methods — public keys AND deterministic Ed25519 signatures
//           (the raw private key is a true `#`-private field with no
//           accessor, so a byte-equal RFC 8032 signature over the same
//           message is the strongest observable private-key pin)
//           (5.3.3 complements this in derivation.spec.ts).
//   3.3.1 — no @noble import outside crypto/ (the wrapper boundary),
//           checked across EVERY import form (static, side-effect,
//           dynamic import(), require(), export … from); the detector
//           itself is pinned by a meta-test. Additionally pins the D5
//           auto-init invariant: @noble/ed25519 is imported by
//           crypto/init.ts alone, which configures the backend on
//           module load — so any code path that can reach a crypto
//           operation sees a configured backend in any import order.
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
    // Every syntactic form a @noble import can take. A scan that only
    // matched `from '@noble/` would miss side-effect imports, require()
    // and dynamic import() — the meta-test below pins the detector
    // itself, so new import syntax cannot silently open a hole.
    const NOBLE_IMPORT =
      /from\s+['"]@noble\/|import\s+['"]@noble\/|require\s*\(\s*['"]@noble\/|import\s*\(\s*['"]@noble\//;

    it('detector covers every import form (meta-pin)', () => {
      const probe = (s: string) => NOBLE_IMPORT.test(s);
      // static import … from / export … from — same `from` clause:
      expect(probe("import { sha256 } from '@noble/hashes/sha2.js';")).toBe(true);
      expect(probe("export { sha256 } from '@noble/hashes/sha2.js';")).toBe(true);
      // side-effect import:
      expect(probe("import '@noble/hashes/sha2.js';")).toBe(true);
      // require():
      expect(probe("require('@noble/hashes/sha2.js');")).toBe(true);
      // dynamic import():
      expect(probe("import('@noble/hashes/sha2.js');")).toBe(true);
      // negative controls — wrapped imports and prose must not trip it:
      expect(probe("import { hkdf } from './crypto/hkdf.js';")).toBe(false);
      expect(probe("import { hkdf } from '../src/crypto/hkdf.js';")).toBe(false);
      expect(probe('the @noble/hashes library is wrapped by crypto/hkdf.ts')).toBe(false);
    });

    it('no direct @noble import outside src/crypto (all import forms)', () => {
      const cryptoDir = join(SRC_DIR, 'crypto');
      const offenders = listTsFiles(SRC_DIR)
        .filter((f) => !f.startsWith(cryptoDir))
        .filter((f) =>
          NOBLE_IMPORT.test(stripComments(readFileSync(f, 'utf8')))
        );
      expect(offenders).toEqual([]);
    });

    it('@noble/ed25519 is imported by crypto/init.ts alone (auto-init invariant, D5)', () => {
      // The backend must be reachable only through init.ts, whose module
      // load configures it — that is what makes auto-init structural:
      // every module touching Ed25519 imports the backend (and thereby
      // the configuration) from init.ts.
      const initFile = join(SRC_DIR, 'crypto', 'init.ts');
      const offenders = listTsFiles(SRC_DIR)
        .filter((f) => f !== initFile)
        .filter((f) =>
          /@noble\/ed25519/.test(stripComments(readFileSync(f, 'utf8')))
        );
      expect(offenders).toEqual([]);
    });
  });

  describe('3.2 — crypto.derivation* byte-parity with the public methods', () => {
    it('deriveRootKey reproduces Identity.fromSeed exactly (pubkey + signature parity)', async () => {
      const identity = await Identity.fromSeed(TEST_SEED);
      const rootKey = crypto.deriveRootKey(TEST_SEED);

      expect(rootKey.length).toBe(32);
      expect(Array.from(ed25519.getPublicKey(rootKey))).toEqual(
        Array.from(identity.getPublicKey())
      );
      // Private-key byte-parity, behaviorally: `#privateKey` is a true
      // private field with no accessor (encapsulation is a design
      // property, not to be pierced for tests), so the raw bytes are not
      // observable. RFC 8032 Ed25519 signing is deterministic, and
      // `identity.sign` routes through the very same `ed.sign` backend as
      // `crypto.sign` — byte-equal signatures over the same message prove
      // byte-equal private keys.
      const msg = new TextEncoder().encode('me2em arch-cycle root-key parity probe');
      expect(Array.from(crypto.sign(msg, rootKey))).toEqual(
        Array.from(await identity.sign(msg))
      );
    });

    it('deriveHandleKey reproduces Identity.deriveHandle exactly (pubkey + signature parity)', async () => {
      const { identity, handle } = await createTestHandle('work');
      const rootKey = crypto.deriveRootKey(TEST_SEED);
      const handleKey = crypto.deriveHandleKey(rootKey, 'work');

      expect(handleKey.length).toBe(32);
      expect(Array.from(ed25519.getPublicKey(handleKey))).toEqual(
        Array.from(handle.getPublicKey())
      );
      // Deterministic-signature parity with the encapsulated key (see the
      // root-key test for why this is the strongest private-key pin).
      const msg = new TextEncoder().encode('me2em arch-cycle handle-key parity probe');
      expect(Array.from(crypto.sign(msg, handleKey))).toEqual(
        Array.from(await handle.sign(msg))
      );
      // Normalization parity: non-canonical name hits the same info string.
      const handleKeyNoisy = crypto.deriveHandleKey(rootKey, '  Work ');
      expect(Array.from(ed25519.getPublicKey(handleKeyNoisy))).toEqual(
        Array.from(handle.getPublicKey())
      );
      expect(identity).toBeInstanceOf(Identity);
    });

    it('deriveSubHandleKey reproduces Handle.deriveSubHandle exactly (pubkey + signature parity)', async () => {
      const { handle } = await createTestHandle('work');
      const rootKey = crypto.deriveRootKey(TEST_SEED);
      const handleKey = crypto.deriveHandleKey(rootKey, 'work');
      const subKey = crypto.deriveSubHandleKey(handleKey, 'work', 'connector-1');

      const sub = await handle.deriveSubHandle('connector-1');
      expect(sub).toBeInstanceOf(SubHandle);
      expect(Array.from(ed25519.getPublicKey(subKey))).toEqual(
        Array.from(sub.getPublicKey())
      );
      // Deterministic-signature parity with the encapsulated key.
      const msg = new TextEncoder().encode('me2em arch-cycle subhandle-key parity probe');
      expect(Array.from(crypto.sign(msg, subKey))).toEqual(
        Array.from(await sub.sign(msg))
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

    it('raw Ed25519 wrappers — noble-oracle agreement and sync/async parity', async () => {
      // Pins the five wrappers not covered by the derive*-parity tests
      // above (getPublicKey, verify, getPublicKeyAsync, signAsync,
      // verifyAsync): each agrees with the @noble oracle imported
      // directly (the oracle scope rule is src/-only — tests are free
      // to use @noble), and every *Async wrapper is byte-identical to
      // its sync counterpart.
      const privateKey = crypto.deriveRootKey(TEST_SEED);
      const publicKey = crypto.getPublicKey(privateKey);
      const msg = new TextEncoder().encode('me2em arch-cycle wrapper parity probe');

      // getPublicKey agrees with the oracle.
      expect(Array.from(publicKey)).toEqual(
        Array.from(ed25519.getPublicKey(privateKey))
      );

      // sign/verify roundtrip through the wrappers; verify agrees with
      // the oracle on both accept and reject paths.
      const sig = crypto.sign(msg, privateKey);
      expect(sig.length).toBe(64);
      expect(crypto.verify(sig, msg, publicKey)).toBe(true);
      expect(ed25519.verify(sig, msg, publicKey)).toBe(true);
      const bad = Uint8Array.from(sig);
      bad[0] ^= 0x01;
      expect(crypto.verify(bad, msg, publicKey)).toBe(false);
      expect(ed25519.verify(bad, msg, publicKey)).toBe(false);

      // Async variants are byte-identical to their sync counterparts.
      expect(Array.from(await crypto.getPublicKeyAsync(privateKey))).toEqual(
        Array.from(publicKey)
      );
      expect(Array.from(await crypto.signAsync(msg, privateKey))).toEqual(
        Array.from(sig)
      );
      expect(await crypto.verifyAsync(sig, msg, publicKey)).toBe(true);
      expect(await crypto.verifyAsync(bad, msg, publicKey)).toBe(false);
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
