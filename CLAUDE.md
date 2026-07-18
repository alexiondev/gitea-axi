# gitea-axi — Agent Instructions

## Commits

Any commit message you write must follow the Conventional Commits specification as documented in [CONVENTIONAL-COMMITS.md](CONVENTIONAL-COMMITS.md).

## Gotchas

The `origin` remote is a self-hosted **Gitea** instance (`git.alexion.dev`), not GitHub.
The `gh` CLI does not work here.

The benchmark arms invoke the **built `dist/main.js`** (the `gitea-axi` binary on `PATH`), not the TypeScript source.
Run `npm run build` before any live `bench:run` if you want `src/` changes reflected; the bench does not run from source.

Prefer this project's own CLI for pull requests — it is the tool being built, so opening its PRs with it is the dogfood path:
`npm run build && node dist/main.js pr create --login axi --base main --head <branch> --title <text> --body-file <path>`.
The login profile is named `axi`, not `alexion` — passing `--login alexion` fails with `VALIDATION_ERROR`.
It reuses the `tea` login profiles, so it needs no separate credentials.
Fall back to `tea pr create --login axi --base main --head <branch>` only for what gitea-axi cannot do yet; `tea pr` still lists PRs until `pr list` lands (task 0008).

Task branches are merged into `main` on the remote, so the local `main` goes stale.
Always `git fetch origin` and cut a task branch from `origin/main`, not from whatever local `main` happens to point at.

Gitea's issue/PR search endpoint (`GET /repos/issues/search`, behind `search issues`/`search prs`) is backed by an **asynchronous, eventually-consistent issue indexer** (bleve by default).
Content created moments earlier may not be searchable yet, so end-to-end assertions that create an issue/PR and then search for it must poll (e.g. `expect.poll`) until it is indexed rather than searching once.
The fixture tier is unaffected — it stubs the endpoint — so this bites only the live `test/e2e` tier.
