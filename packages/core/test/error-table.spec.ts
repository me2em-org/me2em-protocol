// test/error-table.spec.ts
//
// 5.8 — Error table: every AttestationErrorCode has a representative
// scenario with its documented level. The table is typed as
// Record<AttestationErrorCode, …>, so adding a code to the union
// without a scenario is a compile error — the table can never lag
// behind the error model (PR-7).
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Attestation,
  Identity,
  Session,
  type AttestationErrorCode,
  type AttestationLevel,
} from '../src/index.js';
import { base64urlEncode } from '../src/util.js';
import { expectAttestationError, tamperPayload } from './test-utils.js';

const testSeed = new Uint8Array(64).fill(42);

const grantA = {
  audiences: ['app.com'],
  scopes: ['charge:start', 'charge:stop'],
  maxSessionTtl: 7200,
  subNamePatterns: ['connector-*'],
};
const grantB = {
  audiences: ['app.com'],
  scopes: ['charge:start'],
  maxSessionTtl: 7200,
};

let identity: Identity;
let A: Awaited<ReturnType<Identity['attestHandle']>>;
let B: Awaited<ReturnType<Handle['attestSubHandle']>>;
let handleSession: Session;
let subSession: Session;
let sub: Awaited<ReturnType<Handle['deriveSubHandle']>>;

// Local type alias to avoid importing Handle only for types.
type Handle = Awaited<ReturnType<Identity['deriveHandle']>>;

beforeAll(async () => {
  identity = await Identity.fromSeed(testSeed);
  const handle = await identity.deriveHandle('station-001');
  sub = await handle.deriveSubHandle('connector-ccs');
  A = await identity.attestHandle('station-001', grantA);
  B = await handle.attestSubHandle('connector-ccs', grantB);
  handleSession = await Session.create(handle, {
    audience: 'app.com', scopes: ['charge:start'], ttl: 60,
  });
  subSession = await Session.create(sub, {
    audience: 'app.com', scopes: ['charge:start'], ttl: 60,
  });
});

interface Row {
  level: AttestationLevel;
  doc: string;
  trigger: () => Promise<unknown>;
}

const rootPub = () => identity.getPublicKey();
const nowSec = () => Math.floor(Date.now() / 1000);

