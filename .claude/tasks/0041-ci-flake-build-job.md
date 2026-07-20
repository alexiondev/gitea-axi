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

- [x] A distinct job builds the flake on push and on pull request.
- [x] Its failure does not block or fail the other jobs.
- [x] Removing a build-relevant file from the source allowlist makes this job fail.
- [x] The job's cost and its non-gating intent are stated in the workflow so neither reads as an oversight.

## Implementation Notes

The job sits alongside `test` in the existing workflow rather than in a file of its own, so it inherits the `on:` triggers already there — push to `main` and every pull request — with no second copy to keep in step.

Non-gating is achieved two ways, and both are needed.
The absence of a `needs:` edge means the two jobs run concurrently and neither waits on the other, so a slow or failing flake build cannot hold the test job back.
`continue-on-error: true` then keeps a red flake job from failing the workflow run as a whole, which is the part that would otherwise block a merge.
That combination is what the criterion asks for; either alone leaves a gap.

### `continue-on-error` goes on the steps, not the job

The obvious spelling — `continue-on-error: true` as a job key — is inert on the platform this workflow primarily targets, and the first draft of this task had it there.

Gitea Actions runs on a fork of `act`, and that fork's `pkg/model/workflow.go` declares `RawContinueOnError` on its **`Step`** struct only; the `Job` struct has no such field.
A job-level flag is therefore parsed as an unknown key and silently ignored, so a failing `nix flake check` would have failed the whole workflow run — exactly the merge-blocking outcome the criterion forbids, and with nothing in the logs to say why.
Gitea's own comparison page does not list the gap, which is presumably how it survives; go-gitea#25897 mentions it in passing while reporting the sibling gap in `jobs.<id>.if`.

Moving the flag onto both steps fixes it and costs no portability: step-level `continue-on-error` is honoured by `act` and GitHub Actions alike, and a job whose every step carries it concludes green on either platform.
The install step carries it too, not just the build — an action that fails to fetch or install Nix is precisely the infrastructure failure the non-gating stance exists to absorb.

### `nix flake check`, not `nix build`

The two build the same derivation, since the `checks` output aliases the package.
The check output is what a consumer would verify with, though, so exercising that path additionally catches a `checks` output that has stopped evaluating.

One limit worth recording: `nix flake check` builds the current system's outputs and merely *evaluates* the others, so the two systems the runner is not — `aarch64-linux` and `aarch64-darwin` — are type-checked rather than built.
`--all-systems` would not change that; building them needs runners of those architectures.
The job's value is the allowlist guard, which is architecture-independent, so this is a limit rather than a shortfall.

### The allowlist criterion was verified, not assumed

Deleting `./tsconfig.build.json` from `package.nix`'s `lib.fileset.unions` and re-running `nix flake check` locally fails the build in `buildPhase`:

```
> tsc -p tsconfig.build.json
error TS5058: The specified path does not exist: 'tsconfig.build.json'.
```

`package.nix` was restored immediately afterwards; the probe is not in the diff.
This is the failure mode the job exists to catch, and it confirms the loud-but-disconnected shape the 0037 Gotcha describes — the error names the missing file, never the allowlist that omitted it.

### `cachix/install-nix-action` is a third-party action

Nix is not in the runner image, so the job installs it.
That is the one dependency in this file on an action outside `actions/`, resolved from github.com by Gitea Actions the same way `actions/checkout` is.
It is also the most likely source of the infrastructure flakiness `continue-on-error` exists to absorb, which is part of why that flag is set rather than merely tolerated, and why the install step carries it as well as the build step.

It is pinned to a mutable major tag (`@v31`), matching how `actions/checkout@v4` is pinned elsewhere in the file rather than introducing a second convention.
A commit SHA would be the supply-chain-tight choice; the exposure here is a non-gating job holding no credentials and no `secrets` access, and pinning one action by SHA while the rest of the file uses tags would be inconsistent without being materially safer.
Worth revisiting as a file-wide decision rather than a local one.
