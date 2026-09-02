# Contributing to me2em-protocol

Thank you for your interest in contributing to Me2em! This document outlines how to contribute to the protocol reference implementation, our architecture, and release processes.

## 🗂️ Project Structure & Architecture

This repository is a `pnpm` workspace monorepo containing the core cryptographic primitives of the Me2em protocol. 

> **Note:** The main marketing website, blog, and high-level guides are hosted in a **separate repository**: [`me2em-org/me2em-website`](https://github.com/me2em-org/me2em-website) (built with Astro). This repository is strictly for the protocol implementation and its API reference.

```text
me2em-protocol/
├── packages/
│   └── core/               # Core primitives: Identity, Handle, Session (@me2em/core)
├── docs/                   # Generated TypeDoc output (auto-deployed, do not edit manually)
├── package.json            # Root workspace configuration
├── typedoc.json            # TypeDoc configuration for API reference generation
└── CONTRIBUTING.md         # This file
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- pnpm 9+ (We strictly use `pnpm`, not `npm` or `yarn`)

### Local Development Setup
```bash
# 1. Clone the repository
git clone https://github.com/me2em-org/me2em-protocol.git
cd me2em-protocol

# 2. Install dependencies for all workspace packages
pnpm install

# 3. Build the core package
pnpm run build

# 4. Run tests
pnpm run test

# 5. Generate documentation locally (optional, for preview)
pnpm run build-docs
# You can then view it by opening `docs/index.html` or running `npx serve docs`
```

## 📦 Publishing to npm

Publishing is done manually to ensure strict version control. **Always use `pnpm`, never `npm`**, to maintain lockfile consistency.

1. **Authenticate with pnpm registry:**
   Ensure you are logged in. If not, run:
   ```bash
   pnpm login
   ```
2. **Update versions manually:** You must update the `"version"` field in **two** places to keep the workspace in sync:
   - `package.json` (root)
   - `packages/core/package.json`
3. **Commit the version bump:**
   ```bash
   git add package.json packages/core/package.json
   git commit -m "chore: bump version to X.Y.Z"
   git push origin main
   ```
4. **Publish the package:**
   Run the publish command specifically for the core package:
   ```bash
   pnpm publish --filter @me2em/core --access public
   ```
   *(Alternatively, from within the `packages/core` directory, you can run `pnpm publish --access public`)*

## 📝 Documentation Pipeline

We do not maintain a separate documentation repository or use heavy frameworks like Docusaurus for the API reference. 

- **Source of Truth:** All API documentation is written as [JSDoc/TSDoc](https://tsdoc.org/) comments directly in the TypeScript source files (`packages/core/src/**/*.ts`).
- **Automation:** The root `package.json` contains a `"build-docs": "typedoc"` script. 
- **Deployment:** This repository is connected to **Cloudflare Pages**. On every `git push` to the `main` branch, Cloudflare automatically runs `pnpm install && pnpm run build-docs` and deploys the resulting `./docs` folder to **[docs.me2em.com](https://docs.me2em.com)**.

**Rule for contributors:** If you add or modify public methods, classes, or interfaces, you **must** add or update the corresponding JSDoc comments. 

## 🐛 Reporting Issues

Before creating a new issue:
1. Search [existing issues](https://github.com/me2em-org/me2em-protocol/issues).
2. Check if it's already fixed in the `main` branch.
3. Use the appropriate [issue template](.github/ISSUE_TEMPLATE/).

⚠️ **For security vulnerabilities:** See [SECURITY.md](SECURITY.md). Do not disclose publicly.

## 💡 Proposing Changes

**Small fixes (typos, docs, minor bug fixes):**
1. Fork the repository.
2. Create a branch: `fix/short-description`.
3. Make your changes and run `pnpm test`.
4. Submit a Pull Request.

**New features or breaking changes:**
1. Open a [Discussion](https://github.com/me2em-org/me2em-protocol/discussions) first.
2. Describe the problem, proposed solution, and alternatives.
3. Wait for feedback from maintainers. If approved, implement and submit a PR.

## 📐 Coding Standards

### TypeScript/JavaScript
- Follow the project's ESLint configuration.
- Use strict mode. Avoid `any` types.
- Write comprehensive JSDoc for all public APIs.
- Aim for 100% type coverage for new code.

### Commits
- Use [Conventional Commits](https://www.conventionalcommits.org/).
- Example: `feat(core): add handle derivation with metadata` or `fix(crypto): resolve edge case in hkdf`.

## 🔐 Cryptography Guidelines

Me2em is a security-critical project. When working with crypto:

✅ **Do:**
- Use established, audited libraries (e.g., `@noble/ed25519`, `@noble/hashes`, Web Crypto API).
- Add property-based tests for cryptographic functions.
- Document security assumptions and threat models in code comments.

❌ **Don't:**
- Implement your own cryptographic primitives.
- Hardcode secrets, private keys, or test seeds in the source code.
- Change key derivation parameters (like HKDF info/salt) without consensus and thorough review.

## 🧪 Testing

- New features require new tests.
- Bug fixes should include a regression test.
- Aim for >90% coverage in `packages/core`.
- Run coverage locally: `pnpm run test:coverage`

## 🤝 Review Process

1. PR created → GitHub Actions CI runs automatically (lint, typecheck, test).
2. Maintainer reviews within 3-5 business days.
3. Address feedback by pushing updates to the same branch.
4. Once approved, the PR is merged by a maintainer.

---
🙏 **Thank You!** Your contributions make Me2em better, more secure, and more accessible for everyone. Welcome to the community! 🎉