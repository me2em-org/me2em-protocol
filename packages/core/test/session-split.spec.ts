// session-split.spec.ts
//
// PR-11 (core/session-split) — pins for the new Session construction
// surface and the single-normalization attestation issuers:
//   D6/3.5 — the `Session` constructor is private; the only sanctioned
//           reconstruction point is the `@internal`
//           `Session.fromVerified` factory (tests reach it via
//           test-utils). `Session.create` / `Session.verify*` remain
//           the public surface.
//   3.4    — `verifyAttested` is split into five private stages with
//           check order, error codes and levels byte-identical to the
//           pre-split monolith; that property is pinned by the UNTOUCHED
//           attested-session / error-table / fuzz suites (28+8+4
//           `verifyAttested` references). This file pins what those
//           cannot: the fromVerified reconstruction contract.
//   3.6    — `attestSubHandle` / `attestHandle` canonicalize the subject
//           name exactly once (the derive* call already normalizes;
//           `Attestation.issue` keeps its own defensive pass).
//   3.5    — `MAX_DEPTH_EXCEEDED` override (SubHandle leaf) is preserved
//           from earlier PRs; pinned here against regression.

import { describe, it, expect } from 'vitest';
import { Identity, Session } from '../src/index.js';
import {
  TEST_SEED,
  createTestHandle,
  sessionFromVerified,
  expectAttestationError,
} from './test-utils.js';

describe('PR-11 — Session construction surface (D6/3.5)', () => {
  it('fromVerified rebuilds a session with identical public fields', async () => {
    const { handle } = await createTestHandle('work');
    const original = await Session.create(handle, {
      audience: 'app.example.com',
      scopes: ['read', 'write'],
      ttl: 3600,
      sessionId: 'fixed-jti-1',
    });

    const rebuilt = sessionFromVerified(
      original.handleId,
      original.handleName,
      original.audience,
      original.scopes,
      original.expiresAt,
      original.token,
      original.path,
      original.sessionId
    );

    expect(rebuilt.token).toBe(original.token);
    expect(rebuilt.handleId).toBe(original.handleId);
    expect(rebuilt.handleName).toBe(original.handleName);
    expect(rebuilt.audience).toBe(original.audience);
    expect(rebuilt.scopes).toEqual(original.scopes);
    expect(rebuilt.expiresAt).toBe(original.expiresAt);
    expect(rebuilt.sessionId).toBe(original.sessionId);
    expect(rebuilt.isExpired()).toBe(false);
  });

  it('fromVerified carries the SubHandle derivation path', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const handle = await identity.deriveHandle('station-001');
    const sub = await handle.deriveSubHandle('connector-1');
    const original = await Session.create(sub, {
      audience: 'ev-app.com',
      scopes: ['charge:start'],
      ttl: 1800,
    });

    const rebuilt = sessionFromVerified(
      original.handleId,
      original.handleName,
      original.audience,
      original.scopes,
      original.expiresAt,
      original.token,
      original.path,
      original.sessionId
    );
    expect(rebuilt.path).toEqual(['station-001', 'connector-1']);
    expect(rebuilt.isExpired()).toBe(false);
  });

  it('MAX_DEPTH_EXCEEDED: a SubHandle remains a leaf (override preserved)', async () => {
    const { handle } = await createTestHandle('station-001');
    const sub = await handle.deriveSubHandle('connector-1');
    await expectAttestationError(
      sub.deriveSubHandle('deeper'),
      'MAX_DEPTH_EXCEEDED',
      'FORMAT'
    );
  });
});

describe('PR-11 — attestation issuers normalize exactly once (3.6)', () => {
  it('attestSubHandle canonicalizes a non-canonical subName (single pass)', async () => {
    const { handle } = await createTestHandle('station-001');
    const attestation = await handle.attestSubHandle('  Connector-1 ', {
      audiences: ['ev-app.com'],
      scopes: ['charge:start'],
      maxSessionTtl: 1800,
    });
    // The subject name is the canonical form — the same one the derive*
    // call produced — so a noisy caller cannot mint a second identity.
    expect(attestation.payload.subjectName).toBe('connector-1');
  });

  it('attestHandle canonicalizes a non-canonical name (single pass)', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const attestation = await identity.attestHandle('  Station-001 ', {
      audiences: ['ev-app.com'],
      scopes: ['read'],
      maxSessionTtl: 3600,
    });
    expect(attestation.payload.subjectName).toBe('station-001');
  });

  it('issuer names stay consistent with the derived keys they attest', async () => {
    // The attestation must bind the key that
    // identity.deriveSubHandle(handleName, subName) reconstructs —
    // the property the double normalization used to obscure.
    const identity = await Identity.fromSeed(TEST_SEED);
    const handle = await identity.deriveHandle('  Station-001 ');
    const attestation = await handle.attestSubHandle('  Connector-1 ', {
      audiences: ['ev-app.com'],
      scopes: ['charge:start'],
      maxSessionTtl: 1800,
    });

    const reconstructed = await identity.deriveSubHandle('station-001', 'connector-1');
    expect(attestation.payload.subjectId).toBe(reconstructed.getId());
    expect(attestation.payload.subjectName).toBe('connector-1');
    expect(attestation.payload.subjectName).toBe(reconstructed.getName());
  });
});
