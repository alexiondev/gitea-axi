import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentWorkdir, sumTokens } from "./sdk-driver.js";
import type { SdkResultMessage } from "./sdk-driver.js";

describe("sumTokens", () => {
  // Behavior: sumTokens reads per-model token usage from the SDK result's
  // `modelUsage` map and sums the four token components across EVERY model,
  // folding in the auxiliary small model the runtime invokes for internal
  // chores — because that is real consumption against the same allowance
  // (see the token-components note in result.ts). Crucially it reads the SDK's
  // camelCase field names (inputTokens / outputTokens / cacheCreationInputTokens
  // / cacheReadInputTokens); this is a regression guard against a bug where the
  // driver read snake_case keys, so every component silently summed to zero.
  //
  // The result carries two models — a main model and the aux small model — with
  // DISTINCT numbers on every field, so a wrong field mapping cannot be masked
  // by another and both models must be folded in to reach the totals. The
  // expected sums are derived BY HAND from the two models, independent of how
  // sumTokens computes them, per the metric mapping
  // (inputTokens -> freshInput, outputTokens -> output,
  //  cacheCreationInputTokens -> cacheCreation, cacheReadInputTokens -> cacheRead):
  //   freshInput    = 500  + 30  = 530
  //   output        = 200  + 8   = 208
  //   cacheCreation = 3000 + 100 = 3100
  //   cacheRead     = 10000 + 400 = 10400
  it("sums the four camelCase token components across every model, folding in the auxiliary model", () => {
    const result: SdkResultMessage = {
      type: "result",
      subtype: "success",
      modelUsage: {
        "claude-opus-4-8": {
          inputTokens: 500,
          outputTokens: 200,
          cacheCreationInputTokens: 3000,
          cacheReadInputTokens: 10000,
        },
        "claude-haiku-aux": {
          inputTokens: 30,
          outputTokens: 8,
          cacheCreationInputTokens: 100,
          cacheReadInputTokens: 400,
        },
      },
    };

    expect(sumTokens(result)).toEqual({
      freshInput: 530,
      output: 208,
      cacheCreation: 3100,
      cacheRead: 10400,
    });
  });

  // Behavior: when the result carries NO per-model `modelUsage` breakdown,
  // sumTokens falls back to the aggregate `usage` block. Unlike the per-model
  // map, the SDK reports this aggregate in snake_case (input_tokens /
  // output_tokens / cache_creation_input_tokens / cache_read_input_tokens), so
  // this pins that the fallback path reads the OTHER casing correctly and that
  // the two shapes are not confused. This is a regression guard against reading
  // the wrong casing on the fallback path.
  //
  // There is a single aggregate source, so each expected component equals its
  // own field's value; the four numbers are DISTINCT so a wrong field mapping
  // cannot be masked by another. Values are hand-worked from the aggregate,
  // independent of how sumTokens computes them, per the mapping
  // (input_tokens -> freshInput, output_tokens -> output,
  //  cache_creation_input_tokens -> cacheCreation,
  //  cache_read_input_tokens -> cacheRead):
  //   freshInput = 700, output = 90, cacheCreation = 4000, cacheRead = 20000.
  it("falls back to the snake_case aggregate usage when no per-model modelUsage is present", () => {
    const result: SdkResultMessage = {
      type: "result",
      subtype: "success",
      usage: {
        input_tokens: 700,
        output_tokens: 90,
        cache_creation_input_tokens: 4000,
        cache_read_input_tokens: 20000,
      },
    };

    expect(sumTokens(result)).toEqual({
      freshInput: 700,
      cacheCreation: 4000,
      cacheRead: 20000,
      output: 90,
    });
  });
});

describe("createAgentWorkdir", () => {
  // Behavior: each agent run must operate in a fresh, empty directory located
  // OUTSIDE the harness's own checkout. This isolation is what stops an agent
  // that forgets an explicit `-R OWNER/NAME` from having its `gitea-axi`/`tea`
  // tools silently default their target repo to the harness's own git checkout:
  // a directory that is empty (no `.git`) and outside the current checkout gives
  // those tools nothing local to resolve.
  //
  // The three assertions are independent anti-bug properties drawn directly from
  // the requirement, not recomputed from the implementation:
  //   1. the path exists and is a directory,
  //   2. it is empty (zero entries — in particular no `.git`),
  //   3. it sits outside the current working directory (relative path escapes
  //      upward with "..").
  it("returns a fresh, empty directory located outside the current checkout", () => {
    const dir = createAgentWorkdir();
    try {
      expect(statSync(dir).isDirectory()).toBe(true);
      expect(readdirSync(dir)).toHaveLength(0);
      expect(path.relative(process.cwd(), dir).startsWith("..")).toBe(true);
    } finally {
      // Safe: `dir` is a fresh throwaway temp dir we just received from
      // createAgentWorkdir(); never a delete of cwd or any pre-existing path.
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
