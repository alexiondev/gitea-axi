---
spec: benchmark-harness
---

## What to build

The deterministic, idempotent seed that brings a freshly provisioned throwaway repository to a known ground truth before a trial runs, scripted entirely over the Gitea API against the live host (see the single-user-seed ADR). Authentication reuses gitea-axi's existing credential discovery path rather than introducing new secret handling.

The seed establishes a fixed set of labels with fixed colors; a spread of open and closed issues varying by label, assignee presence (assigned-to-self versus unassigned), title keyword, and pre-existing comments; and a handful of pull requests including one labeled, one carrying an existing review, and one backed by a real pushed feature branch. All content is authored by the single available user, so the discriminating dimensions are label, state, assignee presence, and title keyword — not author.

## Acceptance criteria

- [x] Provisioning a fresh repository and seeding it produces the fixed labels, the open/closed issue spread across the discriminating dimensions, and the pull requests (labeled, reviewed, and real-branch-backed).
- [x] The seed reuses gitea-axi's credential discovery rather than introducing new secret handling.
- [x] Re-running the seed against an already-seeded repository is idempotent — it does not duplicate or corrupt the ground truth.
- [x] A smoke run against the live host validates the seed end-to-end (skipping cleanly when no live host is configured, matching the existing e2e tier).

## Implementation Notes

The slice splits into two seams: `bench/seed-plan.ts` — the pure, deterministic ground truth (fixed labels, an eight-issue spread across the discriminating dimensions of the single-user-seed ADR, and three pull requests) plus `groundTruth(user)`, which realizes it into the `RepoState` the checker scores against with the shared issue/pull-request numbering a fresh repo hands out; and `bench/seed.ts` — the idempotent seeding scripted over the live Gitea API.
The pure seam was driven test-first (`bench/seed-plan.test.ts`); the imperative seam is validated by the live smoke run (`bench/seed.smoke.test.ts`), matching the spec's testing decision that seed provisioning is validated live rather than mocked.

Decisions and deviations:

- **Credential reuse.** `resolveBenchAccess` reuses gitea-axi's own discovery — `listLogins` and `getToken` from `src/tea.ts` and `selectLogin` from `src/context.ts`, which was widened from private to `export` for this. No new secret handling was introduced.
- **Smoke tier.** The live smoke test is its own vitest tier (`vitest.bench-smoke.config.ts`, `npm run test:bench:smoke`), gated on `GITEA_AXI_BENCH_LOGIN`, so the deterministic `test:bench` tier stays free of live network. Validated live against `git.alexion.dev`; the throwaway repo is deleted afterward.
- **`readSeedSummary`.** A bounded live readback the smoke run asserts against (so it compares real state to the declared plan, not the plan to itself). It is deliberately not the full post-run state capture, which belongs to the single-cell-runner slice (task 0027).
- **`deleteRepo`.** Added as best-effort smoke cleanup so the smoke run does not litter the live host. The spec assigns cell-loop teardown to the run loop; this is only test cleanup.
- **Pull-request state reconciliation.** Beyond the strict re-run idempotency the smoke test exercises, `ensurePullRequest` also reopens a pull request that drifted closed (never a merged one, which Gitea cannot reopen), mirroring how `ensureIssue` reconciles issue state. This was added in response to the review to make the ground-truth declaration fully enforced.
- **Self-review promotion.** ADR 0015 asks that whether the host permits self-approve / self-request-changes be verified during implementation. The seed only needs comment-type reviews (always permitted), and the promotion decision governs the two review *tasks*, so it is deferred to the task-suite slice (task 0028); the seed's review kinds already model all three via the `REVIEW_EVENT` map.

Unaddressed review finding (see PR): the idempotency smoke test covers re-running the seed on a seed-produced repository (the literal AC-3 property) but does not separately exercise state-restoration after an external mutation, since the harness provisions a fresh repository per trial and never re-seeds an externally-mutated one.
