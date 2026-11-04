// packages/crypto/test/core/slip10.spec.ts
//
// Ф-crypto (payment-layer plan, Документ 2 v1.2): SLIP-0010 ed25519
// in @me2em/crypto, consumed by @me2em/solana as `crypto.slip10`.
//
// The positive vectors are the official SLIP-0010 ed25519 Test
// Vectors 1 and 2, VERBATIM from slip-0010.md (Appendix A of the
// ТЗ): every chain of both tables, private key and chain code,
// byte-exact. TV2's seed is 64 bytes and goes through the PUBLIC
// contract (`slip10.masterKeyFromSeed`); TV1's seed is 16 bytes —
// spec-legal for SLIP-0010 (128 bits) but outside the me2em 64-byte
// contract — so its master step goes through `masterKeyFromSeedRaw`
// (the algorithm-level entry the public contract delegates to).
import { describe, it, expect } from 'vitest';
import { slip10, masterKeyFromSeedRaw } from '../../src/core/slip10.js';
import { signRaw, verifyRaw } from '../../src/core/signatures.js';
import { fromHex, toHex } from '../../src/utils/binary.js';

function bytes(hex: string): Uint8Array {
  return fromHex(hex);
}

/** One row of the official tables: hardened path (SLIP-0010 notation) → [chainCode, private]. */
interface VectorRow {
  chain: string;
  chainCode: string;
  priv: string;
}

const TV1_SEED = '000102030405060708090a0b0c0d0e0f'; // 16 bytes (slip-0010.md Test Vector 1)

const TV1: VectorRow[] = [
  {
    chain: 'm',
    chainCode: '90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb',
    priv: '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7',
  },
  {
    chain: "m/0'",
    chainCode: '8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69',
    priv: '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3',
  },
  {
    chain: "m/0'/1'",
    chainCode: 'a320425f77d1b5c2505a6b1b27382b37368ee640e3557c315416801243552f14',
    priv: 'b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2',
  },
  {
    chain: "m/0'/1'/2'",
    chainCode: '2e69929e00b5ab250f49c3fb1c12f252de4fed2c1db88387094a0f8c4c9ccd6c',
    priv: '92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9',
  },
  {
    chain: "m/0'/1'/2'/2'",
    chainCode: '8f6d87f93d750e0efccda017d662a1b31a266e4a6f5993b15f5c1f07f74dd5cc',
    priv: '30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662',
  },
  {
    chain: "m/0'/1'/2'/2'/1000000000'",
    chainCode: '68789923a0cac2cd5a29172a475fe9e0fb14cd6adb5ad98a3fa70333e7afa230',
    priv: '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793',
  },
];

const TV2_SEED =
  'fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542'; // 64 bytes (slip-0010.md Test Vector 2)

const TV2: VectorRow[] = [
  {
    chain: 'm',
    chainCode: 'ef70a74db9c3a5af931b5fe73ed8e1a53464133654fd55e7a66f8570b8e33c3b',
    priv: '171cb88b1b3c1db25add599712e36245d75bc65a1a5c9e18d76f9f2b1eab4012',
  },
  {
    chain: "m/0'",
    chainCode: '0b78a3226f915c082bf118f83618a618ab6dec793752624cbeb622acb562862d',
    priv: '1559eb2bbec5790b0c65d8693e4d0875b1747f4970ae8b650486ed7470845635',
  },
  {
    chain: "m/0'/2147483647'",
    chainCode: '138f0b2551bcafeca6ff2aa88ba8ed0ed8de070841f0c4ef0165df8181eaad7f',
    priv: 'ea4f5bfe8694d8bb74b7b59404632fd5968b774ed545e810de9c32a4fb4192f4',
  },
  {
    chain: "m/0'/2147483647'/1'",
    chainCode: '73bd9fff1cfbde33a1b846c27085f711c0fe2d66fd32e139d3ebc28e5a4a6b90',
    priv: '3757c7577170179c7868353ada796c839135b3d30554bbb74a4b1e4a5a58505c',
  },
];

/** Walks a chain string ("m/0'/1'") one hardened level at a time via slip10.deriveHardened. */
function deriveStepwise(master: ReturnType<typeof masterKeyFromSeedRaw>, chain: string) {
  let node = master;
  const rest = chain.slice(2);
  if (rest !== '') {
    for (const component of rest.split('/')) {
      node = slip10.deriveHardened(node, Number(component.slice(0, -1)) + 0x80000000);
    }
  }
  return node;
}

