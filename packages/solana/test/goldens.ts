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
