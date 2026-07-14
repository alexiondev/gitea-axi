# Use inline truncation hints and `--full`, not a temp-file path

Body and diff text that exceeds the truncation limit is shortened inline with a hint appended to the field value — `"... (truncated, N chars total - use --full to see complete body)"`.
The `--full` flag on `issue view` and `pr view` suppresses truncation and returns the full raw value.
No temp file is written.

## Considered Options

**Save to a temp file, emit path in `full_content` field** (rejected) — The spec draft described this approach and attributed it to gh-axi, but that description was incorrect.
Temp-file paths create a coupling to local filesystem state that does not survive across sessions or machines, and agents cannot rely on file paths persisting between calls.

**Inline hint + `--full` flag** (chosen) — This is what gh-axi actually implements (`src/body.ts` → `truncateBody()`), and what the AXI principle 3 specifies: *"appending a size hint like '(truncated, 2847 chars total — use --full to see complete body)'"*.
Simpler, portable, consistent with the stated reference.

## Consequences

`issue view` and `pr view` both accept `--full` to return untruncated body.
`issue list`, `issue create`, `pr list`, and `search` also accept `--full`, since they offer `body` via `--fields` and that field truncates identically (task 0021).
The flag keeps the inline hint's "use --full" promise honest on those commands too.
`pr diff` truncates at 4000 chars (matching gh-axi's `DIFF_TRUNCATE_LIMIT`); when truncated, a next-step suggestion to rerun with `--full` is prepended.
The `full_content` field name and temp-file design from the spec draft are dropped entirely.
