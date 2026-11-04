// Payment-layer unit tests (Ф1, Документ 2 v1.2):
// CAIP-2 grammar helpers, the adapter registry, WeakMap wallet binding
// and the default verifyWalletBinding.
import { describe, it, expect } from 'vitest';
import {
  Identity,
  Attestation,
  registerWalletAdapter,
  getWalletAdapter,
  isValidChain,
  parseChain,
  verifyWalletBinding,
  type WalletAdapter,
  type WalletDescriptor,
  type WalletEntityRef,
} from '../src/index.js';
import { TEST_SEED, createTestHandle } from './test-utils.js';

describe('CAIP-2 grammar (isValidChain / parseChain)', () => {
  it('solana:mainnet-beta → valid, parsed', () => {
    expect(isValidChain('solana:mainnet-beta')).toBe(true);
    expect(parseChain('solana:mainnet-beta')).toEqual({
      namespace: 'solana',
      reference: 'mainnet-beta',
    });
  });

  it('monero:mainnet → valid (grammar is chain-agnostic)', () => {
    expect(isValidChain('monero:mainnet')).toBe(true);
  });

  it('namespace boundaries: 3 and 8 chars ok, 2 and 9 fail', () => {
    expect(isValidChain('abc:ref')).toBe(true);
    expect(isValidChain('abcdefgh:ref')).toBe(true);
    expect(isValidChain('ab:ref')).toBe(false);
    expect(isValidChain('abcdefghi:ref')).toBe(false);
  });

  it('reference boundaries: 1 and 64 chars ok, 65 fail; dashes and case allowed', () => {
    expect(isValidChain('solana:a')).toBe(true);
    expect(isValidChain(`solano:${'a'.repeat(64)}`)).toBe(true);
    expect(isValidChain(`solano:${'a'.repeat(65)}`)).toBe(false);
    expect(isValidChain('eip155:1')).toBe(true);
    expect(isValidChain('solano:Mainnet-Beta')).toBe(true);
  });

  it('malformed forms → null/false', () => {
    for (const bad of ['solana', 'Solana:mainnet-beta', 'solana:', 's:mainnet-beta', 'a:b:c', ':ref', '']) {
      expect(isValidChain(bad)).toBe(false);
      expect(parseChain(bad)).toBeNull();
    }
  });
});

describe('adapter registry', () => {
  const descriptor: WalletDescriptor = {
    chain: 'solana:devnet',
    address: 'Addr',
  };
  const makeAdapter = (chain: string, valid = true): WalletAdapter => ({
    chain,
    resolveWallet: async () => ({ ...descriptor, chain }),
    isValidAddress: () => valid,
  });

  it('register → exact-key get → disposer removes', () => {
    const dispose = registerWalletAdapter(makeAdapter('solana:devnet'));
    expect(getWalletAdapter('solana:devnet')?.chain).toBe('solana:devnet');
    dispose();
    expect(getWalletAdapter('solana:devnet')).toBeNull();
  });

  it('exact CAIP-2 keys: solana:mainnet-beta and solana:devnet are different records', () => {
    const d1 = registerWalletAdapter(makeAdapter('solana:mainnet-beta'));
    const d2 = registerWalletAdapter(makeAdapter('solana:devnet'));
    expect(getWalletAdapter('solana:mainnet-beta')?.chain).toBe('solana:mainnet-beta');
    expect(getWalletAdapter('solana:devnet')?.chain).toBe('solana:devnet');
    d1();
    d2();
  });

  it('unknown chain → null (no aliasing, no prefix match)', () => {
    expect(getWalletAdapter('solana:testnet')).toBeNull();
    expect(getWalletAdapter('solano:devnet')).toBeNull();
    expect(getWalletAdapter('')).toBeNull();
  });

  it('last-wins: a later registration replaces the earlier one', () => {
    const disposeA = registerWalletAdapter(makeAdapter('solana:devnet', false));
    const a = getWalletAdapter('solana:devnet');
    const disposeB = registerWalletAdapter(makeAdapter('solana:devnet', true));
    const b = getWalletAdapter('solana:devnet');
    expect(b).not.toBe(a);
    expect(b?.isValidAddress('x')).toBe(true);
    // The superseded disposer must not remove the newer record.
    disposeA();
    expect(getWalletAdapter('solana:devnet')).toBe(b);
    disposeB();
    expect(getWalletAdapter('solana:devnet')).toBeNull();
  });

  it('disposer is idempotent', () => {
    const dispose = registerWalletAdapter(makeAdapter('solano:test'));
    dispose();
    dispose();
    expect(getWalletAdapter('solano:test')).toBeNull();
  });

  it('registry is shared across module copies via globalThis Symbol.for', async () => {
    // A second import of the module (fresh module record in a separate
    // vitest module registry) must see the SAME registry map.
    const dispose = registerWalletAdapter(makeAdapter('solano:shared'));
    const fresh = await import('../src/payment.js');
    expect(fresh.getWalletAdapter('solano:shared')?.chain).toBe('solano:shared');
    expect(fresh.getWalletAdapter('solano:shared')).toBe(getWalletAdapter('solano:shared'));
    dispose();
  });

  it('TypeError on a malformed adapter', () => {
    expect(() => registerWalletAdapter(null as unknown as WalletAdapter)).toThrow(TypeError);
    expect(() =>
      registerWalletAdapter({ isValidAddress: () => true } as unknown as WalletAdapter)
    ).toThrow(TypeError);
    expect(() =>
      registerWalletAdapter({ chain: 'x', resolveWallet: 1 } as unknown as WalletAdapter)
    ).toThrow(TypeError);
  });
});

