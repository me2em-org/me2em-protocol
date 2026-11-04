// packages/solana/test/adapter.spec.ts
//
// Ф3: SolanaWalletAdapter — the core WalletAdapter contract
// (resolveWallet with per-call seed, structural isValidAddress with
// PDA tolerance, nextIndex delegation, chain-bound instances).
import { describe, it, expect } from 'vitest';
import { randomBytes } from '@me2em/crypto';
import { base58 } from '@scure/base';
import { SolanaWalletAdapter, isValidSolanaAddress } from '../src/adapter.js';
import { SolanaWalletTree } from '../src/wallet-tree.js';
import { GOLDEN_ADDRESSES, TV2_SEED } from './goldens.js';
import type { WalletEntityRef } from '@me2em/core';

const entity: WalletEntityRef = {
  id: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  kind: 'handle',
  name: 'station-42',
};

describe('isValidSolanaAddress — structural base58/32-byte check', () => {
  it('accepts the golden addresses', () => {
    for (const address of Object.values(GOLDEN_ADDRESSES)) {
      expect(isValidSolanaAddress(address), address).toBe(true);
    }
  });

  it('accepts arbitrary 32-byte values — no on-curve filter (PDA tolerance)', () => {
    for (let i = 0; i < 32; i++) {
      // Random 32 bytes: ~half of these are off-curve; ALL must pass —
      // the check is structural only.
      expect(isValidSolanaAddress(base58.encode(randomBytes(32)))).toBe(true);
    }
    // Pathological values too — as long as they decode to 32 bytes:
    expect(isValidSolanaAddress(base58.encode(new Uint8Array(32)))).toBe(true);
    expect(isValidSolanaAddress(base58.encode(new Uint8Array(32).fill(0xff)))).toBe(true);
  });

  it('rejects malformed input without throwing', () => {
    const tooLong = base58.encode(new Uint8Array(33));
    const tooShort = base58.encode(new Uint8Array(31));
    for (const bad of [
      '',
      '   ',
      'abc def',
      'l0OIl', // invalid base58 alphabet characters
      tooLong,
      tooShort,
      'sol', // decodes, but 3 bytes
      '!!!',
      '😀',
    ]) {
      expect(isValidSolanaAddress(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(isValidSolanaAddress(undefined as unknown as string)).toBe(false);
    expect(isValidSolanaAddress(null as unknown as string)).toBe(false);
    expect(isValidSolanaAddress(123 as unknown as string)).toBe(false);
  });
});

describe('SolanaWalletAdapter — construction', () => {
  it('binds the exact CAIP-2 chain per network', () => {
    expect(new SolanaWalletAdapter('mainnet-beta').chain).toBe('solana:mainnet-beta');
    expect(new SolanaWalletAdapter('devnet').chain).toBe('solana:devnet');
    expect(new SolanaWalletAdapter('testnet').chain).toBe('solana:testnet');
    expect(new SolanaWalletAdapter('localnet').chain).toBe('solana:localnet');
  });

  it('exposes the network and rejects unknown names', () => {
    expect(new SolanaWalletAdapter('devnet').network).toBe('devnet');
    for (const bad of ['mainnet', 'Mainnet-beta', 'ethereum', '', 'solana:mainnet-beta']) {
      expect(() => new SolanaWalletAdapter(bad as 'devnet'), JSON.stringify(bad)).toThrow(TypeError);
    }
  });
});

describe('SolanaWalletAdapter.resolveWallet — deterministic resolution', () => {
  it('derives the golden wallet at index 0 with label and path', async () => {
    const adapter = new SolanaWalletAdapter('mainnet-beta');
    const descriptor = await adapter.resolveWallet(entity, { seed: TV2_SEED });
    expect(descriptor.chain).toBe('solana:mainnet-beta');
    expect(descriptor.address).toBe(GOLDEN_ADDRESSES[0]);
    expect(descriptor.derivationPath).toBe("m/44'/501'/0'/0'");
    expect(descriptor.label).toBe('station-42');
    expect('privateKey' in descriptor).toBe(false); // descriptors carry no key material
  });

  it('honors the requested index and matches the tree one-shot', async () => {
    const adapter = new SolanaWalletAdapter('mainnet-beta');
    const descriptor = await adapter.resolveWallet(entity, { seed: TV2_SEED, index: 100 });
    const tree = SolanaWalletTree.fromSeed(TV2_SEED);
    try {
      const direct = await tree.deriveWallet(100);
      expect(descriptor.address).toBe(direct.address);
      expect(descriptor.address).toBe(GOLDEN_ADDRESSES[100]);
    } finally {
      tree.dispose();
    }
  });

  it('is chain-bound: devnet and mainnet instances differ only in chain', async () => {
    const main = new SolanaWalletAdapter('mainnet-beta');
    const dev = new SolanaWalletAdapter('devnet');
    const a = await main.resolveWallet(entity, { seed: TV2_SEED, index: 2 });
    const b = await dev.resolveWallet(entity, { seed: TV2_SEED, index: 2 });
    expect(b.chain).toBe('solana:devnet');
    expect(a.address).toBe(b.address); // same tree, different chain key
  });

  it('rejects a missing seed with TypeError (deterministic adapter contract)', async () => {
    const adapter = new SolanaWalletAdapter('mainnet-beta');
    await expect(adapter.resolveWallet(entity)).rejects.toThrow(TypeError);
    await expect(adapter.resolveWallet(entity, {})).rejects.toThrow(TypeError);
    await expect(adapter.resolveWallet(entity, { index: 1 })).rejects.toThrow(TypeError);
    await expect(adapter.resolveWallet(entity, { seed: new Uint8Array(63) })).rejects.toThrow(TypeError);
  });

  it('rejects an out-of-range index with TypeError', async () => {
    const adapter = new SolanaWalletAdapter('mainnet-beta');
    await expect(adapter.resolveWallet(entity, { seed: TV2_SEED, index: 1.5 })).rejects.toThrow(TypeError);
    await expect(adapter.resolveWallet(entity, { seed: TV2_SEED, index: -1 })).rejects.toThrow(TypeError);
  });
});

describe('SolanaWalletAdapter.nextIndex — delegation', () => {
  it('matches the tree semantics', () => {
    const adapter = new SolanaWalletAdapter('mainnet-beta');
    expect(adapter.nextIndex([])).toBe(0);
    expect(adapter.nextIndex(["m/44'/501'/0'/0'", "m/44'/501'/5'/0'"])).toBe(6);
    expect(adapter.nextIndex(['garbage', "m/44'/60'/0'/0'"])).toBe(0);
    expect(() => adapter.nextIndex(null as unknown as string[])).toThrow(TypeError);
  });
});
