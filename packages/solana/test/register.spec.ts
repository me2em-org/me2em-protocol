// packages/solana/test/register.spec.ts
//
// Ф3: registerSolanaAdapters — exact-CAIP-2 keys, production-safe
// default network set, combined idempotent disposer, last-wins
// interplay with the core registry.
import { afterEach, describe, it, expect } from 'vitest';
import { getWalletAdapter, registerWalletAdapter, type WalletAdapter } from '@me2em/core';
import { registerSolanaAdapters } from '../src/register.js';
import { SOLANA_CHAINS } from '../src/networks.js';
import { TV2_SEED } from './goldens.js';

const disposers: Array<() => void> = [];
function track(disposer: () => void): () => void {
  disposers.push(disposer);
  return disposer;
}
afterEach(() => {
  while (disposers.length) disposers.pop()!();
});

describe('registerSolanaAdapters — registry keys', () => {
  it('registers mainnet-beta ONLY by default', () => {
    track(registerSolanaAdapters());
    const adapter = getWalletAdapter('solana:mainnet-beta');
    expect(adapter).not.toBeNull();
    expect(adapter!.chain).toBe('solana:mainnet-beta');
    expect(getWalletAdapter('solana:devnet')).toBeNull();
    expect(getWalletAdapter('solana:testnet')).toBeNull();
    expect(getWalletAdapter('solana:localnet')).toBeNull();
  });

  it('registers one adapter per requested network under its exact key', () => {
    track(registerSolanaAdapters({ networks: ['devnet', 'testnet'] }));
    expect(getWalletAdapter('solana:devnet')).not.toBeNull();
    expect(getWalletAdapter('solana:testnet')).not.toBeNull();
    expect(getWalletAdapter('solana:mainnet-beta')).toBeNull();
  });

  it('an empty network list registers nothing', () => {
    track(registerSolanaAdapters({ networks: [] }));
    for (const chain of Object.values(SOLANA_CHAINS)) {
      expect(getWalletAdapter(chain)).toBeNull();
    }
  });

  it('validates network names BEFORE touching the registry', () => {
    expect(() => registerSolanaAdapters({ networks: ['devnet', 'mainnet' as 'devnet'] })).toThrow(TypeError);
    // Nothing leaked:
    expect(getWalletAdapter('solana:devnet')).toBeNull();
    expect(getWalletAdapter('solana:mainnet-beta')).toBeNull();
  });
});

describe('registerSolanaAdapters — disposer hygiene', () => {
  it('removes every registration of its call, idempotently', () => {
    const disposer = registerSolanaAdapters({ networks: ['mainnet-beta', 'devnet'] });
    expect(getWalletAdapter('solana:mainnet-beta')).not.toBeNull();
    expect(getWalletAdapter('solana:devnet')).not.toBeNull();
    disposer();
    expect(getWalletAdapter('solana:mainnet-beta')).toBeNull();
    expect(getWalletAdapter('solana:devnet')).toBeNull();
    expect(() => disposer()).not.toThrow(); // idempotent
  });

  it('never removes a replacement registered later (last-wins interplay)', () => {
    const first = registerSolanaAdapters({ networks: ['mainnet-beta'] });
    const second = registerSolanaAdapters({ networks: ['mainnet-beta'] });
    const replacement = getWalletAdapter('solana:mainnet-beta');
    first(); // replaced record — must not remove the newer one
    expect(getWalletAdapter('solana:mainnet-beta')).toBe(replacement);
    second();
    expect(getWalletAdapter('solana:mainnet-beta')).toBeNull();
  });

  it('registered adapters are functional SolanaWalletAdapters', async () => {
    track(registerSolanaAdapters({ networks: ['devnet'] }));
    const adapter = getWalletAdapter('solana:devnet');
    expect(adapter!.isValidAddress('QVQwskmGkDfxQfRkbFJeY2YFm7go3ciiLvuANp1AsCi')).toBe(true);
    const descriptor = await adapter!.resolveWallet(
      { id: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', kind: 'identity', name: 'root' },
      { seed: TV2_SEED }
    );
    expect(descriptor.chain).toBe('solana:devnet');
    expect(descriptor.address).toBeTruthy();
  });

  it('coexists with foreign adapters on other namespaces', () => {
    track(registerSolanaAdapters());
    const foreign: WalletAdapter = {
      chain: 'eip155:1',
      resolveWallet: async () => ({ chain: 'eip155:1', address: '0x0' }),
      isValidAddress: () => true,
    };
    const disposer = registerWalletAdapter(foreign);
    track(disposer);
    expect(getWalletAdapter('eip155:1')).toBe(foreign);
    expect(getWalletAdapter('solana:mainnet-beta')).not.toBeNull();
  });
});
