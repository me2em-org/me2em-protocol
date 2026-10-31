// test/signer.spec.ts
//
// Signer abstraction tests (PLAN-LTS-v1 PR-6, tests 5.13; spec
// specs/v1.0.md §8, DR D2).
//
// `Attestation.issue` accepts a `Signer` — an object with `sign(data)` —
// so raw private keys never cross a trust boundary as function
// arguments. `Identity` and `Handle` are the conforming production
// signers; custom implementations are accepted structurally.

import { describe, it, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  Attestation,
  DisposedError,
  Handle,
  Identity,
  type Signer,
} from '../src/index.js';
import { base64urlEncode } from '../src/util.js';
import { createTestHandle, signerFromKey, TEST_SEED } from './test-utils.js';

const grant = { scopes: ['read'], maxSessionTtl: 3600 };
const opts = { jti: 'parity', now: 1700000000, ttlSeconds: 3600 };

describe('5.13.1 — Identity implements Signer', () => {
  it('identity.sign(data) verifies against identity.getPublicKey()', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const data = new TextEncoder().encode('payload');

    const sig = await identity.sign(data);
    expect(sig).toHaveLength(64);
    expect(ed25519.verify(sig, data, identity.getPublicKey())).toBe(true);
  });

  it('Ed25519 determinism: same data → identical signatures', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const data = new Uint8Array([1, 2, 3]);
    expect(await identity.sign(data)).toEqual(await identity.sign(data));
  });
});

describe('5.13.2 — Attestation.issue accepts Identity and Handle as signers', () => {
  it('issue(identity, …) → attestation signed by the root key', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const subjectPub = ed25519.getPublicKey(ed25519.utils.randomPrivateKey());

    const A = await Attestation.issue(identity, subjectPub, 'Station-001', grant);

    expect(await Attestation.verifySignature(A.token, identity.getPublicKey())).toBe(true);
    expect(Attestation.decode(A.token).subjectId).toBe(base64urlEncode(subjectPub));
    expect(Attestation.decode(A.token).subjectName).toBe('station-001');
  });

  it('issue(handle, …) → attestation signed by the handle key (not the root)', async () => {
    const { identity, handle } = await createTestHandle('signer-handle');
    const subjectPub = ed25519.getPublicKey(ed25519.utils.randomPrivateKey());

    const A = await Attestation.issue(handle, subjectPub, 'sub-1', grant);

    expect(await Attestation.verifySignature(A.token, handle.getPublicKey())).toBe(true);
    expect(await Attestation.verifySignature(A.token, identity.getPublicKey())).toBe(false);
  });
});

describe('5.13.3 — attest* passes `this` (byte-parity with manual issue)', () => {
  it('attestHandle token === issue(identity, …) token for the same subject', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const handle = await identity.deriveHandle('station-1');

    const viaApi = await identity.attestHandle('Station-1', grant, opts);
    const viaSigner = await Attestation.issue(
      identity, handle.getPublicKey(), 'Station-1', grant, opts
    );

    expect(viaApi.token).toBe(viaSigner.token);
  });

  it('attestSubHandle token === issue(handle, …) token for the same subject', async () => {
    const { handle } = await createTestHandle('station-1');
    const sub = await handle.deriveSubHandle('connector-1');

    const viaApi = await handle.attestSubHandle('Connector-1', grant, opts);
    const viaSigner = await Attestation.issue(
      handle, sub.getPublicKey(), 'Connector-1', grant, opts
    );

    expect(viaApi.token).toBe(viaSigner.token);
  });
});

describe('5.13.4 — custom structural Signer implementations', () => {
  it('a minimal { sign } object is accepted (open abstraction, spec §8)', async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const remoteSigner: Signer = signerFromKey(raw); // stand-in for an HSM/remote signer
    const subjectPub = ed25519.getPublicKey(ed25519.utils.randomPrivateKey());

    const A = await Attestation.issue(remoteSigner, subjectPub, 'device-1', grant);

    expect(await Attestation.verifySignature(A.token, ed25519.getPublicKey(raw))).toBe(true);
  });
});

describe('5.13.5 — raw private keys are rejected (breaking, §7)', () => {
  it('raw key bytes → TypeError mentioning Signer', async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const subjectPub = ed25519.getPublicKey(ed25519.utils.randomPrivateKey());

    await expect(
      Attestation.issue(raw as unknown as Signer, subjectPub, 'x', grant)
    ).rejects.toThrow(TypeError);
    await expect(
      Attestation.issue(raw as unknown as Signer, subjectPub, 'x', grant)
    ).rejects.toThrow(/Signer/);
  });

  it('null/undefined signer → TypeError', async () => {
    const subjectPub = ed25519.getPublicKey(ed25519.utils.randomPrivateKey());

    await expect(
      Attestation.issue(null as unknown as Signer, subjectPub, 'x', grant)
    ).rejects.toThrow(TypeError);
    await expect(
      Attestation.issue(undefined as unknown as Signer, subjectPub, 'x', grant)
    ).rejects.toThrow(TypeError);
  });

  it('unbound Handle.prototype.sign as a fake signer surfaces the brand-check TypeError', async () => {
    const subjectPub = ed25519.getPublicKey(ed25519.utils.randomPrivateKey());
    const fake = { sign: Handle.prototype.sign } as unknown as Signer;

    await expect(
      Attestation.issue(fake, subjectPub, 'x', grant)
    ).rejects.toThrow(TypeError);
  });
});

describe('5.13.6 — dispose() interacts with the Signer contract', () => {
  it('disposed Identity → DisposedError from sign() and from issue(identity, …)', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const subjectPub = ed25519.getPublicKey(ed25519.utils.randomPrivateKey());
    identity.dispose();

    await expect(identity.sign(new Uint8Array(1))).rejects.toThrow(DisposedError);
    await expect(
      Attestation.issue(identity, subjectPub, 'x', grant)
    ).rejects.toThrow(DisposedError);
  });

  it('disposed Handle → DisposedError from attestSubHandle (issue(this) path)', async () => {
    const { handle } = await createTestHandle('disposed-signer');
    handle.dispose();

    await expect(handle.attestSubHandle('connector-1', grant)).rejects.toThrow(DisposedError);
  });
});