describe('slip10 — SLIP-0010 ed25519 official test vectors (verbatim)', () => {
  it('TV1 (16-byte seed, algorithm level): all chains byte-exact', () => {
    const master = masterKeyFromSeedRaw(bytes(TV1_SEED));
    expect(toHex(master.chainCode)).toBe(TV1[0]!.chainCode);
    expect(toHex(master.key)).toBe(TV1[0]!.priv);
    for (const row of TV1.slice(1)) {
      const node = deriveStepwise(master, row.chain);
      expect(toHex(node.chainCode), `TV1 ${row.chain} chain code`).toBe(row.chainCode);
      expect(toHex(node.key), `TV1 ${row.chain} private`).toBe(row.priv);
    }
  });

  it('TV1 final chain also reachable as ONE derivePath call', () => {
    const master = masterKeyFromSeedRaw(bytes(TV1_SEED));
    const one = slip10.derivePath(master, "m/0'/1'/2'/2'/1000000000'");
    expect(toHex(one.chainCode)).toBe(TV1[5]!.chainCode);
    expect(toHex(one.key)).toBe(TV1[5]!.priv);
  });

  it('TV2 (64-byte seed, PUBLIC contract): all chains byte-exact', () => {
    const master = slip10.masterKeyFromSeed(bytes(TV2_SEED));
    expect(toHex(master.chainCode)).toBe(TV2[0]!.chainCode);
    expect(toHex(master.key)).toBe(TV2[0]!.priv);
    for (const row of TV2.slice(1)) {
      const stepwise = deriveStepwise(master, row.chain);
      expect(toHex(stepwise.chainCode), `TV2 ${row.chain} chain code`).toBe(row.chainCode);
      expect(toHex(stepwise.key), `TV2 ${row.chain} private`).toBe(row.priv);
      const one = slip10.derivePath(master, row.chain);
      expect(toHex(one.chainCode), `TV2 ${row.chain} chain code (derivePath)`).toBe(row.chainCode);
      expect(toHex(one.key), `TV2 ${row.chain} private (derivePath)`).toBe(row.priv);
    }
  });

  it('marker aliases h and H are equivalent to the apostrophe', () => {
    const master = slip10.masterKeyFromSeed(bytes(TV2_SEED));
    const apos = slip10.derivePath(master, "m/0'");
    for (const marker of ['h', 'H']) {
      const node = slip10.derivePath(master, `m/0${marker}`);
      expect(toHex(node.key)).toBe(toHex(apos.key));
      expect(toHex(node.chainCode)).toBe(toHex(apos.chainCode));
    }
  });

  it('bare path "m" returns a detached equal copy of the node', () => {
    const master = slip10.masterKeyFromSeed(bytes(TV2_SEED));
    const copy = slip10.derivePath(master, 'm');
    expect(toHex(copy.key)).toBe(toHex(master.key));
    expect(toHex(copy.chainCode)).toBe(toHex(master.chainCode));
    copy.key[0] = copy.key[0]! ^ 0xff;
    expect(master.key[0]).not.toBe(copy.key[0]); // no aliasing
  });
});

describe('slip10 — seed contract (exactly 64 bytes, like Identity.fromSeed)', () => {
  it('public masterKeyFromSeed: 64-byte seed accepted, all other lengths rejected', () => {
    expect(() => slip10.masterKeyFromSeed(bytes(TV2_SEED))).not.toThrow();
    for (const bad of [
      bytes(TV1_SEED), // 16 bytes — SLIP-0010-legal, me2em-illegal
      new Uint8Array(63),
      new Uint8Array(65),
      new Uint8Array(0),
      new Uint8Array(32),
    ]) {
      expect(() => slip10.masterKeyFromSeed(bad), `length ${bad.length}`).toThrow(TypeError);
    }
  });

  it('public masterKeyFromSeed: non-Uint8Array seed rejected', () => {
    for (const bad of [undefined, null, 'fffcf9f6', 123, { length: 64 }]) {
      expect(() => slip10.masterKeyFromSeed(bad as unknown as Uint8Array), `type ${String(bad)}`).toThrow(
        TypeError
      );
    }
  });

  it('masterKeyFromSeedRaw: SLIP-0010 range 16–64 bytes enforced', () => {
    expect(() => masterKeyFromSeedRaw(bytes(TV1_SEED))).not.toThrow(); // 16 bytes
    expect(() => masterKeyFromSeedRaw(new Uint8Array(15))).toThrow(TypeError);
    expect(() => masterKeyFromSeedRaw(new Uint8Array(65))).toThrow(TypeError);
  });

  it('the seed is snapshot at master time: later mutation does not affect the node', () => {
    const seed = bytes(TV2_SEED);
    const master = slip10.masterKeyFromSeed(seed);
    const before = toHex(master.key);
    seed[0] = seed[0]! ^ 0xff;
    expect(toHex(master.key)).toBe(before);
  });
});

