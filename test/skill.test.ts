import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = readFileSync(
  new URL("../skills/gitea-axi/SKILL.md", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { files?: string[] };

describe("bundled Agent Skill markdown", () => {
  it("is published in the package", () => {
    expect(packageJson.files).toContain("skills");
  });

  it("has frontmatter with a description that triggers on Gitea issue/PR work", () => {
    // Frontmatter is a leading `---`-delimited block.
    const match = skill.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = match?.[1];
    expect(frontmatter, "expected YAML frontmatter delimited by ---").toBeDefined();
    expect(frontmatter).toMatch(/description:/i);

    const description = frontmatter!.toLowerCase();
    expect(description).toContain("gitea");
    expect(description).toContain("issue");
    expect(description).toContain("pull request");
  });

  it("says to prefer gitea-axi over tea, raw API, and git", () => {
    const body = skill.toLowerCase();
    expect(body).toContain("tea");
    expect(body).toContain("api");
    expect(body).toContain("git");
  });

  it("references each command group as a one-liner", () => {
    const body = skill.toLowerCase();
    for (const group of ["issue", "pr", "label", "search", "setup"]) {
      expect(body, `expected the skill to mention the ${group} command group`).toContain(
        group,
      );
    }
  });

  it("points at the bare dashboard and per-command help for discovery", () => {
    const body = skill.toLowerCase();
    // Bare dashboard: running the binary with no arguments.
    expect(body).toContain("no argument");
    expect(body).toContain("dashboard");
    // Per-command help.
    expect(body).toContain("--help");
  });
});
