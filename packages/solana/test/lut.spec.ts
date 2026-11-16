// packages/solana/test/lut.spec.ts
//
// Ф4: parseLutAddresses — valid input, corrupted data, short buffer.
import { describe, it, expect } from 'vitest';
import { parseLutAddresses } from '../src/lut.js';

// Helper: build a minimal LUT account data
// version(1) + deactivationSlot(8) + lastExtendedSlot(8) + lastExtendedSlotStartIndex(1) +
// authority: Option<Pubkey>(1 byte = no authority, or 33 bytes = Some(pubkey)) +
// addresses: Vec<Pubkey>(u32 LE count + 32*count bytes)
function buildLutData(pubkeys: string[]): Uint8Array {
  const { base58 } = require('@scure/base');
  const pubkeyBytes = pubkeys.map((pk) => base58.decode(pk));

  // Calculate total size
  const authoritySize = 1; // NoOption
  const addressesSize = 4 + pubkeyBytes.length * 32;
  const totalSize = 1 + 8 + 8 + 1 + authoritySize + addressesSize;

  const buf = new Uint8Array(totalSize);
  let offset = 0;

  // version = 1
  buf[offset++] = 1;

  // deactivationSlot = 0 (8 bytes, already zero)
  offset += 8;

  // lastExtendedSlot = 0 (8 bytes, already zero)
  offset += 8;

  // lastExtendedSlotStartIndex = 0 (1 byte, already zero)
  offset += 1;

  // authority: NoOption
  buf[offset++] = 0;

  // addresses count (u32 LE)
  const count = pubkeyBytes.length;
  buf[offset++] = count & 0xff;
  buf[offset++] = (count >> 8) & 0xff;
  buf[offset++] = (count >> 16) & 0xff;
  buf[offset++] = (count >> 24) & 0xff;

  // addresses
  for (const pb of pubkeyBytes) {
    buf.set(pb, offset);
    offset += 32;
  }

  return buf;
}

describe('parseLutAddresses — valid input', () => {
  it('parses a LUT with 3 addresses', () => {
    const pubkeys = [
      '11111111111111111111111111111111',
      'DeXb83pRNqBf3owXLST8qUNPvCAB9JaA41TcBfYn1bKm',
      'VoSTx7BZFzLEjJYM8eWjLKF7R3QYZFoK5Wq8R8PxqBk',
    ];
    const { base58 } = require('@scure/base');
    const data = buildLutData(pubkeys);
    const base64Data = Buffer.from(data).toString('base64');
    const result = parseLutAddresses(base64Data);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      const expected = base58.decode(pubkeys[i]);
      expect(Buffer.from(result![i])).toEqual(Buffer.from(expected));
    }
  });

  it('parses a LUT with 1 address', () => {
    const pubkeys = ['DeXb83pRNqBf3owXLST8qUNPvCAB9JaA41TcBfYn1bKm'];
    const data = buildLutData(pubkeys);
    const base64Data = Buffer.from(data).toString('base64');
    const result = parseLutAddresses(base64Data);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
  });

  it('parses a LUT with 0 addresses', () => {
    const data = buildLutData([]);
    const base64Data = Buffer.from(data).toString('base64');
    const result = parseLutAddresses(base64Data);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(0);
  });

  it('parses a LUT with authority', () => {
    const pubkeys = ['DeXb83pRNqBf3owXLST8qUNPvCAB9JaA41TcBfYn1bKm'];
    const { base58 } = require('@scure/base');
    const authorityPk = base58.decode('11111111111111111111111111111111');
    const addressesSize = 4 + pubkeys.length * 32;
    const totalSize = 1 + 8 + 8 + 1 + 33 + addressesSize;
    const buf = new Uint8Array(totalSize);
    let offset = 0;
    buf[offset++] = 1; // version
    offset += 8; // deactivationSlot
    offset += 8; // lastExtendedSlot
    offset += 1; // lastExtendedSlotStartIndex
    buf[offset++] = 1; // authority: Some
    buf.set(authorityPk, offset);
    offset += 32;
    buf[offset++] = 1; // count
    buf.set(pubkeys.map((pk) => base58.decode(pk)).flat(), offset);
    const base64Data = Buffer.from(buf).toString('base64');
    const result = parseLutAddresses(base64Data);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
  });
});

describe('parseLutAddresses — corrupted data', () => {
  it('returns null for empty string', () => {
    expect(parseLutAddresses('')).toBeNull();
  });

  it('returns null for invalid base64', () => {
    expect(parseLutAddresses('not-valid-base64!!!')).toBeNull();
  });

  it('returns null for corrupted addresses (truncated pubkey)', () => {
    const pubkeys = ['DeXb83pRNqBf3owXLST8qUNPvCAB9JaA41TcBfYn1bKm'];
    const data = buildLutData(pubkeys);
    // Truncate the last pubkey by 1 byte
    const corrupted = data.slice(0, data.length - 1);
    const base64Data = Buffer.from(corrupted).toString('base64');
    expect(parseLutAddresses(base64Data)).toBeNull();
  });

  it('returns null for completely random data', () => {
    const random = new Uint8Array(100);
    for (let i = 0; i < 100; i++) random[i] = Math.floor(Math.random() * 256);
    const base64Data = Buffer.from(random).toString('base64');
    expect(parseLutAddresses(base64Data)).toBeNull();
  });
});

describe('parseLutAddresses — short buffer', () => {
  it('returns null when buffer is shorter than header', () => {
    // Header is at least 1 + 8 + 8 + 1 + 1 = 19 bytes minimum
    const short = new Uint8Array(10);
    const base64Data = Buffer.from(short).toString('base64');
    expect(parseLutAddresses(base64Data)).toBeNull();
  });

  it('returns null when count says more addresses than available', () => {
    const pubkeys = ['DeXb83pRNqBf3owXLST8qUNPvCAB9JaA41TcBfYn1bKm'];
    const data = buildLutData(pubkeys);
    // Remove 31 bytes from the last pubkey (leaving only 1 byte)
    const truncated = data.slice(0, data.length - 31);
    const base64Data = Buffer.from(truncated).toString('base64');
    expect(parseLutAddresses(base64Data)).toBeNull();
  });
});
