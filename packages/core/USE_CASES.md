# Me2em Protocol: Advanced Use Cases & Scenarios

Production-ready examples for `@me2em/core` 0.6.0.

The library supports **two verification modes** (full definition in the
[README](./README.md#verification-modes)):

- **Mode 1 — `Session.verifyStateless`.** The verifier holds the
  `Identity` — the private root key. For infrastructure you fully
  control. SubHandle constraints are enforced at session *creation* only.
- **Mode 2 — `Session.verifyAttested`.** The verifier holds only the root
  **public** key plus an attestation chain. For external audiences.
  Grant constraints are **enforced at verification**, and revoking an
  attestation `jti` disables the whole branch — current and future
  sessions.

Every scenario below shows where each mode fits.

Shared architecture: `MAX_DEPTH = 2`, two derivation entry points
(`Handle.deriveSubHandle` autonomous / `Identity.deriveSubHandle`
atomic), strict key encapsulation, TTL + optional `RevocationChecker`.

---

## Scenario 1: EV Charging Station

```text
Identity: EV-Network-Main (network owner — root private key lives ONLY here)
  └─ Handle: station-001  ◀── A = attestHandle (issued once, at provisioning)
       │   (autonomous device, offline)
       ├─ SubHandle: connector-ccs   ◀── B = attestSubHandle (derived locally)
       └─ SubHandle: meter-001       ◀── B = attestSubHandle (derived locally)
```

### 1.1 Provisioning (online, once per station)

```typescript
import { Identity } from '@me2em/core';

const networkIdentity = await Identity.fromSeed(await loadSeedFromVault());

const grantA = {
  audiences: ['ev-charging-app.com', 'fleet-management.com'],
  scopes: ['charge:start', 'charge:stop', 'charge:status'],
  maxSessionTtl: 7200,
  subNamePatterns: ['connector-*', 'meter-*'],
};
const A = await networkIdentity.attestHandle('station-001', grantA);

// Ship to the device: the Handle private key + A.token.
// A is a PUBLIC artifact — a signed statement, not a secret.
```

### 1.2 Autonomous operation (offline)

The station adds a connector with **two local operations** — derivation
plus a self-issued child attestation. No Identity, no network:

```typescript
class ChargingStation {
  constructor(private stationHandle: Handle, private attestationA: string) {}

  async addConnector(connectorId: string, type: string) {
    const connector = await this.stationHandle.deriveSubHandle(connectorId, {
      allowedAudiences: ['ev-charging-app.com'],
      allowedScopes: ['charge:start', 'charge:stop', 'charge:status'],
      maxSessionTtl: 7200,
      displayName: `${type} Connector`,
    });
    const B = await this.stationHandle.attestSubHandle(connectorId, {
      audiences: ['ev-charging-app.com'],
      scopes: ['charge:start', 'charge:stop', 'charge:status'],
      maxSessionTtl: 7200,
    }, { ttlSeconds: 365 * 24 * 3600 }); // device trust window
    return { connector, B };
  }

  async createChargingSession(connector: SubHandle, clientId: string) {
    return Session.create(connector, {
      audience: 'ev-charging-app.com',
      scopes: ['charge:start', 'charge:status'],
      ttl: 3600,
      sessionId: `session_${clientId}_${Date.now()}`,
    });
  }
}
```

### 1.3 External verification (Mode 2 — ev-charging-app.com)

The app is an **independent organization**; it never receives the
network's private root:

```typescript
async function authorizeCharging(token: string, chain: string[]) {
  try {
    const s = await Session.verifyAttested(
      token, EV_NETWORK_ROOT_PUBLIC_KEY, chain, 'ev-charging-app.com',
      revocationChecker,
    );
    await startCharging(s.path![1]); // e.g. 'connector-ccs'
  } catch (e) {
    if (e instanceof AttestationError) {
      // route by e.code / e.level — see README error table
    }
    throw new Error('Unauthorized');
  }
}
```

A compromised station is **contained by its grant**: it can only attest
`connector-*`/`meter-*` names, only `charge:*` scopes, only sessions
≤ 7200s. Revoking the whole station = revoking `A.jti` — one flag that
every verifier honors.

### 1.4 Internal verification (Mode 1 — fleet-management.com, if you own it)

```typescript
const verified = await Session.verifyStateless(
  token, networkIdentity, 'fleet-management.com', revocationChecker,
);
```

Use Mode 1 only where the verifier is trusted with the root key.

---

## Scenario 2: Drone Fleet — selling access (Mode 2 flagship)

Without attestations this scenario is **not implementable safely**: the
buyer would need the operator's private root, or would receive an
unlimited, eternal capability. With Mode 2 the buyer receives a signed,
time-boxed, scope-boxed receipt — verifiable independently.

```text
Identity: Drone-Fleet-Ops (operator)
  └─ Handle: drone-alpha  ◀── A = attestHandle (at deploy):
       │                      camera clients: ['client-photography.com'],
       │                      scopes camera:*, maxSessionTtl 3600
       ├─ SubHandle: camera-module   (internal)
       ├─ SubHandle: telemetry       (internal, Mode 1)
       └─ SubHandle: camera-client-xyz ◀── B = attestSubHandle (in the field)
```

### 2.1 Deploy (once per drone)

```typescript
const A = await fleetIdentity.attestHandle('drone-alpha', {
  audiences: ['client-photography.com'],
  scopes: ['camera:capture', 'camera:stream', 'camera:download'],
  maxSessionTtl: 3600,
  subNamePatterns: ['camera-*', 'sensor-*'],
});
// Ship droneHandle + A.token to the drone.
```

### 2.2 The sale (drone, in the field, offline)

A client buys 30 minutes of camera access. The drone issues the session
itself and hands over the **session token plus the attestation chain** —
the client never receives any private key. The signed, time-boxed,
scope-boxed token *is* the purchasable artifact:

```typescript
async function sellCameraAccess(clientId: string) {
  const subName = `camera-client-${clientId}`;
  const sub = await droneHandle.deriveSubHandle(subName);
  const B = await droneHandle.attestSubHandle(subName, {
    audiences: ['client-photography.com'],
    scopes: ['camera:capture', 'camera:download'],
    maxSessionTtl: 1800,
  }, { ttlSeconds: 1800 });                 // the attestation dies with the deal

  const session = await Session.create(sub, {
    audience: 'client-photography.com',
    scopes: ['camera:capture', 'camera:download'],
    ttl: 1800,
  });

  // Hand to the client over QR/NFC at purchase:
  return { token: session.token, chain: [A.token, B.token] };
}
```

### 2.3 Client-side verification

```typescript
const s = await Session.verifyAttested(
  token, FLEET_ROOT_PUBLIC_KEY, chain, 'client-photography.com',
);
// s.scopes === ['camera:capture', 'camera:download'], TTL ≤ 1800s —
// cryptographically pinned to what was purchased.
```

The deal is auditable: the purchased scope and duration are **signed
statements**. The client cannot extend them (`TTL_EXCEEDED`,
`SESSION_OUTLIVES_ATTESTATION`) — renewal requires contacting the drone
again, which is a feature, not a limitation. The operator can revoke
mid-flight by revoking `B.jti`.

### 2.4 Internal telemetry stays Mode 1

```typescript
const telemetry = await droneHandle.deriveSubHandle('telemetry', {
  allowedAudiences: ['fleet-control.internal'],
  allowedScopes: ['telemetry:read', 'telemetry:stream'],
  maxSessionTtl: 86400,
});
// fleet-control verifies with verifyStateless(fleetIdentity) — it is
// part of the trusted perimeter.
```

---

## Scenario 3: Corporate Messenger

```text
Identity: Corp-Messenger-Root (corporation)
  └─ Handle: department-engineering  ◀── A = attestHandle:
       │   (HR machine — NO root key)   worker-*/contractor-*,
       │                                scopes ⊆ messaging, maxTtl 28800
       ├─ SubHandle: worker-alice ◀── B = attestSubHandle (HR, offline)
       └─ SubHandle: contractor-x ◀── B with a two-week TTL
```

### 3.1 Setup

```typescript
const grantA = {
  audiences: ['corp-messenger.internal', 'jira.internal'],
  scopes: ['message:send', 'message:receive', 'channel:engineering'],
  maxSessionTtl: 28800, // one workday
  subNamePatterns: ['worker-*', 'contractor-*'],
};
const A = await corpIdentity.attestHandle('department-engineering', grantA);
// Ship deptHandle + A.token to the HR system.
```

### 3.2 HR hires — autonomously, without the root

```typescript
async function hireEmployee(employeeId: string, name: string, role: string) {
  const scopes = role === 'Manager'
    ? ['message:send', 'message:receive', 'channel:engineering', 'channel:team-lead']
    : ['message:send', 'message:receive', 'channel:engineering'];

  const worker = await deptHandle.deriveSubHandle(employeeId, {
    allowedAudiences: ['corp-messenger.internal', 'jira.internal'],
    allowedScopes: scopes,
    maxSessionTtl: 28800,
    displayName: name,
    role,
  });
  const B = await deptHandle.attestSubHandle(employeeId, {
    audiences: ['corp-messenger.internal', 'jira.internal'],
    scopes,
    maxSessionTtl: 28800,
  }, { ttlSeconds: 365 * 24 * 3600 });
  return { worker, B };
}
```

Note: even a compromised HR machine **cannot escalate** —
`channel:management` is outside `grantA.scopes`, so such a child
attestation is rejected by every verifier (`SCOPE_EXCEEDED` at level
`ROOT`). Privileges above the department grant require a separate
handle attested **directly by the root**.

### 3.3 Multi-service verification

Messenger **and** Jira verify independently with the same public root:

```typescript
// corp-messenger.internal:
const s = await Session.verifyAttested(
  token, CORP_ROOT_PUB, [A.token, B.token], 'corp-messenger.internal',
  revocationChecker,
);
// jira.internal — identical call, different audience; both honor the
// same revocation store.
```

### 3.4 Firing an employee (the correct way)

Revoke the worker's **attestation** `jti` — one operation, effective in
every service that checks revocations:

```typescript
await revocationService.revokeAttestation(B.jti);
// All existing AND future sessions of worker-alice are rejected
// (REVOKED at level HANDLE_ATTESTATION), regardless of session TTL.
```

> ⚠️ Mode 1 has no protocol-level handle revocation — the
> `RevocationChecker` interface only receives session `jti`. If you must
> stay in Mode 1, the only workaround is a **jti naming convention**
> (`${handleId}:${uuid}`) plus a store that parses it — brittle and easy
> to get wrong. Mode 2 makes branch revocation a first-class primitive.

### 3.5 Contractors

```typescript
const B = await deptHandle.attestSubHandle('contractor-external-xyz', {
  audiences: ['corp-messenger.internal'],
  scopes: ['message:send', 'message:receive', 'channel:project-alpha'],
  maxSessionTtl: 28800,
}, { ttlSeconds: 14 * 24 * 3600 }); // access self-expires in 2 weeks —
                                    // no HR action needed on the end date
```

---

## Comparison

| Aspect | EV Station | Drone Fleet | Corporate Messenger |
|---|---|---|---|
| Identity | network owner | fleet operator | corporation |
| Handle | station (device) | drone (device) | department (group) |
| SubHandle | connector / meter | camera / sensor | employee / contractor |
| Autonomous ops | ✅ offline attest B | ✅ offline attest B (the sale) | ✅ HR without root |
| External verifiers | ✅ Mode 2 | ✅ Mode 2 (the sale itself) | ✅ Mode 2 (messenger + Jira) |
| Internal verifiers | Mode 1 optional | Mode 1 (telemetry) | Mode 1 optional |
| Revocation granularity | station = A.jti; connector = B.jti | deal = B.jti | employee = B.jti |
| Session TTL | 1–2 h | ≤ 1 h (deal ≤ 30 min) | 8 h workday |

## Cryptographic consistency

```typescript
// Autonomous (on the device):
const viaHandle = await stationHandle.deriveSubHandle('connector-ccs');
// Atomic (on any verifier):
const viaIdentity = await identity.deriveSubHandle('station-001', 'connector-ccs');
// viaHandle.getPublicKey() === viaIdentity.getPublicKey() — guaranteed:
// both entry points use DERIVATION_PATHS.subhandle('station-001', 'connector-ccs').
```

## Performance (indicative)

Measured on a modern laptop with @noble — treat as order-of-magnitude:
derivation ~0.5 ms, session verification ~1.5 ms, revocation lookup
~0.1 ms. Benchmark against your own runtime for SLOs.

---

## 🏗️ Infrastructure: production `RevocationChecker` (Redis)

The protocol deliberately does not prescribe a revocation backend. Below
is a production-ready Redis implementation covering **both** artifact
types: session `jti` **and** attestation `jti` (Mode 2 branch
revocation).

```typescript
import Redis from 'ioredis';
import { RevocationChecker } from '@me2em/core';

export class RedisRevocationService implements RevocationChecker {
  private readonly redis: Redis;
  // Single namespace: attestation jti and session jti are both UUIDs.
  // If you need to distinguish them, use two keys and wrap the checker
  // per call site.
  private readonly REVOKED_KEY = 'me2em:revoked';

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  /** Called by verifyStateless / verifyAttested for every level's jti. */
  async isRevoked(jti: string): Promise<boolean> {
    return (await this.redis.sismember(this.REVOKED_KEY, jti)) === 1;
  }

  /** Revoke a single session. */
  async revokeSession(jti: string): Promise<void> {
    await this.redis.sadd(this.REVOKED_KEY, jti);
  }

  /** Mode 2: revoke an entire branch (a handle or a subhandle) by
   *  revoking its ATTESTATION jti. Every verifier that consults this
   *  store rejects all current and future sessions under it. */
  async revokeAttestation(attestationJti: string): Promise<void> {
    await this.redis.sadd(this.REVOKED_KEY, attestationJti);
  }
}
```

Integration:

```typescript
const revocationService = new RedisRevocationService(process.env.REDIS_URL!);

async function authorizeRequest(req: Request, chain: string[]) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) throw new Error('No token provided');

  const verified = await Session.verifyAttested(
    token, CORP_ROOT_PUB, chain, 'corp-messenger.internal', revocationService,
  );
  return verified; // handleName, scopes, path
}
```

**Operations notes:**
- `SISMEMBER` is O(1): ~0.1–0.2 ms added per verification level.
- One revoked UUID ≈ 36 bytes; 1M entries < 50 MB.
- Sessions expire naturally, but revocation entries do not: run a cron
  that removes entries whose token `exp` has passed, or store per-key
  `SET ... EXPIRE (exp - now + skew)` instead of a shared SET.

---

## Summary

| # | Scenario | What it demonstrates |
|---|---|---|
| 1 | EV Station | Fully offline device operation; external org verification; grant-bounded compromise; station-wide revocation |
| 2 | Drone Fleet | **Selling access**: signed, time-boxed receipts verifiable by the buyer; Mode 1 for internal telemetry |
| 3 | Corporate Messenger | Autonomous HR without the root; no privilege escalation past the department grant; cross-service revocation; contractor self-expiry |

Shared guarantees: `MAX_DEPTH = 2`, two derivation entry points with
identical keys, encapsulated private keys, TTL + optional revocation —
and, in Mode 2, **enforceable delegation without ever sharing the root**.