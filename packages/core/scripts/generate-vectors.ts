// packages/core/scripts/generate-vectors.ts
//
// Regenerates specs/test-vectors.json — the real, machine-verified test
// vectors for the Me2eM core protocol (PLAN-LTS-v1.md PR-3, tasks
// 0.1.1–0.1.3, BL-20/BL-21).
//
// Every value is computed through the PUBLIC runtime API of @me2em/core
// (built dist), so the vectors are by construction a golden snapshot of
// the current implementation. The golden test
// `packages/core/test/vectors.spec.ts` re-computes every row and fails on
// any deviation.
//
// Determinism:
// - Ed25519 (RFC 8032) is deterministic: same key + same message → same
//   signature.
// - Attestation.issue is byte-deterministic when `jti`, `now` and
//   `ttlSeconds`/`expiresAt` are pinned.
// - Session.create stamps `iat` from the wall clock (no `now` option), so
//   session vectors pin the payload bytes explicitly and sign them via
//   `Handle.sign` — reproducible without wall-clock dependence.
//
// Usage:
//   corepack pnpm --filter @me2em/core vectors
//   (equivalent to: tsc -p tsconfig.json && node scripts/generate-vectors.ts)

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Identity, get64ByteSeedFromMnemonic } from '../dist/index.js';
import { base64urlEncode } from '../dist/util.js';

// Fixed BIP39 vectors (cross-verified against an independent PBKDF2
// implementation before hardcoding — see test/seed.spec.ts).
const MNEMONIC_12 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_24 = `${'abandon '.repeat(23)}art`;

/** 2026-01-01T00:00:00Z — fixed clock for all token vectors. */
const NOW = 1767225600;
const SESSION_TTL = 1800;

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

// ---------------------------------------------------------------------------
// Seed & identity
// ---------------------------------------------------------------------------
const seed12 = await get64ByteSeedFromMnemonic(MNEMONIC_12);
const seed24 = await get64ByteSeedFromMnemonic(MNEMONIC_24);
const seed12Hex = hex(seed12);

const identity = await Identity.fromSeed(seed12);
const rootPubHex = hex(identity.getPublicKey());

// ---------------------------------------------------------------------------
// Handles & secrets
// ---------------------------------------------------------------------------
const work = await identity.deriveHandle('work');
const personal = await identity.deriveHandle('personal');
const connector = await work.deriveSubHandle('connector-1');

// ---------------------------------------------------------------------------
// Attestations (byte-deterministic: pinned jti + now + ttlSeconds)
// ---------------------------------------------------------------------------
const grantA = {
  audiences: ['ev-app.com'],
  scopes: ['charge:start', 'charge:stop'],
  maxSessionTtl: 7200,
  subNamePatterns: ['connector-*'],
};
const A = await identity.attestHandle('work', grantA, {
  ttlSeconds: 31536000,
  jti: 'vector-a-handle-0001',
  now: NOW,
});

const grantB = {
  audiences: ['ev-app.com'],
  scopes: ['charge:start'],
  maxSessionTtl: 3600,
};
const B = await work.attestSubHandle('connector-1', grantB, {
  ttlSeconds: 1800,
  jti: 'vector-b-subhandle-0001',
  now: NOW,
});

// ---------------------------------------------------------------------------
// Session tokens (pinned payloads, signed through the public Handle API)
// ---------------------------------------------------------------------------
async function buildSessionToken(
  payload: Record<string, unknown>,
  sign: (data: Uint8Array) => Promise<Uint8Array>
): Promise<{ payloadJson: string; token: string }> {
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const sig = await sign(payloadBytes);
  return { payloadJson, token: `${base64urlEncode(payloadBytes)}.${base64urlEncode(sig)}` };
}

const handleSession = await buildSessionToken({
  hId: work.getId(),
  hNm: 'work',
  aud: 'ev-app.com',
  scp: ['charge:start'],
  exp: NOW + SESSION_TTL,
  iat: NOW,
  jti: 'vector-session-handle-0001',
}, (data) => work.sign(data));

// Field order mirrors Session.create: hPath is appended after the base
// fields (see session.ts SessionPayload construction).
const subSession = await buildSessionToken({
  hId: connector.getId(),
  hNm: 'connector-1',
  aud: 'ev-app.com',
  scp: ['charge:start'],
  exp: NOW + SESSION_TTL,
  iat: NOW,
  jti: 'vector-session-subhandle-0001',
  hPath: ['work', 'connector-1'],
}, (data) => connector.sign(data));

