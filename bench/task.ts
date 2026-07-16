// The runnable Task wrapper and the one sample task this slice uses to exercise
// the full single-cell path. A task pairs a natural-language intent handed to the
// agent with the tier it counts toward and a scoring spec the checker consumes.
//
// The scoring spec is a function of the single available user rather than fixed
// data, because a mutation's expected end state is parametrized by that user: the
// seed assigns issues to them and authors comments as them (see seed-plan's
// `groundTruth(user)`). The runner resolves the user from the throwaway
// repository's owner and calls this to obtain the concrete spec.
//
// The full task suite is authored in a later slice; this module carries only the
// wrapper and a single sample task.

import type { Tier } from "./result.js";
import { groundTruth } from "./seed-plan.js";
import type { ScoringSpec } from "./scoring-spec.js";

/**
 * A runnable benchmark task: the agent-facing intent, the tier it belongs to, a
 * stable identifier, and a scoring spec keyed on the single available user.
 */
export interface BenchTask {
  /** Stable identifier; keys the task's cell in the sample store. */
  id: string;
  /** The tier this task counts toward in the reporting rollups. */
  tier: Tier;
  /** The natural-language instruction handed to the agent. */
  intent: string;
  /** The scoring spec for the given single user (see module note). */
  scoringSpec: (user: string) => ScoringSpec;
}

/** The seeded issue the sample task closes. */
const SAMPLE_TARGET_TITLE = "Add CSV export option";

/**
 * One sample single-mutation task: close the seeded "Add CSV export option"
 * issue and change nothing else. Its expected end state is the deterministic
 * ground truth with only that issue's state flipped to closed, so the full-state
 * diff catches both a missed close and any collateral change.
 */
export const SAMPLE_TASK: BenchTask = {
  id: "close-csv-export-issue",
  tier: "single-mutation",
  intent: `Close the issue titled "${SAMPLE_TARGET_TITLE}". Do not modify anything else in the repository.`,
  scoringSpec: (user) => {
    const expected = groundTruth(user);
    const target = expected.issues.find((issue) => issue.title === SAMPLE_TARGET_TITLE);
    if (target === undefined) {
      throw new Error(`sample task target issue "${SAMPLE_TARGET_TITLE}" is not in the seed plan`);
    }
    target.state = "closed";
    return { kind: "mutation", expected };
  },
};
