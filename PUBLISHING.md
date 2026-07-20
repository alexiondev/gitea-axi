# Publishing gitea-axi

`gitea-axi` is an unscoped, public npm package.
Publishing it is a single command.

## Release

```sh
npm publish
```

That is the whole flow.
Everything the release needs is wired into `package.json`, so no extra flags are required:

- The `prepack` script runs `npm run build`, so the tarball always carries a freshly compiled `dist/` rather than whatever happened to be on disk.
- `publishConfig.access` is `public`, so the unscoped package publishes publicly without `--access public`.
- `publishConfig.registry` targets the public npm registry (`https://registry.npmjs.org/`), so a machine whose default registry is set elsewhere still publishes to the right place.
- The `files` allowlist ships only `dist/` and `skills/`, so the built CLI and the bundled Agent Skill go out and nothing else does.

There is deliberately no `postinstall` script.
Installing the package delivers the `gitea-axi` binary only; installing the Agent Skill and the session hooks stays an explicit user action behind `gitea-axi setup` and `gitea-axi setup hooks`.

## Before publishing

You need to be authenticated to the npm registry (`npm whoami` to check, `npm login` if not) with publish rights to the `gitea-axi` name.

Bump the version first with `npm version <patch|minor|major>`, which updates `package.json` and creates the release commit and tag.

## Verifying the packed artifact

The packaging smoke test comes in two facets: one asserts the shape of the packed tarball and its manifest, the other drives an installed binary — `--help`, the dashboard header, and `setup` finding the bundled skill.
By default it packs the real tarball and installs it globally into a throwaway prefix to produce that binary:

```sh
npm run test:pack
```

It builds, packs, and fetches the runtime dependencies from the registry, so it is slower than the unit and integration tiers and is not part of the default `npm test` run.
Distribution touches no Gitea API, so this smoke test is the distribution analogue of the live-Gitea end-to-end tier.

The two facets are `test/packaging/tarball.test.ts`, which is npm-specific by nature, and `test/packaging/installed-binary.test.ts`, which asserts what any *installed* gitea-axi must do, whatever installed it.
That second facet is therefore also the check a non-npm installation path runs against its own output.
Set `GITEA_AXI_INSTALLED_BIN` to the path of an already-installed binary to have it drive that one and skip the pack-and-install setup.

The Nix build is that other caller: its `installCheckPhase` points this variable at the wrapped binary it has just installed and runs the facet alone via `npm run test:installed`.
So `nix build` and `npm run test:pack` guarantee the same things about an installed gitea-axi, and neither can quietly weaken while the other holds.
