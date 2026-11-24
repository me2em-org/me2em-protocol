// packages/pact/src/verify.ts
//
// Verification of the Pact Journal (ТЗ §3.3; PACTS §7.7 — the order is
// normative): (1) chain sq/ph/pid, ph[0] = ZERO32; (2) strict event
// validation, skew ±30 s vs the injected Clock, distinct signers,
// Ed25519 over TBS; (3) quorum by the constitution active at the
// event's seq (freeze per-type, D28), self-events exempt from the
// ACTIVE-signers rule.
//
// Tier distribution (Р9): verifyJournal / verifyPrefix are SYNC —
// Tier 1 (signatures) + Tier 2 (roster replay), both deterministic
// from the journal. verifyAct is ASYNC — Tier 1+2+3: the dated
// revocation flow (Р3) walks the voucher chains (hash-commit D34)
// through core's Attestation primitives and RevocationChecker.isRevokedAt
// (core rc.9, P0.8).
//
// Skew semantics (C3): the Clock is the verification reference — every
// event's `iat` must lie within ±30 s of it (inclusive). Callers
// replaying a historical journal pin the clock to the journal's era;
// revocation lookups use the act's own `iat`, never the clock.
//
// Compromise windows (D20) are Tier 2-deterministic but act-scoped:
// verifyJournal never fails a journal over compromise (P7 — history
// before the fork/compromise stays valid); verifyAct flags
// PRE_COMPROMISE_ACT or rejects with REVOKED.

import { Attestation, crypto, canonicalize, type RevocationChecker } from '@me2em/core';
import type { JsonValue } from '@me2em/core';
import { PactError } from './errors.js';
import { b64urlDecode, b64urlEncode, tbsBytes, validateEvent, ZERO32 } from './codec.js';
import {
  type Anchor,
  type Clock,
  type Constitution,
  type Event,
  type Founder,
  type RosterEntry,
  type VoucherChain,
  type WarningCode,
} from './types.js';

/** Verification outcome (ТЗ §3.3): `warnings: []` means "no warnings". */
export interface VerifyResult {
  ok: boolean;
  error?: PactError;
  roster?: RosterEntry[];
  pactRoot?: string;
  journalHead?: string;
  seq?: number;
  /** Present only in verifyAct (Р10): Tier 3 availability. */
  tier3?: 'supported' | 'unsupported';
  warnings?: Array<{ code: WarningCode; evHash?: string }>;
}

/** Options of {@link verifyJournal} (ТЗ §3.3). */
export interface VerifyOptions {
  /**
   * Skew policy (C3): `'all'` (default) — every event's `iat` must lie
   * within ±30 s of the Clock (inclusive); `'none'` — the skew
   * comparison is skipped entirely; chain/signature/quorum/semantics
   * verification still runs in full. Intended for structural
   * verification of journals whose era lies outside the reference
   * window — a historical prefix just extended by a fresh assembly
   * (`finalize`, B-7) or an archive replay.
   */
  skewCheck?: 'all' | 'none';
}

/** Events outside this skew window from the Clock reject (C3, inclusive bounds). */
export const SKEW_SECONDS = 30;

const DEFAULT_THRESHOLDS: Partial<Record<Event['ty'], { m: 'any' } | { m: 'all' }>> = {
  DISSOLVE: { m: 'any' }, // deadlock-free exit (A2); everything else defaults to 'all'
};

interface RosterValue {
  w: number;
  e: string;
}

/** Per-member trust record (append-only — survives rotation/exit). */
interface MemberRecord {
  /** Membership id — evHash of the membership event (GENESIS/ENROLL). */
  mid: string;
  /** Anchor type (D12 voucher-chain length). */
  an: Anchor;
  /** Founder pp commitment (anchor node pub) — founders only. */
  pp?: string;
  /** Voucher hash-commit (D34). */
  vc?: { rh: string; rp: string };
}

