#!/usr/bin/env node
/**
 * Empirical base for the UAX #15 byte-identity pin in
 * packages/core/test/seed.spec.ts ("passphrase bytes identical with or
 * without pre-NFKC") and for the fixlog П.1 record.
 *
 * Claim: NFKD(NFKC(x)) === NFKD(x) for all strings (UAX #15), so an
 * explicit NFKC pre-normalization of the BIP39 passphrase is
 * byte-redundant — the BIP39 layer normalizes (NFKD) the whole salt
 * per the standard. If any check below ever reports a mismatch, the
 * pin in seed.spec.ts fails and an explicit normalization decision is
 * required instead of a silent derivation change.
 *
 * All checks are deterministic (no Math.random; the fuzz section uses
 * a fixed-seed LCG):
 *   1. end-to-end — @scure/bip39 seed bytes identical with and without
 *      pre-NFKC on a 14-case compatibility-form matrix;
 *   2. single-codepoint sweep — every Unicode scalar value
 *      (0x110000 minus 2,048 surrogates = 1,112,064 codepoints);
 *   3. starter + combining-mark pairs — 7 starters x 112 combining
 *      marks (U+0300..U+036F) = 784 pairs;
 *   4. seeded fuzz — 200,000 multi-char rows built from a
 *      compatibility-form-heavy pool, plus an NFKD idempotence check
 *      on every row.
 *
 * Run: node packages/core/scripts/nfkd-redundancy-check.mjs
 * Exit 0 — zero mismatches everywhere; exit 1 — pin busted.
 */
import { createRequire } from 'module';

const require = createRequire(new URL('../package.json', import.meta.url));
const { mnemonicToSeedSync } = require('@scure/bip39');

const M12 =
  'abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon about';

const toHex = (bytes) => Buffer.from(bytes).toString('hex');
const seedSame = (a, b) => toHex(a) === toHex(b);

let failures = 0;

// 1) End-to-end: BIP39 seed bytes with pre-NFKC passphrase vs as-is.
//    Both must be identical for every compatibility form — the NFKD
//    the BIP39 layer applies subsumes the explicit NFKC step.
const endToEndCases = {
  'precomposed e-acute (U+00E9)': 'caf\u00E9',
  'decomposed e-acute (e + U+0301)': 'cafe\u0301',
  'ligature fi (U+FB01)': '\uFB01le',
  'plain file': 'file',
  'Angstrom sign (U+212B)': '\u212Bx',
  'Angstrom letter (U+00C5)': '\u00C5x',
  'A + combining ring': 'A\u030Ax',
  'hangul precomposed': '\uAC00\uB0C8\uB2E4',
  'hangul jamo': '\u1100\u1161\u11AB',
  'fullwidth TREZOR': '\uFF34\uFF32\uFF25\uFF3A\uFF2F\uFF32',
  'circled one (U+2460)': '\u2460le',
  'ligature ff + combining': '\uFB00e\u0301',
  'Greek dialytika tonos (U+0344)': 'a\u0344b',
  'leading combining mark': '\u0301abc',
};
let e2eBad = 0;
for (const [name, p] of Object.entries(endToEndCases)) {
  const preNfkc = mnemonicToSeedSync(M12, p.normalize('NFKC'));
  const asIs = mnemonicToSeedSync(M12, p);
  if (!seedSame(preNfkc, asIs)) {
    e2eBad++;
    console.log(`1) END-TO-END MISMATCH: ${name}`);
  }
}
failures += e2eBad;
console.log(
  `1) end-to-end seed identity (pre-NFKC vs as-is): ` +
    `${Object.keys(endToEndCases).length - e2eBad}/${Object.keys(endToEndCases).length} SAME`
);

// 2) Single-codepoint sweep: NFKD(NFKC(s)) === NFKD(s) for every
//    Unicode scalar value.
let sweepN = 0;
let sweepBad = 0;
for (let cp = 0; cp <= 0x10ffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue; // surrogates are not scalars
  const s = String.fromCodePoint(cp);
  sweepN++;
  if (s.normalize('NFKD') !== s.normalize('NFKC').normalize('NFKD')) {
    sweepBad++;
    if (sweepBad <= 5) {
      console.log(`2) CODEPOINT MISMATCH U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
    }
  }
}
failures += sweepBad;
console.log(`2) single-codepoint sweep: ${sweepN} cps, ${sweepBad} mismatches`);

// 3) Starter + combining-mark pairs: NFKC composition must stay
//    transparent to the subsequent NFKD.
const starters = ['e', '\uFB01', '\uFB02', '\u00E9', 'q', '\u01C0', '\uAC00'];
let pairN = 0;
let pairBad = 0;
for (const base of starters) {
  for (let cp = 0x0300; cp <= 0x036f; cp++) {
    const s = base + String.fromCodePoint(cp);
    pairN++;
    if (s.normalize('NFKD') !== s.normalize('NFKC').normalize('NFKD')) pairBad++;
  }
}
failures += pairBad;
console.log(`3) pair sweep: ${pairN} pairs, ${pairBad} mismatches`);

// 4) Seeded fuzz over multi-char strings (LCG, fixed seed 0x2f6e2b1):
//    NFKD(NFKC(x)) === NFKD(x) and NFKD idempotence on every row.
let lcgState = 0x2f6e2b1;
const rnd = () => {
  lcgState = (lcgState * 1664525 + 1013904223) >>> 0;
  return lcgState / 2 ** 32;
};
const pool = [
  0x0041, 0x0065, 0x0301, 0x0308, 0x0327, 0x00e9, 0x00c5, 0x212b, 0xfb01,
  0xfb02, 0x2460, 0x0344, 0x1100, 0x1161, 0xac00, 0xff21, 0x3099, 0x309a,
  0x05b0, 0x093f, 0x0654,
];
const FUZZ_ROWS = 200000;
let fuzzBad = 0;
let idempotenceBad = 0;
for (let i = 0; i < FUZZ_ROWS; i++) {
  const len = 1 + Math.floor(rnd() * 8);
  let s = '';
  for (let j = 0; j < len; j++) {
    s += String.fromCodePoint(pool[Math.floor(rnd() * pool.length)]);
  }
  if (s.normalize('NFKD') !== s.normalize('NFKC').normalize('NFKD')) fuzzBad++;
  if (s.normalize('NFKD') !== s.normalize('NFKD').normalize('NFKD')) idempotenceBad++;
}
failures += fuzzBad + idempotenceBad;
console.log(`4) fuzz ${FUZZ_ROWS} strings: ${fuzzBad} mismatches, ` +
  `${idempotenceBad} NFKD-idempotence violations`);

console.log(
  failures === 0
    ? 'OK — zero mismatches everywhere; explicit NFKC pre-normalization is byte-redundant'
    : `FAIL — ${failures} mismatch(es); normalization decision required`
);
process.exit(failures === 0 ? 0 : 1);
