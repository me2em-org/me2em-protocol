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

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { base58 } from '@scure/base';
import { Attestation, Identity, get64ByteSeedFromMnemonic } from '../dist/index.js';
import { base64urlEncode } from '../dist/util.js';

// Fixed BIP39 vectors (cross-verified against an independent PBKDF2
// implementation before hardcoding — see test/seed.spec.ts).
const MNEMONIC_12 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_24 = `${'abandon '.repeat(23)}art`;

/** 2026-01-01T00:00:00Z — fixed clock for all token vectors. */
const NOW = 1767225600;
const SESSION_TTL = 1800;

/** Canonical resource id in the examples: sha256-hex of the empty content. */
const RESOURCE_ID_HASH =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

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

// v1 optional extensions (specs/v1.0.md §5.1): wallet fields in canonical
// order. The address is an ILLUSTRATIVE valid-format address — base58 of
// the subject Handle's public key (32-byte ed25519 → base58), NOT a
// wallet actually derived from subjectWalletPath (the Handle key comes
// from HKDF, not the SLIP tree); real path→address derivation is pinned
// by @me2em/solana tests (Phantom cross-check). No adapter is registered
// in the generator context, so only the structural checks apply — the
// description states this honestly.
const W = await Attestation.issue(identity, work.getPublicKey(), 'work', grantA, {
  ttlSeconds: 31536000,
  jti: 'vector-a-handle-wallet-0001',
  now: NOW,
  subjectWallet: base58.encode(work.getPublicKey()),
  subjectWalletChain: 'solana:mainnet-beta',
  subjectWalletPath: "m/44'/501'/0'/0'",
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
  sid: 'vector-sid-handle-0001',
}, (data) => work.sign(data));

