# 🔐 me2em-protocol

> Open protocol for multi-identity authorization: One cryptographic Identity → unlimited isolated Handles → contextual Sessions.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-docs.me2em.com-blue)](https://docs.me2em.com)
[![npm](https://img.shields.io/npm/v/@me2em/protocol-core)](https://www.npmjs.com/package/@me2em/protocol-core)

## 🎯 What is Me2em?

Me2em solves the "One User = One Profile" limitation of traditional auth systems.

Instead of forcing users to choose between privacy and convenience, Me2em enables:

✅ **Contextual Handles**: One root Identity can generate unlimited isolated profiles  
  `@alice_work`, `@alice_private`, `@alice_iot` — all from one seed phrase.

✅ **IoT Hierarchies**: Manage device networks with granular access control  
  `Device-Root → Sensor-A → Connector-1` — compromise one, not all.

✅ **Privacy by Design**: Applications receive only a public Handle — no email, no phone, no tracking.

✅ **Self-Hosted or Cloud**: Run the reference implementation via Docker, or use Managed Auth.

## 🏗️ Architecture

```
Identity (Root, Ed25519)
   │
   ├── Handle: @alice_work      → Session: app-x (scopes: read:profile)
   ├── Handle: @alice_private   → Session: app-y (scopes: read:messages)
   └── Handle: @alice_iot       → SubHandle: device-001 → Session: mqtt-broker
```

## 🚀 Quick Start

### Option A: Use the SDK (Recommended)

```bash
npm install @me2em/protocol-core
```

```typescript
import { Identity, Handle } from '@me2em/protocol-core';

// Create or restore identity
const identity = await Identity.fromSeed('your-24-word-seed');

// Derive a contextual handle
const workHandle = await identity.deriveHandle('work', {
  metadata: { org: 'acme', role: 'developer' }
});

// Request a session for an application
const session = await workHandle.requestSession({
  audience: 'https://api.acme-app.com',
  scopes: ['read:profile', 'write:tasks'],
  ttl: 3600
});

// Use the token
fetch('https://api.acme-app.com/me', {
  headers: { Authorization: `Bearer ${session.token}` }
});
```

### Option B: Run the Reference Implementation

```bash
git clone https://github.com/me2em-org/me2em-protocol.git
cd me2em-protocol
docker compose up -d
```

See [`/docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) for detailed instructions.

## 📚 Documentation

- 📘 [Protocol Specification](https://docs.me2em.com/spec)
- 🔧 [SDK Reference](https://docs.me2em.com/sdk)
- 🐳 [Self-Hosting Guide](docs/SELF_HOSTING.md)
- 🔐 [Security Model](docs/SECURITY_MODEL.md)

## 🤝 Contributing

We welcome contributions! Start with:

- 🐛 [Good first issues](https://github.com/me2em-org/me2em-protocol/issues?q=label:good-first-issue)
- 📝 [Documentation improvements](https://github.com/me2em-org/me2em-protocol/issues?q=label:documentation)
- 💡 [Propose a feature](https://github.com/me2em-org/me2em-protocol/discussions)

Read our [CONTRIBUTING.md](CONTRIBUTING.md) and [GOVERNANCE.md](GOVERNANCE.md).

## 🔐 Security

Me2em handles cryptographic identities. If you discover a vulnerability:

1. **Do NOT** open a public issue
2. Email `security@me2em.com` with details
3. We will respond within 72 hours

See [SECURITY.md](SECURITY.md) for our responsible disclosure policy.

## 📜 License

Apache License 2.0 — see [LICENSE](LICENSE) for details.

© 2026 Me2em Organization. Part of the Me2em ecosystem: [github.com/me2em-org](https://github.com/me2em-org)
