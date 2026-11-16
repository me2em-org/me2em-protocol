// packages/solana/test/goldens.ts
//
// Golden pins for the Ф3 wallet path, computed INDEPENDENTLY of the
// solana sources (scripts run against the published-shape
// @me2em/crypto build + @scure/base only):
//
//   seed  = SLIP-0010 Test Vector 2 (official, slip-0010.md) — the
//           same 64-byte seed byte-pinned in
//           packages/crypto/test/core/slip10.spec.ts
//   path  = m/44'/501'/{index}'/0'   (canonical Solana payment path)
//   addr  = base58(slip10.publicKey(slip10.derivePath(master, path)))
//
// If solana's path template, public-key handling or base58 encoding
// drifts, these pins fail.
//
// Phantom cross-check fixture (P0.3 §5.7.2 — acceptance Ф3).
//
// ⚠️ PUBLIC DATA ONLY — the mnemonic is the BIP39 official
// 12-word test vector (already public in @me2em/core vectors);
// the address is a public wallet address. NO private key, NO
// seed bytes stored in source.
//
// Origin (fill at acceptance, commit once, do not edit):
//   Phantom v<X.Y.Z>, <OS>, <date>: imported mnemonic →
//   first account address.
//   solana-keygen recover --derivation-path "m/44'/501'/0'/0'"
//   → same address.
import { fromHex } from '@me2em/crypto';

/** SLIP-0010 Test Vector 2 seed — 64 bytes (slip-0010.md, verbatim). */
export const TV2_SEED = fromHex(
  'fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542'
);

/**
 * base58 addresses for the canonical Solana payment path over TV2,
 * keyed by the plain index. Includes the 2^31 − 1 boundary.
 */
export const GOLDEN_ADDRESSES: Readonly<Record<number, string>> = {
  0: 'QVQwskmGkDfxQfRkbFJeY2YFm7go3ciiLvuANp1AsCi',
  1: 'Fyf8KHrQXp7zC4DQuPohFqXfEv5FTzAr4pFRX1Z2RecA',
  2: 'Cd2RttH7gzMTy7ZbNwGFDSWY5PYwESAVpgogtWJxh9HB',
  100: 'bLsvjPXcCxPirt6rHC1QkBZ9B4LRrNJxA4mfn8C3nYY',
  2147483647: '9zMUDviJkb5Mq6pwRpzAuEZCjooHKV5CrkRVezEQNTxL',
};

/** BIP39 official 12-word test vector — public, standard fixture. */
export const PHANTOM_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// gitleaks:allow — public Solana address, not a secret.
/**
 * Public Phantom address for PHANTOM_MNEMONIC at m/44'/501'/0'/0'.
 * Filled at acceptance (P0.3 §5.7.2 — Ф3 acceptance cross-check).
 * Placeholder until filled: CI skips the test via skipIf.
 */
export const PHANTOM_GOLDEN_ADDRESS = '<fill at acceptance>';
