// The live host adapter: the production `BenchHost` the runner drives against a
// real Gitea instance. It is a thin composition of the two live boundaries —
// seed.ts (provision, seed, delete) and snapshot.ts (capture) — bound to one set
// of host credentials. The runner depends only on the `BenchHost` seam, so this
// wiring is exercised by the smoke run rather than mocked unit tests, matching the
// seed tier.

import type { BenchHost } from "./runner.js";
import { captureRepoState } from "./snapshot.js";
import { deleteRepo, provisionRepo, seedRepo, type BenchAccess } from "./seed.js";

/**
 * Build the live host bound to `access`: it provisions and seeds fresh throwaway
 * repositories, captures their post-run state, and deletes them — all through the
 * real Gitea API using gitea-axi's own credential discovery (see resolveBenchAccess).
 */
export function liveBenchHost(access: BenchAccess): BenchHost {
  return {
    provision: () => provisionRepo(access),
    seed: (coords) => seedRepo(access, coords),
    capture: (coords) => captureRepoState(access, coords),
    delete: (coords) => deleteRepo(access, coords),
  };
}
