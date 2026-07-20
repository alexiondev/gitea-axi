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

- [ ] The workflow runs a matrix over the two supported Node versions, and no leg runs an end-of-life Node.
- [ ] The manifest's declared engine range names exactly the versions the matrix tests.
- [ ] The packaging tier's engine assertion matches the narrowed range and passes.
- [ ] The live end-to-end tier runs on the highest leg only.
- [ ] The benchmark harness tier runs on every leg, under its own runner configuration.
- [ ] The packaging tier runs on the highest leg only.
- [ ] The benchmark smoke tier does not run.
- [ ] The workflow syntax stays GitHub-Actions-compatible.