describe('slip10 — hardened-only rule (non-hardened → TypeError)', () => {
  const master = slip10.masterKeyFromSeed(bytes(TV2_SEED));

  it('deriveHardened rejects indices without the hardening bit', () => {
    for (const bad of [0, 1, 5, 44, 501, 0x7fffffff]) {
      expect(() => slip10.deriveHardened(master, bad), `index ${bad}`).toThrow(TypeError);
    }
  });

  it('deriveHardened rejects non-integers and out-of-range indices', () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x100000000, -1]) {
      expect(() => slip10.deriveHardened(master, bad), `index ${String(bad)}`).toThrow(TypeError);
    }
  });

  it('derivePath rejects non-hardened components (anywhere in the path)', () => {
    for (const bad of ['m/0', "m/0'/1", "m/44/501'/0'/0'"]) {
      expect(() => slip10.derivePath(master, bad), `path ${bad}`).toThrow(TypeError);
    }
  });

  it('derivePath rejects malformed paths', () => {
    for (const bad of [
      "0'/1'", // no leading m
      'm/', // empty component
      'm//0\'', // empty component
      "m/00'", // leading zero
      "m/2147483648'", // plain component ≥ 2^31
      "m/0'/x'", // non-numeric component
      '', // empty
    ]) {
      expect(() => slip10.derivePath(master, bad), `path ${JSON.stringify(bad)}`).toThrow(TypeError);
    }
  });

  it('derivation from a malformed node is fail-closed', () => {
    const brokenKey = { key: new Uint8Array(31), chainCode: new Uint8Array(32) };
    const brokenChain = { key: new Uint8Array(32), chainCode: new Uint8Array(16) };
    expect(() => slip10.deriveHardened(brokenKey, 0x80000000)).toThrow(TypeError);
    expect(() => slip10.derivePath(brokenChain, "m/0'")).toThrow(TypeError);
    // The bare path "m" never reaches the component loop — the guard
    // in deriveChildPath must still reject a malformed node.
    expect(() => slip10.derivePath(brokenChain, 'm')).toThrow(TypeError);
    expect(() => slip10.publicKey(brokenKey)).toThrow(TypeError);
  });
});

describe('slip10 — public keys and determinism', () => {
  it('publicKey is a real 32-byte Ed25519 public key (sign/verify roundtrip)', () => {
    const master = slip10.masterKeyFromSeed(bytes(TV2_SEED));
    const node = slip10.derivePath(master, "m/44'/501'/0'/0'");
    const pub = slip10.publicKey(node);
    expect(pub).toHaveLength(32);
    const message = new TextEncoder().encode('me2em slip10');
    const sig = signRaw(node.key, message);
    expect(verifyRaw(pub, message, sig)).toBe(true);
    expect(verifyRaw(slip10.publicKey(master), message, sig)).toBe(false);
  });

  it('derivation is deterministic and deterministic across entry styles', () => {
    const seed = bytes(TV2_SEED);
    const a = slip10.derivePath(slip10.masterKeyFromSeed(seed), "m/44'/501'/7'/0'");
    const b = slip10.derivePath(slip10.masterKeyFromSeed(seed), "m/44'/501'/7'/0'");
    expect(toHex(a.key)).toBe(toHex(b.key));
    expect(toHex(a.chainCode)).toBe(toHex(b.chainCode));
    // Stepwise equals one-shot:
    const stepwise = slip10.deriveHardened(
      slip10.deriveHardened(slip10.deriveHardened(slip10.deriveHardened(
        slip10.masterKeyFromSeed(seed),
        44 + 0x80000000
      ), 501 + 0x80000000), 7 + 0x80000000), 0 + 0x80000000
    );
    expect(toHex(stepwise.key)).toBe(toHex(a.key));
  });

  it('the canonical Solana payment path m/44\'/501\'/{index}\'/0\' derives for several indices', () => {
    const master = slip10.masterKeyFromSeed(bytes(TV2_SEED));
    for (const index of [0, 1, 2, 100, 2147483647]) {
      const node = slip10.derivePath(master, `m/44'/501'/${index}'/0'`);
      expect(node.key).toHaveLength(32);
      expect(slip10.publicKey(node)).toHaveLength(32);
    }
  });

  it('fresh buffers: children never share memory with the parent', () => {
    const master = slip10.masterKeyFromSeed(bytes(TV2_SEED));
    const child = slip10.deriveHardened(master, 0x80000000);
    expect(child.key.buffer).not.toBe(master.key.buffer);
    expect(child.chainCode.buffer).not.toBe(master.chainCode.buffer);
  });
});
