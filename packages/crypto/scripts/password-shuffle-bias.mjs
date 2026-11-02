#!/usr/bin/env node
/**
 * Statistical verification for the F2 fix (unbiased Fisher-Yates in
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
 * The NULL MODEL below is the exact distribution of position 0 for a
 * FAIR shuffle on top of the CURRENT selection step, which uses
 * modulo-biased byte picks (`bytes[k] % classSize` — deliberately NOT
 * touched by F2; F2 scope is the shuffle only):
 *
 *   P(byte pick selects class char c) =
 *       floor(256/m)/256 + (cIndex < 256 % m ? 1/256 : 0),  m = class size
 *   P(pos0 = c) = 2 · P(pick c) / 8            (two class slots, fair FY)
 *
 * (The original ТЗ sketch assumed a uniform distribution over the
 * whole charset — statistically wrong twice: the charset is 88 chars,
 * not 94, and length-8 class weights are 0.25 each regardless of
 * within-class selection probabilities. A naive uniform test at 50k
 * samples partly detects the KNOWN selection bias and flakes at the
 * ~p=0.001 boundary — χ² ≈ 130 on df = 87 was observed against the
 * uniform model. The selection-corrected model below has
 * E[χ²] = df exactly, so excess χ² measures SHUFFLE fairness, which
 * is what F2 changed.)
 *
 * Verdict: pass if Pearson χ² < 140 on df = 87 (z ≈ 4 above the mean
 * under the corrected null; conservative against false fails) AND the
 * class-level χ² < 16.27 (p = 0.001, df = 3 — class weights are
 * exactly 0.25 each and selection-bias-immune). Exit 0 — pass;
 * exit 1 — distribution suspect: re-check after ANY change to the
 * shuffle or selection path before shipping.
 *
 * Power note: the pre-fix shuffle defects (modulo-biased swap indices
 * + reuse of the selection bytes) are largely BELOW the noise floor
 * of 50k samples — this script is a regression guard for gross
 * distribution errors, not a proof of perfect uniformity. The
 * unbiasedness of `randomIntBelow` itself follows from the rejection
 * construction: accepted 32-bit values form an exactly divisible
 * range, so every residue mod n is equiprobable.
 *
 * KNOWN RESIDUAL ISSUE (out of F2 scope, flagged to the architect):
 * the char-SELECTION step (`bytes[k] % classSize` for the guaranteed
 * slots and `bytes[i] % all.length` for the fill) is still
 * modulo-biased (±5% within lower/upper/special at 26-char classes).
 * The null model below absorbs it; fixing it would be a separate
 * decision (reuse `randomIntBelow` for selection/fill).
 */
import { generateSecurePassword } from '../dist/index.js';

const SAMPLES = 50_000;

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SPECIAL = '!@#$%^&*()_+-=[]{}|;:,.<>?';

// Exact selection probability for a class char at byte-index residue
// r: byte % m favors residues 0..(256 % m - 1).
function selectionProb(char, classStr) {
  const m = classStr.length;
  const base = Math.floor(256 / m);
  const r = classStr.indexOf(char);
  if (r < 0) return 0;
  return base / 256 + (r < 256 % m ? 1 / 256 : 0);
}

// Null model: P(pos0 = c) = 2 · selectionProb(c) / 8 under a fair
// Fisher-Yates over the length-8 guaranteed-slot multiset.
function expectedProb(char) {
  if (LOWER.includes(char) || UPPER.includes(char)) {
    return (2 * selectionProb(char, LOWER.includes(char) ? LOWER : UPPER)) / 8;
  }
  if (DIGITS.includes(char)) return (2 * selectionProb(char, DIGITS)) / 8;
  if (SPECIAL.includes(char)) return (2 * selectionProb(char, SPECIAL)) / 8;
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
// (two guaranteed slots of eight) — immune to within-class selection
// bias, so this check needs no correction.
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
console.log(`null model            : selection-corrected (see header)`);
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
  console.error('FAIL: shuffle distribution suspect — investigate before shipping.');
  process.exit(1);
}
console.log('PASS: shuffle distribution consistent with the unbiased-shuffle model.');
