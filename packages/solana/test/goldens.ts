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

// ---------------------------------------------------------------------------
// M2 x402-signer goldens (ТЗ @me2em/x402 v1.2 §4.5 — "golden-векторы
// ручной сериализации legacy transfer").
//
// Computed INDEPENDENTLY of the solana sources with the published-shape
// @me2em/crypto + @scure/base builds (script copies kept outside the
// repo; layout documented in src/x402-signer.ts):
//
//   seed      = TV2_SEED, index 0 (→ GOLDEN_ADDRESSES[0] as source)
//   payTo     = GOLDEN_ADDRESSES[1], amount = 1000 lamports (0.000001 SOL)
//   blockhash = the 32 bytes below (deterministic fixture, not a
//               network value)
//   msg       = 01 | 01 00 01 | 03 | src(32) | dst(32) | sysprog(32×00)
//               | blockhash(32) | 01 | 02 | 02 | 00 01 | 0C
//               | u32LE(2 Transfer) | u64LE(1000)          → 151 bytes
//   tx        = compact-u16(1) || sig(64, RFC 8032 — deterministic)
//               || msg                                    → 216 bytes
//
// If the wire layout, signature encoding or base64 drifts, these pins
// fail. Regenerate only with a documented layout change ( Breaking
// note in the CHANGELOG).
// ---------------------------------------------------------------------------

/** 32-byte blockhash fixture (hex) injected by the golden tests. */
export const X402_GOLDEN_BLOCKHASH_HEX =
  '4685f64b2eea7a114e2f17a199ac9b0ba8eb5b7fb8c9f6c3e2d1a09f8e7d6c5b';

/** Golden payment amount in atomic units (lamports), decimal string. */
export const X402_GOLDEN_AMOUNT = '1000';

/** The unsigned 151-byte legacy message (hex) for the golden inputs. */
export const X402_GOLDEN_MESSAGE_HEX =
  '010100010306047c31eaa9019e64465bf89208ec196a579a05b97c3b2ad68b78de81ccd337de87406a921e4e01c4b3d01e98c10f013331979ab2b42cff92716bebc6fb05fb00000000000000000000000000000000000000000000000000000000000000004685f64b2eea7a114e2f17a199ac9b0ba8eb5b7fb8c9f6c3e2d1a09f8e7d6c5b01020200010c02000000e803000000000000';

/** The signed 216-byte legacy transaction (standard base64). */
export const X402_GOLDEN_TX_BASE64 =
  'AZn7WEQRLv8+zLokNeB0AEWV7b4hvtQilIZhQVsMXki2/FhmkOHQhREdM3bWp1iD7nXyM4pkjTXuR4x4hTHS/Q8BAQABAwYEfDHqqQGeZEZb+JII7BlqV5oFuXw7KtaLeN6BzNM33odAapIeTgHEs9AemMEPATMxl5qytCz/knFr68b7BfsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEaF9ksu6noRTi8XoZmsmwuo61t/uMn2w+LRoJ+OfWxbAQICAAEMAgAAAOgDAAAAAAAA';
