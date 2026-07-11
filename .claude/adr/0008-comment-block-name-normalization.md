# Normalize both issue comment and pr comment to the `comment` block name

gh-axi uses `comment` for `issue comment` output and `commented` for `pr comment` output.
gitea-axi normalizes both to `comment`, with the same schema: `{ number, author, created, body }`.

## Considered Options

**Match gh-axi exactly** (rejected) — `comment` for issue comment, `commented` for PR comment.
The inconsistency in gh-axi is an artifact of delegating to different `gh` subprocesses that return different data shapes, not an intentional design.
There is no semantic reason for the names to differ.

**`comment` for both** (chosen) — A single consistent block name for any "post a comment" operation.
gitea-axi gets the created `Comment` object directly from the Gitea API POST response for both issue and PR comments, so both can return the same schema without extra calls.

## Consequences

- `issue comment` and `pr comment` both emit `comment: { number, author, created, body }` (body truncated at 800 chars).
- This is a deliberate interface divergence from gh-axi.
- `number` is used instead of gh-axi's `issue` alias, since the field applies to both issue and PR numbers.
- Agents get the posted comment's data immediately (AXI Principle 4 — eliminate round trips); no follow-up `view --comments` call needed to confirm what was posted.
