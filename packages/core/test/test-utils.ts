// Shared test utilities for @me2em/core.
// Not a spec file — vitest picks up only `*.spec.ts`.
import { expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  AttestationError,
  Identity,
  Handle,
  Session,
  type AttestationErrorCode,
  type AttestationLevel,
  type Signer,
} from '../src/index.js';

/** Fixed 64-byte test seed (D1: seed is the full BIP39 seed). */
export const TEST_SEED = new Uint8Array(64).fill(42);

/**
 * Deterministic identity + handle factory for tests.
 * Same name + same seed → same keys, so assertions stay stable.
 */
export async function createTestHandle(
  name = 'test-handle',
  seed: Uint8Array = TEST_SEED
): Promise<{ identity: Identity; handle: Handle }> {
  const identity = await Identity.fromSeed(seed);
  const handle = await identity.deriveHandle(name);
  return { identity, handle };
}

/**
 * Wraps a raw 32-byte private key in a minimal {@link Signer} — the
 * mechanical replacement for the pre-PR-6 raw-key first argument of
 * `Attestation.issue` in tests that exercise signer-agnostic behavior.
 * Production callers pass `Identity` / `Handle` (or a custom `Signer`).
 */
export function signerFromKey(privateKey: Uint8Array): Signer {
  return {
    sign: (data: Uint8Array): Promise<Uint8Array> =>
      ed25519.sign(data, privateKey),
  };
}

/**
 * For async throwers: rejections of async functions (including
 * sync-thrown errors inside their async bodies). Asserts the error is
 * an {@link AttestationError} with the expected `code`/`level`.
 */
export async function expectAttestationError(
  promise: Promise<unknown>,
  code: AttestationErrorCode,
  level: AttestationLevel
): Promise<void> {
  try {
    await promise;
    expect.unreachable('should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(AttestationError);
    expect((e as AttestationError).code).toBe(code);
    expect((e as AttestationError).level).toBe(level);
  }
}

/**
 * For SYNC throwers only (e.g. Attestation.decode). Async functions
 * never throw synchronously — their rejections require
 * {@link expectAttestationError}.
 */
export function expectAttestationErrorSync(
  fn: () => unknown,
  code: AttestationErrorCode,
  level: AttestationLevel
): void {
  try {
    fn();
    expect.unreachable('should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(AttestationError);
    expect((e as AttestationError).code).toBe(code);
    expect((e as AttestationError).level).toBe(level);
  }
}

/**
 * Rebuilds a {@link Session} from already-verified parts via the
 * `@internal` `Session.fromVerified` factory (PR-11, D6): the public
 * constructor is private, and tests reach the internal factory through
 * this helper rather than touching construction directly.
 */
export function sessionFromVerified(
  handleId: string,
  handleName: string,
  audience: string,
  scopes: string[],
  expiresAt: number,
  token: string,
  path?: string[],
  sessionId?: string
): Session {
  return Session.fromVerified(
    handleId,
    handleName,
    audience,
    scopes,
    expiresAt,
    token,
    path,
    sessionId
  );
}

/**
 * Rebuilds a two-part token with a mutated payload, keeping the original
 * signature — the standard way to produce a tampered token in tests.
 */
export function tamperPayload(
  token: string,
  mutate: (payload: Record<string, unknown>) => void
): string {
  const [payloadB64, signatureB64] = token.split('.');
  let base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) base64 += '=';
  const binary = atob(base64);
  const payloadBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    payloadBytes[i] = binary.charCodeAt(i);
  }

  const payload = JSON.parse(
    new TextDecoder().decode(payloadBytes)
  ) as Record<string, unknown>;
  mutate(payload);

  const modifiedBytes = new TextEncoder().encode(JSON.stringify(payload));
  const modifiedB64 = btoa(String.fromCharCode(...modifiedBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${modifiedB64}.${signatureB64}`;
}
