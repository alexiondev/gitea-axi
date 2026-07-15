---
spec: benchmark-harness
blocked-by: 0023-bench-tool-isolation-guard
---

## What to build

The per-arm scaffolding that charges each tool's real ambient-context cost honestly. All arms share one task-agnostic base prompt and the same repository coordinates and token; each arm then receives a minimal, symmetric bootstrap naming its tool and pointing at that tool's own native discovery affordance.

The deliberate asymmetries follow the shipped products: the gitea-axi arm loads the bundled Agent Skill, because the Skill is part of what ships and its token cost belongs to gitea-axi. The tea and raw-API arms receive a one-line pointer to their native discovery affordance. The gitea-mcp arm's dispatcher schemas load eagerly as its ambient cost, and that arm disables the shell tool entirely, attaching only the MCP tools. Each arm's assembled prompt plus tool/PATH configuration (from the guard) is produced as a single arm definition the runner consumes.

## Acceptance criteria

- [ ] All arms share the identical base prompt and are handed the same repository coordinates and token.
- [ ] The gitea-axi arm's assembled context carries the bundled Agent Skill.
- [ ] The tea and raw-API arms each receive only a one-line native-discovery pointer.
- [ ] The gitea-mcp arm loads its dispatcher schemas eagerly, has the shell tool disabled, and is attached only the MCP tools.
- [ ] Each non-MCP arm's tool/PATH configuration comes from the guard and exposes only that arm's allowed binary.
