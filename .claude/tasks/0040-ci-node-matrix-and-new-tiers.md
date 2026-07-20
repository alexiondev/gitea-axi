---
spec: nix-flake-packaging
blocked-by: 0036-parameterized-installed-binary-tier
---

## What to build

Continuous integration moves off end-of-life Node, tests the full range of Node versions the package claims to support, and gains the two test tiers it currently never runs.

The workflow matrixes over the two supported Node versions, and the declared engine range in the package manifest narrows to match.
Today the manifest promises support down to Node 20 while testing only Node 20, so the entire claimed range below the tested version is unverified and its floor is end-of-life.
Narrowing is free right now because nothing has been published and no tags exist; that window closes at first publish.
The packaging tier currently asserts that the declared range mentions Node 20, so that assertion changes with it — part of this work rather than a later surprise.

The live end-to-end tier moves to the highest matrix leg only: it exercises the Gitea API contract rather than Node-version behavior, and each leg provisions a full Gitea service.

Two tiers join the workflow.
The benchmark harness tier runs on every leg — it is deterministic, needs no network or agent SDK, and is currently unguarded despite its non-default runner configuration being an easy thing to believe is running when it is not.
The packaging tier runs on the highest leg only, being slow and largely version-independent; it is the only automated guard on the distribution artifact, given that publishing is a manual command.

The benchmark smoke tier stays out: it targets a live host discovered through the maintainer's own credentials and skips cleanly when they are absent, so here it would pass by skipping — a green check that verified nothing.

The workflow keeps its container-and-npm shape and its GitHub Actions compatibility; nothing migrates to building via Nix.

## Acceptance criteria

- [x] The workflow runs a matrix over the two supported Node versions, and no leg runs an end-of-life Node.
- [x] The manifest's declared engine range names exactly the versions the matrix tests.
- [x] The packaging tier's engine assertion matches the narrowed range and passes.
- [x] The live end-to-end tier runs on the highest leg only.
- [x] The benchmark harness tier runs on every leg, under its own runner configuration.
- [x] The packaging tier runs on the highest leg only.
- [x] The benchmark smoke tier does not run.
- [x] The workflow syntax stays GitHub-Actions-compatible.

## Implementation Notes

The supported majors are 22 and 24 — the two current long-term-support lines, and the pair that brackets the nixpkgs default the flake already builds against (24.18.0).
The engine range became `^22 || ^24` rather than `>=22`, so it names those two majors and nothing else; a bare floor would have re-promised the odd-numbered 23, which is itself end-of-life.

The single matrix job was kept rather than split into a matrixed job plus a separate single-version job for the once-only tiers.
The acceptance criteria are phrased in terms of matrix legs, one job keeps the version list in exactly one place, and the task asked that the workflow keep its container-and-npm shape.
The cost is that the Gitea service container starts on the Node 22 leg without the end-to-end tier consuming it — cheap next to running that tier twice, which is what the spec's rationale was actually guarding against.

The once-only steps condition on `matrix.highest`, a flag attached to the `24` leg through a `strategy.matrix.include` entry, rather than on `matrix.node == '24'` at each site.
An `include` entry whose keys match an existing combination augments that leg rather than adding a new one, on both GitHub Actions and Gitea Actions, and an undefined context property is falsy on the other leg.

Two consequential changes beyond the criteria, both surfaced by review:

`@types/node` moved from `^20.19.0` to `^22.20.1`.
It was the last Node 20 reference left in the manifest, and the typecheck runs on every leg.
It tracks the *floor* rather than the highest leg deliberately: typings for 24 would let source compile against APIs the Node 22 leg does not have.

`.claude/spec/gitea-axi.md`'s "Language and Runtime" section still read "TypeScript on Node 20+", which this change falsified.

Verified by running the whole matrix's worth of tiers locally through `nix develop`: typecheck, the fast tier with coverage thresholds (410 tests), the benchmark harness tier under its own runner configuration (117), and the full packaging tier (7), plus `nix build .#gitea-axi` after the lockfile moved.
The workflow was parsed with `yq` to confirm the matrix, the container expression, and the two `if:` conditions land where intended.
The live end-to-end tier was not run locally — it needs a disposable Gitea instance, and the diff only gates it.

One follow-up worth flagging: `vitest.bench.config.ts` sets `passWithNoTests: true`, so if its include glob ever broke, the new benchmark step would go green while running nothing — precisely the failure mode this task cites as the reason to add the step.
Pre-existing, and left alone here rather than widened into a test-configuration change.
