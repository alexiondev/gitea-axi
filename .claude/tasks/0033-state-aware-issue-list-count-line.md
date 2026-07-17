---
spec: read-tier-accuracy
blocked-by: 0032-bench-read-report-persistence
---

## What to build

Make the `issue list` count line name the state it filtered on, so the answer to "how many issues are open?" is present in the summary rather than only inferable from each row's state field.

The command already resolves the effective state filter (defaulting to open), so it composes that state into its own count line and passes the composed line down; the generic count-line render helper stays generic and unaware of issue state. This keeps a single render seam and lets other list commands (`pr list`, `search`, `dashboard`) opt in on their own terms rather than inheriting the behavior.

The count-line wording is chosen so that an agent quoting the summary lands on an answer the read checker already accepts (its accepted renderings include forms like `5 open`). After the change lands, a re-run of the read tier confirms `read-open-issue-count` moves from a consistent failure toward a pass — using the reports persisted by [[0032-bench-read-report-persistence]] to confirm the failure was a wrong/inferred count rather than a rejected phrasing before finalizing the wording.

## Acceptance criteria

- [x] The `issue list` count line names the state it counted for the default open filter.
- [x] The count line names the state for an explicit `--state` filter.
- [x] The generic count-line render helper is unchanged and remains state-agnostic; `pr list`, `search`, and `dashboard` output is unaffected.
- [x] Existing count-line invariants hold: a total is always reported, and the bare `count: N` form never appears.
- [x] New assertions extend the existing `issue list` command test at the fixture-server CLI seam, asserting exact rendered count-line strings.
- [-] A re-run of the read tier shows `read-open-issue-count` moving toward a pass, and the chosen wording contains a rendering the read checker already accepts.

## Implementation Notes

- The `issue list` count line now renders `count: <shown> <state> of <total> total` — e.g. `count: 5 open of 5 total`, `count: 1 closed of 1 total`. The command composes the state into the count line via a local `countStateQualifier(state)` helper; the generic `formatCountLine` gained only an optional, domain-agnostic `qualifier?: string` and never learns about issue state. Every other caller (`pr list`, `search`, `dashboard`, `label`, `issue`'s blocks/blocked-by list) passes no qualifier, so their output is byte-identical — the untouched command tests still pass, which is what criterion 3 really guards.
- **Criterion 3 wording.** Read literally, `formatCountLine` is not "unchanged" — it gained a parameter. But it stays *state-agnostic* (the qualifier is a bare string; state-to-qualifier mapping lives in the command), which is the spec's actual intent ("the generic render helper that formats count lines stays generic … rather than the helper learning about issue state"). The single render seam is preserved. Marked satisfied on that reading; the spec author may wish to reword the criterion from "unchanged" to "state-agnostic".
- **`--state all`.** Deliberately renders with no state word (`count: N of M total`): `all` imposes no narrowing filter and has no natural one-word name, so naming it adds no disambiguation. Open and closed — the filters where a bare count could mislead — are named, which is what resolves User Story 2's ambiguity. Pinned by a dedicated `--state all` test.
- **Criterion 6 (`[-]`, deferred not dropped).** The controllable half is done and verified: the chosen wording contains a checker-accepted rendering — running the real `checkReadAnswer` against the real `formatCountLine(5, 5, false, "open")` output (`count: 5 open of 5 total`) scores a pass on the `read-open-issue-count` fact, so an agent that merely echoes the summary now passes. The live read-tier re-run itself needs the benchmark environment (a live Gitea host + the Claude Agent SDK) and is left as a follow-up to run when the harness is next exercised; the report-persistence from [[0032-bench-read-report-persistence]] is now in place to confirm the movement from real report text.
- Reconciled the pre-existing count-line assertions that the format change made stale (five in `test/issue-list.test.ts`, two in `test/detection.test.ts`) to the state-named form; added a `--state all` guard test.
