// encapsulation.spec.ts — PLAN-LTS PR-5, tests 5.1–5.5
//
// 5.1 Identity encapsulation      (#private, defensive getters, dispose)
// 5.2 Handle encapsulation        (brand check, input copying, dispose)
// 5.3 SubHandle encapsulation     (path/metadata copies, inherited dispose)
// 5.4 dispose() semantics         (DisposedError contract, integration)
// 5.5 Redaction                   (toJSON / inspect never emit key material)
import { describe, it, expect } from 'vitest';
import { inspect } from 'node:util';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  DisposedError,
  Handle,
  Identity,
  Session,
  SubHandle,
} from '../src/index.js';
import { TEST_SEED, createTestHandle } from './test-utils.js';

const utf8 = (s: string) => new TextEncoder().encode(s);
const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');

/** Deterministic 32-byte key for direct construction tests (not via Identity). */
function scratchKey(label: string): Uint8Array {
  return hkdf(sha256, TEST_SEED, new Uint8Array(0), utf8(`pr5/${label}`), 32);
}

async function expectDisposed(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DisposedError);
}

// ─────────────────────────────────────────────────────────────
// 5.1 Identity
// ─────────────────────────────────────────────────────────────
describe('5.1 Identity encapsulation', () => {
  it('key material is unreachable at runtime (true #private, not TS-private)', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const surface = identity as unknown as Record<string, unknown>;
    expect(surface['privateKey']).toBeUndefined();
    expect(surface['publicKey']).toBeUndefined();
    // #private fields create no enumerable own properties at all
    expect(Object.keys(identity)).toEqual([]);
  });

  it('getPublicKey() returns a defensive copy', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const pristine = await Identity.fromSeed(TEST_SEED);
    const pk = identity.getPublicKey();
    pk[0] ^= 0xff;
    pk[31] ^= 0xff;
    expect(identity.getPublicKey()).toEqual(pristine.getPublicKey());
  });

  it('mutating the seed buffer after fromSeed() does not affect the Identity', async () => {
    const seed = new Uint8Array(TEST_SEED);
    const identity = await Identity.fromSeed(seed);
    const pubBefore = identity.getPublicKey();
    seed.fill(0xff);
    expect(identity.getPublicKey()).toEqual(pubBefore);
  });

  it('capability methods throw DisposedError after dispose() — guard runs before validation', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    identity.dispose();
    await expectDisposed(identity.deriveHandle('after-dispose'));
    await expectDisposed(identity.deriveSubHandle('h', 's'));
    // Invalid grant on purpose: the dispose guard must fire BEFORE grant
    // validation, proving the guard is the first statement.
    await expectDisposed(identity.attestHandle('after-dispose', {} as never));
  });

  it('informational getters survive dispose(); double dispose() is a no-op', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const pub = identity.getPublicKey();
    identity.dispose();
    identity.dispose(); // idempotent — must not throw
    expect(identity.getPublicKey()).toEqual(pub);
  });
});

