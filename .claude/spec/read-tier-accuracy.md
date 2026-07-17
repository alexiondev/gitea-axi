# Read-tier accuracy

## Problem Statement

The benchmark ranks gitea-axi first on both cost metrics — lowest cost-equivalent tokens and lowest imputed cost of the four arms — but second on accuracy, 95% against gitea-mcp's 97%.
That entire two-point deficit is a single task: `read-open-issue-count`, which gitea-axi fails on all three trials while gitea-mcp passes one of three.
The read tier is the weakest tier for every arm, and on it gitea-axi spends more turns and more output than gitea-mcp yet scores lower, so agents are working harder to answer count questions and still getting them wrong.

Two things stand in the way of closing this gap.
First, the `issue list` summary reports `count: N of M total` and never names the state it filtered on, so an agent asking "how many issues are open?" has to infer the answer rather than read it off the summary line.
Second, the benchmark records only tokens and a `failure: "incorrect"` tag for a failed read — never the agent's actual report — so a maintainer cannot tell whether the agent reported a wrong number or reported the right number in wording the checker's phrase list did not accept.
Without the report text the root cause of the 3/3 failure cannot be confirmed, so the product fix would be a guess.

## Solution

Make list count summaries self-answering, and make read failures diagnosable.

For the product, the count line of a filtered list names the state it counted.
When a maintainer or an agent runs `issue list` on the default open filter, the summary states that the count is a count of open issues, so the answer to "how many are open?" is present in the summary rather than only inferable from each row's state field.

For the harness, every result record carries the agent's final report for read tasks.
A failed read is then diagnosable directly from the stored record: the maintainer can see the exact text the agent submitted and tell a wrong count apart from a right count phrased in words the checker did not list.
This is the prerequisite that turns the `read-open-issue-count` failure from an opaque tag into evidence, and it is the data that decides whether the checker's accepted-phrasing list is later too strict.

## User Stories

1. As an agent answering a count question, I want the list summary to state which state it counted, so that I can report "5 open issues" straight from the summary line without inferring it from the rows.
2. As a maintainer reading `issue list` output, I want the count line to say what it counted, so that a bare `count: 5` is never ambiguous about whether those five are open, closed, or all issues.
3. As a maintainer auditing a failed read trial, I want the stored result record to include the agent's final report, so that I can see exactly what the agent said instead of only that it was "incorrect".
4. As a maintainer deciding whether the read checker is too strict, I want the persisted reports across trials, so that I can judge from evidence whether correct answers are being rejected on wording rather than substance.
5. As a maintainer re-running the benchmark after the count-line change, I want `read-open-issue-count` to move from a consistent failure toward a pass, so that gitea-axi's accuracy stops trailing on the one task that accounts for the whole gap.

## Implementation Decisions

- Two modules change: the `issue list` command in the product, and the benchmark runner's result-record assembly in the harness.
  They serve one goal but are testable at different seams and can land independently, with the harness change first so the product fix can be confirmed against real report text.

- **State-aware count line (product).**
  The list command composes the state into its own count line; the generic render helper that formats count lines stays generic.
  The command already resolves the effective state filter (defaulting to open), so it passes that filter descriptor into the summary rather than the helper learning about issue state.
  This keeps a single render seam and lets each list command opt in on its own terms; `pr list`, `search`, and `dashboard` are unaffected unless they choose to opt in the same way.
  The existing count-line invariants are preserved: a total is always reported, and the bare `count: N` form must never appear.

- **Report persistence (harness).**
  The agent's final report is already in hand at the point the runner scores a read task, so persisting it is threading that value into the record the runner assembles rather than plumbing it up from a new source.
  The report is added to the result record for read tasks; the store serializes whatever record it is handed, so it needs no change of its own.
  Mutation tasks are scored by diffing repository state and have no agent report to record, so the field is populated for read tasks and absent otherwise.

- **Ordering.**
  Persist the report first and re-run enough of the read tier to capture real reports, then confirm from those reports whether the failure is a wrong count or a rejected phrasing before finalizing the count-line wording.
  The count-line wording should be chosen so that an agent quoting the summary lands on an answer the read checker already accepts.

## Testing Decisions

- A good test here asserts external behavior: the text a user or agent sees on stdout, and the shape of the record the harness writes — not the internal composition of the count string.

- **Count line** is tested at the command's behavioral seam — the fixture-server CLI harness that runs the real command against a stubbed Gitea and asserts on rendered stdout.
  Prior art is the existing `issue list` command test, which already asserts exact count-line strings such as `count: 3 of 17 total` and guards that the bare `count: N` form never appears.
  New assertions extend that file: the count line names the state for the default open filter and for an explicit state filter, and the existing total-and-cap invariants still hold.

- **Report persistence** is tested at the runner's record-assembly seam, where the existing runner test already drives a cell to a recorded outcome and asserts on the produced record.
  A completed read cell yields a record carrying the agent's final report; a mutation cell yields a record without one.

## Out of Scope

- Trimming gitea-axi's input and cache-read footprint.
  gitea-axi replays the largest context of the efficient arms and wins cost only on the 5×-weighted output component, so reducing its input footprint would harden the cost lead — but it is a separate optimization touching many commands and is not part of closing the accuracy gap.

- Relaxing the read checker's accepted-phrasing list.
  Whether the checker is too strict is a benchmark-validity decision that must be made from the persisted report evidence this spec produces, not pre-judged; changing accepted phrasings before seeing the reports risks tuning the benchmark to the tool rather than fixing the tool.

- Any change to how mutation tasks are scored, and any change to the cost-equivalent-token metric or its weighting.

## Further Notes

The two leaders trade a narrow accuracy edge for a clear cost lead, and this one task is the whole of that edge, so the count-line change is the single highest-leverage move on the accuracy axis.
The report-persistence change also has standing value beyond this task: it makes every future read failure diagnosable rather than opaque, which is the harness's current blind spot and the reason the root cause could not be confirmed from the existing records.
The state-explicit summary is squarely on gitea-axi's central thesis — an agent-ergonomic, low-token interface — because it hands the answer to a count question directly on the summary line instead of forcing the agent into extra turns to derive it.
