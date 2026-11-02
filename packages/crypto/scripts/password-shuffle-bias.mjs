#!/usr/bin/env node
/**
 * Statistical verification for the F2 + BL-43 fixes (unbiased
 * Fisher-Yates AND unbiased per-class selection / fill in
 * `generateSecurePassword`, `src/validation/password.ts`).
 *
 * NOT part of the CI suite — slow and statistical by nature (see the
 * `randomIntBelow` JSDoc). Run manually:
 *
 *   pnpm --filter @me2em/crypto build
 *   node packages/crypto/scripts/password-shuffle-bias.mjs
 *
 * Method
 * ------
 * Generate 50,000 passwords of MINIMUM length (8). At length 8 every
 * slot is a guaranteed-type slot (2 lower / 2 upper / 2 digit /
 * 2 special — no random-fill slots), so the multiset the fair
 * Fisher-Yates draws position 0 from is exactly known.
 *
 * NULL MODEL — exact distribution of position 0 after BL-43, where
 * EVERY random index (per-class selection, fill, shuffle) comes from
 * the rejection-sampled `randomIntBelow` helper:
 *
 *   P(selection picks class char c) = 1/m,  m = class size   (BL-43)
 *   P(pos0 = c) = 2 · (1/m) / 8                              (fair FY)
 *
 * History: pre-F2 the shuffle reused selection bytes with
 * modulo-biased swap indices; pre-BL-43 the SELECTION step kept
 * modulo-biased byte picks (`bytes[k] % classSize`, ±5% within the
 * 26-char classes), and this script then ran with a
 * selection-corrected null model
 * (`P(pick c) = floor(256/m)/256 + (cIndex < 256 % m ? 1/256 : 0)`)
 * that ABSORBED that known bias so excess χ² isolated the shuffle.
 * With BL-43 the bias is gone, the model collapses to uniform within
 * each class, and the same χ² now guards BOTH the shuffle and the
 * selection path.
 *
 * Verdict: pass if Pearson χ² < 140 on df = 87 (z ≈ 4 above the mean
 * under the uniform-selection null; conservative against false fails)
 * AND the class-level χ² < 16.27 (p = 0.001, df = 3 — class weights
 * are exactly 0.25 each). Exit 0 — pass; exit 1 — distribution
 * suspect: re-check after ANY change to the shuffle or selection
 * path before shipping.
 *
 * Power note: residual defects below the noise floor of 50k samples
 * (e.g. a single-count skew of a few units) are not detectable — this
 * script is a regression guard for gross distribution errors, not a
 * proof of perfect uniformity. The unbiasedness of `randomIntBelow`
 * itself follows from the rejection construction: accepted 32-bit
 * values form an exactly divisible range, so every residue mod n is
 * equiprobable.
 */
import { generateSecurePassword } from '../dist/index.js';

const SAMPLES = 50_000;

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SPECIAL = '!@#$%^&*()_+-=[]{}|;:,.<>?';

// Null model (BL-43): selection is rejection-sampled — uniform within
// each class — so a class char c (class size m) lands at position 0
// with probability 2 · (1/m) / 8 under a fair Fisher-Yates.
function expectedProb(char) {
  if (LOWER.includes(char)) return (2 / LOWER.length) / 8;
  if (UPPER.includes(char)) return (2 / UPPER.length) / 8;
  if (DIGITS.includes(char)) return (2 / DIGITS.length) / 8;
  if (SPECIAL.includes(char)) return (2 / SPECIAL.length) / 8;
  throw new Error(`Unexpected char in output: ${char}`);
}

function chiSquare(observed, expected) {
  let chi = 0;
  for (let k = 0; k < observed.length; k++) {
    const diff = observed[k] - expected[k];
    chi += (diff * diff) / expected[k];
  }
  return chi;
}

const chars = [...(LOWER + UPPER + DIGITS + SPECIAL)];
const counts = new Map(chars.map((c) => [c, 0]));

for (let i = 0; i < SAMPLES; i++) {
  const pw = generateSecurePassword(8);
  const first = pw[0];
  if (!counts.has(first)) {
    console.error(`FAIL: position 0 produced an out-of-charset char: ${JSON.stringify(first)}`);
    process.exit(1);
  }
  counts.set(first, counts.get(first) + 1);
}

const observed = chars.map((c) => counts.get(c));
const expected = chars.map((c) => SAMPLES * expectedProb(c));

const chi = chiSquare(observed, expected);
const DF = chars.length - 1; // 88 chars → df = 87
const CRITICAL = 140; // z ≈ 4 above E[χ²] = df under the corrected null

// Class-level summary: each class owns exactly 0.25 of position 0
// (two guaranteed slots of eight) — independent of within-class
// selection probabilities, so this check needs no correction.
const classes = {
  lower: { count: 0 },
  upper: { count: 0 },
  digit: { count: 0 },
  special: { count: 0 },
};
for (const c of chars) {
  if (LOWER.includes(c)) classes.lower.count += counts.get(c);
  else if (UPPER.includes(c)) classes.upper.count += counts.get(c);
  else if (DIGITS.includes(c)) classes.digit.count += counts.get(c);
  else classes.special.count += counts.get(c);
}
const classChi = Object.values(classes).reduce((acc, cls) => {
  const exp = SAMPLES / 4;
  const d = cls.count - exp;
  return acc + (d * d) / exp;
}, 0);

console.log(`samples               : ${SAMPLES} (length 8)`);
console.log(`charset cells         : ${chars.length} (df = ${DF})`);
console.log(`null model            : uniform selection (BL-43) + fair FY (F2)`);
console.log(`chi-square (per char) : ${chi.toFixed(2)}  | critical ${CRITICAL}`);
console.log(`chi-square (per class): ${classChi.toFixed(2)}  | critical 16.27 (p=0.001, df=3)`);
for (const [name, cls] of Object.entries(classes)) {
  const exp = SAMPLES / 4;
  console.log(
    `  ${name.padEnd(8)}: observed ${cls.count}  expected ${exp.toFixed(0)}  ` +
      `(${((cls.count / SAMPLES) * 100).toFixed(2)}%)`
  );
}
const min = Math.min(...observed);
const max = Math.max(...observed);
console.log(`per-char counts min/max: ${min} / ${max}`);

if (chi >= CRITICAL || classChi >= 16.27) {
  console.error('FAIL: password distribution suspect — investigate before shipping.');
  process.exit(1);
}
console.log('PASS: distribution consistent with unbiased selection (BL-43) + unbiased shuffle (F2).');
