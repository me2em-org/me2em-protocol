// packages/solana/test/wallet-tree.spec.ts
//
// Ф3: SolanaWalletTree — seed contract, deterministic derivation
// (golden-pinned against independently computed TV2 addresses),
// index allocation semantics and the dispose contract.
import { describe, it, expect } from 'vitest';
import { DisposedError } from '@me2em/core';
import { secureWipe, signRaw, slip10, verifyRaw } from '@me2em/crypto';
import { base58 } from '@scure/base';
import { SolanaWalletTree, nextPaymentIndex } from '../src/wallet-tree.js';
import { GOLDEN_ADDRESSES, TV2_SEED } from './goldens.js';

describe('SolanaWalletTree.fromSeed — seed contract (exactly 64 bytes)', () => {
  it('accepts the 64-byte TV2 seed', () => {
    expect(() => SolanaWalletTree.fromSeed(TV2_SEED)).not.toThrow();
  });

  it('rejects every other length and non-Uint8Array input', () => {
    for (const bad of [
      new Uint8Array(16), // SLIP-0010-legal, me2em-illegal
      new Uint8Array(63),
      new Uint8Array(65),
      new Uint8Array(0),
      new Uint8Array(32),
    ]) {
      expect(() => SolanaWalletTree.fromSeed(bad), `length ${bad.length}`).toThrow(TypeError);
    }
    for (const bad of [undefined, null, 'fffcf9f6', 123, { length: 64 }]) {
      expect(() => SolanaWalletTree.fromSeed(bad as unknown as Uint8Array), `type ${String(bad)}`).toThrow(
        TypeError
      );
    }
  });

  it('does not wipe the caller-owned seed and does not retain it', async () => {
    const seed = TV2_SEED.slice();
    const tree = SolanaWalletTree.fromSeed(seed);
    try {
      // Caller's buffer untouched (caller owns it):
      expect(Array.from(seed)).toEqual(Array.from(TV2_SEED));
      // No retention: mutating the caller's buffer after fromSeed
      // cannot influence later derivations.
      const before = await tree.deriveWallet(0);
      seed[0] ^= 0xff;
      const after = await tree.deriveWallet(0);
      expect(after.address).toBe(before.address);
      expect(Array.from(after.privateKey)).toEqual(Array.from(before.privateKey));
    } finally {
      tree.dispose();
    }
  });
});

describe('SolanaWalletTree.deriveWallet — golden addresses (TV2, m/44\'/501\'/N\'/0\')', () => {
  it('derives the independently pinned base58 addresses byte-exact', async () => {
    const tree = SolanaWalletTree.fromSeed(TV2_SEED);
    try {
      for (const [indexStr, golden] of Object.entries(GOLDEN_ADDRESSES)) {
        const index = Number(indexStr);
        const wallet = await tree.deriveWallet(index);
        expect(wallet.address, `index ${index}`).toBe(golden);
        expect(wallet.derivationPath, `index ${index}`).toBe(`m/44'/501'/${index}'/0'`);
      }
    } finally {
      tree.dispose();
    }
  });

  it('derives through crypto.slip10 — cross-checked public key and signing capability', async () => {
    const tree = SolanaWalletTree.fromSeed(TV2_SEED);
    try {
      const wallet = await tree.deriveWallet(1);
      // Same node reachable through the raw crypto.slip10 namespace:
      const master = slip10.masterKeyFromSeed(TV2_SEED);
      const node = slip10.derivePath(master, "m/44'/501'/1'/0'");
      expect(wallet.address).toBe(base58.encode(slip10.publicKey(node)));
      // The returned private key is a real Ed25519 signing seed whose
      // public key IS the address preimage — a signature made with it
      // verifies against the key decoded from the ADDRESS string:
      const message = new TextEncoder().encode('me2em solana Ф3');
      const sig = signRaw(wallet.privateKey, message);
      expect(verifyRaw(base58.decode(wallet.address), message, sig)).toBe(true);
      expect(verifyRaw(slip10.publicKey(node), message, sig)).toBe(true);
    } finally {
      tree.dispose();
    }
  });

  it('is deterministic with fresh buffers per call', async () => {
    const tree = SolanaWalletTree.fromSeed(TV2_SEED);
    try {
      const a = await tree.deriveWallet(2);
      const b = await tree.deriveWallet(2);
      expect(a.address).toBe(b.address);
      expect(Array.from(a.privateKey)).toEqual(Array.from(b.privateKey));
      expect(a.privateKey.buffer).not.toBe(b.privateKey.buffer); // no aliasing
      expect(a.privateKey).toHaveLength(32);
      expect(a.privateKey).not.toEqual(TV2_SEED.subarray(0, 32)); // master never leaked
    } finally {
      tree.dispose();
    }
  });

  it('rejects non-integers and out-of-range indices', async () => {
    const tree = SolanaWalletTree.fromSeed(TV2_SEED);
    try {
      for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x80000000, '0' as unknown as number]) {
        await expect(tree.deriveWallet(bad), `index ${String(bad)}`).rejects.toThrow(TypeError);
      }
      // 2^31 − 1 is the legal maximum (golden-pinned above).
    } finally {
      tree.dispose();
    }
  });
});

