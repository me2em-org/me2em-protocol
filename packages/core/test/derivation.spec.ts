import { describe, it, expect } from 'vitest';
import {
  Identity,
  Handle,
  SubHandle,
  generateSeedPhrase,
  get32ByteSeedFromMnemonic,
  validateSeedPhrase,
} from '../src/index.js';
import { DERIVATION_PATHS } from '../src/crypto/derivation-paths.js';

const testSeed = new Uint8Array(32).fill(42);

describe('Me2em Core Functionality', () => {
  // ---------------------------------------------------------------------------
  // Identity & Handle Derivation (existing tests, unchanged)
  // ---------------------------------------------------------------------------
  describe('Identity & Handle Derivation', () => {
    it('should derive same HandleId from same seed + name', async () => {
      const identity1 = await Identity.fromSeed(testSeed);
      const handle1a = await identity1.deriveHandle('work');
      const handle1b = await identity1.deriveHandle('private');

      const identity2 = await Identity.fromSeed(testSeed);
      const handle2a = await identity2.deriveHandle('work');

      expect(handle1a.getId()).toBe(handle2a.getId());
      expect(handle1a.getId()).not.toBe(handle1b.getId());
    });

    it('should attach and retrieve metadata', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const metadata = { displayName: 'Alice', role: 'admin' };
      const handle = await identity.deriveHandle('work', metadata);

      expect(handle.getName()).toBe('work');
      expect(handle.getMetadata()).toEqual(metadata);
    });
  });

  // ---------------------------------------------------------------------------
  // DERIVATION_PATHS — единый источник info-строк
  // ---------------------------------------------------------------------------
  describe('DERIVATION_PATHS', () => {
    it('should provide a constant identity path', () => {
      expect(DERIVATION_PATHS.identity).toBe('me2em/identity/v1/root');
    });

    it('should build handle info string with normalized name', () => {
      expect(DERIVATION_PATHS.handle('station-001')).toBe(
        'me2em/handle/v1/station-001'
      );
      expect(DERIVATION_PATHS.handle('Station-001')).toBe(
        'me2em/handle/v1/station-001'
      );
      expect(DERIVATION_PATHS.handle('  Station-001  ')).toBe(
        'me2em/handle/v1/station-001'
      );
    });

    it('should build subhandle info string with normalized names', () => {
      expect(DERIVATION_PATHS.subhandle('station-001', 'connector-1')).toBe(
        'me2em/subhandle/v1/station-001/connector-1'
      );
      expect(DERIVATION_PATHS.subhandle('Station-001', 'Connector-1')).toBe(
        'me2em/subhandle/v1/station-001/connector-1'
      );
      expect(DERIVATION_PATHS.subhandle('  A  ', '  B  ')).toBe(
        'me2em/subhandle/v1/a/b'
      );
    });

    it('should produce different info strings for different names', () => {
      const h1 = DERIVATION_PATHS.handle('a');
      const h2 = DERIVATION_PATHS.handle('b');
      expect(h1).not.toBe(h2);

      const s1 = DERIVATION_PATHS.subhandle('h', 's1');
      const s2 = DERIVATION_PATHS.subhandle('h', 's2');
      expect(s1).not.toBe(s2);
    });
  });

  // ---------------------------------------------------------------------------
  // Handle.deriveSubHandle — автономная деривация
  // ---------------------------------------------------------------------------
  describe('Handle.deriveSubHandle', () => {
    it('should derive a SubHandle with correct path', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle = await identity.deriveHandle('station-001');
      const sub = await handle.deriveSubHandle('connector-1');

      expect(sub).toBeInstanceOf(SubHandle);
      expect(sub.getPath()).toEqual(['station-001', 'connector-1']);
      expect(sub.getName()).toBe('connector-1');
      expect(sub.getDepth()).toBe(2);
    });

    it('should produce identical SubHandle from same name (deterministic)', async () => {
      const identity1 = await Identity.fromSeed(testSeed);
      const handle1 = await identity1.deriveHandle('station-001');
      const sub1 = await handle1.deriveSubHandle('connector-1');

      const identity2 = await Identity.fromSeed(testSeed);
      const handle2 = await identity2.deriveHandle('station-001');
      const sub2 = await handle2.deriveSubHandle('connector-1');

      expect(sub1.getId()).toBe(sub2.getId());
      expect(sub1.getPublicKey()).toEqual(sub2.getPublicKey());
    });

    it('should produce different SubHandles for different names', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle = await identity.deriveHandle('station-001');
      const sub1 = await handle.deriveSubHandle('connector-1');
      const sub2 = await handle.deriveSubHandle('connector-2');

      expect(sub1.getId()).not.toBe(sub2.getId());
      expect(sub1.getPublicKey()).not.toEqual(sub2.getPublicKey());
    });

    it('should normalize names to lowercase', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle = await identity.deriveHandle('Station-001');
      const sub = await handle.deriveSubHandle('Connector-1');

      expect(sub.getPath()).toEqual(['station-001', 'connector-1']);
    });

    it('should carry SubHandleMetadata when provided', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle = await identity.deriveHandle('station-001');
      const sub = await handle.deriveSubHandle('connector-1', {
        allowedAudiences: ['ev-app.com'],
        allowedScopes: ['charge:start'],
        maxSessionTtl: 3600,
      });

      const metadata = sub.getSubMetadata();
      expect(metadata.allowedAudiences).toEqual(['ev-app.com']);
      expect(metadata.allowedScopes).toEqual(['charge:start']);
      expect(metadata.maxSessionTtl).toBe(3600);
    });
  });

  // ---------------------------------------------------------------------------
  // Identity.deriveSubHandle — атомарная деривация
  // ---------------------------------------------------------------------------
  describe('Identity.deriveSubHandle', () => {
    it('should derive a SubHandle atomically from Identity', async () => {
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

      // MUST produce identical keys — this is the core guarantee of the hybrid model
      expect(subViaHandle.getId()).toBe(subViaIdentity.getId());
      expect(subViaHandle.getPublicKey()).toEqual(subViaIdentity.getPublicKey());
      expect(subViaHandle.getPath()).toEqual(subViaIdentity.getPath());
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

    it('should normalize names to lowercase', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const sub = await identity.deriveSubHandle('Station-001', 'Connector-1');

      expect(sub.getPath()).toEqual(['station-001', 'connector-1']);
    });

    it('should carry SubHandleMetadata when provided', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const sub = await identity.deriveSubHandle('station-001', 'connector-1', {
        allowedAudiences: ['ev-app.com'],
        maxSessionTtl: 3600,
      });

      const metadata = sub.getSubMetadata();
      expect(metadata.allowedAudiences).toEqual(['ev-app.com']);
      expect(metadata.maxSessionTtl).toBe(3600);
    });
  });

  // ---------------------------------------------------------------------------
  // MAX_DEPTH = 2 enforcement
  // ---------------------------------------------------------------------------
  describe('MAX_DEPTH = 2 enforcement', () => {
    it('should make SubHandle always a leaf (depth === 2)', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const sub = await identity.deriveSubHandle('station-001', 'connector-1');

      expect(sub.getDepth()).toBe(2);
      expect(sub.isLeaf()).toBe(true);
    });

    it('should throw an error if deriveSubHandle is called on a SubHandle (leaf by design)', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const sub = await identity.deriveSubHandle('station-001', 'connector-1');

      // SubHandle is a leaf (depth = 2), so derivation must be blocked
      await expect(
        sub.deriveSubHandle('invalid-child')
      ).rejects.toThrow(/maximum depth.*reached|marked as leaf/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Handle.derivePassword (existing tests, unchanged)
  // ---------------------------------------------------------------------------
  describe('Handle.derivePassword', () => {
    it('should deterministically derive the same password', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle = await identity.deriveHandle('google');

      const pwd1 = handle.derivePassword('google', 16);
      const pwd2 = handle.derivePassword('google', 16);

      expect(pwd1).toBe(pwd2);
      expect(pwd1.length).toBeGreaterThan(0);
      expect(pwd1).toMatch(/^[A-Za-z0-9_-]{22}$/);
    });

    it('should derive different passwords for different contexts', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle = await identity.deriveHandle('google');

      const pwdGoogle = handle.derivePassword('google');
      const pwdGithub = handle.derivePassword('github');

      expect(pwdGoogle).not.toBe(pwdGithub);
    });
  });

  // ---------------------------------------------------------------------------
  // Handle.deriveChannelKey (existing tests, unchanged)
  // ---------------------------------------------------------------------------
  describe('Handle.deriveChannelKey', () => {
    it('should deterministically derive a 32-byte channel key', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle = await identity.deriveHandle('drone-001');

      const key1 = handle.deriveChannelKey('telemetry-v1');
      const key2 = handle.deriveChannelKey('telemetry-v1');

      expect(key1).toEqual(key2);
      expect(key1.length).toBe(32);
      expect(key1).toBeInstanceOf(Uint8Array);
    });

    it('should derive different keys for different contexts', async () => {
      const identity = await Identity.fromSeed(testSeed);
      const handle = await identity.deriveHandle('drone-001');

      const keyTelemetry = handle.deriveChannelKey('telemetry');
      const keyCommand = handle.deriveChannelKey('command');

      expect(keyTelemetry).not.toEqual(keyCommand);
    });
  });

  // ---------------------------------------------------------------------------
  // BIP39 Seed Utilities (existing tests, unchanged)
  // ---------------------------------------------------------------------------
  describe('BIP39 Seed Utilities', () => {
    it('should generate valid 12-word and 24-word phrases', () => {
      const phrase12 = generateSeedPhrase(128);
      expect(phrase12.length).toBe(12);
      expect(validateSeedPhrase(phrase12).isValid).toBe(true);

      const phrase24 = generateSeedPhrase(256);
      expect(phrase24.length).toBe(24);
      expect(validateSeedPhrase(phrase24).isValid).toBe(true);
    });

    it('should reject invalid seed phrases', () => {
      const invalid = ['apple', 'banana', 'cherry'];
      const result = validateSeedPhrase(invalid);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('must be 12 or 24 words');
    });

    it('should convert mnemonic to deterministic 32-byte seed', async () => {
      const phrase = generateSeedPhrase(128);
      const seedBytes = await get32ByteSeedFromMnemonic(phrase);

      expect(seedBytes.length).toBe(32);
      expect(seedBytes).toBeInstanceOf(Uint8Array);

      const identity = await Identity.fromSeed(seedBytes);
      expect(identity.getPublicKey().length).toBe(32);
    });

    it('should produce identical Identity from string and array mnemonic', async () => {
      const phraseArray = generateSeedPhrase(128);
      const phraseString = phraseArray.join(' ');

      const seed1 = await get32ByteSeedFromMnemonic(phraseArray);
      const seed2 = await get32ByteSeedFromMnemonic(phraseString);

      expect(seed1).toEqual(seed2);
    });
  });
});
