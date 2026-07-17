# Benchmark harness

This directory holds the benchmark that tests gitea-axi's central claim — that it is an agent-ergonomic, low-token interface to Gitea — against the `tea` CLI, the official `gitea-mcp` server, and raw Gitea REST calls.
This run bears that out on cost: gitea-axi posts the lowest cost-equivalent tokens and the lowest imputed cost of the four tools, though `gitea-mcp` edges it slightly on accuracy.

## How it works

Each arm is an agent given exactly one of the four tools and nothing else, run on the same fixed model at temperature zero, so the comparison measures the tool rather than the model.
The suite is 20 tasks across four tiers — read, single-mutation, find-then-act, and multi-step — each run against a freshly seeded throwaway repository and scored deterministically by diffing the resulting repository state (or matching required facts in the agent's answer) against the seeded ground truth.
The headline metric is cost-equivalent tokens: the four token components (fresh input, cache write, cache read, output) weighted by Anthropic's published API pricing ratios, which is why an arm can spend more raw tokens yet cost less.

## Results

| arm | cost-equivalent tokens | raw tokens | success | imputed cost |
| --- | ---: | ---: | ---: | ---: |
| gitea-axi | 16,921 | 68,093 | 95% | $6.20 |
| raw-api | 17,773 | 55,631 | 95% | $6.64 |
| gitea-mcp | 17,898 | 60,028 | 97% | $6.82 |
| tea | 20,505 | 80,702 | 90% | $7.25 |

All four arms completed the full matrix — 20 of 20 tasks each, at the reporting floor.
gitea-axi wins on cost-equivalent tokens and on real imputed cost even though it does not use the fewest raw tokens: its interactions are output-light, and output is the most expensive component (weighted 5×), so its compact answers beat arms that emit more.
gitea-mcp is the most accurate at 97% against gitea-axi's 95%, so the two leaders trade a small accuracy edge for a clear cost lead.

By tier, the read tasks are the hardest for every arm (75–83% success) — exact-answer reads, not mutations, are where correctness slips.
tea is the outlier on find-then-act, dropping to 78% success at about 1.7× the cost-equivalent tokens of the other three arms.

_Snapshot: 2026-07-17 — 4 arms × 20 tasks × 3 trials each (240 samples), a single run against one live Gitea host; imputed cost is Anthropic API-priced._