// Field order mirrors Session.create: sid follows jti as a base field,
// hPath is appended after the base fields (see session.ts SessionPayload
// construction).
const subSession = await buildSessionToken({
  hId: connector.getId(),
  hNm: 'connector-1',
  aud: 'ev-app.com',
  scp: ['charge:start'],
  exp: NOW + SESSION_TTL,
  iat: NOW,
  jti: 'vector-session-subhandle-0001',
  sid: 'vector-sid-subhandle-0001',
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
      expected_b64url: work.derivePassword('github', { byteLength: 32 }),
    },
    {
      description: 'Context canonicalization: NFKC + lowercase + trim → identical to "github"',
      seed_hex: seed12Hex,
      handle_name: 'work',
      context: '  GitHub ',
      length: 16,
      expected_b64url: work.derivePassword('  GitHub '),
    },
    {
      description: 'NFKC: fullwidth ＧitHub (U+FF27) canonicalizes to "github" — identical secret',
      seed_hex: seed12Hex,
      handle_name: 'work',
      context: 'ＧitHub',
      length: 16,
      expected_b64url: work.derivePassword('ＧitHub'),
    },
    {
      description: 'Revision 2: HKDF-SHA256(ikm=handlePriv, salt="me2em/secret/github", info="me2em/secret/v1/r2", L=16) — independent of revision 1',
      seed_hex: seed12Hex,
      handle_name: 'work',
      context: 'github',
      revision: 2,
      expected_b64url: work.derivePassword('github', { revision: 2 }),
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
    {
      description: 'Channel key revision 2: info="me2em/channel/v1/r2" — independent of revision 1',
      seed_hex: seed12Hex,
      handle_name: 'work',
      context: 'telemetry-v1',
      revision: 2,
      expected_key_hex: hex(work.deriveChannelKey('telemetry-v1', { revision: 2 })),
    },
  ],
  derive_resource_key: [
    {
      description: 'Resource key, unlocked static state: salt="me2em/resource/chat-msg/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", info="me2em/resource/v1" (epoch=1 omitted, revision=1 omitted)',
      seed_hex: seed12Hex,
      handle_name: 'work',
      resource_type: 'chat-msg',
      resource_id: RESOURCE_ID_HASH,
      expected_key_hex: hex(work.deriveResourceKey('chat-msg', RESOURCE_ID_HASH)),
    },
    {
      description: 'Resource key, locked state revision=0: info="me2em/resource/v1/r0" — independent of revision 1 (blur/stub key)',
      seed_hex: seed12Hex,
      handle_name: 'work',
      resource_type: 'chat-msg',
      resource_id: RESOURCE_ID_HASH,
      revision: 0,
      expected_key_hex: hex(work.deriveResourceKey('chat-msg', RESOURCE_ID_HASH, { revision: 0 })),
    },
    {
      description: 'Resource key, incremental subscription revision=2: info="me2em/resource/v1/r2" — independent of revisions 0/1',
      seed_hex: seed12Hex,
      handle_name: 'work',
      resource_type: 'stream',
      resource_id: 'ch-42',
      revision: 2,
      expected_key_hex: hex(work.deriveResourceKey('stream', 'ch-42', { revision: 2 })),
    },
    {
      description: 'Resource key, day epoch: info="me2em/resource/v1/e20261105" — temporal anchor as monotonic integer',
      seed_hex: seed12Hex,
      handle_name: 'work',
      resource_type: 'chat-msg',
      resource_id: RESOURCE_ID_HASH,
      epoch: 20261105,
      expected_key_hex: hex(work.deriveResourceKey('chat-msg', RESOURCE_ID_HASH, { epoch: 20261105 })),
    },
    {
      description: 'Resource key, epoch+lock combo: info="me2em/resource/v1/e20261105/r0" — epoch precedes revision in the info path',
      seed_hex: seed12Hex,
      handle_name: 'work',
      resource_type: 'chat-msg',
      resource_id: RESOURCE_ID_HASH,
      epoch: 20261105,
      revision: 0,
      expected_key_hex: hex(work.deriveResourceKey('chat-msg', RESOURCE_ID_HASH, { epoch: 20261105, revision: 0 })),
    },
    {
      description: 'Canonicalization: raw inputs "Ｃhat-Msg " (U+FF2C fullwidth C, uppercase M, trailing space) and "e3b0…" → NFKC→lowercase→trim → same key as vector #1',
      seed_hex: seed12Hex,
      handle_name: 'work',
      resource_type: 'Ｃhat-Msg ',
      resource_id: RESOURCE_ID_HASH,
      expected_key_hex: hex(work.deriveResourceKey('Ｃhat-Msg ', RESOURCE_ID_HASH)),
    },
    {
      description: 'Domain separation: same resource_id, different resource_type ("file") → different key',
      seed_hex: seed12Hex,
      handle_name: 'work',
      resource_type: 'file',
      resource_id: RESOURCE_ID_HASH,
      expected_key_hex: hex(work.deriveResourceKey('file', RESOURCE_ID_HASH)),
    },
    {
      description: 'Domain separation: same resource_type, different resource_id ("msg-105") → different key',
      seed_hex: seed12Hex,
      handle_name: 'work',
      resource_type: 'chat-msg',
      resource_id: 'msg-105',
      expected_key_hex: hex(work.deriveResourceKey('chat-msg', 'msg-105')),
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
  attestation_wallet: [
    {
      description: "v1 optional extensions (§5.1): wallet fields in canonical order; address is an illustrative valid-format address (base58 of the subject Handle's public key), not a wallet derived from subjectWalletPath — real path→address derivation is pinned by @me2em/solana tests (Phantom cross-check)",
      seed_hex: seed12Hex,
      subject_handle_name: 'work',
      grant: grantA,
      ttl_seconds: 31536000,
      now: NOW,
      jti: 'vector-a-handle-wallet-0001',
      subject_wallet: base58.encode(work.getPublicKey()),
      subject_wallet_chain: 'solana:mainnet-beta',
      subject_wallet_path: "m/44'/501'/0'/0'",
      expected_payload_json: JSON.stringify(W.payload),
      expected_token: W.token,
    },
  ],
  session_handle: [
    {
      description: 'Handle session token; payload pinned incl. the lineage sid (Session.create stamps iat from the wall clock). Ed25519 over the exact payload bytes',
      seed_hex: seed12Hex,
      handle_name: 'work',
      audience: 'ev-app.com',
      scopes: ['charge:start'],
      ttl: SESSION_TTL,
      iat: NOW,
      jti: 'vector-session-handle-0001',
      sid: 'vector-sid-handle-0001',
      expected_payload_json: handleSession.payloadJson,
      expected_token: handleSession.token,
    },
  ],
  session_subhandle: [
    {
      description: 'SubHandle session token; sid after jti, hPath appended last (normative key order)',
      seed_hex: seed12Hex,
      handle_name: 'work',
      sub_name: 'connector-1',
      audience: 'ev-app.com',
      scopes: ['charge:start'],
      ttl: SESSION_TTL,
      iat: NOW,
      jti: 'vector-session-subhandle-0001',
      sid: 'vector-sid-subhandle-0001',
      expected_payload_json: subSession.payloadJson,
      expected_token: subSession.token,
    },
  ],
};

const output = {
  spec: 'Me2eM core protocol',
  spec_version: '1.0',
  vector_file_version: 5,
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

// ---------------------------------------------------------------------------
// Merge-write (rc.10): this generator owns the top-level core fields and the
// `vectors` map. Sections owned by other generators — `jcs` (core rc.9, P0.8)
// and `pact` (@me2em/pact) — and every non-base note are preserved verbatim.
// Before rc.10 this script rewrote the whole file, silently dropping those
// sections and resetting vector_file_version (caught during the BL-06
// regeneration; mirrors the merge pattern of the pact generator).
// ---------------------------------------------------------------------------
const target = fileURLToPath(new URL('../../../specs/test-vectors.json', import.meta.url));
const current = JSON.parse(readFileSync(target, 'utf8')) as {
  vector_file_version?: number;
  notes?: string[];
  [key: string]: unknown;
};
const baseNotes = output.notes;
const sidNote =
  'Group session (rc.10, BL-06): session payloads carry the lineage id `sid` — random at creation, stable across renewals, consulted by revocation alongside `jti`. Vectors pin `sid` explicitly; the field order is hId…jti, sid, then hPath last (mirrors Session.create).';
const preservedNotes = (current.notes ?? []).filter(
  (n) => !baseNotes.includes(n) && n !== sidNote
);
const merged = {
  ...current,
  ...output,
  vector_file_version: Math.max(current.vector_file_version ?? 0, output.vector_file_version),
  notes: [...baseNotes, ...preservedNotes, sidNote],
};
writeFileSync(target, JSON.stringify(merged, null, 2) + '\n');
console.log(`Wrote ${target}`);
console.log(`Categories: ${Object.keys(vectors).join(', ')}`);
