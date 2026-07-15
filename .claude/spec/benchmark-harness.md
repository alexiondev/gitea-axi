## Problem Statement

gitea-axi claims to be an agent-ergonomic, low-token interface to Gitea issues and pull requests, positioned against the `tea` CLI, the official `gitea-mcp` server, and raw Gitea REST calls.
That claim is currently unmeasured.
The maintainer wants evidence — a reproducible comparison of correctness and token consumption across those four ways of driving Gitea from a coding agent, presented as a table analogous to the published gh-axi benchmark.

Because the maintainer runs on a Claude subscription with a fixed weekly token allowance (not API credits), the resource that actually matters is token usage, not dollars.
And because a full sweep would be expensive to run in one sitting, the benchmark must be runnable incrementally — one arm-and-task cell at a time, whenever spare budget is available — accumulating results rather than requiring a single monolithic run.

## Solution

A benchmark harness, living in a `bench/` directory in this repository (excluded from the npm package), that drives a Claude agent against a suite of realistic Gitea tasks under four tool conditions and records how each performs.

For each **cell** — one `(arm, task, trial)` combination — the harness provisions a fresh throwaway repository on the live Gitea host, seeds it to a known state, runs the agent with access to exactly one arm's tool, scores the outcome deterministically against the seeded ground truth, and appends an immutable result record.
An aggregator renders the accumulated records into a headline table (one row per arm) plus supporting views, annotating any partially-run cells rather than blocking on a complete matrix.

The four arms are **gitea-axi**, **tea** (native structured commands only), **gitea-mcp** (eager schemas), and **raw Gitea REST API** (curl).
The headline metric is **cost-equivalent tokens** — token components weighted by Anthropic's published API pricing ratios — reported alongside the raw token sum and the full component breakdown.

## User Stories

1. As the maintainer, I want to run a single benchmark cell on demand by selecting an arm and a task, so that I can spend only the token budget I have available at that moment.
2. As the maintainer, I want each cell to run against a freshly provisioned and seeded throwaway repository, so that trials are isolated and correctness is scored against a known ground truth.
3. As the maintainer, I want the agent in each arm to have access to exactly one tool, so that the comparison measures the tool rather than the agent's choice between tools.
4. As the maintainer, I want the gitea-axi arm to carry the product's bundled Agent Skill and the other arms to receive only a minimal pointer to their tool's native discovery affordance, so that each tool's real ambient-context cost is charged honestly.
5. As the maintainer, I want mutation tasks scored by diffing the entire post-run repository state against the expected end state, so that both the intended change and any collateral damage are caught.
6. As the maintainer, I want read tasks scored by matching required facts in the agent's final report against the seeded ground truth, so that correctness is judged without an LLM-judge.
7. As the maintainer, I want the headline metric to be cost-equivalent tokens with the raw sum and per-component breakdown recorded alongside, so that I can gauge weekly-budget burn today and re-weight the data if Anthropic's accounting is ever documented.
8. As the maintainer, I want each run bounded by a turn cap and a wall-clock backstop, so that a confused or hung agent cannot drain my budget.
9. As the maintainer, I want results appended as immutable timestamped samples, so that I can deepen any cell's sample size opportunistically without overwriting prior runs.
10. As the maintainer, I want the aggregator to render whatever results exist and annotate incomplete coverage, so that a half-run matrix still produces a readable, non-misleading table.
11. As the maintainer, I want tasks confined to the capability surface shared by all four arms, so that success differences reflect ergonomics rather than scope.
12. As the maintainer, I want capability-asymmetric operations reported in a separate bonus table, so that each tool's distinctive edges and gaps are visible without contaminating the headline comparison.
13. As the maintainer, I want a per-tier and per-token-component view derived from the same records, so that I can see where an arm wins or loses and what drives its cost.
14. As the maintainer, I want the harness to reject or flag any run in which the agent reached a tool outside its arm, so that a leak invalidates the trial instead of silently corrupting the metrics.

## Implementation Decisions

### Arms

Four arms are compared:

- **gitea-axi** — the hero arm; its bundled Agent Skill is loaded into the agent's context, matching how the product ships.
- **tea** — restricted to its native structured subcommands.
  The `tea api` escape hatch is excluded, because allowing it would collapse the tea arm into the raw-API arm.
- **gitea-mcp** — the official server (v1.3.0 at design time), with its full set of dispatcher tools loaded eagerly.
- **raw Gitea REST API** — the agent issues `curl` calls against `HOST/api/v1` with a bearer token.

### Environment

Every cell runs against the live Gitea host, but isolation comes from a per-trial throwaway repository the harness creates, seeds, runs against, and deletes.
The harness authenticates by reusing gitea-axi's existing credential discovery path rather than introducing new secret handling.

### Seed

The seed is scripted through the Gitea API and is deterministic and idempotent.
It establishes a fixed set of labels with fixed colors, a spread of open and closed issues varying by label, assignee state, title keyword, and pre-existing comments, and a handful of pull requests including one labeled, one carrying an existing review, and one backed by a real pushed feature branch.
All content is authored by the single available user.

Because only one Gitea account is available, the seed carries no author or assignee variety across users.
Discriminating dimensions are label, state, assignee presence (assigned-to-self versus unassigned), and title keyword.

### Task suite

The scored suite is 20 tasks drawn only from the capability surface shared by all four arms — issue and pull-request listing, viewing, creation, editing, closing and reopening, commenting and comment retrieval, label management and application, review comments, merge, and assignee changes.
Tasks are phrased as natural-language intents, not command invocations, and are parametrized against the seed.
The suite is weighted toward discovery and multi-step work, where tool ergonomics diverge: roughly four read tasks, six single-mutation tasks, six find-then-act tasks, and four multi-step workflows.

