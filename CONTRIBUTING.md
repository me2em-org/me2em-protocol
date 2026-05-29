# Contributing to me2em-protocol

Thank you for your interest in contributing to Me2em! This document outlines how to contribute to the protocol reference implementation.

## 🗂️ Project Structure

```
me2em-protocol/
├── packages/
│   ├── protocol-core/    # Core primitives: Identity, Handle, Session
│   ├── sdk-js/           # TypeScript SDK for browsers/Node.js
│   └── sdk-rust/         # Rust SDK (planned)
├── specs/                # Protocol specification (markdown + OpenAPI)
├── tests/                # Integration & property-based tests
├── docker/               # Dockerfiles and compose configs
└── docs/                 # Developer documentation
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and pnpm 9+ (for JS/TS packages)
- Docker & Docker Compose (for local testing)
- Rust 1.75+ (optional, for Rust SDK)

### Install dependencies
```bash
pnpm install
```

### Run tests
```bash
pnpm test          # Unit tests
pnpm test:e2e      # End-to-end tests with Docker
```

### Build packages
```bash
pnpm build
```

## 🐛 Reporting Issues

Before creating a new issue:
1. Search [existing issues](https://github.com/me2em-org/me2em-protocol/issues)
2. Check if it's already fixed in `main` branch
3. Use the appropriate [issue template](.github/ISSUE_TEMPLATE/)

### For security vulnerabilities
→ See [SECURITY.md](SECURITY.md). **Do not** disclose publicly.

## 💡 Proposing Changes

### Small fixes (typos, docs, bug fixes)
1. Fork the repository
2. Create a branch: `fix/short-description`
3. Make your changes
4. Run tests: `pnpm test`
5. Submit a Pull Request

### New features or breaking changes
1. Open a [Discussion](https://github.com/me2em-org/me2em-protocol/discussions) first
2. Describe the problem, proposed solution, and alternatives
3. Wait for feedback from maintainers
4. If approved, implement and submit a PR

## 📐 Coding Standards

### TypeScript/JavaScript
- Follow [TypeScript ESLint config](.eslintrc.cjs)
- Use strict mode, no `any` types
- Write JSDoc for public APIs
- 100% type coverage for new code

### Rust (if applicable)
- Follow `clippy` recommendations
- Document public items with `///`
- Add unit tests for new functions

### Commits
- Use [Conventional Commits](https://www.conventionalcommits.org/)
- Example: `feat(protocol): add handle derivation with metadata`

## 🔐 Cryptography Guidelines

Me2em is a security-critical project. When working with crypto:

✅ **Do**:
- Use established libraries (libsodium, Web Crypto API)
- Add property-based tests for cryptographic functions
- Document security assumptions and threat models

❌ **Don't**:
- Implement your own cryptographic primitives
- Hardcode secrets or test keys in source code
- Change key derivation parameters without consensus

## 🧪 Testing

- New features require tests
- Bug fixes should include a regression test
- Aim for >90% coverage in `protocol-core`

Run coverage:
```bash
pnpm test:coverage
```

## 📝 Documentation

- Update `docs/` when changing public APIs
- Keep code examples in sync with implementation
- Use [Docusaurus](https://docusaurus.io) syntax for docs

## 🤝 Review Process

1. PR created → CI runs automatically
2. Maintainer reviews within 3-5 business days
3. Address feedback, push updates to the same branch
4. Once approved, PR is merged by a maintainer

### Becoming a Maintainer

Active contributors may be invited to join the core team. Criteria:
- 5+ merged PRs with quality contributions
- Demonstrated understanding of protocol design
- Positive collaboration in discussions

See [GOVERNANCE.md](GOVERNANCE.md) for details.

## 🙏 Thank You

Your contributions make Me2em better for everyone. Welcome to the community! 🎉