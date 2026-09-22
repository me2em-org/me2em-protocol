# CI & Security Pipeline — Developer Guide

This guide explains what the pipeline checks, why, and — most
importantly — **what to do when a job fails**.

Pipeline file: [`.github/workflows/ci-security.yml`](./ci-security.yml)
Triggered by: push to `main`, pull requests to `main`, weekly schedule
(Mondays 02:00 UTC).

---

## Pipeline overview

| Job | Duration | What runs |
|-----|----------|-----------|
| **secret-scan** | ~30–60s | [gitleaks](https://github.com/gitleaks/gitleaks) scans the full git history for hardcoded secrets |
| **build-and-test** | ~3–5 min | `pnpm install --frozen-lockfile` → build (topological: core first) → typecheck → 380+ tests → lint (non-blocking) → dependency audit (informational) |
| **codeql** | ~2–5 min | GitHub CodeQL deep static analysis, `security-extended` query set |

All three run **in parallel**. All three must be green for `main`.

Node 22 · pnpm (from `packageManager` in root `package.json`) ·
runner pinned to `ubuntu-24.04`.

---

## Job 1: secret-scan (gitleaks) failed

Gitleaks found something in the git history that matches a secret
pattern (API key, private key, token, high-entropy string).

### Step 1 — determine: real secret or false positive?

Open the failing run → job log → the finding includes the file,
line, and a snippet.

**It's a REAL secret** (an actual key, token, or password that works):
1. **Rotate it immediately.** A secret in git history is compromised
   forever — even if removed in a later commit, history preserves it.
   Gitleaks documentation correctly notes: removing the secret from
   the current code does NOT remove it from history.
2. Do NOT try to hide it in the current commit — rotation is the only
   real fix.
3. After rotation, if the finding must stay in history (public repo),
   add its fingerprint to `.gitleaksignore` with a comment explaining
   the rotation.

**It's a FALSE POSITIVE** (a test fixture, a synthetic vector, a
documentation example):

1. Confirm the string is synthetic (a BIP39 test vector, a
   `new Uint8Array(32).fill(0x42)` pattern, an RFC constant).
2. Add a suppression — in order of preference:
   - **`.gitleaks.toml`** — if the pattern is broad and belongs to
     test directories (see existing `[rules.allowlist]` section for
     examples covering BIP39 vectors and `fill()` patterns).
   - **`.gitleaksignore`** — if it's a one-off finding (paste the
     fingerprint gitleaks prints, one per line).
3. Commit with: `ci: gitleaks ignore for <what and why>`

### Never do

- ❌ Delete the workflow file to make the failure go away.
- ❌ Add a broad allowlist (`paths = ['.*']`) — it disables the
  scanner for everything.
- ❌ Commit a "test" secret that actually works in production.

### Live example
The first real run of this pipeline flagged the code-fence example in this very guide (.github/workflows/README.md,the fill(0x42) pattern in the gitleaks section). Fixed via .gitleaksignore fingerprint — exactly the false-positive proceduredescribed above.

---

## Job 2: build-and-test failed

Read the failing step name — each maps to a specific fix:

### `Install dependencies` failed
- Lockfile out of sync with `package.json` → run `pnpm install`
  locally, commit the updated `pnpm-lock.yaml`.
- `onlyBuiltDependencies` warning → the field belongs in
  `pnpm-workspace.yaml`, NOT in per-package `package.json`.

### `Build packages` failed
- TypeScript errors in any package's `src/`.
- Workspace dependency not built first — `pnpm -r build` handles
  topological order automatically; if it fails, a package's build
  script itself is broken.

### `Typecheck` failed
- Runs AFTER build — `@me2em/core` `dist/index.d.ts` is available.
- If you see `Cannot find module '@me2em/core'` — the build step
  failed or was reordered. Build must precede typecheck.

### `Test` failed
- Fix the failing test. All 380+ tests must pass.
- If your change legitimately breaks a pinned test (e.g. intentional
  behavior change), update the test IN THE SAME COMMIT, with a comment
  explaining the behavior change.
- A flaky test (passes locally, fails in CI intermittently): do NOT
  add `skip` — investigate. Known flake patterns: real-time waits
  (use `waitFor`), random data with checksum assumptions (use fixed
  vectors).

### `Lint` failed
- **Non-blocking** (`continue-on-error: true`) — the pipeline stays
  green. Fix anyway when convenient: `pnpm -r lint` locally shows the
  issues.

### `Dependency audit` failed
- **Non-blocking / informational** — logs advisories found in the
  dependency tree.
- Review the advisory: if it affects a package you use at runtime,
  update the dependency in a separate commit
  (`pnpm --filter @me2em/core update <pkg>`).
- Policy decision on blocking thresholds is pending — see BACKLOG.

---

## Job 3: codeql failed

CodeQL alerts appear in **Security → Code scanning**, not in the job
log (the job only fails if the analysis itself errored).

1. Open the alert → it shows the data flow (source → sink) for
   taint-analysis findings.
2. Severity triage:
   - **Error / Critical** — fix in code, do not suppress.
   - **Warning** — fix or justify: add a `// codeql[query-id]` inline
     suppression ONLY with a written justification.
   - **Note** — optional.
3. False positives: suppressions require an explanation comment —
   unsuppressed is preferred for a security protocol project.

---

## Adding a new package

The pipeline is package-agnostic (`pnpm -r` operates on the whole
workspace). A new package needs:

1. `typecheck`, `build`, `test`, `lint` scripts in its `package.json`.
2. Its build must not break topological order (pnpm handles it).
3. Test fixtures in `test/` — covered by the gitleaks allowlist in
   `.gitleaks.toml` if they contain vector-like strings.

## Runner & toolchain versions

- **Runner**: `ubuntu-24.04` (pinned — `ubuntu-latest` migrates to
  Ubuntu 26 in Oct 2026).
- **Node**: 22 (LTS) via `actions/setup-node` matrix.
- **pnpm**: 10.11.1, taken from `packageManager` in root
  `package.json` — single source of truth, do not pin in the workflow.
- **checkout**: v6 (Node 24-native; v4 triggers Node 20 deprecation
  warnings).
- **CodeQL**: v4 (v3 deprecated Dec 2026).

Update action versions in a dedicated CI commit — never mixed with
feature changes.

---

## Maintenance checklist (quarterly)

- [ ] Action versions current (no deprecation warnings in runs).
- [ ] `pnpm audit` findings reviewed; blocking policy reconsidered.
- [ ] Test count in the workflow comment matches reality.
- [ ] Gitleaks allowlist — entries still justified?
- [ ] Branch protection — required checks still correct?