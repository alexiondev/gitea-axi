import { delimiter } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type PathProbe,
  pruneDuplicateManagedHooks,
  resolveEntrypointOnPath,
} from "../src/hooks.js";

describe("resolveEntrypointOnPath", () => {
  const ENTRYPOINT = "/opt/gitea-axi/dist/main.js";

  /** A probe over a fake filesystem: real paths, plus text for wrapper scripts. */
  const probeOver = (
    realPaths: Record<string, string>,
    texts: Record<string, string> = {},
  ): PathProbe => ({
    realPath: (candidate) => realPaths[candidate],
    readText: (candidate) => texts[candidate],
  });

  const path = ["/empty", "/usr/local/bin", "/usr/bin"].join(delimiter);

  it("matches a symlink to the entrypoint by real path — npm's install shape", () => {
    const probe = probeOver({
      [ENTRYPOINT]: ENTRYPOINT,
      "/usr/local/bin/gitea-axi": ENTRYPOINT,
    });

    expect(resolveEntrypointOnPath("gitea-axi", ENTRYPOINT, path, probe)).toBe(
      "/usr/local/bin/gitea-axi",
    );
  });

  it("matches a wrapper naming the entrypoint in its text — the Nix install shape", () => {
    // The wrapper's own realpath is the wrapper, never the entrypoint, which is
    // precisely why the realpath test alone cannot see this install.
    const probe = probeOver(
      {
        [ENTRYPOINT]: ENTRYPOINT,
        "/usr/local/bin/gitea-axi": "/usr/local/bin/gitea-axi",
      },
      { "/usr/local/bin/gitea-axi": `#!/bin/sh\nexec node ${ENTRYPOINT} "$@"\n` },
    );

    expect(resolveEntrypointOnPath("gitea-axi", ENTRYPOINT, path, probe)).toBe(
      "/usr/local/bin/gitea-axi",
    );
  });

  it("follows a chained wrapper to the entrypoint — the real Nix shape", () => {
    // Nix is two hops: bin/gitea-axi sets PATH and execs bin/.gitea-axi-wrapped,
    // and only that second script names the entrypoint.
    const wrapped = "/usr/local/bin/.gitea-axi-wrapped";
    const probe = probeOver(
      {
        [ENTRYPOINT]: ENTRYPOINT,
        "/usr/local/bin/gitea-axi": "/usr/local/bin/gitea-axi",
        [wrapped]: wrapped,
      },
      {
        "/usr/local/bin/gitea-axi": `#!/bin/bash -e\nexport PATH\nexec -a "$0" "${wrapped}" "$@"\n`,
        [wrapped]: `#!/bin/bash -e\nexec "/usr/bin/node" ${ENTRYPOINT} "$@"\n`,
      },
    );

    expect(resolveEntrypointOnPath("gitea-axi", ENTRYPOINT, path, probe)).toBe(
      "/usr/local/bin/gitea-axi",
    );
  });

  it("gives up on a wrapper chain that never names the entrypoint", () => {
    // A cycle: it must terminate rather than following the loop forever.
    const other = "/usr/local/bin/other";
    const probe = probeOver(
      {
        [ENTRYPOINT]: ENTRYPOINT,
        "/usr/local/bin/gitea-axi": "/usr/local/bin/gitea-axi",
        [other]: other,
      },
      {
        "/usr/local/bin/gitea-axi": `exec "${other}"\n`,
        [other]: `exec "/usr/local/bin/gitea-axi"\n`,
      },
    );

    expect(resolveEntrypointOnPath("gitea-axi", ENTRYPOINT, path, probe)).toBeUndefined();
  });

  it("refuses a same-named binary that is some other program", () => {
    // Accepting this would hand the SDK a path that realpath-matches itself,
    // making its check a tautology and recording a name for a program the
    // caller never asked about.
    const probe = probeOver(
      {
        [ENTRYPOINT]: ENTRYPOINT,
        "/usr/local/bin/gitea-axi": "/somewhere/else/gitea-axi",
      },
      { "/usr/local/bin/gitea-axi": "#!/bin/sh\nexec node /somewhere/else/dist/main.js\n" },
    );

    expect(resolveEntrypointOnPath("gitea-axi", ENTRYPOINT, path, probe)).toBeUndefined();
  });

  it("returns undefined when the name resolves nowhere on PATH", () => {
    const probe = probeOver({ [ENTRYPOINT]: ENTRYPOINT });

    expect(resolveEntrypointOnPath("gitea-axi", ENTRYPOINT, path, probe)).toBeUndefined();
  });

  it("returns undefined for an unset or empty PATH", () => {
    const probe = probeOver({ [ENTRYPOINT]: ENTRYPOINT });

    expect(resolveEntrypointOnPath("gitea-axi", ENTRYPOINT, undefined, probe)).toBeUndefined();
    expect(resolveEntrypointOnPath("gitea-axi", ENTRYPOINT, "", probe)).toBeUndefined();
  });

  it("skips empty PATH entries rather than probing the working directory", () => {
    const probed: string[] = [];
    resolveEntrypointOnPath("gitea-axi", ENTRYPOINT, ["", "/usr/bin", ""].join(delimiter), {
      realPath: (candidate) => {
        probed.push(candidate);
        return undefined;
      },
      readText: () => undefined,
    });

    expect(probed).toEqual([ENTRYPOINT, "/usr/bin/gitea-axi"]);
  });

  it("takes the first PATH entry that matches, not a later one", () => {
    const probe = probeOver({
      [ENTRYPOINT]: ENTRYPOINT,
      "/usr/local/bin/gitea-axi": ENTRYPOINT,
      "/usr/bin/gitea-axi": ENTRYPOINT,
    });

    expect(resolveEntrypointOnPath("gitea-axi", ENTRYPOINT, path, probe)).toBe(
      "/usr/local/bin/gitea-axi",
    );
  });
});