describe('bindWallet / getWallet (WeakMap storage)', () => {
  const desc = (chain: string, address: string): WalletDescriptor => ({ chain, address });

  it('bind → get roundtrip on Identity and Handle', async () => {
    const { identity, handle } = await createTestHandle('walletly');
    identity.bindWallet(desc('solana:devnet', 'Addr1'));
    handle.bindWallet(desc('solana:mainnet-beta', 'Addr2'));

    expect(identity.getWallet('solana:devnet')?.address).toBe('Addr1');
    expect(handle.getWallet('solana:mainnet-beta')?.address).toBe('Addr2');
    expect(identity.getWallet('solana:mainnet-beta')).toBeNull();
    expect(handle.getWallet('solana:devnet')).toBeNull();
    expect(identity.getWallet('solana:testnet')).toBeNull();
  });

  it('bindWallet copies the descriptor — later caller mutation does not leak', async () => {
    const { handle } = await createTestHandle('walletly');
    const mutable: { chain: string; address: string } = {
      chain: 'solana:devnet',
      address: 'Original',
    };
    handle.bindWallet(mutable);
    mutable.address = 'Mutated';
    mutable.chain = 'solana:mainnet-beta';
    expect(handle.getWallet('solana:devnet')?.address).toBe('Original');
    expect(handle.getWallet('solana:mainnet-beta')).toBeNull();
  });

  it('per-entity isolation: two handles on one identity do not share bindings', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const h1 = await identity.deriveHandle('wallet-one');
    const h2 = await identity.deriveHandle('wallet-two');
    h1.bindWallet(desc('solana:devnet', 'AddrOne'));
    expect(h2.getWallet('solana:devnet')).toBeNull();
    expect(identity.getWallet('solana:devnet')).toBeNull();
  });

  it('re-binding the same chain overwrites (last per-chain binding)', async () => {
    const { handle } = await createTestHandle('walletly');
    handle.bindWallet(desc('solana:devnet', 'First'));
    handle.bindWallet(desc('solana:devnet', 'Second'));
    expect(handle.getWallet('solana:devnet')?.address).toBe('Second');
  });

  it('bindWallet without required fields → TypeError', async () => {
    const { handle } = await createTestHandle('walletly');
    expect(() => handle.bindWallet({ chain: '', address: 'A' })).toThrow(TypeError);
    expect(() => handle.bindWallet({ chain: 'solana:devnet', address: '' })).toThrow(TypeError);
    expect(() => handle.bindWallet(null as unknown as WalletDescriptor)).toThrow(TypeError);
  });

  it('SubHandle inherits bindWallet/getWallet', async () => {
    const { handle } = await createTestHandle('station-x');
    const sub = await handle.deriveSubHandle('connector-1');
    sub.bindWallet(desc('solana:devnet', 'SubAddr'));
    expect(sub.getWallet('solana:devnet')?.address).toBe('SubAddr');
  });
});

