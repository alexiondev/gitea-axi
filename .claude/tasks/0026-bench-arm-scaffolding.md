---
spec: benchmark-harness
blocked-by: 0023-bench-tool-isolation-guard
---

## What to build

The per-arm scaffolding that charges each tool's real ambient-context cost honestly. All arms share one task-agnostic base prompt and the same repository coordinates and token; each arm then receives a minimal, symmetric bootstrap naming its tool and pointing at that tool's own native discovery affordance.

The deliberate asymmetries follow the shipped products: the gitea-axi arm loads the bundled Agent Skill, because the Skill is part of what ships and its token cost belongs to gitea-axi. The tea and raw-API arms receive a one-line pointer to their native discovery affordance. The gitea-mcp arm's dispatcher schemas load eagerly as its ambient cost, and that arm disables the shell tool entirely, attaching only the MCP tools. Each arm's assembled prompt plus tool/PATH configuration (from the guard) is produced as a single arm definition the runner consumes.

## Acceptance criteria

- [x] All arms share the identical base prompt and are handed the same repository coordinates and token.
- [x] The gitea-axi arm's assembled context carries the bundled Agent Skill.
- [x] The tea and raw-API arms each receive only a one-line native-discovery pointer.
- [x] The gitea-mcp arm loads its dispatcher schemas eagerly, has the shell tool disabled, and is attached only the MCP tools.
- [x] Each non-MCP arm's tool/PATH configuration comes from the guard and exposes only that arm's allowed binary.

## Implementation Notes

The scaffolding lives in `bench/arm.ts`, following the existing `bench/` seam pattern. Two exports:

- `basePrompt(context)` — the identical, task-agnostic base prompt, carrying only the facts shared by every arm (repository coordinates, host URL, token) and naming no tool or task, so it is byte-for-byte identical across arms and the per-arm bootstrap is the only difference.
- `buildArm(arm, context, options)` — assembles the single `ArmDefinition` the runner consumes: the fully assembled system prompt plus the tool configuration (`shell` xor `mcp`). The shell arms' `binDir`/PATH/guard come from `guard.ts` (`provisionArmBin` + `guardCommand`); the gitea-mcp arm gets `shell: null` and the MCP server attachment.

Decisions and deviations worth flagging:

- **AC4's "loads dispatcher schemas eagerly" and "attached only the MCP tools" are conveyed structurally, not enforced here.** Eager schema loading is inherent to attaching an MCP server — the Agent SDK lists the server's tools on connect — so the arm definition materializes it by carrying the `mcp` server config (with `shell: null`). Actually attaching *only* the MCP tools (granting no shell/other builtin tools) is the runner's job in task 0027; the arm definition expresses the intent via `shell: null` + a populated `mcp`. This split matches the spec, which places the SDK wiring in the runner slice.
- **`loadSkillBody` strips the skill's YAML frontmatter, embedding only the instructional body.** AC2 says the gitea-axi arm "carries the bundled Agent Skill"; the frontmatter's `description` is metadata Claude Code loads ambiently for *every* skill, so folding it into this one arm would double-count it and overcharge gitea-axi's ambient cost (User Story 4: "each tool's real ambient-context cost is charged honestly"). The body is what an active skill contributes.
- **The MCP env uses the official gitea-mcp server's own contract** (`GITEA_HOST`, `GITEA_ACCESS_TOKEN`, launched `-t stdio`), pointed at the shared host and token. The tests assert the env *values* (host + token), not the key names, to avoid coupling to launch details.
- **Path resolution matches the product's house style** (`new URL("../skills/gitea-axi/SKILL.md", import.meta.url)`, as in `src/commands/setup.ts`), rather than `import.meta.dirname`, per a review note; `bench/` runs from source so `import.meta.url` resolves to the shipped skill.
- **`skillPath` and `locate` options** are injectable seams (skill location; binary resolver) that keep the module host-independently testable; `locate` mirrors `provisionArmBin`'s existing parameter in `guard.ts`.

Review: Risk **Low**. No unaddressed Standards or Spec findings — the one actionable Standards note (house-style path resolution) was applied; the remaining review points are principled deviations documented above. No criteria dropped.
