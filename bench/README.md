# Benchmark harness

This directory holds the benchmark that tests gitea-axi's central claim — that it is an agent-ergonomic, low-token interface to Gitea — against the `tea` CLI, the official `gitea-mcp` server, and raw Gitea REST calls.
The result is honest rather than flattering: gitea-axi is the lowest-cost of the *structured* interfaces — it beats both `tea` and `gitea-mcp` on every tier at 100% task success — but hand-rolled raw REST is cheaper still, because terse HTTP is the token floor no wrapper undercuts.
Keeping the raw-REST arm in the comparison is deliberate: a benchmark of agent-CLIs that omits it will always crown the wrapper, and this one refuses to.

## How it works

Each arm is an agent given exactly one of the four tools and nothing else, run on the same fixed model at temperature zero, so the comparison measures the tool rather than the model.
The suite is 20 tasks across four tiers — read, single-mutation, find-then-act, and multi-step — each run against a freshly seeded throwaway repository and scored deterministically by diffing the resulting repository state (or matching required facts in the agent's answer) against the seeded ground truth.
The headline metric is cost-equivalent tokens: the four token components (fresh input, cache write, cache read, output) weighted by Anthropic's published API pricing ratios, which is why an arm can spend more raw tokens yet cost less.
Every arm is credentialed the way its product is really configured — the token in its environment (`gitea-axi`, `gitea-mcp`) or in its prompt (`raw-api`), and a `tea` login for `tea` — so no arm pays a turn tax rediscovering how to authenticate.

## Results

| arm | cost-equivalent tokens | raw tokens | turns | success | imputed cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| raw-api | 16,971 | 52,586 | 4.3 | 100% | ~$0.11 |
| gitea-axi | 19,240 | 81,067 | 6.0 | 100% | ~$0.12 |
| tea | 20,568 | 82,188 | 6.2 | 97% | ~$0.12 |
| gitea-mcp | 21,803 | 79,961 | 5.7 | 100% | ~$0.14 |

All four arms completed the full matrix — 20 of 20 tasks each, at the reporting floor — and success is near-perfect: only `tea` slips, to 89% on find-then-act, while the other three pass every run.

Raw REST posts the lowest cost-equivalent tokens and leads every tier.
It is direct HTTP with the token in the request header, so it takes the fewest turns (4.3) and reads the least cached context, and no higher-level tool beats that on tokens alone.
This is the honest ceiling, and the reason gitea-axi does not claim the cost crown outright.

gitea-axi is a clear second overall and the cheapest of the structured tools: it undercuts the official `gitea-mcp` server and the `tea` CLI on every tier, at 100% success, with the lowest output-token count of any arm.
Note the split between raw and cost-equivalent tokens — gitea-axi spends more raw tokens than `gitea-mcp` yet costs less, because output is weighted 5× and gitea-axi's answers are compact.

By tier, raw REST's edge is widest on reads (10,921 vs gitea-axi's 14,415) — a read is one HTTP request for curl, where a CLI still spends a turn or two — and narrows on multi-step (24,348 vs 26,963), where the work itself dominates and interface overhead matters less.

Cost parity on the scored suite also understates gitea-axi, because the suite is the subset every arm can do at all.
The bonus table records capability-asymmetric operations — full-text issue search, rendering a PR's diff and checks, issue dependencies — that gitea-axi handles directly and raw REST has no first-class equivalent for.

_Snapshot: 2026-07-17 — 4 arms × 20 tasks × 3 trials each (240 samples), a single clean run with all four arms executed together against one live Gitea host; imputed cost is the mean per-task Anthropic-API-priced dollar cost._
