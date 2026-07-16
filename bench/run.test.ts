import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORE_ROOT,
  DEFAULT_TURN_CAP,
  DEFAULT_WALL_CLOCK_MS,
  parseRunArgs,
} from "./run.js";

describe("parseRunArgs", () => {
  // Behavior: parsing the required --arm and --task selection yields the resolved
  // cell with defaults applied for everything else — five trials (spec: "Each cell
  // defaults to five trials"), the documented turn-cap and wall-clock backstop, the
  // default store root, and the login taken from the environment when --login is
  // omitted. Trials is the independent literal 5; the other defaults are asserted
  // against the module's documented default constants (the single source of truth
  // for each default), which checks the parser wires them through on omission.
  it("applies the documented defaults when only the required arm and task are given, taking the login from the environment", () => {
    const result = parseRunArgs(
      ["--arm", "gitea-axi", "--task", "close-csv-export-issue"],
      { GITEA_AXI_BENCH_LOGIN: "alexion" },
    );

    expect(result.help).toBe(false);
    if (result.help) return;

    // The required selection resolves to the chosen cell.
    expect(result.arm).toBe("gitea-axi");
    expect(result.taskId).toBe("close-csv-export-issue");

    // Trials default to five (independent literal from the spec).
    expect(result.trials).toBe(5);

    // The remaining bounds and store root fall back to the documented defaults.
    expect(result.turnCap).toBe(DEFAULT_TURN_CAP);
    expect(result.wallClockMs).toBe(DEFAULT_WALL_CLOCK_MS);
    expect(result.storeRoot).toBe(DEFAULT_STORE_ROOT);

    // The login comes from the environment.
    expect(result.login).toBe("alexion");
  });

  // Behavior: every optional flag overrides its default, and an explicit --login
  // takes precedence over the environment. The parser passes through whatever the
  // maintainer supplies. All expected values are independent literals chosen apart
  // from the code; login must be the explicit "explicit-login" even though the
  // environment also sets GITEA_AXI_BENCH_LOGIN ("env-login").
  it("passes every supplied flag through, with an explicit login overriding the environment", () => {
    const result = parseRunArgs(
      [
        "--arm",
        "tea",
        "--task",
        "read-open-issue-count",
        "--trials",
        "3",
        "--turn-cap",
        "12",
        "--wall-clock-ms",
        "90000",
        "--store",
        "/tmp/bench-out",
        "--login",
        "explicit-login",
      ],
      { GITEA_AXI_BENCH_LOGIN: "env-login" },
    );

    expect(result.help).toBe(false);
    if (result.help) return;

    expect(result.arm).toBe("tea");
    expect(result.taskId).toBe("read-open-issue-count");
    expect(result.trials).toBe(3);
    expect(result.turnCap).toBe(12);
    expect(result.wallClockMs).toBe(90000);
    expect(result.storeRoot).toBe("/tmp/bench-out");

    // The explicit --login beats the env-provided login.
    expect(result.login).toBe("explicit-login");
  });

  // Behavior: malformed or incomplete input is rejected with a usage error. The
  // four arms are exactly gitea-axi, tea, gitea-mcp, raw-api; --arm and --task are
  // required; --trials must be a positive integer; unknown flags are not accepted;
  // and a login must be resolvable (from --login or the environment). A non-empty
  // env login is supplied where the tested defect is elsewhere, so the throw is the
  // intended one rather than a missing login.
  it("rejects malformed or incomplete input with a usage error", () => {
    const env = { GITEA_AXI_BENCH_LOGIN: "alexion" };

    // Unknown arm (not one of the four).
    expect(() => parseRunArgs(["--arm", "github", "--task", "t"], env)).toThrow();
    // Missing required --arm.
    expect(() => parseRunArgs(["--task", "t"], env)).toThrow();
    // Missing required --task.
    expect(() => parseRunArgs(["--arm", "tea"], env)).toThrow();
    // Non-numeric trials.
    expect(() =>
      parseRunArgs(["--arm", "tea", "--task", "t", "--trials", "abc"], env),
    ).toThrow();
    // Unknown flag.
    expect(() =>
      parseRunArgs(["--arm", "tea", "--task", "t", "--frobnicate", "x"], env),
    ).toThrow();
    // The removed --model flag is now unknown and rejected.
    expect(() =>
      parseRunArgs(["--arm", "tea", "--task", "t", "--model", "x"], env),
    ).toThrow();

    // Login is required and here is resolvable from neither --login nor the env.
    expect(() => parseRunArgs(["--arm", "tea", "--task", "t"], {})).toThrow();
  });

  // Behavior: --help short-circuits parsing and reports a help request, winning
  // even alongside other arguments and via the -h alias.
  it("short-circuits to a help request for --help and -h, even alongside other args", () => {
    expect(parseRunArgs(["--help"], {}).help).toBe(true);
    expect(parseRunArgs(["-h"], {}).help).toBe(true);
    expect(parseRunArgs(["--arm", "tea", "--help"], {}).help).toBe(true);
  });
});