// ─────────────────────────────────────────────────────────────
// 5.2 Handle
// ─────────────────────────────────────────────────────────────
describe('5.2 Handle encapsulation', () => {
  it('Handle.prototype.sign.call(fakeThis) → TypeError (private-field brand check)', async () => {
    const foreignThis = {} as Handle;
    await expect(
      Handle.prototype.sign.call(foreignThis, utf8('data'))
    ).rejects.toThrow(TypeError);
    // Sync method: brand check throws synchronously.
    expect(() => Handle.prototype.getName.call(foreignThis)).toThrow(TypeError);
  });

  it('constructor copies the key buffer — later caller mutation has no effect', async () => {
    const raw = scratchKey('input-copy');
    const handle = new Handle(raw, 'copy-test');
    const sig1 = await handle.sign(utf8('payload'));
    raw.fill(0xff); // corrupt the caller's buffer AFTER construction
    const sig2 = await handle.sign(utf8('payload'));
    expect(sig1).toEqual(sig2);
  });

  it('getMetadata() returns a copy; absent metadata stays undefined', async () => {
    const handle = new Handle(scratchKey('meta-copy'), 'meta-copy', { custom: 1 });
    const meta = handle.getMetadata();
    expect(meta).toEqual({ custom: 1 });
    meta!['custom'] = 999;
    expect(handle.getMetadata()).toEqual({ custom: 1 });
    const bare = new Handle(scratchKey('no-meta'), 'no-meta');
    expect(bare.getMetadata()).toBeUndefined();
  });

  it('getMetadata(): input is deep-copied in the constructor — caller mutation before or after is invisible', () => {
    const input = { custom: { a: 1 } };
    const handle = new Handle(scratchKey('meta-deep-in'), 'meta-deep-in', input);
    // the copy happens in the constructor, not lazily in the getter
    expect(handle.getMetadata()).toEqual({ custom: { a: 1 } });
    input.custom.a = 42; // mutate the CALLER's input after construction
    expect(handle.getMetadata()).toEqual({ custom: { a: 1 } });
  });

  it('getMetadata(): nested values are deep-copied on the way out — mutating them does not leak', () => {
    const handle = new Handle(scratchKey('meta-deep-out'), 'meta-deep-out', {
      custom: { a: 1 },
    });
    const meta = handle.getMetadata() as { custom: { a: number } };
    meta.custom.a = 42;
    (meta as Record<string, unknown>)['added'] = true;
    expect(handle.getMetadata()).toEqual({ custom: { a: 1 } });
  });

  it('getPublicKey() returns a defensive copy', async () => {
    const handle = new Handle(scratchKey('pk-copy'), 'pk-copy');
    const pk = handle.getPublicKey();
    pk.fill(0xaa);
    expect(handle.getPublicKey()).not.toEqual(pk);
  });

  it('all capability methods throw DisposedError after dispose()', async () => {
    const { handle } = await createTestHandle('dispose-all');
    const { handle: other } = await createTestHandle('dispose-peer');
    handle.dispose();
    await expectDisposed(handle.sign(utf8('x')));
    await expectDisposed(handle.deriveSubHandle('child'));
    await expectDisposed(handle.attestSubHandle('child', {} as never));
    expect(() => handle.derivePassword('github')).toThrow(DisposedError);
    expect(() => handle.deriveChannelKey('ch')).toThrow(DisposedError);
    await expectDisposed(handle.deriveSharedSecret(other.getPublicKey()));
  });

  it('informational getters survive dispose(); double dispose() is a no-op', async () => {
    const { handle } = await createTestHandle('dispose-info');
    const name = handle.getName();
    const id = handle.getId();
    const pub = handle.getPublicKey();
    handle.dispose();
    handle.dispose();
    expect(handle.getName()).toBe(name);
    expect(handle.getId()).toBe(id);
    expect(handle.getPublicKey()).toEqual(pub);
  });
});

// ─────────────────────────────────────────────────────────────
// 5.3 SubHandle
// ─────────────────────────────────────────────────────────────
describe('5.3 SubHandle encapsulation', () => {
  it('path input is copied — caller mutation has no effect', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const sub = await identity.deriveSubHandle('parent', 'child');
    expect(sub.getPathString()).toBe('parent/child');
    // The path is a leaf-owned copy: mutating what getPath() returns
    // must not touch the SubHandle either.
    const returned = sub.getPath();
    returned[0] = 'hacked';
    expect(sub.getPathString()).toBe('parent/child');
  });

  it('constraint arrays are copied at construction — enforced set cannot be mutated', async () => {
    const meta: Record<string, unknown> = { allowedScopes: ['charge:start'] };
    const identity = await Identity.fromSeed(TEST_SEED);
    const sub = await identity.deriveSubHandle('parent', 'child', meta as never);
    // Mutate the CALLER's array after construction.
    (meta['allowedScopes'] as string[]).push('charge:stop');
    expect(() =>
      sub.validateSessionOptions({
        audience: 'app.example.com',
        scopes: ['charge:stop'],
        ttl: 600,
      })
    ).toThrow(/not allowed/);
    // getSubMetadata() also returns copies.
    const snapshot = sub.getSubMetadata();
    snapshot.allowedScopes!.push('charge:stop');
    expect(() =>
      sub.validateSessionOptions({
        audience: 'app.example.com',
        scopes: ['charge:stop'],
        ttl: 600,
      })
    ).toThrow(/not allowed/);
  });

  it('getMetadata() and getSubMetadata() nested custom values are independent deep copies', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const sub = await identity.deriveSubHandle('parent', 'child', {
      nested: { a: 1 },
    } as never);
    const fromMeta = sub.getMetadata() as { nested: { a: number } };
    const fromSub = sub.getSubMetadata() as unknown as { nested: { a: number } };
    expect(fromMeta.nested).toEqual({ a: 1 });
    expect(fromSub.nested).toEqual({ a: 1 });
    // mutating one getter's output must not be visible through the other
    fromMeta.nested.a = 42;
    expect(fromSub.nested).toEqual({ a: 1 });
    expect(sub.getMetadata()).toEqual({ nested: { a: 1 } });
    fromSub.nested.a = 7;
    expect(sub.getMetadata()).toEqual({ nested: { a: 1 } });
    expect((sub.getSubMetadata() as unknown as { nested: { a: number } }).nested).toEqual({ a: 1 });
  });

  it('inherits dispose() from Handle — capability methods throw DisposedError', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const sub = await identity.deriveSubHandle('parent', 'child');
    sub.dispose();
    expect(() => sub.derivePassword('svc')).toThrow(DisposedError);
    await expectDisposed(sub.sign(utf8('x')));
  });
});

