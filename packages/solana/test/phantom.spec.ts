// packages/solana/test/phantom.spec.ts
//
// Acceptance Ф3 (P0.3 §5.7.2): cross-check the derived wallet
// against a REAL Solana wallet (Phantom) and the reference CLI
// (solana-keygen). This is the only pin that is independent of the
// me2em stack (crypto.slip10 + solana's path template) — it proves
// interop with the Solana ecosystem, not just internal consistency
// with @me2em/crypto.
//
// Origin of the golden address (filled at acceptance time):
//
//   Mnemonic: BIP39 official 12-word vector
//             ("abandon abandon ... about")
//   Derivation path: m/44'/501'/0'/0'   (Phantom default)
//   Phantom:  v<X.Y.Z>, <OS>, <date>, imported the mnemonic,
//             first account address = PHANTOM_GOLDEN_ADDRESS
//   solana-keygen: `solana-keygen recover --derivation-path "m/44'/501'/0'/0'"`
//             (offline, recover mode), output = same address
//
// gitleaks: the base58 address is a PUBLIC wallet address, not a
// secret — allowlisted via `.gitleaks.toml` (path: `packages/solana/test/`).
import { describe, it, expect } from 'vitest';
import { get64ByteSeedFromMnemonic } from '@me2em/core';
import { SolanaWalletTree } from '../src/wallet-tree.js';
import { PHANTOM_GOLDEN_ADDRESS, PHANTOM_MNEMONIC } from './goldens.js';

const PHANTOM_FILLED = !PHANTOM_GOLDEN_ADDRESS.startsWith('<');

describe('Ф3 acceptance — Phantom / solana-keygen cross-check', () => {
  it.skipIf(!PHANTOM_FILLED)(
    'Phantom-imported 12-word mnemonic derives the same address at index 0',
    async () => {
      const seed = await get64ByteSeedFromMnemonic(PHANTOM_MNEMONIC);
      const tree = SolanaWalletTree.fromSeed(seed);
      try {
        const wallet = await tree.deriveWallet(0);
        expect(wallet.address).toBe(PHANTOM_GOLDEN_ADDRESS);
        expect(wallet.derivationPath).toBe("m/44'/501'/0'/0'");
      } finally {
        tree.dispose();
      }
    }
  );
});
