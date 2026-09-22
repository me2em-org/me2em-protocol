# Security Policy

## 🔐 Supported Versions

Me2em packages version independently. Security fixes ship in the
latest alpha of every package:

| Package | Version | Supported |
|---------|---------|-----------|
| `@me2em/core` | 0.7.0-alpha.x | ✅ Yes |
| `@me2em/crypto` | 0.1.0-alpha.x | ✅ Yes |
| `@me2em/react` | 0.1.0-alpha.x | ✅ Yes |
| any older release | — | ❌ No |

> Me2em is in active development. Always use the latest alpha of each
> package for security fixes.

## 🚨 Reporting a Vulnerability

Me2em handles cryptographic identities, key derivation, and
authentication. We take security seriously.

**If you discover a security vulnerability:**

1. **Do NOT** open a public issue or discuss it publicly.
2. Email `security@me2em.com` with:
   - Affected package (`@me2em/core` / `@me2em/crypto` / `@me2em/react`)
   - Description of the vulnerability
   - Steps to reproduce (if applicable)
   - Potential impact assessment
   - Suggested fix (optional but appreciated)
3. Use PGP if possible: [PGP Key](https://me2em.com/security/pgp-key.asc) (coming soon)

## 📬 What to Expect

- **Acknowledgment**: Within 72 hours
- **Assessment**: Within 7 business days
- **Fix timeline**: Severity-dependent (critical: ≤14 days)
- **Disclosure**: Coordinated with the reporter, after the fix is released

## 🔍 Security Model Notes for Reporters

Understanding the architecture helps you report accurately:

- **Seed-derived identity**: the seed phrase is the only permanent
  carrier of identity. A report of "recovering the key tree from a
  leaked seed" describes expected behavior, not a vulnerability — the
  seed is assumed secret by the threat model.
- **Transient key material**: private keys exist in RAM during login
  and are wiped after use. GC/JIT copies are a documented limitation
  (see BACKLOG BL-07), not a vulnerability.
- **Verification modes**: SubHandle constraint enforcement at
  *verification* time is Mode 2 (`verifyAttested`) only. Mode 1
  enforces at creation — see the README "Verification modes" section.

## 🛡️ Security Best Practices for Users

When implementing Me2em in your application:

✅ **Do**:
- Treat the seed phrase as the ONLY permanent carrier of identity —
  paper and the user's head. Never device storage, never cloud, never
  logs.
- Use short-lived sessions and rely on auto-renewal
  (`@me2em/react useSession`).
- Prefer Mode 2 (`verifyAttested`) for any external audience; reserve
  `verifyStateless` for infrastructure you fully control.
- Implement a `RevocationChecker` — it is consulted for attestation
  **and** session `jti`.
- Isolate per-identity storage (see `@me2em/react` context cache —
  per-identity IndexedDB).
- Keep all `@me2em/*` packages updated.

❌ **Don't**:
- Never transmit the seed or raw private keys — derivation is
  client-side, always.
- Never persist key material in plaintext storage.
- Don't trust attestation constraints without Mode 2 verification —
  Mode 1 enforces SubHandle constraints at creation only.
- Don't rely on zeroing buffers as a hard guarantee — GC/JIT may
  retain copies.
- Don't log private keys, seed phrases, or cache keys.

## 🔍 Audit Status

| Component | Audit Date | Auditor | Report |
|-----------|------------|---------|--------|
| `@me2em/core` | Planned before v1.0 | TBD | — |
| `@me2em/crypto` | Planned before v1.0 | TBD | — |
| `@me2em/react` | Planned before v1.0 | TBD | — |

> Independent security audits are planned before the v1.0 release.
> Follow [Discussions](https://github.com/me2em-org/me2em-protocol/discussions) for updates.

## 📜 Responsible Disclosure Policy

We follow responsible disclosure principles:
- No legal action against good-faith researchers.
- Public acknowledgment (with consent) after the fix is released.
- Bug bounty program: planned for post-v1.0.

## 🔄 Updates

This policy is reviewed quarterly. Last updated: September 2026.

---

*Part of the Me2em ecosystem: [github.com/me2em-org](https://github.com/me2em-org) | Contact: security@me2em.com*