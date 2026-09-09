// tests/subhandle.spec.ts
//
// Tests for the SubHandle primitive.
// SubHandle is a leaf node in the Me2em derivation tree (MAX_DEPTH = 2).
// It inherits from Handle for polymorphism in Session handling.

import { describe, it, expect } from 'vitest';
import {
  Identity,
  Handle,
  SubHandle,
  type SubHandleMetadata,
} from '../src/index.js';

const testSeed = new Uint8Array(32).fill(42);

/**
 * Helper: creates a SubHandle via Handle.deriveSubHandle for use in tests.
 */
async function createTestSubHandle(
  handleName: string = 'station-001',
  subName: string = 'connector-1',
  metadata?: SubHandleMetadata
): Promise<{ identity: Identity; handle: Handle; sub: SubHandle }> {
  const identity = await Identity.fromSeed(testSeed);
  const handle = await identity.deriveHandle(handleName);
  const sub = await handle.deriveSubHandle(subName, metadata);
  return { identity, handle, sub };
}

describe('SubHandle', () => {
  // ---------------------------------------------------------------------------
  // Constructor validation
  // ---------------------------------------------------------------------------
  describe('Constructor', () => {
    it('should create a SubHandle with a valid path of length 2', async () => {
      const { sub } = await createTestSubHandle();
      expect(sub).toBeInstanceOf(SubHandle);
      expect(sub).toBeInstanceOf(Handle);
    });

    it('should reject a path with length !== 2 (empty)', () => {
      const privKey = new Uint8Array(32).fill(1);
      expect(() => new SubHandle(privKey, 'sub', [])).toThrow(
        /exactly 2 elements/
      );
    });

    it('should reject a path with length 1', () => {
      const privKey = new Uint8Array(32).fill(1);
      expect(() => new SubHandle(privKey, 'sub', ['only-handle'])).toThrow(
        /exactly 2 elements/
      );
    });

    it('should reject a path with length 3', () => {
      const privKey = new Uint8Array(32).fill(1);
      expect(() =>
        new SubHandle(privKey, 'sub', ['a', 'b', 'c'])
      ).toThrow(/exactly 2 elements/);
    });
  });

  // ---------------------------------------------------------------------------
  // Path methods
  // ---------------------------------------------------------------------------
  describe('getPath / getPathString', () => {
    it('should return the correct path array', async () => {
      const { sub } = await createTestSubHandle('station-001', 'connector-1');
      expect(sub.getPath()).toEqual(['station-001', 'connector-1']);
    });

    it('should return the path as a slash-separated string', async () => {
      const { sub } = await createTestSubHandle('station-001', 'connector-1');
      expect(sub.getPathString()).toBe('station-001/connector-1');
    });

    it('should return a COPY of the path (not a reference)', async () => {
      const { sub } = await createTestSubHandle();
      const path = sub.getPath();
      path.push('tampered');
      // Original path must remain unchanged
      expect(sub.getPath()).toEqual(['station-001', 'connector-1']);
    });

    it('should normalize names to lowercase', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle = await identity.deriveHandle('Station-001');
      const sub = await handle.deriveSubHandle('Connector-1');
      expect(sub.getPath()).toEqual(['station-001', 'connector-1']);
    });
  });

  // ---------------------------------------------------------------------------
  // Depth and leaf status
  // ---------------------------------------------------------------------------
  describe('getDepth / isLeaf', () => {
    it('should always return depth === 2', async () => {
      const { sub } = await createTestSubHandle();
      expect(sub.getDepth()).toBe(2);
    });

    it('should always be a leaf (cannot derive children)', async () => {
      const { sub } = await createTestSubHandle();
      expect(sub.isLeaf()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Constraint validation: validateSessionOptions
  // ---------------------------------------------------------------------------
  describe('validateSessionOptions', () => {
    describe('allowedAudiences', () => {
      it('should pass when audience is in the allowed list', async () => {
        const { sub } = await createTestSubHandle('h', 's', {
          allowedAudiences: ['app-a.com', 'app-b.com'],
        });
        expect(() =>
          sub.validateSessionOptions({
            audience: 'app-a.com',
            scopes: ['read'],
            ttl: 3600,
          })
        ).not.toThrow();
      });

      it('should reject when audience is NOT in the allowed list', async () => {
        const { sub } = await createTestSubHandle('h', 's', {
          allowedAudiences: ['app-a.com'],
        });
        expect(() =>
          sub.validateSessionOptions({
            audience: 'evil.com',
            scopes: ['read'],
            ttl: 3600,
          })
        ).toThrow(/Audience "evil.com" not allowed/);
      });

      it('should allow any audience when allowedAudiences is empty/undefined', async () => {
        const { sub } = await createTestSubHandle('h', 's', {});
        expect(() =>
          sub.validateSessionOptions({
            audience: 'anything.com',
            scopes: [],
            ttl: 1,
          })
        ).not.toThrow();
      });
    });

    describe('allowedScopes', () => {
      it('should pass when all requested scopes are allowed', async () => {
        const { sub } = await createTestSubHandle('h', 's', {
          allowedScopes: ['read', 'write', 'admin'],
        });
        expect(() =>
          sub.validateSessionOptions({
            audience: 'app',
            scopes: ['read', 'write'],
            ttl: 3600,
          })
        ).not.toThrow();
      });

      it('should reject when any requested scope is forbidden', async () => {
        const { sub } = await createTestSubHandle('h', 's', {
          allowedScopes: ['read'],
        });
        expect(() =>
          sub.validateSessionOptions({
            audience: 'app',
            scopes: ['read', 'admin'],
            ttl: 3600,
          })
        ).toThrow(/Scopes not allowed.*admin/);
      });

      it('should reject with ALL forbidden scopes listed', async () => {
        const { sub } = await createTestSubHandle('h', 's', {
          allowedScopes: ['read'],
        });
        expect(() =>
          sub.validateSessionOptions({
            audience: 'app',
            scopes: ['write', 'admin'],
            ttl: 3600,
          })
        ).toThrow(/write.*admin|admin.*write/);
      });

      it('should allow any scopes when allowedScopes is empty/undefined', async () => {
        const { sub } = await createTestSubHandle('h', 's', {});
        expect(() =>
          sub.validateSessionOptions({
            audience: 'app',
            scopes: ['anything', 'goes'],
            ttl: 1,
          })
        ).not.toThrow();
      });
    });

    describe('maxSessionTtl', () => {
      it('should pass when ttl <= maxSessionTtl', async () => {
        const { sub } = await createTestSubHandle('h', 's', {
          maxSessionTtl: 3600,
        });
        expect(() =>
          sub.validateSessionOptions({
            audience: 'app',
            scopes: [],
            ttl: 3600,
          })
        ).not.toThrow();
      });

      it('should reject when ttl > maxSessionTtl', async () => {
        const { sub } = await createTestSubHandle('h', 's', {
          maxSessionTtl: 3600,
        });
        expect(() =>
          sub.validateSessionOptions({
            audience: 'app',
            scopes: [],
            ttl: 7200,
          })
        ).toThrow(/TTL 7200s exceeds max allowed 3600s/);
      });

      it('should allow any ttl when maxSessionTtl is undefined', async () => {
        const { sub } = await createTestSubHandle('h', 's', {});
        expect(() =>
          sub.validateSessionOptions({
            audience: 'app',
            scopes: [],
            ttl: 999999,
          })
        ).not.toThrow();
      });
    });

    describe('expiresAt', () => {
      it('should pass when SubHandle has not expired', async () => {
        const futureTimestamp = Math.floor(Date.now() / 1000) + 86400; // +24h
        const { sub } = await createTestSubHandle('h', 's', {
          expiresAt: futureTimestamp,
        });
        expect(() =>
          sub.validateSessionOptions({
            audience: 'app',
            scopes: [],
            ttl: 60,
          })
        ).not.toThrow();
      });

      it('should reject when SubHandle has expired', async () => {
        const pastTimestamp = Math.floor(Date.now() / 1000) - 3600; // -1h
        const { sub } = await createTestSubHandle('h', 's', {
          expiresAt: pastTimestamp,
        });
        expect(() =>
          sub.validateSessionOptions({
            audience: 'app',
            scopes: [],
            ttl: 60,
          })
        ).toThrow(/SubHandle has expired/);
      });
    });

    describe('Combined constraints', () => {
      it('should enforce all constraints simultaneously', async () => {
        const { sub } = await createTestSubHandle('h', 's', {
          allowedAudiences: ['app.com'],
          allowedScopes: ['read'],
          maxSessionTtl: 3600,
        });

        // All valid
        expect(() =>
          sub.validateSessionOptions({
            audience: 'app.com',
            scopes: ['read'],
            ttl: 1800,
          })
        ).not.toThrow();

        // Audience violation
        expect(() =>
          sub.validateSessionOptions({
            audience: 'evil.com',
            scopes: ['read'],
            ttl: 1800,
          })
        ).toThrow(/Audience/);

        // Scope violation
        expect(() =>
          sub.validateSessionOptions({
            audience: 'app.com',
            scopes: ['admin'],
            ttl: 1800,
          })
        ).toThrow(/Scopes not allowed/);

        // TTL violation
        expect(() =>
          sub.validateSessionOptions({
            audience: 'app.com',
            scopes: ['read'],
            ttl: 7200,
          })
        ).toThrow(/TTL/);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------
  describe('getSubMetadata', () => {
    it('should return the SubHandle-specific metadata', async () => {
      const metadata: SubHandleMetadata = {
        displayName: 'CCS Connector',
        allowedAudiences: ['ev-app.com'],
        allowedScopes: ['charge:start'],
        maxSessionTtl: 3600,
      };
      const { sub } = await createTestSubHandle('station', 'connector', metadata);
      const retrieved = sub.getSubMetadata();

      expect(retrieved.displayName).toBe('CCS Connector');
      expect(retrieved.allowedAudiences).toEqual(['ev-app.com']);
      expect(retrieved.allowedScopes).toEqual(['charge:start']);
      expect(retrieved.maxSessionTtl).toBe(3600);
    });

    it('should return a COPY of the metadata (not a reference)', async () => {
      const metadata: SubHandleMetadata = {
        allowedAudiences: ['app.com'],
      };
      const { sub } = await createTestSubHandle('h', 's', metadata);
      const retrieved = sub.getSubMetadata();
      retrieved.allowedAudiences!.push('evil.com');

      // Original must remain unchanged
      expect(sub.getSubMetadata().allowedAudiences).toEqual(['app.com']);
    });

    it('should return empty object when no metadata provided', async () => {
      const { sub } = await createTestSubHandle('h', 's');
      expect(sub.getSubMetadata()).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: Handle.deriveSubHandle
  // ---------------------------------------------------------------------------
  describe('Integration with Handle.deriveSubHandle', () => {
    it('should create a SubHandle with correct path', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle = await identity.deriveHandle('station-001');
      const sub = await handle.deriveSubHandle('connector-1');

      expect(sub).toBeInstanceOf(SubHandle);
      expect(sub.getPath()).toEqual(['station-001', 'connector-1']);
      expect(sub.getName()).toBe('connector-1');
      expect(sub.getDepth()).toBe(2);
    });

    it('should produce different SubHandles for different names', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle = await identity.deriveHandle('station-001');
      const sub1 = await handle.deriveSubHandle('connector-1');
      const sub2 = await handle.deriveSubHandle('connector-2');

      expect(sub1.getId()).not.toBe(sub2.getId());
      expect(sub1.getPublicKey()).not.toEqual(sub2.getPublicKey());
    });

    it('should produce identical SubHandle from same name (deterministic)', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle1 = await identity.deriveHandle('station-001');
      const sub1 = await handle1.deriveSubHandle('connector-1');

      const identity2 = await Identity.fromSeed(testSeed);
      const handle2 = await identity2.deriveHandle('station-001');
      const sub2 = await handle2.deriveSubHandle('connector-1');

      expect(sub1.getId()).toBe(sub2.getId());
      expect(sub1.getPublicKey()).toEqual(sub2.getPublicKey());
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: Identity.deriveSubHandle (atomic)
  // ---------------------------------------------------------------------------
  describe('Integration with Identity.deriveSubHandle', () => {
    it('should create a SubHandle atomically from Identity', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const sub = await identity.deriveSubHandle('station-001', 'connector-1');

      expect(sub).toBeInstanceOf(SubHandle);
      expect(sub.getPath()).toEqual(['station-001', 'connector-1']);
      expect(sub.getName()).toBe('connector-1');
      expect(sub.getDepth()).toBe(2);
    });

    it('should produce identical SubHandle as Handle.deriveSubHandle (CRYPTOGRAPHIC CONSISTENCY)', async () => {
      const identity = await Identity.fromSeed(testSeed);

      // Method 1: via Handle (autonomous)
      const handle = await identity.deriveHandle('station-001');
      const subViaHandle = await handle.deriveSubHandle('connector-1');

      // Method 2: via Identity (atomic)
      const subViaIdentity = await identity.deriveSubHandle(
        'station-001',
        'connector-1'
      );

      // MUST produce identical keys
      expect(subViaHandle.getId()).toBe(subViaIdentity.getId());
      expect(subViaHandle.getPublicKey()).toEqual(subViaIdentity.getPublicKey());
    });

    it('should produce different SubHandles for different handle names', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const sub1 = await identity.deriveSubHandle('station-001', 'connector-1');
      const sub2 = await identity.deriveSubHandle('station-002', 'connector-1');

      expect(sub1.getId()).not.toBe(sub2.getId());
    });

    it('should produce different SubHandles for different sub names', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const sub1 = await identity.deriveSubHandle('station-001', 'connector-1');
      const sub2 = await identity.deriveSubHandle('station-001', 'connector-2');

      expect(sub1.getId()).not.toBe(sub2.getId());
    });
  });

  // ---------------------------------------------------------------------------
  // Inheritance from Handle
  // ---------------------------------------------------------------------------
  describe('Inheritance from Handle', () => {
    it('should be an instance of Handle (polymorphism)', async () => {
      const { sub } = await createTestSubHandle();
      expect(sub).toBeInstanceOf(Handle);
      expect(sub).toBeInstanceOf(SubHandle);
    });

    it('should sign data and verify signature', async () => {
      const { sub } = await createTestSubHandle();
      const data = new TextEncoder().encode('test message');
      const signature = await sub.sign(data);

      const isValid = await Handle.verify(
        signature,
        data,
        sub.getPublicKey()
      );
      expect(isValid).toBe(true);
    });

    it('should derive a password', async () => {
      const { sub } = await createTestSubHandle();
      const pwd = sub.derivePassword('github', 16);

      expect(pwd.length).toBeGreaterThan(0);
      expect(pwd).toMatch(/^[A-Za-z0-9_-]+$/);

      // Deterministic
      const pwd2 = sub.derivePassword('github', 16);
      expect(pwd).toBe(pwd2);
    });

    it('should derive a channel key', async () => {
      const { sub } = await createTestSubHandle();
      const key = sub.deriveChannelKey('telemetry-v1');

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);

      // Deterministic
      const key2 = sub.deriveChannelKey('telemetry-v1');
      expect(key).toEqual(key2);
    });

    it('should return a public key', async () => {
      const { sub } = await createTestSubHandle();
      const pk = sub.getPublicKey();

      expect(pk).toBeInstanceOf(Uint8Array);
      expect(pk.length).toBe(32);
    });

    it('should return an ID', async () => {
      const { sub } = await createTestSubHandle();
      const id = sub.getId();

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('Edge cases', () => {
    it('should normalize whitespace in names', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle = await identity.deriveHandle('  Station-001  ');
      const sub = await handle.deriveSubHandle('  Connector-1  ');

      expect(sub.getPath()).toEqual(['station-001', 'connector-1']);
    });

    it('should handle names with special characters', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle = await identity.deriveHandle('station_001');
      const sub = await handle.deriveSubHandle('connector-1.2');

      expect(sub.getPath()).toEqual(['station_001', 'connector-1.2']);
    });

    it('should work with empty metadata object', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle = await identity.deriveHandle('h');
      const sub = await handle.deriveSubHandle('s', {});

      expect(sub.getSubMetadata()).toEqual({});
      expect(() =>
        sub.validateSessionOptions({
          audience: 'any',
          scopes: ['any'],
          ttl: 999999,
        })
      ).not.toThrow();
    });
  });
});
