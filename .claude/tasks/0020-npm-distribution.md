---
spec: gitea-axi
blocked-by: 0018-setup-skill-and-hooks
---

## What to build

Publish readiness for the unscoped `gitea-axi` npm package.
Package metadata (name, description, repository, license, engines for Node 20+, ESM), the `gitea-axi` bin entry, and the bundled Agent Skill file included in the published artifact.
No postinstall script — the install delivers the CLI binary only, and skill installation stays behind the explicit `setup` command.
Verify the packed artifact: a global install from the packed tarball yields a working binary whose `setup` finds the bundled skill.
This tarball-and-global-install check is the applicable real-integration surface for this slice; distribution touches no Gitea API, so there is no live-Gitea end-to-end case — the packaging smoke test below stands in its place.

## Acceptance criteria

- [x] The packed tarball contains the built CLI, the bin entry, and the Agent Skill markdown, and nothing declares a postinstall script
- [x] A global install from the tarball puts a working `gitea-axi` on the PATH (dashboard header, `--help`, and `setup` all function)
- [x] Package metadata is complete: unscoped name, description, repository URL, license, Node 20+ engines, ESM module type
- [x] The publish flow (registry target, access, prepack build) is documented or scripted so publishing is a single command

## Implementation Notes

Most package metadata (unscoped name, description, `type: "module"`, MIT license, `engines.node >=20`, the `gitea-axi` bin, and the `files` allowlist shipping `dist` + `skills`) already existed from earlier tasks; this slice added the missing `repository` (plus conventional `homepage`/`bugs`) and the publish wiring.

`prepublishOnly` was replaced with `prepack: "npm run build"`.
`prepack` fires on both `npm pack` and `npm publish`, so the tarball always carries a freshly built `dist/` — which the packaging smoke test's `npm pack` relies on — whereas `prepublishOnly` only ran on publish.
`publishConfig` pins `access: "public"` (so the unscoped package publishes without `--access public`) and `registry: "https://registry.npmjs.org/"` (so a machine with a different default registry still publishes to the right place), making `npm publish` a genuine single command.
The flow is also written down in `PUBLISHING.md`.

The packaging smoke test is its own tier: `vitest.packaging.config.ts` + the `test:pack` script, excluded from the fast `npm test` run (it packs, installs globally, and fetches runtime deps from the registry, so it is slow).
Distribution touches no Gitea API, so — exactly as the task frames it — this tarball-and-global-install check stands in for the absent live-Gitea e2e tier rather than being one.

Deviations / follow-ups:

- **Process deviation (TDD sequencing):** the test-writer sub-agent ran concurrently with the `package.json`/`PUBLISHING.md` edits, so by its final run it observed GREEN and did not report a clean RED for the metadata/publish facets (it mis-attributed the fields to the prior commit). The pre-edit tree was genuinely RED for those facets (no `repository`, `prepack`, `publishConfig`, or `PUBLISHING.md`); the file-presence and installed-binary facets were already GREEN because the CLI, bin, and bundled skill shipped in task 0018.
- **Test robustness fixes the sub-agent made:** the `npm pack --json` output shape differs across npm majors (array vs. object), so the test tolerates both; and the dashboard facet uses a promisified `execFile` rather than `execFileSync` so the in-process fixture Gitea server can answer the CLI's HTTP calls (a synchronous spawn deadlocks the shared event loop).