Reviews in the scored suite use comment-type reviews, which a single user can leave on their own pull request.
Whether the host permits a user to approve or request changes on their own pull request is verified during implementation; if permitted, the two review tasks are promoted from comment reviews to approve and request-changes.

Capability-asymmetric operations are excluded from the scored suite and reported in a separate bonus table.
These fall in both directions: operations where tea, gitea-mcp, or raw API fall short of gitea-axi (full-text search, diff, checks, checkout, issue dependencies), and operations outside gitea-axi's scope entirely (repository, release, and milestone management), for which gitea-axi is reported as not-applicable.

### Scaffolding

All arms share an identical task-agnostic base prompt and the same repository coordinates and token.
Each arm then receives a minimal, symmetric bootstrap naming its tool and pointing at that tool's own native discovery affordance — with the deliberate exception that the gitea-axi arm loads the bundled Agent Skill, because the Skill is part of the shipped product and its token cost should be charged to gitea-axi.
The tea and raw-API arms receive a one-line pointer; the gitea-mcp arm's schemas load eagerly as its ambient cost.

### Tool isolation

Enforcement is a guard callback that inspects every proposed shell command and permits only the one binary allow-listed for the active arm plus harmless utilities, denying foreign binaries, absolute-path evasions, and fetch-via-interpreter tricks.
A curated per-arm PATH backs the guard as a convenience layer.
The gitea-mcp arm disables the shell tool entirely and attaches only the MCP tools.
Blocked attempts are left in the transcript and count as realistic wasted effort; they are not silently retried.

### Runner and metrics

The runner is the Claude Agent SDK on the maintainer's subscription, using a single fixed model at temperature zero across all arms.
The auxiliary small model that the agent runtime invokes for internal chores is included in metrics rather than suppressed, because it is real consumption.

Each completed run records the four token components (fresh input, cache-creation, cache-read, output), the turn count, the wall-clock duration, the imputed cost, and the pass/fail outcome.
The headline metric, **cost-equivalent tokens**, weights the components by Anthropic's published API pricing ratios (see the cost-equivalent-token-metric ADR).
The raw token sum and the component breakdown are retained so the data can be re-weighted if the subscription's weekly accounting is ever documented.

### Run loop and results

Each cell defaults to five trials, with a reporting floor of three.
Each run is bounded by a turn cap and a wall-clock backstop; exceeding either records a failure, tagged to distinguish a confused agent from a hung one.
Results are appended as immutable, timestamped samples to a per-cell store; deepening a cell adds samples rather than overwriting slots.

### Reporting

The aggregator reads the accumulated results and renders a headline table with one row per arm — cost-equivalent tokens, raw tokens, turns, duration, success rate, and a coverage figure — with imputed cost shown as a de-emphasized secondary column.
It renders whatever exists and annotates incomplete coverage rather than blocking on a full matrix.
Supporting views derived from the same records include a per-tier breakdown, a per-token-component breakdown, and the separate bonus table.

## Testing Decisions

A good test here exercises external behavior at a seam, not internal wiring, mirroring the repository's existing split between a deterministic fixture tier and a live end-to-end tier.

Three pure seams are unit-tested:

- The **checker**, fed synthetic state snapshots and expected states, covering the normalization rules (dropping volatile identifiers and timestamps, matching comments by author and body, comparing label sets), the full-state diff that catches both missing intent and collateral change, and the deterministic answer-match for read tasks.
- The **guard**, covering that each arm's allow-listed binary passes and that foreign binaries, absolute-path evasions, and interpreter-based fetch attempts are denied.
- The **aggregator**, covering partial-matrix annotation, coverage reporting, per-tier and per-component rollups, and stable rendering from an append-only sample store.

Two boundaries are validated by integration and audit rather than unit tests:

- **Seed provisioning** against the live host, validated by a smoke run rather than mocked, since its value is the real API interaction.
- **Run orchestration** against the real model, validated by the post-run transcript audit that asserts no foreign tool was reached; a detected leak flags the trial invalid.

Prior art for the deterministic seams is the project's existing fixture-server tier; prior art for the live boundary is the existing end-to-end tier, including its use of polling for the eventually-consistent issue indexer.

## Out of Scope

- The numbered task file that schedules this work is authored separately by the maintainer.
- Repository, release, milestone, and other operations outside gitea-axi's command surface are not scored; they appear only in the bonus table.
- Multi-account scenarios (distinct authors and assignees, and non-self approvals) are out of scope for the scored suite under the single-user constraint.
- Empirically pinning the subscription's exact weekly-budget weighting is a possible later validation, not part of this harness.
- Container-based operating-system isolation is not used; the guard is the enforcement mechanism.

## Further Notes

The gitea-mcp server uses a compact read/write dispatcher design rather than one eager schema per operation, so the MCP arm may not reproduce the dramatic token inflation seen for heavier MCP servers in the reference gh-axi benchmark.
That is a legitimate result about dispatcher-style MCP design, not a defect in the harness, and the expectation is set here so the outcome is not read as a bug.

Duration is treated as a soft metric throughout, because every arm runs against the live host and inherits its network variance.

The benchmark's own vocabulary (arm, cell, shared surface, cost-equivalent tokens, seed, checker) is intentionally kept in this spec and the `bench/` documentation rather than in the tool's domain glossary, which describes gitea-axi's own language and should not be diluted by harness terms.
