---
spec: nix-flake-packaging
blocked-by: 0037-flake-package-and-wrapper
---

## What to build

A separate continuous-integration job that builds the flake, on both push and pull request.

Its value is detecting flake rot — most concretely, a build-relevant file omitted from the source allowlist — at the commit that causes it rather than weeks later at the maintainer's next system rebuild.

It is deliberately non-gating for the other jobs, so an infrastructure problem with Nix availability on the runner does not block an otherwise legitimate change.
Its cost is honest and accepted: because the checks output aliases the package, this job re-runs the fast tier inside the derivation and, without a warm store, rebuilds the whole dependency closure.

## Acceptance criteria

- [ ] A distinct job builds the flake on push and on pull request.
- [ ] Its failure does not block or fail the other jobs.
- [ ] Removing a build-relevant file from the source allowlist makes this job fail.
- [ ] The job's cost and its non-gating intent are stated in the workflow so neither reads as an oversight.
