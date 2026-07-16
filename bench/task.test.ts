import { describe, expect, it } from "vitest";
import { SAMPLE_TASK } from "./task.js";

/**
 * The sample task's target and a control, taken as independent literals from the
 * seed plan's declared ground truth (bench/seed-plan.ts): the sample task closes
 * the OPEN issue "Add CSV export option", while "Fix crash on startup" is a
 * different issue that is OPEN in the seed. These titles and seed states are the
 * source of truth, fixed by the seed plan and the task's stated purpose — not
 * read back from task.ts.
 */
const TARGET_TITLE = "Add CSV export option";
const CONTROL_TITLE = "Fix crash on startup";

// A single available user for the scoring spec; its exact value is irrelevant to
// this behavior (an arbitrary independent literal), since we assert issue states,
// not assignees.
const USER = "benchbot";

describe("SAMPLE_TASK", () => {
  // Behavior: the one sample task exercises the full path by closing a specific
  // seeded issue, and its scoring spec expresses the intended mutation's end
  // state — the target issue closed, everything else unchanged from the seeded
  // ground truth (benchmark-harness spec, "runnable Task wrapper"). Observable
  // facts, each an independent literal from the seed plan / task purpose:
  //  - it is a single-mutation task naming its target in the intent;
  //  - its spec is a mutation spec;
  //  - the target issue "Add CSV export option" is CLOSED in the expected state;
  //  - a control issue OPEN in the seed and NOT the target stays OPEN.
  it("closes only the target issue in its mutation scoring spec, leaving the seed otherwise unchanged", () => {
    expect(SAMPLE_TASK.tier).toBe("single-mutation");
    expect(SAMPLE_TASK.intent).toContain(TARGET_TITLE);

    const spec = SAMPLE_TASK.scoringSpec(USER);
    expect(spec.kind).toBe("mutation");
    if (spec.kind !== "mutation") return;

    const target = spec.expected.issues.find((issue) => issue.title === TARGET_TITLE);
    expect(target).toBeDefined();
    expect(target?.state).toBe("closed");

    const control = spec.expected.issues.find((issue) => issue.title === CONTROL_TITLE);
    expect(control).toBeDefined();
    expect(control?.state).toBe("open");
  });
});
