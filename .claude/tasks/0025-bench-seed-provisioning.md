---
spec: benchmark-harness
---

## What to build

The deterministic, idempotent seed that brings a freshly provisioned throwaway repository to a known ground truth before a trial runs, scripted entirely over the Gitea API against the live host (see the single-user-seed ADR). Authentication reuses gitea-axi's existing credential discovery path rather than introducing new secret handling.

The seed establishes a fixed set of labels with fixed colors; a spread of open and closed issues varying by label, assignee presence (assigned-to-self versus unassigned), title keyword, and pre-existing comments; and a handful of pull requests including one labeled, one carrying an existing review, and one backed by a real pushed feature branch. All content is authored by the single available user, so the discriminating dimensions are label, state, assignee presence, and title keyword — not author.

## Acceptance criteria

- [ ] Provisioning a fresh repository and seeding it produces the fixed labels, the open/closed issue spread across the discriminating dimensions, and the pull requests (labeled, reviewed, and real-branch-backed).
- [ ] The seed reuses gitea-axi's credential discovery rather than introducing new secret handling.
- [ ] Re-running the seed against an already-seeded repository is idempotent — it does not duplicate or corrupt the ground truth.
- [ ] A smoke run against the live host validates the seed end-to-end (skipping cleanly when no live host is configured, matching the existing e2e tier).
