import { describe, it, expect } from 'vitest';
import { Identity, Handle, generateSeedPhrase, get32ByteSeedFromMnemonic, validateSeedPhrase } from '../src/index.js';

describe('Me2em Core Functionality', () => {
  const testSeed = new Uint8Array(32).fill(42);

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