/** Replay state — append-only views over the verified prefix. */
interface JournalState {
  pid: string | undefined;
  head: string;
  hashes: string[];
  events: Event[];
  constitution: Constitution | undefined;
  founderPubs: string[];
  roster: Map<string, RosterValue>;
  /**
   * Member records keyed by member pub (append-only — records survive
   * rotation and exit for retrospective act verification). Founders of
   * one GENESIS share the membership id but each carries its own
   * voucher; at most one founder voucher per membership event (codec).
   */
  members: Map<string, MemberRecord>;
  invites: Map<string, { w?: number; an: Anchor; ep?: string; revoked: boolean }>;
  usedInvites: Set<string>;
  acts: Set<string>;
  /** old pub → rotation record (D20 compromisedAt window + D39 new key). */
  rotatedKeys: Map<string, { ca?: number; newP: string }>;
}

function systemClock(): Clock {
  return { now: () => Math.floor(Date.now() / 1000) };
}

function sortedRoster(roster: Map<string, RosterValue>): RosterEntry[] {
  return [...roster.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([p, v]) => ({ p, w: v.w, e: v.e }));
}

function successResult(state: JournalState, extra?: Partial<VerifyResult>): VerifyResult {
  return {
    ok: true,
    roster: sortedRoster(state.roster),
    pactRoot: state.hashes[0],
    journalHead: state.head,
    seq: state.events.length > 0 ? state.events[state.events.length - 1].sq : undefined,
    warnings: [],
    ...extra,
  };
}

function failResult(error: PactError): VerifyResult {
  return { ok: false, error, warnings: [] };
}

// ---------------------------------------------------------------------------
// Quorum (PACTS §4, §7.5)
// ---------------------------------------------------------------------------

function thresholdOf(cn: Constitution, ty: Event['ty']): { m: string; k?: number } {
  const configured = cn.th[ty];
  if (configured) return configured;
  return DEFAULT_THRESHOLDS[ty] ?? { m: 'all' };
}

/**
 * B-5 constitution validation: rejects `k(DISSOLVE) > n_founders`
 * (dissolution must stay reachable).
 */
function validateConstitutionQuorum(cn: Constitution, nFounders: number, where: string): void {
  const dissolve = cn.th['DISSOLVE'];
  if (dissolve && dissolve.m === 'k-of-active' && (dissolve.k ?? 0) > nFounders) {
    throw new PactError('MALFORMED', 'verify', `${where}: k(DISSOLVE) exceeds the founder count (B-5)`);
  }
}

/**
 * Quorum check for non-self event types. Signatures from keys that are
 * not ACTIVE at the event's seq do not count toward the quorum.
 * Freeze (D28): the threshold comes from the constitution BEFORE the
 * event — AMEND updates it only afterwards.
 */
function requireQuorum(state: JournalState, event: Event): void {
  const cn = state.constitution;
  if (!cn) throw new PactError('MALFORMED', 'verify', 'journal must start with GENESIS');
  const th = thresholdOf(cn, event.ty);
  const signerPubs = new Set(event.sig.map((s) => s.p));

  const activeSigners = [...signerPubs].filter((p) => state.roster.has(p));
  if (activeSigners.length === 0) {
    throw new PactError('INVALID_QUORUM', 'verify', `${event.ty}: no ACTIVE member signed`);
  }
  const signerMass = (pubs: string[]): number =>
    cn.w ? pubs.reduce((acc, p) => acc + (state.roster.get(p)?.w ?? 0), 0) : pubs.length;
  const activeMass = cn.w
    ? [...state.roster.values()].reduce((acc, v) => acc + v.w, 0)
    : state.roster.size;

  switch (th.m) {
    case 'any':
      return; // ≥ 1 ACTIVE signer — checked above
    case 'all': {
      for (const p of state.roster.keys()) {
        if (!signerPubs.has(p)) {
          throw new PactError('INVALID_QUORUM', 'verify', `${event.ty}: not all ACTIVE members signed`);
        }
      }
      return;
    }
    case 'k-of-active': {
      const k = th.k;
      /* v8 ignore next: codec rejects k-less k-of-active before the
       * quorum stage — defensive guard. */
      if (typeof k !== 'number' || !Number.isSafeInteger(k) || k < 1) {
        throw new PactError('MALFORMED', 'verify', `${event.ty}: k-of-active requires integer k ≥ 1`);
      }
      // B-5: the requirement compresses to the active mass.
      if (signerMass(activeSigners) < Math.min(k, activeMass)) {
        throw new PactError('INVALID_QUORUM', 'verify', `${event.ty}: quorum mass below min(k, active)`);
      }
      return;
    }
    case 'founder': {
      for (const p of state.founderPubs) {
        if (!signerPubs.has(p)) {
          throw new PactError('INVALID_QUORUM', 'verify', `${event.ty}: not all founders signed`);
        }
      }
      return;
    }
    default:
      throw new PactError('MALFORMED', 'verify', `${event.ty}: unknown threshold mode`);
  }
}

