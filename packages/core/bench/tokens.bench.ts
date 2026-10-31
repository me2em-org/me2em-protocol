// Token benchmarks — issuance and full verification chain (the LTS
// performance contract). Baseline: pnpm bench:baseline
// (bench/baseline.json, captured before Stage 1 per PLAN-LTS PR-4).
import { bench, describe } from 'vitest';
import { Attestation, Session } from '../src/index.js';
import { createTestHandle } from '../test/test-utils.js';

const { identity, handle } = await createTestHandle('bench-handle');
const grant = { scopes: ['read'], maxSessionTtl: 3600 };
const attestation = await Attestation.issue(
  identity,
  handle.getPublicKey(),
  'bench-handle',
  grant
);
const session = await Session.create(handle, {
  audience: 'bench-app',
  scopes: ['read'],
  ttl: 3600,
});

describe('tokens', () => {
  bench('Attestation.issue', async () => {
    await Attestation.issue(
      identity,
      handle.getPublicKey(),
      'bench-handle',
      grant
    );
  });

  bench('Attestation.decode', () => {
    Attestation.decode(attestation.token);
  });

  bench('Session.create', async () => {
    await Session.create(handle, {
      audience: 'bench-app',
      scopes: ['read'],
      ttl: 3600,
    });
  });

  bench('Session.verifyStateless (full chain)', async () => {
    await Session.verifyStateless(session.token, identity, 'bench-app');
  });
});