// ---------------------------------------------------------------------------
// Assemble the vector file
// ---------------------------------------------------------------------------
const vectors = {
  seed: [
    {
      description: 'BIP39 official vector: 12 words, empty passphrase → 64-byte seed',
      mnemonic: MNEMONIC_12,
      passphrase: '',
      expected_seed_hex: seed12Hex,
    },
    {
      description: 'BIP39 vector: 24 words, empty passphrase → 64-byte seed (same length as 12 words)',
      mnemonic: MNEMONIC_24,
      passphrase: '',
      expected_seed_hex: hex(seed24),
    },
  ],
  identity_derivation: [
    {
      description: 'Root identity key: HKDF-SHA256(ikm=seed64, salt=empty, info="me2em/identity/v1/root", L=32)',
      seed_hex: seed12Hex,
      expected_public_key_hex: rootPubHex,
    },
  ],
  handle_derivation: [
    {
      description: 'Handle key: HKDF-SHA256(ikm=rootPriv, salt=empty, info="me2em/handle/v1/work", L=32)',
      seed_hex: seed12Hex,
      handle_name: 'work',
      expected_public_key_hex: hex(work.getPublicKey()),
      expected_id_b64url: work.getId(),
    },
    {
      description: 'Different name → unrelated key (same identity)',
      seed_hex: seed12Hex,
      handle_name: 'personal',
      expected_public_key_hex: hex(personal.getPublicKey()),
      expected_id_b64url: personal.getId(),
    },
  ],
  subhandle_derivation: [
    {
      description: 'SubHandle key: HKDF-SHA256(ikm=handlePriv, salt=empty, info="me2em/subhandle/v1/work/connector-1", L=32)',
      seed_hex: seed12Hex,
      handle_name: 'work',
      sub_name: 'connector-1',
      expected_public_key_hex: hex(connector.getPublicKey()),
      expected_id_b64url: connector.getId(),
    },
  ],
  derive_password: [
    {
      description: 'Default length 16: HKDF-SHA256(ikm=handlePriv, salt="me2em/secret/github", info="me2em/secret/v1", L=16) → base64url',
      seed_hex: seed12Hex,
      handle_name: 'work',
      context: 'github',
      length: 16,
      expected_b64url: work.derivePassword('github'),
    },
    {
      description: 'Explicit length 32',
      seed_hex: seed12Hex,
      handle_name: 'work',
      context: 'github',
      length: 32,
      expected_b64url: work.derivePassword('github', 32),
    },
    {
      description: 'Context canonicalization: lowercase + trim → identical to "github"',
      seed_hex: seed12Hex,
      handle_name: 'work',
      context: '  GitHub ',
      length: 16,
      expected_b64url: work.derivePassword('  GitHub '),
    },
  ],
  derive_channel_key: [
    {
      description: 'Channel key: HKDF-SHA256(ikm=handlePriv, salt="me2em/channel/telemetry-v1", info="me2em/channel/v1", L=32)',
      seed_hex: seed12Hex,
      handle_name: 'work',
      context: 'telemetry-v1',
      expected_key_hex: hex(work.deriveChannelKey('telemetry-v1')),
    },
  ],
  derive_shared_secret: [
    {
      description: 'X25519 (Ed25519→Montgomery) + HKDF-SHA256(ikm=rawECDH, salt=sorted(64B both public keys), info="me2em/p2p-channel/v2", L=32)',
      seed_hex: seed12Hex,
      handle_name_a: 'work',
      handle_name_b: 'personal',
      expected_secret_hex: hex(await work.deriveSharedSecret(personal.getPublicKey())),
    },
  ],
  attestation_handle: [
    {
      description: 'Root→Handle attestation; byte-deterministic given (grant, ttlSeconds, jti, now)',
      seed_hex: seed12Hex,
      subject_handle_name: 'work',
      grant: grantA,
      ttl_seconds: 31536000,
      now: NOW,
      jti: 'vector-a-handle-0001',
      expected_payload_json: JSON.stringify(A.payload),
      expected_token: A.token,
    },
  ],
  attestation_subhandle: [
    {
      description: 'Handle→SubHandle attestation signed by the Handle key (chain level 2)',
      seed_hex: seed12Hex,
      subject_handle_name: 'work',
      subject_sub_name: 'connector-1',
      grant: grantB,
      ttl_seconds: 1800,
      now: NOW,
      jti: 'vector-b-subhandle-0001',
      expected_payload_json: JSON.stringify(B.payload),
      expected_token: B.token,
    },
  ],
  session_handle: [
    {
      description: 'Handle session token; payload pinned (Session.create stamps iat from the wall clock). Ed25519 over the exact payload bytes',
      seed_hex: seed12Hex,
      handle_name: 'work',
      audience: 'ev-app.com',
      scopes: ['charge:start'],
      ttl: SESSION_TTL,
      iat: NOW,
      jti: 'vector-session-handle-0001',
      expected_payload_json: handleSession.payloadJson,
      expected_token: handleSession.token,
    },
  ],
  session_subhandle: [
    {
      description: 'SubHandle session token; hPath appended after base fields (normative key order)',
      seed_hex: seed12Hex,
      handle_name: 'work',
      sub_name: 'connector-1',
      audience: 'ev-app.com',
      scopes: ['charge:start'],
      ttl: SESSION_TTL,
      iat: NOW,
      jti: 'vector-session-subhandle-0001',
      expected_payload_json: subSession.payloadJson,
      expected_token: subSession.token,
    },
  ],
};

const output = {
  spec: 'Me2eM core protocol',
  spec_version: '1.0',
  vector_file_version: 1,
  algorithm: 'BIP39 (seed) + HKDF-SHA256 (RFC 5869, derivation) + Ed25519 (RFC 8032, signatures) + X25519 (RFC 7748, ECDH)',
  notes: [
    'All derived keys are 32 bytes and used directly as Ed25519 seeds (RFC 8032).',
    'Base64URL is unpadded (RFC 4648 §5); ids are base64url of the 32-byte public key.',
    'Attestation tokens are byte-deterministic given (grant, ttlSeconds, jti, now).',
    'Session tokens: iat/exp come from the issuer clock at creation time; vectors pin the payload bytes and reproduce the signature via Ed25519 over those bytes.',
    'Fixed clock NOW = 1767225600 = 2026-01-01T00:00:00Z.',
  ],
  vectors,
};

const target = fileURLToPath(new URL('../../../specs/test-vectors.json', import.meta.url));
writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
console.log(`Wrote ${target}`);
console.log(`Categories: ${Object.keys(vectors).join(', ')}`);
