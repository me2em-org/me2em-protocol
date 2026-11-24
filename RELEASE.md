# RELEASE.md — manual release procedure

Publishing is **manual** (BL-35 annulled 2026-11-24): no CI release
workflow, no changesets — the owner runs the commands below. Rationale:
a past automation attempt ended in an npm account block; releases are
infrequent, so the manual procedure is acceptable. Do **not** re-open
publish automation without an architect decision.

## Policy

- **Dist-tag:** rc-line versions publish to **`latest`** (the DR-6
  разминка stance). Never pass `--tag` — npm's default tag for a plain
  `npm publish` is `latest`, which is exactly what we want for rc.
- **Order:** publish in peer-dependency order — `core` → `crypto` →
  `pact` → `react` → `solana` → `x402`. Bump and publish only the
  packages whose version is ahead of the registry.
- **Access:** scoped packages always need `--access public`
  (`npm publish` of a scope defaults to restricted).
- **Version bumps:** manual `package.json` edit + `CHANGELOG.md` entry
  per released package, one commit per release batch (house style:
  `feat(pact): 1.0.0-rc.5 — …`).

## Pre-flight (per release batch)

```sh
cd /path/to/me2em-protocol
git pull && git status                     # clean tree, main or release branch
corepack pnpm install
corepack pnpm -r typecheck && corepack pnpm -r test && corepack pnpm -r lint
corepack pnpm -r build                     # dist/ fresh everywhere
```

Compare repo vs registry to get the publish set (2026-11-24: `core`
rc.10, `react` rc.5, `pact` rc.5 — first publish):

```sh
for p in @me2em/core @me2em/crypto @me2em/pact @me2em/react @me2em/solana @me2em/x402
  do printf "%-15s %s\n" "$p" "$(npm view $p version 2>/dev/null || echo NEW)"; done
```

Sanity-check what ships (must be `dist/ src/ README.md LICENSE`, no
tests/benches — `files` in each package.json):

```sh
cd packages/pact && npm pack --dry-run
```

## Publish

One package at a time, in order; `prepublishOnly` re-runs the build
(`npm publish` executes it — do not skip):

```sh
cd packages/core && npm publish --access public
cd packages/pact && npm publish --access public
cd packages/react && npm publish --access public
# …crypto / solana / x402 only when their versions moved
```

## Post-checks

```sh
for p in @me2em/core @me2em/pact @me2em/react
  do printf "%-15s %s\n" "$p" "$(npm view $p version)"; done

# install smoke outside the repo — peers must resolve, subpaths import
mkdir -p /tmp/pub-smoke && cd /tmp/pub-smoke && npm init -y >/dev/null
npm install @me2em/pact @me2em/react
node --input-type=module -e "
import('@me2em/pact/transport').then(m => console.log('transport ok:', Object.keys(m)));
import('@me2em/pact/testing').then(m => console.log('testing ok:', Object.keys(m).length, 'exports'));"
```

Then push the release-batch commit (version bumps + CHANGELOGs) and
record the batch in the per-package CHANGELOG date lines.