const TABLE: Record<AttestationErrorCode, Row> = {
  MALFORMED: {
    level: 'FORMAT',
    doc: 'structurally invalid token (wrong shape)',
    trigger: async () => Attestation.decode('garbage'),
  },
  BAD_SIGNATURE: {
    level: 'SESSION',
    doc: 'stateless mode: payload tampered under a stale signature',
    trigger: async () => {
      const h = await identity.deriveHandle('et-signature');
      const s = await Session.create(h, { audience: 'app.com', scopes: ['charge:start'], ttl: 60 });
      return Session.verifyStateless(
        tamperPayload(s.token, (p) => { p.scp = ['swapped']; }),
        identity, 'app.com',
      );
    },
  },
  EXPIRED: {
    level: 'SESSION',
    doc: 'stateless mode: exp in the past (beyond ±30 s skew)',
    trigger: async () => {
      const h = await identity.deriveHandle('et-expired');
      const s = await Session.create(h, { audience: 'app.com', scopes: ['charge:start'], ttl: 60 });
      return Session.verifyStateless(
        tamperPayload(s.token, (p) => { p.exp = nowSec() - 100; }),
        identity, 'app.com',
      );
    },
  },
  NOT_YET_VALID: {
    level: 'SESSION',
    doc: 'stateless mode: iat in the future (beyond ±30 s skew)',
    trigger: async () => {
      const h = await identity.deriveHandle('et-future');
      const s = await Session.create(h, { audience: 'app.com', scopes: ['charge:start'], ttl: 60 });
      return Session.verifyStateless(
        tamperPayload(s.token, (p) => { p.iat = nowSec() + 3600; }),
        identity, 'app.com',
      );
    },
  },
  REVOKED: {
    level: 'SESSION',
    doc: 'stateless mode: revocation checker flags the session jti',
    trigger: async () => {
      const h = await identity.deriveHandle('et-revoked');
      const s = await Session.create(h, { audience: 'app.com', scopes: ['charge:start'], ttl: 60 });
      return Session.verifyStateless(s.token, identity, 'app.com', {
        isRevoked: async (jti) => jti === s.sessionId,
      });
    },
  },
  PATH_MISMATCH: {
    level: 'ROOT',
    doc: 'attested mode: root attestation subject ≠ session hPath[0]',
    trigger: async () => Session.verifyAttested(
      tamperPayload(subSession.token, (p) => { p.hPath = ['wrong-station', 'connector-ccs']; }),
      rootPub(), [A.token, B.token], 'app.com',
    ),
  },
  NAME_NOT_PERMITTED: {
    level: 'ROOT',
    doc: 'attested mode: SubHandle name not permitted by root subNamePatterns',
    trigger: async () => {
      const A2 = await identity.attestHandle('station-001', { ...grantA, subNamePatterns: ['meter-*'] });
      return Session.verifyAttested(subSession.token, rootPub(), [A2.token, B.token], 'app.com');
    },
  },
  SCOPE_EXCEEDED: {
    level: 'ROOT',
    doc: 'attested mode: handle grant scopes not nested under root grant',
    trigger: async () => {
      const h = await identity.deriveHandle('et-scope');
      const A3 = await identity.attestHandle('et-scope', {
        audiences: ['app.com'], scopes: ['base:read'], maxSessionTtl: 7200, subNamePatterns: ['s-*'],
      });
      const B3 = await h.attestSubHandle('s-1', {
        audiences: ['app.com'], scopes: ['extra:write'], maxSessionTtl: 7200,
      });
      const s3 = await Session.create(await h.deriveSubHandle('s-1'), {
        audience: 'app.com', scopes: ['extra:write'], ttl: 60,
      });
      return Session.verifyAttested(s3.token, rootPub(), [A3.token, B3.token], 'app.com');
    },
  },
  AUDIENCE_NOT_PERMITTED: {
    level: 'SESSION',
    doc: 'attested mode: verifier expects a different audience',
    trigger: async () => Session.verifyAttested(handleSession.token, rootPub(), [A.token], 'wrong.com'),
  },
  TTL_EXCEEDED: {
    level: 'ROOT',
    doc: 'attested mode: handle maxSessionTtl exceeds the root one',
    trigger: async () => {
      const h = await identity.deriveHandle('et-ttl');
      const A4 = await identity.attestHandle('et-ttl', {
        audiences: ['app.com'], scopes: ['x:1'], maxSessionTtl: 100, subNamePatterns: ['s-*'],
      });
      const B4 = await h.attestSubHandle('s-1', {
        audiences: ['app.com'], scopes: ['x:1'], maxSessionTtl: 9999,
      });
      const s4 = await Session.create(await h.deriveSubHandle('s-1'), {
        audience: 'app.com', scopes: ['x:1'], ttl: 60,
      });
      return Session.verifyAttested(s4.token, rootPub(), [A4.token, B4.token], 'app.com');
    },
  },
  CHAIN_INCOMPLETE: {
    level: 'FORMAT',
    doc: 'attested mode: empty chain for a handle session',
    trigger: async () => Session.verifyAttested(handleSession.token, rootPub(), [], 'app.com'),
  },
  SUBJECT_MISMATCH: {
    level: 'SUB_ATTESTATION',
    doc: 'attested mode: session hId ≠ handle attestation subjectId',
    trigger: async () => Session.verifyAttested(
      tamperPayload(subSession.token, (p) => { p.hId = base64urlEncode(new Uint8Array(32).fill(9)); }),
      rootPub(), [A.token, B.token], 'app.com',
    ),
  },
  SESSION_OUTLIVES_ATTESTATION: {
    level: 'SESSION',
    doc: 'attested mode: session outlives the earliest attestation',
    trigger: async () => {
      const h = await identity.deriveHandle('et-outlives');
      const A5 = await identity.attestHandle('et-outlives', {
        audiences: ['app.com'], scopes: ['x:1'], maxSessionTtl: 7200,
      }, { ttlSeconds: 600 });
      const B5 = await h.attestSubHandle('s-1', {
        audiences: ['app.com'], scopes: ['x:1'], maxSessionTtl: 7200,
      }, { ttlSeconds: 600 });
      const s5 = await Session.create(await h.deriveSubHandle('s-1'), {
        audience: 'app.com', scopes: ['x:1'], ttl: 3600,
      });
      return Session.verifyAttested(s5.token, rootPub(), [A5.token, B5.token], 'app.com');
    },
  },
  MAX_DEPTH_EXCEEDED: {
    level: 'FORMAT',
    doc: 'derivation tree: a leaf SubHandle cannot derive children',
    trigger: async () => sub.deriveSubHandle(),
  },
  DISPOSED: {
    level: 'FORMAT',
    doc: 'lifecycle: capability method on a disposed Handle',
    trigger: async () => {
      const h = await identity.deriveHandle('et-disposed');
      h.dispose();
      return h.sign(new TextEncoder().encode('x'));
    },
  },
};

describe('5.8 — error table (every code, representative level)', () => {
  it('the table covers the full AttestationErrorCode union', () => {
    const codes = Object.keys(TABLE) as AttestationErrorCode[];
    // Exhaustiveness is enforced at compile time by Record<…>; this
    // runtime pin documents the count (15 codes) explicitly.
    expect(codes).toHaveLength(15);
    expect(new Set(codes).size).toBe(15);
  });

  for (const [code, row] of Object.entries(TABLE) as [AttestationErrorCode, Row][]) {
    it(`${code} → level ${row.level} (${row.doc})`, async () => {
      await expectAttestationError(row.trigger(), code, row.level);
    });
  }
});