describe("pruneDuplicateManagedHooks", () => {
  const settingsWith = (...commands: string[]) => ({
    hooks: {
      SessionStart: commands.map((command) => ({
        matcher: "",
        hooks: [{ type: "command", command, timeout: 10 }],
      })),
    },
  });

  interface ReadBack {
    hooks: { SessionStart: { hooks: { command: string; timeout?: number }[] }[] };
  }

  const commandsOf = (settings: unknown) =>
    (settings as ReadBack).hooks.SessionStart.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );

  it("collapses a duplicated entry whose command does not contain the marker", () => {
    // The case the SDK cannot handle: it recognises its own hook by finding the
    // marker inside the recorded command, so an entrypoint path without
    // "gitea-axi" in it makes a re-run append rather than update.
    const entrypoint = "/build/source/dist/main.js";
    const result = pruneDuplicateManagedHooks(
      settingsWith(entrypoint, entrypoint),
      (command) => command === entrypoint,
    );

    expect(result.changed).toBe(true);
    expect(commandsOf(result.settings)).toEqual([entrypoint]);
  });

  it("keeps the last managed entry, which is the one the SDK just appended", () => {
    // Both entries carry the same command, so the survivor is identified by the
    // rest of its shape: the stale one has a timeout the SDK no longer writes.
    const result = pruneDuplicateManagedHooks(
      {
        hooks: {
          SessionStart: [
            { matcher: "", hooks: [{ type: "command", command: "gitea-axi", timeout: 99 }] },
            { matcher: "", hooks: [{ type: "command", command: "gitea-axi", timeout: 10 }] },
          ],
        },
      },
      (command) => command === "gitea-axi",
    );

    const settings = result.settings as ReadBack;
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0]?.hooks[0]).toMatchObject({ timeout: 10 });
  });

  it("leaves hooks belonging to other tools untouched", () => {
    const result = pruneDuplicateManagedHooks(
      settingsWith("other-tool", "gitea-axi", "another-tool", "gitea-axi"),
      (command) => command === "gitea-axi",
    );

    expect(commandsOf(result.settings)).toEqual(["other-tool", "another-tool", "gitea-axi"]);
  });

  it("prunes duplicates that share a single group", () => {
    const result = pruneDuplicateManagedHooks(
      {
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [
                { type: "command", command: "gitea-axi", timeout: 10 },
                { type: "command", command: "other-tool", timeout: 10 },
                { type: "command", command: "gitea-axi", timeout: 10 },
              ],
            },
          ],
        },
      },
      (command) => command === "gitea-axi",
    );

    expect(commandsOf(result.settings)).toEqual(["other-tool", "gitea-axi"]);
  });

  it("reports no change and returns the input when there is nothing to prune", () => {
    const single = settingsWith("gitea-axi");
    const result = pruneDuplicateManagedHooks(single, (command) => command === "gitea-axi");

    expect(result.changed).toBe(false);
    expect(result.settings).toBe(single);
  });

  it("preserves sibling settings keys and other hook events", () => {
    const result = pruneDuplicateManagedHooks(
      {
        model: "opus",
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "audit" }] }],
          SessionStart: settingsWith("gitea-axi", "gitea-axi").hooks.SessionStart,
        },
      },
      (command) => command === "gitea-axi",
    );

    const settings = result.settings as ReadBack & {
      model: string;
      hooks: { PreToolUse: unknown[] };
    };
    expect(settings.model).toBe("opus");
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(commandsOf(settings)).toEqual(["gitea-axi"]);
  });

  it("tolerates settings with no SessionStart hooks at all", () => {
    for (const input of [{}, { hooks: {} }, { hooks: { SessionStart: "nonsense" } }, null]) {
      const result = pruneDuplicateManagedHooks(input, () => true);
      expect(result.changed).toBe(false);
      expect(result.settings).toBe(input);
    }
  });
});
