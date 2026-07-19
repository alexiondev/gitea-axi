# Benchmark harness

This directory holds the benchmark that tests gitea-axi's central claim — that it is an agent-ergonomic, low-token interface to Gitea — against the `tea` CLI, the official `gitea-mcp` server, and raw Gitea REST calls.
The result is that gitea-axi has reached the token floor: it is the cheapest of the structured interfaces by a wide margin and now runs neck-and-neck with hand-rolled raw REST — within ~1% overall — at 100% task success and the fewest turns of any arm.
Keeping the raw-REST arm in the comparison is deliberate: a benchmark of agent-CLIs that omits the hand-rolled baseline will always flatter the wrapper, and this one refuses to — which is exactly what makes gitea-axi matching that baseline meaningful.

## How it works

Each arm is an agent given exactly one of the four tools and nothing else, run on the same fixed model at temperature zero, so the comparison measures the tool rather than the model.
The suite is 20 tasks across four tiers — read, single-mutation, find-then-act, and multi-step — each run against a freshly seeded throwaway repository and scored deterministically by diffing the resulting repository state (or matching required facts in the agent's answer) against the seeded ground truth.
The headline metric is cost-equivalent tokens: the four token components (fresh input, cache write, cache read, output) weighted by Anthropic's published API pricing ratios, which is why an arm can spend more raw tokens yet cost less.
Every arm is credentialed the way its product is really configured — the token in its environment (`gitea-axi`, `gitea-mcp`) or in its prompt (`raw-api`), and a `tea` login for `tea` — so no arm pays a turn tax rediscovering how to authenticate.

## Results

| arm | cost-equivalent tokens | raw tokens | turns | success | imputed cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| raw-api | 17,613 | 60,384 | 5.0 | 100% | ~$0.11 |
| gitea-axi | 17,815 | 62,705 | 4.8 | 100% | ~$0.11 |
| gitea-mcp | 23,198 | 76,378 | 5.2 | 100% | ~$0.15 |
| tea | 23,210 | 94,600 | 7.2 | 85% | ~$0.14 |

All four arms completed the full matrix — 20 of 20 tasks each — and success is near-perfect: only `tea` slips, to 85% overall (67% on find-then-act), while the other three pass every run.

Raw REST posts the lowest cost-equivalent tokens, but only barely: gitea-axi lands within ~1% of it (17,815 vs 17,613), a gap well inside the noise of three trials.
Direct HTTP with the token in the request header is the token floor no wrapper is supposed to undercut — and a structured tool drawing level with it is the headline of this snapshot.

gitea-axi is the cheapest structured interface by a wide margin — roughly 23% under both the official `gitea-mcp` server and the `tea` CLI — and it beats both of them on every tier, at 100% success.
It also takes the fewest turns of any arm (4.8, raw REST included) and the lowest output-token count of the shell arms; its compact TOON answers are what let a structured tool run this close to the floor.

By tier the picture is sharper than the overall total.
gitea-axi is the *cheapest arm outright* on the two discovery-heavy tiers — reads (13,294 vs raw's 14,656) and find-then-act (17,585 vs 18,631) — where finding the right entity is the work, and its compact search and list output beats reconstructing and parsing raw JSON.
Raw REST reclaims the lead on the mutation-heavy tiers — narrowly on single-mutation (15,212 vs 15,552), more clearly on multi-step (22,643 vs 26,079) — where the task is a handful of terse POSTs that no wrapper undercuts.
So the two trade tiers: gitea-axi wins where an interface earns its keep, raw REST wins where the request was already minimal.

Cost parity on the scored suite also understates gitea-axi, because the suite is the subset every arm can do at all.
The bonus table records capability-asymmetric operations — full-text issue search, rendering a PR's diff and checks, issue dependencies — that gitea-axi handles directly and raw REST has no first-class equivalent for.

_Snapshot: 2026-07-19 — 4 arms × 20 tasks × 3 trials each (240 samples), a single clean run with all four arms executed together against one live Gitea host; imputed cost is the mean per-task Anthropic-API-priced dollar cost._
