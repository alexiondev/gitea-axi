---
spec: gitea-axi
---

## What to build

A single ruling on whether `--fields body` truncates, applied uniformly everywhere the `body` extra field is offered.

The spec contradicts itself today.
Principle 3 says body text is truncated at **500 characters** "in all contexts (list and detail alike)", while the Command Surface describes the `body` extra field as "`body` (raw)" for both `issue list --fields` and `issue create --fields`.
`issue view` follows Principle 3 (it routes the body through `truncateBody`, which also applies `cleanBody`), but the two `--fields` paths follow the Command Surface and emit the body raw and untruncated — `ISSUE_CREATE_EXTRA_FIELDS` in task 0004, then `ISSUE_LIST_EXTRA_FIELDS` in task 0002, which copied the precedent rather than diverge from it.

The cost is real on the list path: `issue list --limit 30 --fields body` can emit 30 full issue bodies into an agent's context, which is the exact expense Principle 3 exists to prevent.
The plausible reading of "raw" is *uncleaned markdown* (no `cleanBody`) rather than *unbounded*, but that is a guess and the two passages need reconciling in the spec text, not in an extractor.

Decide, then make the spec and the code agree:

- If bodies truncate in `--fields` too, route the `body` extractor through `truncateBody` (a `truncatedBody()` FieldDef alongside `pluck`/`joined`/`relativeTimeField` in `fields.ts`), and amend the Command Surface's "(raw)" wording.
- If `--fields body` is genuinely exempt, amend Principle 3 to carve out the exemption explicitly and say why, so the next slice offering a `body` field does not have to re-derive it.

Whichever way it goes, `issue list`, `issue create`, and any later command exposing `body` via `--fields` must behave the same.

## Acceptance criteria

- [ ] The spec no longer contradicts itself: Principle 3 and the Command Surface's `body` field agree, with the reasoning recorded
- [ ] `issue list --fields body` and `issue create --fields body` behave identically under the ruling
- [ ] If truncation wins, the truncation hint and `--full` affordance match how `issue view` already presents a truncated body (see ADR 0003)
- [ ] Tests cover the ruled behaviour on both commands
