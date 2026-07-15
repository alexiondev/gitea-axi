# Cost-equivalent tokens as the benchmark's headline metric

The benchmark compares how much each arm costs to drive.
The maintainer runs on a Claude subscription with a fixed weekly token allowance, so the scarce resource is token consumption against that allowance, not dollars.
The question is how to reduce each run's four token components — fresh input, cache-creation, cache-read, and output — into a single headline number that reflects weekly-budget burn.

Research into Anthropic's documentation established that the exact unit and per-component weighting of the subscription weekly limit are not publicly documented.
The one anchoring signal is that overage past the included allowance is billed at standard API rates, which points toward cost-weighted accounting rather than a flat token count.

## Considered Options

**Raw summed tokens as headline** (rejected) — Summing all four components at 1× is transparent and assumption-free, but cache-read routinely dominates the total, and Anthropic's API prices cache-reads at roughly a tenth of fresh input.
A raw sum therefore overstates the burn of arms whose context is largely cached (notably the eager-schema MCP arm) by up to an order of magnitude, which would misrank the arms on the very axis the benchmark exists to measure.

**Imputed dollars as headline** (rejected) — The runtime already reports an imputed cost that folds in every component at the correct weights.
It is an accurate comparative number, but it is expressed in a unit the maintainer does not spend; on a subscription no dollars leave the account, and the mental model is weekly tokens.

**Cost-equivalent tokens as headline** (chosen) — Weight the four components by Anthropic's published API pricing ratios (fresh input 1×, cache-write 1.25× or 2× by TTL, cache-read 0.1×, output 5×) and express the result as a token count.
This is tokens — the maintainer's unit — weighted the way their budget most plausibly burns, and it is the same ranking as the imputed dollar figure.

## Consequences

- The headline is cost-equivalent tokens; the raw summed tokens and the full four-component breakdown are recorded alongside every run, so the data can be re-weighted without re-running if the subscription's real accounting is ever documented.
- Imputed dollars are retained as a de-emphasized secondary column, portable for readers who are on the API rather than a subscription.
- The weighting is an explicit, documented assumption grounded in the overage-pricing signal, not a measured fact; an optional later validation could pin the real weekly weighting empirically by burning a known token mix.
- The auxiliary small model invoked by the runtime is counted rather than suppressed, since it is real consumption against the same allowance.
