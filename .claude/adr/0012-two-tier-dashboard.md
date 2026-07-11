# Two-tier dashboard: gh-axi-sized default, `--full` for the rich view

The no-args home view has two tiers.
The short tier (bare `gitea-axi`, and what the SessionStart hook runs) matches gh-axi's home shape: up to 3 open issues and up to 3 open PRs.
The full tier (`gitea-axi --full`) is the rich view: a 20-row open-PR table with labels and review decision, plus open issue counts grouped by label (up to 1000 issues aggregated).
The short tier's help block always hints at `--full`.

## Considered Options

**Rich dashboard always** (rejected) — The original spec shape.
It is the heaviest command in the tool: one review fetch per listed PR (up to 20) plus up to 20 pages of issue aggregation.
With the opt-in SessionStart hook (see ADR 0009 addendum) it would run at every session start inside the SDK's 10-second hook timeout, and canonical Principle 7 asks for a "compact" dashboard.

**Short dashboard only** (rejected) — Drops the label-aggregation view entirely, losing the at-a-glance issue-state summary that motivated the rich dashboard.

**Two tiers** (chosen) — Cheap, hook-safe default with the rich view one flag away and discoverable via the default output's help block.

## Consequences

- The SessionStart hook always runs the short tier, because the SDK registers the bare binary with no arguments.
- `--full` is intentionally overloaded: on view/diff commands it suppresses truncation; on the dashboard it selects the full tier.
- The short tier costs at most 5 HTTP calls (issues, PRs, up to 3 review fetches), comfortably inside the hook timeout.
- Dashboard empty states are `issues: 0 open` / `prs: 0 open` in both tiers, matching gh-axi's home view.