// ---------------------------------------------------------------------------
// Replay (sync — Tier 1+2)
// ---------------------------------------------------------------------------

function applyEvent(state: JournalState, event: Event, hash: string): void {
  const pl = event.pl as Record<string, never> & Record<string, unknown>;
  const signerPubs = new Set(event.sig.map((s) => s.p));

  switch (event.ty) {
    case 'GENESIS': {
      if (state.events.length !== 0) {
        throw new PactError('MALFORMED', 'verify', 'GENESIS must be the first event');
      }
      const ft = pl['ft'] as unknown as Founder[];
      const cn = pl['cn'] as unknown as Constitution;
      // Co-signature: every founder signed (PACTS §7.5).
      for (const f of ft) {
        if (!signerPubs.has(f.p)) {
          throw new PactError('INVALID_QUORUM', 'verify', 'GENESIS: missing founder signature');
        }
      }
      if (cn.w) {
        for (const f of ft) {
          if (!Number.isSafeInteger(f.w) || (f.w as number) < 1) {
            throw new PactError('MALFORMED', 'verify', 'GENESIS: founder weight required when weights are enabled');
          }
        }
      }
      validateConstitutionQuorum(cn, ft.length, 'GENESIS');
      state.constitution = cn;
      state.founderPubs = ft.map((f) => f.p);
      for (const f of ft) {
        state.roster.set(f.p, { w: cn.w ? (f.w as number) : 1, e: hash });
        state.members.set(f.p, { mid: hash, an: f.an, pp: f.pp, vc: f.vc });
      }
      return;
    }

    case 'INVITE': {
      requireQuorum(state, event);
      const w = pl['w'] as number | undefined;
      if (state.constitution!.w && w === undefined) {
        throw new PactError('MALFORMED', 'verify', 'INVITE: weight required when weights are enabled');
      }
      // D13: a pinned constitution requires the invitee commitment — an
      // invite without `ep` would be a bearer invite in pinned clothing.
      const ep = pl['ep'] as string | undefined;
      if (state.constitution!.im === 'pinned' && ep === undefined) {
        throw new PactError('MALFORMED', 'verify', 'INVITE: pinned constitution requires the invitee commitment ep (D13)');
      }
      state.invites.set(hash, { w, an: pl['an'] as unknown as Anchor, ep, revoked: false });
      return;
    }

    case 'REVOKE_INVITE': {
      requireQuorum(state, event);
      const inv = state.invites.get(pl['ref'] as string);
      if (!inv || inv.revoked || state.usedInvites.has(pl['ref'] as string)) {
        throw new PactError('MALFORMED', 'verify', 'REVOKE_INVITE: invite unknown, used or already revoked (D14)');
      }
      inv.revoked = true;
      return;
    }

    case 'ENROLL': {
      // Self-event: exactly the joiner signs (PACTS §7.5).
      if (event.sig.length !== 1) {
        throw new PactError('INVALID_QUORUM', 'verify', 'ENROLL: exactly the joiner signs');
      }
      const p = event.sig[0].p;
      if (state.roster.has(p)) {
        throw new PactError('MALFORMED', 'verify', 'ENROLL: member already ACTIVE');
      }
      const ref = pl['ref'] as string;
      const inv = state.invites.get(ref);
      if (!inv || inv.revoked || state.usedInvites.has(ref)) {
        throw new PactError('MALFORMED', 'verify', 'ENROLL: invite unknown, revoked or already used (D14)');
      }
      // D13: a pinned invite may only be accepted by the committed
      // invitee — the same "exactly the joiner signs" family (§7.5).
      if (inv.ep !== undefined && p !== inv.ep) {
        throw new PactError('INVALID_QUORUM', 'verify', 'ENROLL: pinned invite — signer does not match ep (D13)');
      }
      // B-6: ENROLL repeats the INVITE weight verbatim.
      if ((inv.w === undefined) !== (pl['w'] === undefined) || (inv.w !== undefined && inv.w !== pl['w'])) {
        throw new PactError('WEIGHT_MISMATCH', 'verify', 'ENROLL: weight differs from the INVITE (B-6)');
      }
      state.usedInvites.add(ref);
      const w = state.constitution!.w ? (pl['w'] as number) : 1;
      state.roster.set(p, { w, e: hash });
      state.members.set(p, {
        mid: hash,
        an: inv.an,
        vc: pl['vc'] as unknown as { rh: string; rp: string } | undefined,
      });
      return;
    }

    case 'EXIT': {
      // D18a: signed by the exiting member's current key.
      if (event.sig.length !== 1) {
        throw new PactError('INVALID_QUORUM', 'verify', 'EXIT: exactly the exiting member signs');
      }
      if (!state.roster.has(event.sig[0].p)) {
        throw new PactError('INVALID_QUORUM', 'verify', 'EXIT: signer is not an ACTIVE member');
      }
      state.roster.delete(event.sig[0].p);
      return;
    }

    case 'EVICT': {
      requireQuorum(state, event);
      if (!state.roster.has(pl['tp'] as string)) {
        throw new PactError('MALFORMED', 'verify', 'EVICT: target is not an ACTIVE member');
      }
      state.roster.delete(pl['tp'] as string);
      return;
    }

    case 'ROTATE_KEY': {
      // D39: exactly the parent (ACTIVE) and the new key sign.
      if (event.sig.length !== 2) {
        throw new PactError('INVALID_QUORUM', 'verify', 'ROTATE_KEY: exactly parent + new key sign');
      }
      const np = pl['np'] as string;
      const parentSig = event.sig.find((s) => s.p !== np);
      const newSig = event.sig.find((s) => s.p === np);
      if (!parentSig || !newSig) {
        throw new PactError('INVALID_QUORUM', 'verify', 'ROTATE_KEY: signatures must be {current key, new key}');
      }
      const entry = state.roster.get(parentSig.p);
      if (!entry) {
        throw new PactError('INVALID_QUORUM', 'verify', 'ROTATE_KEY: parent is not an ACTIVE member');
      }
      if (state.roster.has(np)) {
        throw new PactError('MALFORMED', 'verify', 'ROTATE_KEY: new key already ACTIVE');
      }
      state.rotatedKeys.set(parentSig.p, { ca: pl['ca'] as number | undefined, newP: np });
      state.roster.delete(parentSig.p);
      state.roster.set(np, entry); // w/e preserved (D39)
      // The anchor node is unchanged by a key rotation — the member
      // record (membership id, anchor type, voucher) is inherited.
      const rec = state.members.get(parentSig.p);
      /* v8 ignore next: the parent is a roster member, so its record
       * always exists — defensive only. */
      if (rec) state.members.set(np, rec);
      return;
    }

    case 'ACT': {
      requireQuorum(state, event);
      state.acts.add(hash);
      return;
    }

    case 'REVERSE_ACT': {
      requireQuorum(state, event);
      if (!state.acts.has(pl['ref'] as string)) {
        throw new PactError('MALFORMED', 'verify', 'REVERSE_ACT: ref does not point to a journal ACT (D19)');
      }
      return;
    }

    case 'AMEND': {
      requireQuorum(state, event); // B-4: the constitution BEFORE the event
      const cn = pl['cn'] as unknown as Constitution;
      validateConstitutionQuorum(cn, state.founderPubs.length, 'AMEND');
      state.constitution = cn;
      return;
    }

    case 'DISSOLVE': {
      requireQuorum(state, event);
      return;
    }

    default:
      /* v8 ignore next: validateEvent rejects unknown modes/types before
       * this switch — defensive only. */
      throw new PactError('UNKNOWN_EVENT_TYPE', 'verify', `ty: ${String(event.ty)}`);
  }
}

