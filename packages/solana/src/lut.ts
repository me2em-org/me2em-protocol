// packages/solana/src/lut.ts
//
// Minimal Address Lookup Table parser (Ф4).
//
// Parses a single LUT account data blob (base64-encoded, raw bytes)
// into an array of 32-byte pubkey buffers. This is NOT a universal
// bincode parser — only the `AddressLookupTable` wire format is
// supported:
//
//   deactivationSlot (u64 LE) | lastExtendedSlot (u64 LE) |
//   lastExtendedSlotStartIndex (u8) | authority (Option<Pubkey>) |
//   addresses (Vec<Pubkey>)
//
// The parser is best-effort: any corruption (short buffer, invalid
// base64, wrong lengths) causes the function to return `null`, and
// the caller treats this as `REFERENCE_MISMATCH` (fail-closed).
//
// No dependencies beyond `@scure/base` (base64 decoding) and
// standard TypedArrays.

import { base64 } from '@scure/base';

// ---------------------------------------------------------------------------
// Bincode helpers (little-endian, in-place)
// ---------------------------------------------------------------------------

/** Read a u64 LE from `buf` at `offset`; advances offset by 8. */
function readU64LE(buf: Uint8Array, offset: number): number {
  let value = 0;
  for (let i = 0; i < 8; i++) {
    value |= buf[offset + i] << (i * 8);
  }
  return value;
}

/** Read a u8 from `buf` at `offset`; advances offset by 1. */
function readU8(buf: Uint8Array, offset: number): number {
  return buf[offset];
}

/** Read a u32 LE from `buf` at `offset`; advances offset by 4. */
function readU32LE(buf: Uint8Array, offset: number): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value |= buf[offset + i] << (i * 8);
  }
  return value;
}

/**
 * Read an `Option<Pubkey>` from the stream.
 *
 * Tag byte: 0 = None (skip 0), 1 = Some (skip 32 bytes pubkey).
 * Returns `null` for None, a 32-byte buffer for Some.
 */
function readOptionPubkey(buf: Uint8Array, offset: number): {
  pubkey: Uint8Array | null;
  nextOffset: number;
} {
  const tag = readU8(buf, offset);
  if (tag === 0) {
    return { pubkey: null, nextOffset: offset + 1 };
  }
  if (tag === 1) {
    const pubkey = buf.slice(offset + 1, offset + 33);
    return { pubkey, nextOffset: offset + 33 };
  }
  throw new Error(`LUT: invalid Option<Pubkey> tag ${tag}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a base64-encoded LUT account data blob into resolved
 * 32-byte pubkey buffers.
 *
 * Returns `null` on any parse failure (corrupted data, wrong length,
 * invalid base64) — the caller must treat this as `REFERENCE_MISMATCH`
 * (fail-closed).
 *
 * Wire format (AddressLookupTable):
 *   - deactivationSlot: u64 LE (8 bytes)
 *   - lastExtendedSlot: u64 LE (8 bytes)
 *   - lastExtendedSlotStartIndex: u8 (1 byte)
 *   - authority: Option<Pubkey> (1 + 0/32 bytes)
 *   - addresses: Vec<Pubkey> — u32 LE count + N × 32 bytes
 */
export function parseLutAddresses(base64Data: string): readonly Uint8Array[] | null {
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(base64.decode(base64Data));
  } catch {
    return null; // invalid base64 → fail-closed
  }

  let offset = 0;

  // deactivationSlot: u64 LE (8 bytes) — we skip it, but must advance
  try {
    offset += 8;
    // lastExtendedSlot: u64 LE (8 bytes) — skip
    offset += 8;
    // lastExtendedSlotStartIndex: u8 (1 byte) — skip
    offset += 1;
    // authority: Option<Pubkey>
    const { nextOffset } = readOptionPubkey(raw, offset);
    offset = nextOffset;
    // addresses: Vec<Pubkey>
    const count = readU32LE(raw, offset);
    offset += 4;

    if (offset + count * 32 > raw.length) {
      return null; // truncated
    }

    const addresses: Uint8Array[] = new Array(count);
    for (let i = 0; i < count; i++) {
      addresses[i] = raw.slice(offset + i * 32, offset + (i + 1) * 32);
    }
    return addresses;
  } catch {
    return null; // any parse error → fail-closed
  }
}