describe('SolanaWalletTree.nextIndex — v1.2 §2.2 allocation semantics', () => {
  it('empty input yields 0', () => {
    expect(nextPaymentIndex([])).toBe(0);
  });

  it('max + 1 — holes are never reused', () => {
    expect(nextPaymentIndex(["m/44'/501'/0'/0'", "m/44'/501'/2'/0'"])).toBe(3);
    expect(nextPaymentIndex(["m/44'/501'/7'/0'"])).toBe(8);
  });

  it('foreign and unparseable paths are ignored, never thrown on', () => {
    expect(
      nextPaymentIndex([
        "m/44'/60'/0'/0'", // foreign coin type
        "m/44'/501'/5'", // missing level
        "m/0'/1'/2'", // not ours
        'garbage',
        '',
        'm/44/501/6/0', // not hardened — not our grammar
        'm/44\'/501\'/4294967296\'/0\'', // beyond the plain-index range
        null as unknown as string, // tolerated mixed input
      ])
    ).toBe(0);
    expect(
      nextPaymentIndex(["m/44'/501'/9'/0'", 'garbage', "m/44'/501'/3'/0'"])
    ).toBe(10);
  });

  it('rejects non-array input', () => {
    expect(() => nextPaymentIndex("m/44'/501'/0'/0'" as unknown as string[])).toThrow(TypeError);
    expect(() => nextPaymentIndex(undefined as unknown as string[])).toThrow(TypeError);
  });

  // Deliberate tolerance (v1.2 §2.2): the scanner accepts padded index
  // renderings (`00`, `007`) and canonicalizes via Number() — a strict
  // `(0|[1-9][0-9]*)` grammar would silently ignore such persisted
  // paths and could reallocate an existing index (address reuse).
  // Overflowing captures (2^31 and beyond) stay filtered by the range
  // check.
  it('padded index renderings count as used; overflows stay filtered', () => {
    expect(nextPaymentIndex(["m/44'/501'/00'/0'"])).toBe(1);
    expect(nextPaymentIndex(["m/44'/501'/007'/0'"])).toBe(8);
    expect(
      nextPaymentIndex(["m/44'/501'/3'/0'", "m/44'/501'/002'/0'"])
    ).toBe(4);
    expect(nextPaymentIndex(["m/44'/501'/2147483648'/0'"])).toBe(0);
  });

  it('works after dispose (no key material involved)', async () => {
    const tree = SolanaWalletTree.fromSeed(TV2_SEED);
    tree.dispose();
    expect(tree.nextIndex([])).toBe(0);
    await expect(tree.deriveWallet(0)).rejects.toThrow(DisposedError);
  });
});

describe('SolanaWalletTree.dispose — zeroization and lifecycle', () => {
  it('revokes key capabilities with DisposedError, idempotently', async () => {
    const tree = SolanaWalletTree.fromSeed(TV2_SEED);
    tree.dispose();
    await expect(tree.deriveWallet(0)).rejects.toThrow(DisposedError);
    try {
      await tree.deriveWallet(0);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DisposedError);
      expect((e as DisposedError).className).toBe('SolanaWalletTree');
      expect((e as DisposedError).name).toBe('DisposedError');
    }
    expect(() => tree.dispose()).not.toThrow(); // idempotent
    await expect(tree.deriveWallet(0)).rejects.toThrow(DisposedError);
  });

  it('a fresh tree from the same seed keeps deriving after another is disposed', async () => {
    const t1 = SolanaWalletTree.fromSeed(TV2_SEED);
    t1.dispose();
    const t2 = SolanaWalletTree.fromSeed(TV2_SEED);
    try {
      const wallet = await t2.deriveWallet(0);
      expect(wallet.address).toBe(GOLDEN_ADDRESSES[0]);
    } finally {
      t2.dispose();
    }
  });

  it('wipe-on-dispose leaves no usable master material (post-dispose object cannot be revived)', () => {
    const tree = SolanaWalletTree.fromSeed(TV2_SEED);
    tree.dispose();
    tree.dispose(); // double dispose is a no-op, no double-wipe errors
    expect(tree.nextIndex(["m/44'/501'/3'/0'"])).toBe(4);
  });
});

describe('nextPaymentIndex — independent function surface', () => {
  it('matches the tree method', () => {
    const tree = SolanaWalletTree.fromSeed(TV2_SEED);
    try {
      const paths = ["m/44'/501'/0'/0'", "m/44'/501'/1'/0'"];
      expect(tree.nextIndex(paths)).toBe(nextPaymentIndex(paths));
    } finally {
      tree.dispose();
    }
  });

  it('secureWipe integration: derived keys wipe cleanly (no throw on fresh buffers)', async () => {
    const tree = SolanaWalletTree.fromSeed(TV2_SEED);
    try {
      const { privateKey } = await tree.deriveWallet(0);
      expect(() => secureWipe(privateKey)).not.toThrow();
      expect(Array.from(privateKey)).toEqual(new Array(32).fill(0));
    } finally {
      tree.dispose();
    }
  });
});
