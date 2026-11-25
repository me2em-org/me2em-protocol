# RELEASE.md — manual release procedure

Publishing is **manual** (BL-35 annulled 2026-11-24): no CI release
workflow, no changesets — the owner runs the commands below. Rationale:
a past automation attempt ended in an npm account block; releases are
infrequent, so the manual procedure is acceptable. Do **not** re-open
publish automation without an architect decision.

## Policy

- **Dist-tag:** rc-line versions publish to **`latest`** (the DR-6
  разминка stance). Pass **`--tag latest` explicitly**: npm ≥ 7.20
  refuses to publish a prerelease without an explicit tag
  ("You must specify a tag using --tag when publishing a prerelease
  version") — the historical default-to-latest no longer applies.
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
grep -H '"version"' packages/{core,crypto,pact,react,solana,x402}/package.json
# ↑ these MUST match the release batch — the npm publish banner prints
# the SAME version, so a stale tree is visible right there (publishing
# a stale rc.x ships the wrong code to `latest`)
grep -l "workspace:" packages/*/package.json
# ↑ MUST list crypto, pact, react, solana, x402 (core has no @me2em
# deps): cross-package refs keep the pnpm workspace protocol — dev
# always links the CURRENT workspace member, even when packages version
# at different rates. npm publish cannot ship that protocol
# (EUNSUPPORTEDPROTOCOL; the react rc.5 blocker), so releases pack with
# pnpm — which rewrites workspace:^ to real semver at pack time — and
# publish the stamped tarballs; the guard lives in the Pack smoke below.
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

## Pack smoke (offline, before every publish)

`corepack pnpm pack` rewrites `workspace:^` to real semver ranges in
the packed manifest (what `pnpm publish` used to do — the release
publishes with npm instead, see below). Pack the release set, verify
the stamp, then simulate a consumer without the registry:

```sh
rm -rf /tmp/pack-stage /tmp/pack-smoke && mkdir -p /tmp/pack-stage /tmp/pack-smoke
for p in core pact react; do (cd packages/$p && corepack pnpm pack --pack-destination /tmp/pack-stage); done

# stamp check — MUST print nothing: a workspace: protocol in a tarball
# is un-installable by npm consumers (EUNSUPPORTEDPROTOCOL)
for t in /tmp/pack-stage/*.tgz
  do tar -xOzf "$t" package/package.json | grep -q "workspace:" && echo "BLOCKER in $t"; done

cd /tmp/pack-smoke && npm init -y >/dev/null
# one tarball at a time, in peer order — a combined install can mask
# per-package manifest errors
npm install /tmp/pack-stage/me2em-core-*.tgz
npm install /tmp/pack-stage/me2em-pact-*.tgz
npm install /tmp/pack-stage/me2em-react-*.tgz
npm ls --depth=0

node --input-type=module -e "
import { canonicalizeToString } from '@me2em/core';
console.log('core JCS:', canonicalizeToString({ b: 1, a: [true, null, 'x'] }));
console.log('transport:', Object.keys(await import('@me2em/pact/transport')));
console.log('testing:', Object.keys(await import('@me2em/pact/testing')).length, 'exports');
console.log('react:', Object.keys(await import('@me2em/react')).length, 'exports');"
```

Expect: JCS `{"a":[true,null,"x"],"b":1}`; transport lists
`ReferenceX3DH` and `channelClock`; testing ~11 fixtures; react ~13
exports. `npm ls` shows `@me2em/crypto` as UNMET OPTIONAL (by design —
lazy load) and `react` as an auto-installed peer.

## Publish

Publish the STAGED tarballs from the Pack smoke above — their manifests
carry the stamped real ranges, and npm's CLI performs the WebAuthn
browser flow on publish (which pnpm publish lacks). Note
`npm publish <tarball>` does NOT run `prepublishOnly` — the pre-flight
build must have run:

```sh
npm publish /tmp/pack-stage/me2em-core-*.tgz  --access public --tag latest
npm publish /tmp/pack-stage/me2em-pact-*.tgz  --access public --tag latest
npm publish /tmp/pack-stage/me2em-react-*.tgz --access public --tag latest
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