const states = new WeakMap<JournalVerifier, JournalState>();

function emptyState(): JournalState {
  return {
    pid: undefined,
    head: ZERO32,
    hashes: [],
    events: [],
    constitution: undefined,
    founderPubs: [],
    roster: new Map(),
    members: new Map(),
    invites: new Map(),
    usedInvites: new Set(),
    acts: new Set(),
    rotatedKeys: new Map(),
  };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ---------------------------------------------------------------------------
// Incremental verifier (rc.3, F-rc3-1 — specs/tz-pact-rc3-incremental.md)
// ---------------------------------------------------------------------------

/**
 * Incremental journal verifier (RC3-D4): the streaming face of the same
 * replay {@link verifyJournal} runs — there is no second, "fast"
 * verification path; the only skip is the re-check of an already
 * committed prefix (RC3-D2). Each `apply` runs the full PACTS §7.7
 * order on its event (chain → envelope/skew/signatures →
 * semantics/quorum); the committed prefix is protected by a
 * hash-commitment (RC3-D1) that `applySuffix` re-derives from the
 * caller's actual array on every call — a diverged journal rejects
 * with `FORK_DETECTED` (RC3-D3, fail-closed, no silent recompute; run
 * {@link verifyJournal} for a from-scratch diagnosis of the exact
 * cause).
 *
 * The state is opaque and in-memory only (RC3-D6): it is not a wire
 * format and never crosses `JournalStore`/`Channel`; suffix
 * verification against a foreign head is {@link verifyPrefix}'s
 * contract. Failed `apply*` calls leave the state unchanged — every
 * check precedes every mutation (PACTS §7.7 order).
 *
 * Skew (RC3-D5): the Clock is read per applied event; pin the clock
 * (or set `skewCheck: 'none'`) for era-consistent streaming replays.
 */
export class JournalVerifier {
  private readonly clock: Clock;
  private readonly skewCheck: 'all' | 'none';
  /** RC3-D1: hash-commitment of the applied prefix. */
  private commitment: Uint8Array;

  constructor(clock?: Clock, opts?: VerifyOptions) {
    this.clock = clock ?? systemClock();
    this.skewCheck = opts?.skewCheck ?? 'all';
    this.commitment = new Uint8Array(32);
    states.set(this, emptyState());
  }

  /** Number of applied events. */
  get height(): number {
    return states.get(this)!.events.length;
  }

  /** evHash of the last applied event; ZERO32 when empty. */
  get head(): string {
    return states.get(this)!.head;
  }

  /**
   * Full verification + application of one event. Throws `PactError`
   * on the first violation — the state is left unchanged.
   */
  apply(event: Event): void {
    const state = states.get(this)!;
    // (1) chain (PACTS §7.7 step 1)
    if (state.pid === undefined) state.pid = event.pid;
    else if (state.pid !== event.pid) {
      throw new PactError('FORK_DETECTED', 'verify', 'pid changed mid-journal');
    }
    if (event.sq !== state.events.length) {
      throw new PactError('FORK_DETECTED', 'verify', `sq ${event.sq} does not continue the chain (expected ${state.events.length})`);
    }
    if (event.ph !== state.head) {
      throw new PactError('FORK_DETECTED', 'verify', 'ph does not match the previous event hash');
    }
    // (2) envelope + skew + signatures (PACTS §7.7 step 2)
    validateEvent(event, 'verify');
    if (this.skewCheck === 'all') {
      const now = this.clock.now();
      if (Math.abs(event.iat - now) > SKEW_SECONDS) {
        throw new PactError('SKEW', 'verify', `iat ${event.iat} is outside ±${SKEW_SECONDS}s of the clock`);
      }
    }
    const tbs = tbsBytes(event);
    for (const s of event.sig) {
      const signature = b64urlDecode(s.s, 'sig.s', 64, 'verify');
      const publicKey = b64urlDecode(s.p, 'sig.p', 32, 'verify');
      if (!crypto.verify(signature, tbs, publicKey)) {
        throw new PactError('SIGNATURE_INVALID', 'verify', `Ed25519 verification failed for ${s.p}`);
      }
    }
    // (3) type semantics + quorum (PACTS §7.7 step 3)
    const hBytes = crypto.sha256(tbs);
    const hash = b64urlEncode(hBytes);
    applyEvent(state, event, hash);
    state.head = hash;
    state.events.push(event);
    state.hashes.push(hash);
    // RC3-D1: extend the prefix commitment.
    this.commitment = crypto.sha256(concatBytes(this.commitment, hBytes));
  }

  /**
   * RC3-D2: the cheap integrity pass over the caller's array
   * `[0..height)` — pid/sq/ph chain plus the hash-commitment
   * re-derived from the actual content (JCS + SHA-256, no signatures,
   * no state machine) — then the full check of `[height..len)`.
   * A no-op suffix applies nothing and still re-checks the prefix.
   */
  applySuffix(events: Event[]): void {
    const height = states.get(this)!.events.length;
    if (events.length < height) {
      throw new PactError('FORK_DETECTED', 'verify', `journal shorter than the committed prefix (${events.length} < ${height})`);
    }
    if (height > 0) this.integrityPass(events, height);
    for (let i = height; i < events.length; i++) {
      this.apply(events[i]);
    }
  }

  private integrityPass(events: Event[], height: number): void {
    let prevH: Uint8Array | undefined;
    let pid: string | undefined;
    let c: Uint8Array = new Uint8Array(32);
    for (let i = 0; i < height; i++) {
      const e = events[i];
      if (pid === undefined) pid = e.pid;
      else if (pid !== e.pid) {
        throw new PactError('FORK_DETECTED', 'verify', 'integrity pass: pid changed mid-journal');
      }
      if (e.sq !== i) {
        throw new PactError('FORK_DETECTED', 'verify', `integrity pass: sq ${e.sq} does not continue the chain (expected ${i})`);
      }
      const hBytes = crypto.sha256(tbsBytes(e));
      if (e.ph !== (prevH === undefined ? ZERO32 : b64urlEncode(prevH))) {
        throw new PactError('FORK_DETECTED', 'verify', 'integrity pass: ph does not match the previous event hash');
      }
      c = crypto.sha256(concatBytes(c, hBytes));
      prevH = hBytes;
    }
    if (prevH === undefined) {
      /* v8 ignore next: height > 0 guarantees at least one iteration —
       * defensive only. */
      throw new PactError('FORK_DETECTED', 'verify', 'integrity pass: empty prefix');
    }
    const headOk = b64urlEncode(prevH) === states.get(this)!.head;
    if (!headOk || !bytesEqual(c, this.commitment)) {
      throw new PactError('FORK_DETECTED', 'verify', 'journal prefix diverges from the committed verifier state (F-rc3-1) — run verifyJournal for a from-scratch diagnosis');
    }
  }

  /** Success view of the committed state (same fields as a clean verifyJournal). */
  snapshot(): VerifyResult {
    return successResult(states.get(this)!);
  }
}

/** Factory of {@link JournalVerifier} (RC3-D4). */
export function createJournalVerifier(clock?: Clock, opts?: VerifyOptions): JournalVerifier {
  return new JournalVerifier(clock, opts);
}

function replay(events: Event[], clock: Clock, skewCheck: 'all' | 'none' = 'all'): JournalState {
  const verifier = new JournalVerifier(clock, { skewCheck });
  verifier.applySuffix(events);
  return states.get(verifier)!;
}

// ---------------------------------------------------------------------------
// Public API (ТЗ §3.3)
// ---------------------------------------------------------------------------

/**
 * Full-journal verification — SYNC, Tier 1+2 (Р9): signatures plus the
 * deterministic roster/constitution replay. Tier 3 is never performed
 * here; use {@link verifyAct} for dated revocation checks; `warnings`
 * is always `[]` (Р9 — Tier 3 is async-only).
 *
 * @param events - Journal events in order (must start with GENESIS).
 * @param clock - Verification reference time; every event's `iat` must
 *   lie within ±30 s (inclusive). Historical replays pin the clock to
 *   the journal's era. Defaults to the system clock.
 * @param opts - `{ skewCheck: 'all' | 'none' }` — `'none'` skips the
 *   skew comparison for structural replays outside the reference era
 *   (assembly `finalize`, archive replay); everything else verifies
 *   in full.
 */
export function verifyJournal(events: Event[], clock?: Clock, opts?: VerifyOptions): VerifyResult {
  try {
    const state = replay(events, clock ?? systemClock(), opts?.skewCheck ?? 'all');
    return successResult(state);
  } catch (e) {
    if (e instanceof PactError) return failResult(e);
    /* v8 ignore next: non-PactError throws are programming bugs — rethrow. */
    throw e;
  }
}

/**
 * Prefix verification — SYNC, Tier 1+2 on `[0..k−1]` (B-7): the
 * subscriber must validate the whole prefix before accepting the head.
 * After replay, `journalHead` must equal `head` — divergence is
 * `FORK_DETECTED` (the prefix itself stays valid — D27).
 *
 * @param events - The prefix events `[0..k−1]`.
 * @param head - The JournalHead this prefix is claimed to end at.
 * @param clock - Optional verification reference (additive convenience;
 *   defaults to the system clock, same skew rule as verifyJournal).
 */
export function verifyPrefix(events: Event[], head: string, clock?: Clock): VerifyResult {
  try {
    const state = replay(events, clock ?? systemClock());
    if (state.head !== head) {
      throw new PactError('FORK_DETECTED', 'verify', `prefix head ${state.head} != expected ${head}`);
    }
    return successResult(state);
  } catch (e) {
    if (e instanceof PactError) return failResult(e);
    /* v8 ignore next: non-PactError throws are programming bugs — rethrow. */
    throw e;
  }
}

/**
 * Verifies the chain artifact (PACTS §5.4, D12): root-first serialized
 * core attestations; length must match the anchor type; every token
 * verifies against the previous subject (root → `rp`); the chain must
 * be alive at `actIat` (`iat ≤ actIat < exp` for every attestation);
 * for founders the last subject must bind to the journal's `pp`
 * commitment; returns the chain's `jti`s for dated revocation lookups.
 */
async function verifyChain(
  chain: VoucherChain,
  an: Anchor,
  rp: string,
  pp: string | undefined,
  actIat: number
): Promise<string[]> {
  const expectedLen = an === 'identity' ? 1 : an === 'handle' ? 2 : 3;
  if (chain.chain.length !== expectedLen) {
    throw new PactError('ANCHOR_MISMATCH', 'verify', `voucher chain length ${chain.chain.length} != ${expectedLen} for anchor ${an} (D12)`);
  }
  const jtis: string[] = [];
  let signer = b64urlDecode(rp, 'vc.rp', 32, 'verify');
  let lastSubject = '';
  for (const token of chain.chain) {
    let payload: { jti: string; subjectId: string; iat: number; exp: number };
    try {
      payload = Attestation.decode(token);
    } catch {
      throw new PactError('IDP_UNRESOLVABLE', 'verify', 'voucher chain token is not a decodable attestation');
    }
    if (!(await Attestation.verifySignature(token, signer))) {
      throw new PactError('IDP_UNRESOLVABLE', 'verify', 'voucher chain signature does not verify against the issuer');
    }
    // §5.4: the chain must be alive at the act — an expired or future
    // attestation grants no accountable identity at the act's moment.
    if (!(payload.iat <= actIat && actIat < payload.exp)) {
      throw new PactError('IDP_UNRESOLVABLE', 'verify', `voucher chain not alive at act.iat (iat ${payload.iat}, exp ${payload.exp})`);
    }
    jtis.push(payload.jti);
    lastSubject = payload.subjectId;
    signer = b64urlDecode(payload.subjectId, 'subjectId', 32, 'verify');
  }
  if (pp !== undefined && lastSubject !== pp) {
    throw new PactError('IDP_UNRESOLVABLE', 'verify', 'voucher chain does not bind to the founder pp commitment');
  }
  return jtis;
}

/**
 * Act verification — ASYNC, Tier 1+2+3 (Р9): full journal replay, then
 * the normative Tier 3 flow (Р3):
 *
 * 1. `chains` — out-of-band artifacts keyed by membership id
 *    (`evHash` of the membership event); the journal holds only the
 *    hash-commit (D34).
 * 2. Signer with `vc`: missing artifact ⇒ warning `VOUCHER_UNRESOLVED`;
 *    `SHA-256(JCS(chain)) != vc.rh` ⇒ `MALFORMED`; chain not verifiable
 *    against `vc.rp` ⇒ `IDP_UNRESOLVABLE` (fail-closed — a `vc` is a
 *    checkable promise of accountability).
 * 3. Every `jti` of a valid chain: `revocations.isRevokedAt(jti,
 *    act.iat)` — raw `jti`, inclusive on `at`; `true` ⇒ `ok: false`,
 *    `REVOKED` (SUB_ATTESTATION).
 * 4. Signer without `vc` ⇒ warning `NO_VOUCHER` (D6 — dial is off).
 * 5. No `revocations` (or without `isRevokedAt`) ⇒ `tier3:
 *    'unsupported'`, warning `TIER3_UNSUPPORTED`, `ok: true`.
 *
 * @param clock - Optional verification reference (additive; the same
 *   skew rule as verifyJournal — pin it to the journal's era for
 *   retrospective acts).
 *
 * Compromise windows (D20): acts signed by a key later rotated with
 * `ca` reject with `REVOKED` (ROTATE_KEY) when `iat > ca`; older acts
 * pass with warning `PRE_COMPROMISE_ACT`.
 */
export async function verifyAct(
  events: Event[],
  evHash: string,
  revocations?: RevocationChecker,
  chains?: Map<string, VoucherChain>,
  clock?: Clock
): Promise<VerifyResult> {
  try {
    const state = replay(events, clock ?? systemClock());

    // Locate the act.
    const idx = state.hashes.indexOf(evHash);
    if (idx === -1) {
      throw new PactError('MALFORMED', 'verify', 'evHash: act not found in the journal');
    }
    const act = state.events[idx];
    if (act.ty !== 'ACT' && act.ty !== 'REVERSE_ACT' && act.ty !== 'AMEND') {
      throw new PactError('MALFORMED', 'verify', `evHash: ${act.ty} is not an act`);
    }

    const warnings: NonNullable<VerifyResult['warnings']> = [];
    const stateFields = (): Partial<VerifyResult> => ({
      roster: sortedRoster(state.roster),
      pactRoot: state.hashes[0],
      journalHead: state.head,
      seq: act.sq,
    });

    // D20 compromise windows — journal-deterministic, act-scoped.
    let compromised = false;
    let preCompromise = false;
    for (const s of act.sig) {
      const rot = state.rotatedKeys.get(s.p);
      if (rot?.ca !== undefined) {
        if (act.iat > rot.ca) compromised = true;
        else preCompromise = true;
      }
    }
    if (compromised) {
      return {
        ok: false,
        error: new PactError('REVOKED', 'verify', `act signed after compromisedAt (ROTATE_KEY) by ${act.sig.map((s) => s.p).join(', ')}`),
        warnings,
        ...stateFields(),
      };
    }
    if (preCompromise) {
      warnings.push({ code: 'PRE_COMPROMISE_ACT', evHash });
    }

    // Tier 3 gate: the dated checker decides availability (Р3.5).
    const supported =
      revocations !== undefined && typeof revocations.isRevokedAt === 'function';
    if (!supported) {
      warnings.push({ code: 'TIER3_UNSUPPORTED', evHash });
      return { ok: true, tier3: 'unsupported', warnings, ...stateFields() };
    }

    // Per-signer voucher flow (Р3.2–Р3.4).
    for (const s of act.sig) {
      const rec = state.members.get(s.p);
      if (!rec) continue;
      const vc = rec.vc;
      if (!vc) {
        warnings.push({ code: 'NO_VOUCHER', evHash: rec.mid });
        continue;
      }
      const chain = chains?.get(rec.mid);
      if (!chain) {
        warnings.push({ code: 'VOUCHER_UNRESOLVED', evHash: rec.mid });
        continue;
      }
      // D34: the artifact must match the journal's hash-commit.
      const rh = b64urlEncode(crypto.sha256(canonicalize(chain.chain as unknown as JsonValue)));
      if (rh !== vc.rh) {
        throw new PactError('MALFORMED', 'verify', `vc.rh mismatch for membership ${rec.mid}`);
      }
      const jtis = await verifyChain(chain, rec.an, vc.rp, rec.pp, act.iat);
      for (const jti of jtis) {
        if (await revocations!.isRevokedAt!(jti, act.iat)) {
          return {
            ok: false,
            error: new PactError('REVOKED', 'verify', `attestation jti ${jti} revoked at or before act.iat (SUB_ATTESTATION)`),
            warnings,
            ...stateFields(),
          };
        }
      }
    }

    return { ok: true, tier3: 'supported', warnings, ...stateFields() };
  } catch (e) {
    if (e instanceof PactError) return failResult(e);
    /* v8 ignore next: non-PactError throws are programming bugs — rethrow. */
    throw e;
  }
}
