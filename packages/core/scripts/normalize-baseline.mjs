#!/usr/bin/env node
// Rewrites absolute `filepath` fields in bench/baseline.json to paths
// relative to the package root (packages/core).
//
// `vitest bench --outputJson` emits the runner machine's absolute path;
// a committed baseline must stay machine-independent. Matching for
// `vitest bench --compare` is by task name/fullName, not by filepath,
// so normalization is behavior-neutral (verified empirically: all
// benchmarks still match their baseline pairs after the rewrite).
//
// The rewrite is text-surgical (regex over the raw file, not a
// JSON.parse → stringify roundtrip) so the emitted vitest formatting
// stays byte-identical outside the replaced spans.
//
// Hooked into `bench:baseline` — future regenerations are normalized
// automatically.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const baselinePath = join(pkgRoot, 'bench', 'baseline.json');

const raw = readFileSync(baselinePath, 'utf8');

let replaced = 0;
const out = raw.replace(/("filepath"\s*:\s*")([^"]+)(")/g, (match, pre, value, post) => {
  if (!isAbsolute(value)) return match;
  replaced++;
  return pre + relative(pkgRoot, value).replaceAll('\\', '/') + post;
});

if (replaced === 0) {
  console.log('normalize-baseline: no absolute filepath fields — nothing to do');
} else {
  writeFileSync(baselinePath, out);
  console.log(`normalize-baseline: rewrote ${replaced} absolute filepath field(s) to package-relative paths`);
}