describe('verifyWalletBinding default (core)', () => {
  const wallet = (address: string): WalletDescriptor => ({ chain: 'solana:devnet', address });
  const entity = (id: string, name: string): WalletEntityRef => ({
    id,
    kind: 'handle',
    name,
  });

  it('attestation WITH wallet fields binds when signature, subject and address all match → true', async () => {
    const { identity, handle } = await createTestHandle('bindy');
    const address = 'GoodDevnetAddress';
    const att = await Attestation.issue(
      identity, handle.getPublicKey(), 'bindy',
      { scopes: ['read'], maxSessionTtl: 3600 },
      { subjectWallet: address, subjectWalletChain: 'solana:devnet' }
    );
    const ok = await verifyWalletBinding(
      wallet(address),
      entity(handle.getId(), handle.getName()),
      att,
      { issuerPublicKey: identity.getPublicKey() }
    );
    expect(ok).toBe(true);
  });

  it('attestation WITHOUT wallet fields → false (undefined never equals an address)', async () => {
    const { identity, handle } = await createTestHandle('bindy');
    const att = await identity.attestHandle('bindy', { scopes: ['read'], maxSessionTtl: 3600 });
    expect(att.payload.subjectWallet).toBeUndefined();
    const ok = await verifyWalletBinding(
      wallet('GoodDevnetAddress'),
      entity(handle.getId(), handle.getName()),
      att,
      { issuerPublicKey: identity.getPublicKey() }
    );
    expect(ok).toBe(false);
  });

  it('wrong issuer key → false', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const { handle } = await createTestHandle('bindy');
    const other = await Identity.fromSeed(
      new Uint8Array(64).fill(7)
    );
    const address = 'GoodDevnetAddress';
    const att = await Attestation.issue(
      identity, handle.getPublicKey(), 'bindy',
      { scopes: ['read'], maxSessionTtl: 3600 },
      { subjectWallet: address, subjectWalletChain: 'solana:devnet' }
    );
    const ok = await verifyWalletBinding(
      wallet(address),
      entity(handle.getId(), handle.getName()),
      att,
      { issuerPublicKey: other.getPublicKey() }
    );
    expect(ok).toBe(false);
  });

  it('address mismatch → false', async () => {
    const { identity, handle } = await createTestHandle('bindy');
    const address = 'GoodDevnetAddress';
    const att = await Attestation.issue(
      identity, handle.getPublicKey(), 'bindy',
      { scopes: ['read'], maxSessionTtl: 3600 },
      { subjectWallet: address, subjectWalletChain: 'solana:devnet' }
    );
    const ok = await verifyWalletBinding(
      wallet('SomeOtherAddress'),
      entity(handle.getId(), handle.getName()),
      att,
      { issuerPublicKey: identity.getPublicKey() }
    );
    expect(ok).toBe(false);
  });

  it('subject mismatch (attestation of another entity) → false', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const h1 = await identity.deriveHandle('bindy-a');
    const h2 = await identity.deriveHandle('bindy-b');
    const address = 'GoodDevnetAddress';
    const att = await Attestation.issue(
      identity, h1.getPublicKey(), 'bindy-a',
      { scopes: ['read'], maxSessionTtl: 3600 },
      { subjectWallet: address, subjectWalletChain: 'solana:devnet' }
    );
    const ok = await verifyWalletBinding(
      wallet(address),
      entity(h2.getId(), h2.getName()),
      att,
      { issuerPublicKey: identity.getPublicKey() }
    );
    expect(ok).toBe(false);
  });
});
