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
The ruling is verified at the fixture/unit tier only: body truncation is deterministic string processing over a body the CLI already holds, with no live-Gitea response semantics for an end-to-end test to attest to, so no e2e case is warranted here.

## Acceptance criteria

- [x] The spec no longer contradicts itself: Principle 3 and the Command Surface's `body` field agree, with the reasoning recorded
- [x] `issue list --fields body` and `issue create --fields body` behave identically under the ruling
- [x] If truncation wins, the truncation hint and `--full` affordance match how `issue view` already presents a truncated body (see ADR 0003)
- [x] Tests cover the ruled behaviour on both commands

## Implementation Notes

**The ruling: `--fields body` truncates.**
Principle 3 already declared truncation applies "in all contexts (list and detail alike)"; the four `--fields body` extractors were the drift, not the intent.
"Raw" in the Command Surface is resolved to mean *uncleaned markdown* (short bodies still pass through byte-for-byte), never *unbounded* — an unbounded body on a list path lets `issue list --limit 30 --fields body` spill thirty full bodies into an agent's context, the exact cost Principle 3 exists to prevent.

**Code.**
Added a `truncatedBody()` `FieldDef` in `fields.ts` (alongside `pluck`/`joined`/`relativeTimeField`) that routes the value through the same `truncateBody(value, BODY_TRUNCATE_LIMIT, host)` that `issue view` / `pr view` use, so the hint text and `cleanBody`-on-overflow behaviour are byte-identical.
`ExtractContext` gained `host` and `full` (both required) — the render context now declares its hostname and truncation mode explicitly; every `extractRow` call site was updated (the body-less ones — dashboard, label list, relationships — pass `full: false`).
The four registries (`ISSUE_LIST`, `ISSUE_CREATE`, `PR_LIST`, `SEARCH` extra fields) now use `truncatedBody("body")`.

**Scope beyond the two commands the ACs name.**
The task body mandated that "`issue list`, `issue create`, and any later command exposing `body` via `--fields` must behave the same", so `pr list` and `search` were included too — each got the ruling and a parity test.
A `--full` flag (suppresses the `--fields body` truncation, matching `issue view`) was added to `issue list`, `issue create`, `pr list`, and `search`, since the inline hint literally says "use --full to see complete body" and that promise must be keepable on every command that offers the field.
Help text for all four commands and ADR 0003's consequences were updated accordingly.

**Verification tier.**
Fixture/unit tier only, as the task specified — no e2e case: truncation is deterministic string processing over a body the CLI already holds, with no live-Gitea response semantics to attest to.
