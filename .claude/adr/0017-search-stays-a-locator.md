# Search stays a locator; a single match does not auto-load its detail

`search issues` / `search prs` always return a locator list (`number`, `title`, `state`, `author`, `created`) plus a next-step suggestion — never the full detail, even when exactly one result matches.
This deliberately narrows a literal reading of AXI Principle 4 ("eliminate round trips").

## Considered Options

**Auto-collapse to `view` on a single match** (rejected) — On exactly one result, run `issue view` / `pr view` and return the detail record, sparing the agent a second command.
It reads as the purest Principle 4 outcome, and it is what prompted this decision.
But the agent that searches most often wants the *number* to feed a mutation (`edit`, `close`, `comment`), not the body — so auto-loading the detail spends exactly the body tokens Principle 3's truncation exists to avoid, taxing the common find-then-act path to save a step on the rarer find-then-read one.
It also makes the output shape non-uniform — a list for zero and 2+ matches, a detail record for one — which the agent can no longer rely on.

**Stay a locator, suggest the next step** (chosen) — Search's job is finding the number to feed into `view` / `edit` (the spec's locator-schema rationale).
On a single match the next-step suggestion fills the real number (`issue view 2`), applying Principle 9's single-id fill; the agent decides whether that number feeds a `view`, an `edit`, or a `close`.

## The dividing line

Principle 4 eliminates a *redundant* round trip — a mutation returns the entity it just wrote, so no follow-up `view` is needed (ADR 0008).
`search` → `view` is not redundant: the follow-up is optional and its intent (read vs. act) is the agent's to choose, so collapsing it means guessing intent and over-fetching when the guess is wrong.

## Consequences

- `search` output shape is uniform across all match counts: always a locator list with a `help[N]:` next step.
- The next-step suggestion is conditioned on the in-repo match count: 0 → `list --state all` fallback ("to list all … instead"); 1 → `view <n>` with the real number; 2+ → `view <number>` placeholder.
- The zero-match fallback points at the non-indexed list, so it recovers from both an over-narrow query and issue-indexer lag without the command having to tell the two apart.
- An agent that does want the detail spends one more command (`view <n>`) by design — the number is already in hand, and it pays only for the detail it actually asks for.
