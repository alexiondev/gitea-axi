---
spec: gitea-axi
blocked-by: 0018-setup-skill-and-hooks
---

## What to build

Publish readiness for the unscoped `gitea-axi` npm package.
Package metadata (name, description, repository, license, engines for Node 20+, ESM), the `gitea-axi` bin entry, and the bundled Agent Skill file included in the published artifact.
No postinstall script — the install delivers the CLI binary only, and skill installation stays behind the explicit `setup` command.
Verify the packed artifact: a global install from the packed tarball yields a working binary whose `setup` finds the bundled skill.

## Acceptance criteria

- [ ] The packed tarball contains the built CLI, the bin entry, and the Agent Skill markdown, and nothing declares a postinstall script
- [ ] A global install from the tarball puts a working `gitea-axi` on the PATH (dashboard header, `--help`, and `setup` all function)
- [ ] Package metadata is complete: unscoped name, description, repository URL, license, Node 20+ engines, ESM module type
- [ ] The publish flow (registry target, access, prepack build) is documented or scripted so publishing is a single command
