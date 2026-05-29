# Governance Model: Me2em Ecosystem

> This document describes how decisions are made in the Me2em open-source project.

**Version**: 1.0  
**Last Updated**: May 2026  
**Scope**: All repositories under `github.com/me2em-org`

---

## 🎯 Philosophy

Me2em is built on three principles:

1. **Privacy by Design**: Technical decisions must prioritize user privacy and cryptographic security.
2. **Open Collaboration**: Anyone can contribute; merit is earned through quality work, not affiliation.
3. **Decentralized Trust**: The protocol should enable trustless interactions; governance should reflect that.

---

## 👥 Roles

### 👤 Contributor
Anyone who submits code, docs, issues, or feedback.

**Rights**:
- Comment on issues and PRs
- Propose features via Discussions
- Submit pull requests

**Path to next role**: 3+ merged PRs with positive reviews.

### 🔧 Maintainer
Trusted contributors with write access to specific repositories.

**Responsibilities**:
- Review and merge PRs in their area
- Triage issues and label appropriately
- Help onboard new contributors
- Uphold code quality and security standards

**How to become**:
1. Be an active Contributor (3+ merged PRs)
2. Receive nomination from an existing Maintainer
3. Approval by ≥2 Core Team members
4. 2-week no-objection period

**Current Maintainers**: [List in `MAINTAINERS.md`]

### 🧭 Core Team
Strategic decision-makers for the protocol and ecosystem.

**Responsibilities**:
- Approve breaking changes to the protocol spec
- Resolve maintainer disputes
- Manage security disclosures and releases
- Represent Me2em in external partnerships

**How to become**:
1. Be a Maintainer for ≥6 months
2. Demonstrate deep protocol understanding
3. Nomination by ≥2 Core Team members
4. Supermajority vote (≥75%) of existing Core Team

**Current Core Team**: [List in `CORE_TEAM.md`]

### 🗳️ Community Advisory Council (Planned)
Representative body for broader community input (post-v1.0).

---

## 🗳️ Decision-Making

### Technical Decisions (within a repo)
- **Process**: RFC via GitHub Discussion → Implementation PR → Maintainer review → Merge
- **Consensus**: Lazy consensus (no objections after 5 business days)
- **Tie-breaker**: Repo Maintainer(s)

### Protocol Specification Changes
- **Process**: Me2em Improvement Proposal (MIP) → Core Team review → Community comment period (14 days) → Core Team vote
- **Threshold**: ≥2/3 Core Team approval
- **Documentation**: All MIPs archived in `specs/MIPs/`

### Governance Changes
- **Process**: Proposal in Discussions → Core Team draft → Community comment (30 days) → Core Team supermajority (≥75%)
- **Ratification**: Published as `GOVERNANCE-vX.md`

### Security Decisions
- **Process**: Private discussion among Core Team + security reporter → Fix → Coordinated disclosure
- **Emergency**: Core Team may act unilaterally for critical vulnerabilities, with post-mortem

---

## 🔄 Conflict Resolution

1. **Direct discussion**: Parties attempt to resolve informally
2. **Maintainer mediation**: Neutral Maintainer facilitates
3. **Core Team escalation**: Final decision by Core Team vote
4. **Community fork**: As last resort, community may fork (per Apache 2.0 license)

---

## 📊 Transparency

- All non-sensitive discussions happen in public (GitHub Issues/Discussions)
- Meeting notes (Core Team) published within 7 days
- Financial decisions (if any) documented in `TRANSPARENCY.md`
- Security incidents: post-mortem published after resolution

---

## 🚀 Roadmap Input

Anyone can propose roadmap items via:
- GitHub Discussions: `category:roadmap`
- Annual community survey (planned)

Core Team prioritizes based on:
1. Security & stability
2. Community demand (👍 reactions, use-case validation)
3. Technical feasibility
4. Alignment with Me2em philosophy

---

## 📜 Amendments

This document may be amended following the "Governance Changes" process above.

---

*Part of the Me2em ecosystem: [github.com/me2em-org](https://github.com/me2em-org) | Contact: hello@me2em.com*