// ─────────────────────────────────────────────────────────────
// 5.4 dispose() semantics — DisposedError contract, integration
// ─────────────────────────────────────────────────────────────
describe('5.4 dispose() semantics', () => {
  it('DisposedError is a proper Error with name and className', () => {
    const e = new DisposedError('Handle');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('DisposedError');
    expect(e.className).toBe('Handle');
    expect(e.message).toContain('disposed');
  });

  it('Session.create on a disposed handle throws DisposedError', async () => {
    const { handle } = await createTestHandle('disposed-session');
    handle.dispose();
    await expectDisposed(
      Session.create(handle, {
        audience: 'app.example.com',
        scopes: ['read'],
        ttl: 600,
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────
// 5.5 Redaction — toJSON / inspect never emit key material
// ─────────────────────────────────────────────────────────────
describe('5.5 redaction (toJSON / inspect)', () => {
  it('JSON.stringify(handle) contains no trace of the private key', async () => {
    const raw = scratchKey('redaction');
    const handle = new Handle(raw, 'redaction-test');
    const secretB64 = b64url(raw);
    const secretHex = Buffer.from(raw).toString('hex');
    const json = JSON.stringify(handle);
    expect(json).not.toContain(secretB64);
    expect(json).not.toContain(secretHex);
    expect(json).not.toContain('privateKey');
    expect(inspect(handle)).not.toContain(secretB64);
  });

  it('toJSON exposes exactly the redacted contract per class', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const { handle } = await createTestHandle('redact-handle');
    const sub = await handle.deriveSubHandle('child', {
      allowedScopes: ['s1'],
      maxSessionTtl: 60,
    });

    expect(Object.keys(identity.toJSON()).sort()).toEqual(['id', 'kind']);
    expect(identity.toJSON()['kind']).toBe('Identity');

    expect(Object.keys(handle.toJSON()).sort()).toEqual(['id', 'kind', 'name']);
    expect(handle.toJSON()['kind']).toBe('Handle');

    const subJson = sub.toJSON();
    expect(Object.keys(subJson).sort()).toEqual(['id', 'kind', 'name', 'path']);
    expect(subJson['kind']).toBe('SubHandle');
    expect(subJson['path']).toEqual(['redact-handle', 'child']);
    // Constraint metadata must not leak through serialization either.
    expect(JSON.stringify(sub)).not.toContain('allowedScopes');
    expect(JSON.stringify(sub)).not.toContain('maxSessionTtl');
  });

  it('inspect renders a short redacted representation for each class', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const { handle } = await createTestHandle('inspect-handle');
    const sub = await handle.deriveSubHandle('child');

    expect(inspect(identity)).toMatch(/^Identity\(id=/);
    expect(inspect(handle)).toMatch(/^Handle\(id=/);
    expect(inspect(handle)).toContain('inspect-handle');
    expect(inspect(sub)).toMatch(/^SubHandle\(id=/);
    expect(inspect(sub)).toContain('inspect-handle/child');
  });
});
