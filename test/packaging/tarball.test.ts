import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractTarball, packTarball, projectRoot } from "./npm-artifact.js";

// The shape of the packed npm tarball and the manifest that ships inside it.
// These assertions are npm-specific by nature — no other distribution method
// produces a tarball or a packed manifest — so they stay separate from the
// installed-binary assertions, which any installation method can drive.

let workDir: string;
/** The extracted tarball's root — npm nests everything under `package/`. */
let packageDir: string;
/** The manifest as it ships inside the packed tarball. */
let packedManifest: Record<string, unknown>;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "gitea-axi-pack-"));
  const tarball = packTarball(workDir);
  packageDir = extractTarball(tarball, workDir);
  packedManifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
}, 300_000);

afterAll(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
  }
});

describe("npm distribution artifact", () => {
  it("bundles the built CLI, the bin entry, and the Agent Skill, and declares no postinstall", () => {
    expect(existsSync(join(packageDir, "dist", "main.js"))).toBe(true);
    expect(existsSync(join(packageDir, "skills", "gitea-axi", "SKILL.md"))).toBe(true);

    const bin = packedManifest.bin as Record<string, string> | undefined;
    expect(bin?.["gitea-axi"]).toBe("dist/main.js");

    const scripts = packedManifest.scripts as Record<string, string> | undefined;
    expect(scripts?.postinstall).toBeUndefined();
  });

  it("excludes the bench/ harness directory from the package", () => {
    expect(existsSync(join(packageDir, "bench"))).toBe(false);
  });

  it("declares complete metadata: unscoped name, description, repo, license, engines, ESM type", () => {
    const name = packedManifest.name as string;
    expect(name).toBe("gitea-axi");
    expect(name).not.toContain("@");
    expect(name).not.toContain("/");

    const description = packedManifest.description as string;
    expect(typeof description).toBe("string");
    expect(description.length).toBeGreaterThan(0);

    const repository = packedManifest.repository as string | { url?: string } | undefined;
    const repositoryUrl = typeof repository === "string" ? repository : repository?.url;
    expect(repositoryUrl).toContain("gitea-axi");

    expect(packedManifest.license).toBe("MIT");

    const engines = packedManifest.engines as Record<string, string> | undefined;
    expect(engines?.node).toMatch(/20/);

    expect(packedManifest.type).toBe("module");
  });

  it("scripts and documents the publish flow so publishing is a single command", () => {
    const scripts = packedManifest.scripts as Record<string, string> | undefined;
    expect(scripts?.prepack).toBe("npm run build");

    const publishConfig = packedManifest.publishConfig as Record<string, string> | undefined;
    expect(publishConfig?.access).toBe("public");

    const publishingDoc = join(projectRoot, "PUBLISHING.md");
    expect(existsSync(publishingDoc)).toBe(true);
    expect(readFileSync(publishingDoc, "utf8")).toMatch(/npm publish/);
  });
});
