# Me2em Protocol: Advanced Use Cases & Scenarios

Production-ready examples for `@me2em/core` v0.7.0-alpha.1 and
`@me2em/crypto` v0.1.0-alpha.1.

The protocol supports **two verification modes** (full definition in the
[README](./README.md#verification-modes)):

- **Mode 1 — `Session.verifyStateless`.** The verifier holds the
  `Identity` — the private root key. For infrastructure you fully
  control. SubHandle constraints are enforced at session *creation* only.
- **Mode 2 — `Session.verifyAttested`.** The verifier holds only the root
  **public** key plus an attestation chain. For external audiences.
  Grant constraints are **enforced at verification**, and revoking an
  attestation `jti` disables the whole branch — current and future
  sessions.

Every scenario below shows where each mode fits — and which approved use
case (UC) it implements. The registry:

| UC | Name | One line |
|----|------|----------|
| UC-1 | AI Agent Delegation | An autonomous agent with its own key, an owner-signed mandate, one-call revocation |
| UC-2 | IoT Device Hierarchy | Devices derive and attest children offline; grants bound compromise; branch revocation |
| UC-3 | Multi-Context Identity | One person, isolated personas; departments and employees in the corporate reading |
| UC-4 | Multi-App SSO (Shared User Base) | One instance, many apps; the seed is the account; no user database |
| UC-5 | Deterministic Password Manager | Per-service secrets derived from the seed; nothing stored |
| UC-6 | E2EE Messaging | X3DH channels, per-message keys, envelopes for offline recipients |

Protocol terms are domain-neutral; each scenario defines its own
interpretation (see the root [README → Terminology](../../README.md#-terminology)):

| Scenario | UC | Handle is… | SubHandle is… | Attestation is… |
|----------|-----|------------|----------------|-----------------|
| 1 — AI Agent Delegation | UC-1 | An autonomous AI agent | — | The agent's mandate |
| 2 — Satellite Capacity Marketplace | UC-2 | A spacecraft | A payload / a sold tasking window | The sold capability |
| 3 — Drone Fleet Management | UC-2 | An airframe | A sensor / a maintenance grant | Provisioning / maintenance access |
| 4 — Multi-App SSO | UC-4 | A per-app persona | — | Partner-app delegation (optional) |
| 5 — Multi-Context Identity | UC-3 | A persona | A delegated leaf (guest, device) | In-persona delegation |
| 6 — EV Charging Network | UC-2 | A charging station | A connector / meter | Device provisioning |
| 7 — Corporate Messenger | UC-3 | A department | An employee / contractor | Employment / contract |
| 8 — Deterministic Password Manager | UC-5 | A service context | — | — |
| 9 — E2EE Messenger | UC-6 | The messaging identity | A device (optional) | — |

Shared architecture: `MAX_DEPTH = 2`, two derivation entry points
(`Handle.deriveSubHandle` autonomous / `Identity.deriveSubHandle`
atomic), strict key encapsulation, TTL + optional `RevocationChecker`.
Scenarios 1 and 9 additionally use `@me2em/crypto`; scenario 8 touches
it via Argon2id/HIBP.

---


## Scenario 1: AI Agent Delegation (UC-1)

An autonomous AI agent needs its own cryptographic identity: isolated
from its owner, attested by the owner, revocable instantly. This is the
same split-knowledge pattern as the corporate scenario — but the
"employee" is software, and the "employer" may be an orchestrator, an
MCP host, or a human owner.

```text
Identity: Researcher (the human owner — seed on paper)
  └─ Handle: agent-research-assistant  ◀── A = attestHandle:
       │   (software agent — runs anywhere)   the agent's MANDATE
       └─ connects to MCP servers, tools, and peer agents
```

### 1.1 Issuing the mandate (owner, once per agent)

```typescript
const A = await ownerIdentity.attestHandle('agent-research-assistant', {
  audiences: ['mcp.example.com', 'tools.example.com'],
  scopes: ['search:web', 'files:read'],
  maxSessionTtl: 3600,
});
// Ship agentHandle + A.token to the agent runtime.
```

The attestation **is the mandate**: it cryptographically states that
this key belongs to an agent of this owner, allowed these scopes, for
these audiences, until this date. Anyone can verify it; nobody —
including the agent itself — can forge a wider one.

### 1.2 Agent ↔ known service (static ECDH — no pre-keys needed)

For a KNOWN, online service (an MCP server publishing its static
Ed25519 key), the agent derives a channel key directly — no pre-key
material, no round trips:

```typescript
import { hkdfWithInfo } from '@me2em/crypto';

const serverPub = await fetchServerIdentityKey('mcp.example.com');
const shared = await agentHandle.deriveSharedSecret(serverPub);
const sessionKey = await hkdfWithInfo(
  shared, salt, 'me2em/crypto/v1/agent-session', 32,
);
```

**Method selection rule** (see root README → Terminology):
`deriveSharedSecret` is for two parties that already know each other's
public keys. If the AGENT instead *accepts asynchronous tasks* while
offline, it publishes a `PreKeyBundle` and peers use
`wrapKeyForRecipient` (@me2em/crypto) — pre-key material matters only
for inbound, not outbound.

### 1.3 Agent sessions with attested verification

```typescript
const session = await Session.create(agentHandle, {
  audience: 'mcp.example.com',
  scopes: ['search:web'],
  ttl: 1800,
});

// The MCP server verifies with the owner's PUBLIC root key only:
await Session.verifyAttested(
  session.token, OWNER_ROOT_PUB, [A.token], 'mcp.example.com',
);
// → knows: whose agent, what mandate, not revoked, within TTL
```

### 1.4 Revocation — the killer feature for agents

An agent gone rogue (or a hijacked runtime) is neutralized by ONE
operation:

```typescript
await revocationService.revokeAttestation(A.jti);
```

Every verifier that consults the store rejects the agent from that
moment — across every service, every audience. Compare with API keys:
there you must hunt down every deployment of the key.

---

## Scenario 2: Satellite Capacity Marketplace (UC-2 — selling access, Mode 2 flagship)

A satellite operator sells time-boxed slices of spacecraft resources —
Earth-observation *tasking / direct access* windows, *transponder
leasing*, downlink capacity. Without attestations this cannot be done
safely: the buyer would need the operator's private root, or would
receive an unlimited, eternal capability. With Mode 2 the buyer receives
a signed, time-boxed, scope-boxed receipt — verifiable offline, with no
private keys handed over.

```text
Identity: Orbital-Ops (operator — root private key lives ONLY here)
  └─ Handle: sat-eo-07  ◀── A = attestHandle (once, in the commissioning run)
       │   (autonomous spacecraft; ground contacts are short and rare)
       ├─ SubHandle: imaging-payload   (internal, Mode 1)
       ├─ SubHandle: adcs-telemetry    (internal, Mode 1)
       └─ SubHandle: client-acme-42    ◀── B = attestSubHandle (the sold window)
```

### 2.1 Commissioning (once per spacecraft)

```typescript
const A = await orbitalOps.attestHandle('sat-eo-07', {
  audiences: ['tasking.portal.example', 'gs-ops.internal'],
  scopes: ['imaging:task', 'imaging:fetch', 'downlink:reserve'],
  maxSessionTtl: 3600,
  subNamePatterns: ['client-*', 'payload-*'],
});
// Ship satHandle + A.token to the spacecraft.
```

### 2.2 The sale (onboard, offline between contacts)

A client buys a 30-minute imaging window. The spacecraft derives the
buyer's SubHandle and issues the child attestation itself — at the next
ground contact, or pre-provisioned before the pass:

```typescript
async function sellTaskingWindow(clientId: string) {
  const subName = `client-${clientId}`;
  const sub = await satHandle.deriveSubHandle(subName);
  const B = await satHandle.attestSubHandle(subName, {
    audiences: ['tasking.portal.example'],
    scopes: ['imaging:task', 'imaging:fetch'],
    maxSessionTtl: 1800,
  }, { ttlSeconds: 1800 });                 // the attestation dies with the window

  const session = await Session.create(sub, {
    audience: 'tasking.portal.example',
    scopes: ['imaging:task', 'imaging:fetch'],
    ttl: 1800,
  });

  // Delivered through the sales API: token + chain. No private keys move.
  return { token: session.token, chain: [A.token, B.token] };
}
```

### 2.3 Buyer-side verification

```typescript
const s = await Session.verifyAttested(
  token, ORBITAL_ROOT_PUBLIC_KEY, chain, 'tasking.portal.example',
);
// s.scopes === ['imaging:task', 'imaging:fetch'], TTL ≤ 1800s —
// cryptographically pinned to what was purchased.
```

The receipt *is* the product: purchased scope and duration are signed
statements the buyer cannot extend (`TTL_EXCEEDED`,
`SESSION_OUTLIVES_ATTESTATION`) — renewal is a new sale. The operator can
kill a window mid-flight by revoking `B.jti` (e.g. spacecraft in safe
mode). Internal payload/telemetry sessions verify with
`verifyStateless` — the ground segment is the trusted perimeter.

---

## Scenario 3: Drone Fleet Management (UC-2 — IoT Device Hierarchy)

Fleet operations: provisioning airframes at deploy, isolating onboard
subsystems, granting time-boxed maintenance access in the field, and
revoking a lost drone in one call. No marketplace here — everything stays
inside the operator's perimeter.

```text
Identity: FleetOps-Root (operator)
  └─ Handle: drone-alpha  ◀── A = attestHandle (per airframe, at deploy)
       ├─ SubHandle: gimbal-camera     (internal, Mode 1)
       ├─ SubHandle: flight-telemetry  (internal, Mode 1)
       └─ SubHandle: maint-tech-77     ◀── B = attestSubHandle (a maintenance window)
```

### 3.1 Deploy (once per airframe)

```typescript
const A = await fleetIdentity.attestHandle('drone-alpha', {
  audiences: ['fleet-control.internal'],
  scopes: ['telemetry:stream', 'camera:capture', 'maintenance:run'],
  maxSessionTtl: 3600,
  subNamePatterns: ['gimbal-*', 'sensor-*', 'maint-*'],
});
// Ship droneHandle + A.token to the airframe.
```

### 3.2 A technician in the field

48 hours of maintenance access, issued by the drone itself — offline, at
the hangar; the grant expires without any HR-style action:

```typescript
const sub = await droneHandle.deriveSubHandle('maint-tech-77', {
  allowedAudiences: ['fleet-control.internal'],
  allowedScopes: ['maintenance:run', 'telemetry:read'],
  maxSessionTtl: 3600,
});
const B = await droneHandle.attestSubHandle('maint-tech-77', {
  audiences: ['fleet-control.internal'],
  scopes: ['maintenance:run', 'telemetry:read'],
  maxSessionTtl: 3600,
}, { ttlSeconds: 48 * 3600 });
// Hand the tech { token, chain: [A.token, B.token] }.
```

### 3.3 A lost airframe

```typescript
await revocationService.revokeAttestation(A.jti);
// Every session under drone-alpha — camera, telemetry, any future
// maintenance grant — is rejected everywhere, instantly.
```

Telemetry verifies with `verifyStateless` (Mode 1): fleet control is part
of the trusted perimeter and already holds the root key.

---

## Scenario 4: Multi-App SSO (UC-4 — Shared User Base)

One Me2em instance, many applications, zero registered users. The account
is the seed phrase; the server stores no profiles — only hashed refresh
tokens and revoked `jti` entries. This is the commercial core of the
cloud edition; a self-hosted instance becomes the auth center for its own
apps the same way.

```text
Identity: user seed (on paper / in the vault app)
  ├─ Handle: @taxi        ──→ session → taxi-app.example
  ├─ Handle: @freelance   ──→ session → freelance-app.example
  └─ Handle: @home        ──→ session → housing-app.example
```

### 4.1 First login (App_A)

The seed never leaves the client; derivation happens in the browser:

```typescript
const identity = await Identity.fromSeed(await get32ByteSeedFromMnemonic(phrase));
const handle = await identity.deriveHandle('taxi');
const session = await Session.create(handle, {
  audience: 'taxi-app.example',
  scopes: ['ride:book'],
  ttl: 1800,
});
// taxi-app's backend verifies with verifyStateless — same org, Mode 1.
```

The instance also sets an HttpOnly cookie for its own domain
(`me2em.com` or a subdomain) alongside the app session.

### 4.2 Automatic login (App_B)

App_B uses the same instance. The browser carries the instance cookie,
the instance confirms the session, App_B receives its own token — the
user never types the seed again.

### 4.3 Correlation is opt-in

Every app receives a different Handle. Taxi and freelance see unrelated
identities unless the user deliberately reuses one Handle across both.
Cross-app correlation is the user's choice — enforced by derivation, not
by a privacy policy.

### 4.4 "Log out everywhere"

Revocation is why the server keeps *something*: hashed refresh tokens and
revoked `jti` entries — the minimum that enables logout-from-all-devices
without storing anything that reconstructs identity or content.

For **external** apps (partners outside the perimeter) the same flow
switches to Mode 2: the instance attests the partner's Handles, and the
partner verifies chains with the root public key only.

---

## Scenario 5: Multi-Context Identity (UC-3 — personas)

The personal reading of the protocol: one human, many isolated contexts.
This is the Quick Start scenario of the root README (two personas, three
packages, end to end) — here with the delegation layer added.

```text
Identity: Alice (seed on paper)
  ├─ Handle: @work        ──→ sessions → employer tools
  ├─ Handle: @portfolio   ──→ sessions → client-facing services
  └─ Handle: @home  ◀── B = attestSubHandle: guest token, 24 h, gate only
       └─ SubHandle: gate-guest
```

### 5.1 Personas

```typescript
const work = await identity.deriveHandle('work', { displayName: 'Alice @ Acme' });
const portfolio = await identity.deriveHandle('portfolio');
// Separate Ed25519 keypairs; compromising one reveals nothing about the others.
```

### 5.2 A guest at the building

Delegated access within a persona — the house Handle attests a leaf that
can only open the gate, for a day:

```typescript
const home = await identity.deriveHandle('home');
const guest = await home.deriveSubHandle('gate-guest', {
  allowedAudiences: ['housing.example'],
  allowedScopes: ['gate:open'],
  maxSessionTtl: 900,
});
const B = await home.attestSubHandle('gate-guest', {
  audiences: ['housing.example'],
  scopes: ['gate:open'],
  maxSessionTtl: 900,
}, { ttlSeconds: 24 * 3600 });
// Hand the guest { token, chain: [B.token] }; cameras and climate sit
// outside the grant — SCOPE_EXCEEDED if asked.
```

Full walkthrough: root README → Quick Start (UC-3).



## Scenario 6: EV Charging Network (UC-2 — IoT Device Hierarchy)

```text
Identity: EV-Network-Main (network owner — root private key lives ONLY here)
  └─ Handle: station-001  ◀── A = attestHandle (issued once, at provisioning)
       │   (autonomous device, offline)
       ├─ SubHandle: connector-ccs   ◀── B = attestSubHandle (derived locally)
       └─ SubHandle: meter-001       ◀── B = attestSubHandle (derived locally)
```

### 6.1 Provisioning (online, once per station)

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

### 6.2 Autonomous operation (offline)

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

### 6.3 External verification (Mode 2 — ev-charging-app.com)

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

### 6.4 Internal verification (Mode 1 — fleet-management.com, if you own it)

```typescript
const verified = await Session.verifyStateless(
  token, networkIdentity, 'fleet-management.com', revocationChecker,
);
```

Use Mode 1 only where the verifier is trusted with the root key.

---

## Scenario 7: Corporate Messenger (UC-3 — Multi-Context Identity)

```text
Identity: Corp-Messenger-Root (corporation)
  └─ Handle: department-engineering  ◀── A = attestHandle:
       │   (HR machine — NO root key)   worker-*/contractor-*,
       │                                scopes ⊆ messaging, maxTtl 28800
       ├─ SubHandle: worker-alice ◀── B = attestSubHandle (HR, offline)
       └─ SubHandle: contractor-x ◀── B with a two-week TTL
```

### 7.1 Setup

```typescript
const grantA = {
  audiences: ['corp-messenger.internal', 'jira.internal'],
  scopes: ['message:send', 'message:receive', 'channel:engineering'],
  maxSessionTtl: 28800, // one workday
  subNamePatterns: ['worker-*', 'contractor-*'],
};
const A = await corpIdentity.attestHandle('department-engineering', grantA,
  { ttlSeconds: 365 * 24 * 3600 }); // one year
// Ship deptHandle + A.token to the HR system.
// Attestation is valid for a year, sessions — one workday
```

### 7.2 HR hires — autonomously, without the root

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

### 7.3 Multi-service verification

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

### 7.4 Firing an employee (the correct way)

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

### 7.5 Contractors

```typescript
const B = await deptHandle.attestSubHandle('contractor-external-xyz', {
  audiences: ['corp-messenger.internal'],
  scopes: ['message:send', 'message:receive', 'channel:project-alpha'],
  maxSessionTtl: 28800,
}, { ttlSeconds: 14 * 24 * 3600 }); // access self-expires in 2 weeks —
                                     // no HR action needed on the end date

```
---

## Scenario 8: Deterministic Password Manager (UC-5)

The zero-storage credential pattern: per-service secrets derived from the
seed — nothing persisted, nothing to breach, no servers, no verification
modes.

```typescript
import { Identity } from '@me2em/core';

const identity = await Identity.fromSeed(seedBytes);
const work = await identity.deriveHandle('work');

// One call per service — same result on every device, forever:
const githubSecret = work.derivePassword('github.com', 32);
const jiraSecret   = work.derivePassword('jira.internal', 32);
```

Properties that fall out for free:

- **Same seed + same context → same secret.** A new phone plus the seed
  phrase restores every password.
- **Per-context isolation.** A Handle per persona: the work Handle never
  derives a secret the personal Handle could produce.
- **Nothing to reset.** No "forgot password" exists because no password
  is stored — losing the seed loses the identity, by design.

`@me2em/crypto` adds the guard rails: Argon2id profiles for secrets the
user must type rather than derive, and HIBP breach checks for the rare
hand-chosen password.

---

## Scenario 9: E2EE Messenger (UC-6)

The first vertical (`@me2em/messenger`, planned) — built directly on the
crypto package: canonical X3DH for key agreement, long-lived channels
with epoch rotation, envelopes for recipients who are offline.

```text
Identity: Alice (seed) ── Handle: @alice ── publishes PreKeyBundle
Identity: Bob   (seed) ── Handle: @bob   ── publishes PreKeyBundle
```

### 9.1 Opening a channel

```typescript
import { initiateX3DH, establishChannel, encryptChannelMessage } from '@me2em/crypto';

const bundle = await fetchPreKeyBundle('bob');
const x3dh = await initiateX3DH(aliceIdentity, bundle);
const channel = await establishChannel(x3dh.sharedSecret, 'chat-42');

const msg = await encryptChannelMessage(channel, 0, plaintext);
```

Bob completes the same X3DH on his side — consuming a one-time pre-key
(mandatory, no zero-fallback) — and derives the same channel.

### 9.2 Writing to someone offline

Envelopes wrap a message key for a recipient who has not been online for
days; each envelope is self-contained and replay-guarded by OTK
consumption:

```typescript
const wrapped = await wrapKeyForRecipient({
  keyBytes: fileKey,
  recipientBundle: bobsBundle,
  myIdentity: aliceIdentity,
  contextSalt: new TextEncoder().encode('chat-42'),
});
```

### 9.3 Forward secrecy at rotation points

Channels rotate epochs; previous-epoch material is wiped and messages
from it become undecryptable. Per-message keys and a strictly-increasing
replay counter protect everything in between.

The identity layer stays Me2em: `@alice` is a Handle derived from her
seed — the messenger account is recoverable on any device from the seed
alone, and a second device derives the same identity without a sync
service.

An optional device SubHandle (`@alice` → `phone-1`) follows the same
pattern — see the interpretation table.

---

## Comparison

| Scenario | UC | Identity | Handle | SubHandle | Autonomous ops | External verifiers | Revocation | Session TTL |
|---|---|---|---|---|---|---|---|---|
| AI Agent | UC-1 | human owner | the agent | — | ✅ the agent itself | Mode 2 (MCP servers) | agent = A.jti | ≤ 1 h |
| Satellite Marketplace | UC-2 | operator | spacecraft | payload / sold window | ✅ onboard attest B | Mode 2 (buyers) | window = B.jti; sat = A.jti | ≤ 30 min |
| Drone Fleet Mgmt | UC-2 | operator | airframe | sensors / maint grant | ✅ in-field attest B | — (Mode 1 perimeter) | airframe = A.jti | ≤ 1 h |
| Multi-App SSO | UC-4 | the user | per-app persona | — | login flows | Mode 1; Mode 2 for partners | refresh-hash / jti | min–h |
| Multi-Context | UC-3 | the user | persona | delegated leaf | derivation itself | Mode 1 (own backends) | Handle jti / attestation | per-app |
| EV Charging | UC-2 | network owner | station | connector / meter | ✅ offline attest B | Mode 2 (charging app) | station = A.jti | 1–2 h |
| Corporate Messenger | UC-3 | corporation | department | employee / contractor | ✅ HR without root | Mode 2 (messenger + Jira) | employee = B.jti | 8 h |
| Password Manager | UC-5 | the user | service context | — | derivation | — | — | — |
| E2EE Messenger | UC-6 | the user | messaging identity | device (optional) | pre-key publishing | peers (channel keys) | channel/session jti | channel lifetime |

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

| # | Scenario | UC | What it demonstrates |
|---|---|-----|----------------------|
| 1 | AI Agent Delegation | UC-1 | Deterministic agent identities; owner-signed mandates; attested verification by MCP servers; instant agent revocation |
| 2 | Satellite Capacity Marketplace | UC-2 | **Selling capacity**: signed, time-boxed receipts verifiable by the buyer; Mode 1 for internal payload/telemetry |
| 3 | Drone Fleet Management | UC-2 | Provisioning at deploy; in-field maintenance grants; lost-airframe revocation in one call |
| 4 | Multi-App SSO | UC-4 | Shared User Base: no user database; cookie auto-login across apps; opt-in correlation |
| 5 | Multi-Context Identity | UC-3 | Isolated personas from one seed; in-persona delegation (guest token); the Quick Start scenario |
| 6 | EV Charging Network | UC-2 | Fully offline device operation; external org verification; grant-bounded compromise; station-wide revocation |
| 7 | Corporate Messenger | UC-3 | Autonomous HR without the root; no privilege escalation past the department grant; cross-service revocation; contractor self-expiry |
| 8 | Deterministic Password Manager | UC-5 | Zero-storage credentials: derive per service, restore from the seed, nothing to breach |
| 9 | E2EE Messenger | UC-6 | X3DH channels, epoch forward secrecy, envelopes for offline recipients — the messenger vertical's foundation |

Shared guarantees: `MAX_DEPTH = 2`, two derivation entry points with
identical keys, encapsulated private keys, TTL + optional revocation —
and, in Mode 2, **enforceable delegation without ever sharing the root**.
