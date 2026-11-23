// packages/pact/src/types.ts
//
// Public type surface of @me2em/pact (ТЗ §3.1; payloads normative per
// PACTS §7.3 — docs/PACTS.md). All binary fields are unpadded base64url
// (RFC 4648 §5); all hashing/signing happens over JCS (RFC 8785) bytes
// produced by @me2em/core rc.9 (decision B1).

/**
 * The hierarchy node the pact key is derived from (PACTS D1–D3).
 * The anchor type fixes the expected voucher-chain length (D12):
 * identity → 1 attestation, handle → 2, subhandle → 3.
 */
export type Anchor = 'identity' | 'handle' | 'subhandle';

/** Journal event registry of v1 (PACTS D28 — the registry is closed). */
export type EventType =
  | 'GENESIS' | 'INVITE' | 'REVOKE_INVITE' | 'ENROLL' | 'EXIT'
  | 'EVICT' | 'ROTATE_KEY' | 'ACT' | 'REVERSE_ACT' | 'AMEND' | 'DISSOLVE';

/** All journal event types, normative order (PACTS §3). */
export const EVENT_TYPES = [
  'GENESIS', 'INVITE', 'REVOKE_INVITE', 'ENROLL', 'EXIT',
  'EVICT', 'ROTATE_KEY', 'ACT', 'REVERSE_ACT', 'AMEND', 'DISSOLVE',
] as const;

export type ThresholdMode = 'all' | 'any' | 'k-of-active' | 'founder';

/**
 * Quorum threshold (PACTS §4). `k` is meaningful for `k-of-active`
 * only (integer ≥ 1); the requirement at verification time is
 * `min(k, active mass)` (B-5).
 */
export interface Threshold {
  m: ThresholdMode;
  k?: number;
}

/**
 * The pact constitution (PACTS §4). `im` — invite mode: `pinned` ties
 * an invite to a concrete invitee, `bearer` — to whoever presents it
 * (D13). `w` — weights enabled: threshold mass is the sum of member
 * weights (B-6).
 */
export interface Constitution {
  th: Partial<Record<EventType, Threshold>>;
  im: 'pinned' | 'bearer';
  w: boolean;
}

/** Journal signature: pactPub b64url(32) + Ed25519 signature b64url(64). */
export interface Signature {
  p: string;
  s: string;
}

/**
 * Journal event envelope (PACTS §7.1). `pl` shape per `ty` is
 * normative (PACTS §7.3) and enforced by strict parse — unknown or
 * missing fields reject (`MALFORMED`).
 */
export interface Event {
  typ: 'me2em/pact-event/v1';
  pid: string;
  sq: number;
  ph: string;
  ty: EventType;
  pl: Record<string, unknown>;
  iat: number;
  sig: Signature[];
}

/** Founder entry of GENESIS (PACTS §7.3): p = pactPub, pp = anchor node pub. */
export interface Founder {
  p: string;
  pp: string;
  an: Anchor;
  w?: number;
  vc?: Voucher;
}

/**
 * Voucher hash-commit (PACTS §5.4, D34): the journal stores only the
 * commitment — `rh` = b64url(SHA-256(JCS(chain))), `rp` = root pub of
 * the anchor Identity. Full chains travel out-of-band keyed by
 * membership id (evHash of the membership event).
 */
export interface Voucher {
  rh: string;
  rp: string;
}

/** Out-of-band voucher chain artifact: serialized core attestations, root first. */
export type VoucherChain = { chain: string[] };

/** Non-fatal findings of verification (ТЗ §3.1, Р10). */
export type WarningCode =
  | 'PRE_COMPROMISE_ACT'
  | 'TIER3_UNSUPPORTED'
  | 'NO_VOUCHER'
  | 'VOUCHER_UNRESOLVED';

/** Clock injection (C3, Р4): unix seconds. Assembly does not defend against skew — verify does. */
export interface Clock {
  now(): number;
}

/** Roster entry (PACTS §5): `e` = evHash of the membership event; roster is sorted by `p`. */
export interface RosterEntry {
  p: string;
  w: number;
  e: string;
}

/** GENESIS payload: context commitment, constitution, founders. */
export interface GenesisPayload {
  ch: string;
  cx?: string;
  cn: Constitution;
  ft: Founder[];
}

/** INVITE payload: weight is assigned here and repeated verbatim by ENROLL (B-6). */
export interface InvitePayload {
  dn?: string;
  w?: number;
  an: Anchor;
}

/** REVOKE_INVITE payload: cancels an unused invite by its event hash (D14). */
export interface RevokeInvitePayload {
  ref: string;
  rs?: string;
}

/** ENROLL payload: the joiner signs; `w` repeats the INVITE weight verbatim (B-6). */
export interface EnrollPayload {
  ref: string;
  dn?: string;
  w?: number;
  vc?: Voucher;
}

/** EXIT payload: signed by the exiting member's current key (D18a). */
export interface ExitPayload {
  rs?: string;
}

/** EVICT payload: `tp` — pactPub of the removed ACTIVE member; target does not sign (D26′). */
export interface EvictPayload {
  tp: string;
  rs?: string;
}

/** ROTATE_KEY payload: `np` — new pactPub; `ca` — compromisedAt window (D20/D39). */
export interface RotateKeyPayload {
  np: string;
  ca?: number;
}

/**
 * ACT payload: `dh` — b64url SHA-256 of the act document (out-of-band
 * or inline `doc` ≤ 2048 B, check-verified, D34); `no` — note ≤ 32.
 */
export interface ActPayload {
  dh?: string;
  doc?: string;
  no?: string;
}

/** REVERSE_ACT payload: supersedes or reversals the ACT at `ref` (D19). */
export interface ReverseActPayload {
  ref: string;
  k: 'supersede' | 'reversal';
  rs?: string;
}

/** AMEND payload: the FULL new constitution; quorum uses the one before the event (B-4/D23). */
export interface AmendPayload {
  cn: Constitution;
  no?: string;
}

/** DISSOLVE payload: default threshold `any` (deadlock-free exit, A2). */
export interface DissolvePayload {
  rs?: string;
}

/** Payload shape per event type (PACTS §7.3 — the strict-parse anchor). */
export type PayloadByType = {
  GENESIS: GenesisPayload;
  INVITE: InvitePayload;
  REVOKE_INVITE: RevokeInvitePayload;
  ENROLL: EnrollPayload;
  EXIT: ExitPayload;
  EVICT: EvictPayload;
  ROTATE_KEY: RotateKeyPayload;
  ACT: ActPayload;
  REVERSE_ACT: ReverseActPayload;
  AMEND: AmendPayload;
  DISSOLVE: DissolvePayload;
};
