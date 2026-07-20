# gitea-axi — Agent Instructions

## Commits

Any commit message you write must follow the Conventional Commits specification as documented in [CONVENTIONAL-COMMITS.md](CONVENTIONAL-COMMITS.md).

## Gotchas

The `origin` remote is a self-hosted **Gitea** instance (`git.alexion.dev`), not GitHub.
The `gh` CLI does not work here.

The benchmark arms invoke the **built `dist/main.js`** (the `gitea-axi` binary on `PATH`), not the TypeScript source.
Run `npm run build` before any live `bench:run` if you want `src/` changes reflected; the bench does not run from source.

Prefer this project's own CLI for pull requests — it is the tool being built, so opening its PRs with it is the dogfood path:
`npm run build && node dist/main.js pr create --login alexion --base main --head <branch> --title <text> --body-file <path>`.
It reuses the `tea` login store, which here holds exactly `alexion` — there is no `axi` profile, and the `csv-reviewer` profile that used to exist is gone for good.
`selectLogin` matches the `--login` value against those names exactly, so `--login alexion` works and an unknown name like `--login axi` fails with `VALIDATION_ERROR` ("Login profile "axi" not found").
Fall back to `tea pr create --login alexion --base main --head <branch>` only for what gitea-axi cannot do yet; `tea pr` still lists PRs until `pr list` lands (task 0008).

The same login store backs the benchmark: `npm run bench:run -- --arm <arm> --login alexion --task <id>` (or set `GITEA_AXI_BENCH_LOGIN=alexion`).

The `bench/` unit tests only run under their own Vitest project config: `npx vitest run --config vitest.bench.config.ts bench/<file>.test.ts`.
Plain `npx vitest run bench/<file>.test.ts` reports "no tests" because the default `vitest.config.ts` includes only `test/**`.

Task branches are merged into `main` on the remote, so the local `main` goes stale.
Always `git fetch origin` and cut a task branch from `origin/main`, not from whatever local `main` happens to point at.

Gitea's issue/PR search endpoint (`GET /repos/issues/search`, behind `search issues`/`search prs`) is backed by an **asynchronous, eventually-consistent issue indexer** (bleve by default).
Content created moments earlier may not be searchable yet, so end-to-end assertions that create an issue/PR and then search for it must poll (e.g. `expect.poll`) until it is indexed rather than searching once.
The fixture tier is unaffected — it stubs the endpoint — so this bites only the live `test/e2e` tier.

`tea` is **still a runtime dependency**, despite [ADR 0002](.claude/adr/0002-direct-gitea-api-over-tea-subprocess.md) being titled "use direct Gitea API instead of wrapping the `tea` subprocess".
That ADR moved *command dispatch* to `gitea-js`; it explicitly kept `tea` for **credential discovery**, and its own Consequences section says so.
Per [ADR 0001](.claude/adr/0001-diff-auth-via-tea-login-list.md) as amended, `src/context.ts` resolves auth by shelling out to `tea login list --output json` (discovery) and `tea login helper get --login <name>` (token, with in-place OAuth refresh).
The only bypass is the test hook requiring `GITEA_AXI_API_URL` + `GITEA_AXI_TOKEN` + `GITEA_AXI_REPO` together; there is no user-facing path that avoids `tea`, and `TEA_NOT_INSTALLED` exists for its absence.

Neither `node`/`npm` nor `tea` is on the `PATH` in a non-interactive shell on this machine, and there is no `~/.gitconfig`.
This is a NixOS host with no global Node install, so run work through the flake's dev shell: `nix develop --command <cmd>`, which carries Node, `git`, `tea`, and `curl` — enough for the build, the fast tier, the live end-to-end tier, and the benchmark harness's own runner.
That covers anything resolving credentials, including `gitea-axi pr create`.
The shell deliberately does *not* put `gitea-axi` on the `PATH`, so a live `bench:run` of the `gitea-axi` arm still needs the built binary exposed under that name itself — see the benchmark gotcha above.
`nix shell nixpkgs#nodejs -c ...` still works for a one-off outside the repository, but inside it the dev shell is the declarative answer and pins the same Node the package is built against.
`node_modules/` may be absent too, so `npm ci` first.
Commits need an explicit identity: `git -c user.name=alexion -c user.email=contact@alexion.dev commit ...`, matching the existing history.

