// Derivation benchmarks — LTS risk path (PR-5/6/7/8 touch these).
// Baseline: pnpm bench:baseline (bench/baseline.json, captured before
// Stage 1 per PLAN-LTS PR-4). Compare later runs: vitest bench --compare.
import { bench, describe } from 'vitest';
import { Identity } from '../src/index.js';
import { TEST_SEED } from '../test/test-utils.js';

const identity = await Identity.fromSeed(TEST_SEED);
const handle = await identity.deriveHandle('bench-handle');

describe('derivation', () => {
  bench('Identity.fromSeed (64B)', async () => {
    await Identity.fromSeed(TEST_SEED);
  });

  bench('Identity.deriveHandle', async () => {
    await identity.deriveHandle('bench-handle');
  });

  bench('Identity.deriveSubHandle (atomic)', async () => {
    await identity.deriveSubHandle('bench-handle', 'bench-sub');
  });

  bench('Handle.deriveSubHandle (two-step)', async () => {
    await handle.deriveSubHandle('bench-sub');
  });

  bench('Handle.derivePassword (16)', () => {
    handle.derivePassword('bench-context', { byteLength: 16 });
  });

  bench('Handle.deriveChannelKey', () => {
    handle.deriveChannelKey('bench-channel');
  });
});
