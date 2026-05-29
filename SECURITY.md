# Security Policy

## 🔐 Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ Yes    |
| < 0.1   | ❌ No     |

> Me2em is in active development. Always use the latest version for security fixes.

## 🚨 Reporting a Vulnerability

Me2em handles cryptographic identities and authentication. We take security seriously.

**If you discover a security vulnerability:**

1. **Do NOT** open a public issue or discuss it publicly
2. Email `security@me2em.com` with:
   - Description of the vulnerability
   - Steps to reproduce (if applicable)
   - Potential impact assessment
   - Suggested fix (optional but appreciated)
3. Use PGP if possible: [PGP Key](https://me2em.com/security/pgp-key.asc) (coming soon)

## 📬 What to Expect

- **Acknowledgment**: Within 72 hours
- **Assessment**: Within 7 business days
- **Fix timeline**: Depends on severity (critical: ≤14 days)
- **Disclosure**: Coordinated with reporter, after fix is released

## 🛡️ Security Best Practices for Users

When implementing Me2em in your application:

✅ **Do**:
- Store seed phrases in secure, user-controlled storage (never in plaintext)
- Use short-lived sessions and rotate tokens frequently
- Validate Handle metadata server-side, not just client-side
- Keep dependencies updated (`@me2em/*` packages)

❌ **Don't**:
- Expose private keys or seed phrases in client-side code
- Reuse sessions across different contexts/applications
- Trust Handle metadata without verification
- Disable cryptographic signature verification

## 🔍 Audit Status

| Component | Audit Date | Auditor | Report |
|-----------|------------|---------|--------|
| protocol-core | Planned Q2 2026 | TBD | — |

> We plan independent security audits before v1.0 release. Follow [Discussions](https://github.com/me2em-org/me2em-protocol/discussions) for updates.

## 📜 Responsible Disclosure Policy

We follow responsible disclosure principles:
- No legal action against good-faith researchers
- Public acknowledgment (with consent) after fix
- Bug bounty program: Planned for post-v1.0

## 🔄 Updates

This policy is reviewed quarterly. Last updated: May 2026.

---

*Part of the Me2em ecosystem: [github.com/me2em-org](https://github.com/me2em-org) | Contact: security@me2em.com*