The Nix derivation's source is an **explicit allowlist** in [`package.nix`](package.nix), not the whole repository and not a gitignore filter.
A new build-relevant top-level file — a TypeScript configuration, a runner configuration the fast tier loads, a directory the build reads — must be added to that `lib.fileset.unions` list or `nix build` fails on a missing file.
The failure is loud but disconnected from its cause: the error names the missing file, not the allowlist that omitted it.
The flip side is the point of the design — touching an ADR, a spec, a task, a `bench/` file, or prose documentation must *not* change the derivation's output path.

`buildNpmPackage` provides **no check hook**, so `doCheck = true` on its own is silently inert — the build logs `no Makefile or custom checkPhase, doing nothing` and ships a package whose tests never ran.
Running the fast tier inside the derivation requires an explicit `checkPhase`; it also needs `git` and `which` in `nativeCheckInputs` and a writable `HOME`, since some of those tests shell out to `git`.

`nodejsInstallExecutables` (inside `npmInstallHook`) installs each manifest `bin` entry as a **generated wrapper that invokes `node <path>` explicitly**, not as a symlink to the entrypoint.
So under Nix the executable bit on `dist/main.js` is not load-bearing — `chmod -x` on it changes nothing — while the bit on `$out/bin/gitea-axi` is, and makeWrapper always sets it.
The npm path differs: there the `bin` entry is symlinked and npm sets the bit at install time.

`npmInstallHook` runs `npm prune --omit=dev` against the **build tree's** `node_modules` during `installPhase`, so dev dependencies (vitest included) are gone by the time `postInstall` or `installCheckPhase` runs.
Anything that needs them after install must snapshot the tree in `preInstall` first; `cp -al` is the cheap way, since the prune's deletions do not follow hardlinks.

Running vitest inside the derivation leaves a run cache at `node_modules/.vite/…/results.json` that records durations and timestamps, and `npmInstallHook` copies `node_modules` into `$out` wholesale.
Left alone it ships a stray cache in the closure and makes the output non-reproducible — visible only under `nix build --rebuild`, which reports "may not be deterministic"; an ordinary build stays green.
`checkPhase` deletes it before the install phase runs.

nixpkgs 26.11 (the `nixos-unstable` the flake tracks) has **dropped `x86_64-darwin`**.
`legacyPackages.x86_64-darwin` now *throws* rather than merely failing to build, so listing that system in the flake's `systems` breaks `nix flake show` and `nix flake check` for every system at once, not just that one.
Intel macOS would need the 26.05 branch.

Gitea Actions ignores **job-level `continue-on-error`**.
Its `act` fork declares `RawContinueOnError` on the `Step` struct only — `pkg/model/workflow.go` has no such field on `Job` — so `jobs.<id>.continue-on-error` is parsed as an unknown key and silently dropped, and the job fails the run as if the flag were never written.
Gitea's own syntax-comparison page does not list the gap.
Put `continue-on-error` on each step instead: `act` and GitHub Actions both honour it there, and a job whose every step carries it concludes green on either platform.
The same fork historically ignored `jobs.<id>.if` (go-gitea#25897), so treat any job-level key as needing a check against the fork's structs rather than against GitHub's documentation.

`resolvePortableHookCommand` in `axi-sdk-js` returns the bare binary name only when a `PATH` entry *realpath-matches* the **`execPath` it is handed**, and the absolute path otherwise.
Passing `binaryNames` does not by itself make the hook portable: npm symlinks its `bin` entry straight at `dist/main.js` so the match succeeds there, but a wrapper-based install (Nix, a shim, a generated `.cmd`) never can, because a script that *invokes* a file does not resolve *to* it.
Per [ADR 0019](.claude/adr/0019-hook-records-search-path-name.md), `setup hooks` therefore resolves `gitea-axi` on `PATH` itself and hands *that* location over, which makes the match succeed and the bare name get recorded.
It only accepts a `PATH` entry that resolves to the running entrypoint — a symlink to it, or a wrapper naming it in its text — so a same-named binary that is some other program falls through to the absolute-path fallback, as does a name that is not on `PATH` at all.
It reads `PATH` from `process.env`, not from the injected `deps.env`, because it has to agree with the SDK's own probing — so a test that wants to steer this has to set `process.env.PATH`.
Verify hook behaviour by driving the installed binary and reading `~/.claude/settings.json`, not by reading the SDK's interface; a hook whose recorded path no longer exists does not run and does not warn.

The SDK's `isManagedHook` recognises its own hook by testing whether the recorded command *contains* the marker, so it appends a duplicate instead of updating in place whenever the recorded command lacks the substring `gitea-axi`.
`setup hooks` compensates by pruning duplicates itself after the SDK writes.
This is why `package.nix` no longer needs to rename its build tree: the fast tier runs from `/build/source`, whose path has no marker in it, and the idempotency test passes there.
