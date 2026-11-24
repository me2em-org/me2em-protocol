// Journal benchmarks — rc.3 (F-rc3-1): the assembly fast path must
// stay flat in the prefix length (hash-integrity pass per RC3-D2, no
// per-event Ed25519/state-machine work on the committed prefix).
// Baseline: pnpm --filter @me2em/pact bench:baseline (bench/baseline.json).
import { bench, describe } from 'vitest';
import { b64urlEncode } from '../src/codec.js';
import { assembleAct, assembleGenesis } from '../src/assemble/index.js';
import { createJournalVerifier, verifyJournal } from '../src/verify.js';
import { CH, CN2, clockAt, Member, PID, T0 } from '../test/journal-utils.js';
import type { Event } from '../src/types.js';

const a = new Member(1);
const b = new Member(2);
const keys = [a.key, b.key];

function founderEntries(): Array<{ p: string; pp: string; an: 'identity' }> {
  const list = [a, b].map((m) => ({ p: m.pub, pp: m.anchorPub(), an: 'identity' as const }));
  list.sort((x, y) => (x.p < y.p ? -1 : x.p > y.p ? 1 : 0));
  return list;
}

const genesis: Event = assembleGenesis({
  pid: PID,
  ch: CH,
  cn: CN2,
  ft: founderEntries(),
  founderKeys: keys,
  clock: clockAt(T0),
});

function prefix(n: number): Event[] {
  const events = [genesis];
  for (let i = 0; i < n; i++) {
    events.push(assembleAct(events, { no: `bench-${b64urlEncode(new Uint8Array([i]))}-${i}` }, keys, clockAt(T0)));
  }
  return events;
}

const p32 = prefix(32);
const p64 = prefix(64);
const p128 = prefix(128);

// The committed-state integrity pass (RC3-D2): a verifier holding a
// verified 64-event prefix, re-checked on every bench call — the cost
// the warm assembly path pays for the prefix instead of a full replay.
const committed64 = createJournalVerifier(clockAt(T0), { skewCheck: 'none' });
committed64.applySuffix(p64);

describe('pact journal (rc.3, F-rc3-1)', () => {
  // Cache-miss assemblies (a fresh foreign prefix tail each call) —
  // the full-replay path, i.e. the rc.2 per-assembly cost. The linear
  // growth in N is the baseline the incremental path replaces.
  bench('assembleAct onto 32-event prefix (cache miss — full replay)', () => {
    assembleAct(p32, { no: 'bench-run' }, keys, clockAt(T0));
  });

  bench('assembleAct onto 64-event prefix (cache miss — full replay)', () => {
    assembleAct(p64, { no: 'bench-run' }, keys, clockAt(T0));
  });

  bench('assembleAct onto 128-event prefix (cache miss — full replay)', () => {
    assembleAct(p128, { no: 'bench-run' }, keys, clockAt(T0));
  });

  // The warm-path prefix cost: chain + hash-commitment re-derivation,
  // no signatures, no state machine (RC3-D2).
  bench('committed-prefix integrity pass, 64 events', () => {
    committed64.applySuffix(p64);
  });

  bench('JournalVerifier.applySuffix 64 events (cold)', () => {
    const v = createJournalVerifier(clockAt(T0), { skewCheck: 'none' });
    v.applySuffix(p64);
  });

  bench('verifyJournal 64 events (cold reference)', () => {
    verifyJournal(p64, clockAt(T0), { skewCheck: 'none' });
  });
});
