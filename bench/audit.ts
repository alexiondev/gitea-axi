// The post-run transcript audit: a defence-in-depth check that re-inspects a
// completed run's tool invocations and asserts no foreign tool was reached. The
// guard (guard.ts) is the primary, in-band enforcement — it denies a foreign
// shell command before it runs — but the audit is the independent backstop the
// benchmark trusts: if enforcement ever leaked, a run in which a foreign tool
// actually executed is flagged invalid rather than being scored (see the
// benchmark-harness spec's testing decisions).
//
// This module is pure — it re-runs the arm's own guard over the recorded shell
// commands and checks the arm's channel discipline (shell arms never reach MCP
// tools; the MCP arm never reaches the shell). It does not run the agent; the
// runner (runner.ts) drives the run and feeds the transcript here.

import type { ArmDefinition } from "./arm.js";

/**
 * One tool invocation recorded in the agent's transcript, reduced to what the
 * isolation audit needs. `shell` is a proposed shell command; `mcp` is a call to
 * an attached MCP server's tool; `other` is a built-in, non-Gitea-reaching tool
 * (file read/edit and the like) that carries no isolation risk.
 */
export type ToolUse =
  | { kind: "shell"; command: string }
  | { kind: "mcp"; server: string; tool: string }
  | { kind: "other"; name: string };

/**
 * The audit's verdict. On a leak it carries a human-readable reason per foreign
 * tool that was reached, so an invalidated trial can be diagnosed from the record.
 */
export type AuditResult = { clean: true } | { clean: false; leaks: string[] };

/**
 * The single source of truth for whether one tool is foreign to an arm: returns a
 * human-readable reason it must not run, or `null` when it is permitted. A shell
 * arm puts every Bash command through its own guard and admits every non-shell
 * built-in, but has no MCP server; the MCP arm disables the shell entirely and
 * admits its MCP tools. Built-in `other` tools reach no Gitea channel and are
 * always permitted.
 *
 * Both isolation enforcement points share this predicate so they cannot drift: the
 * agent driver (sdk-driver.ts) consults it in-band to deny a foreign tool before
 * it runs, and `auditTranscript` re-applies it post-run as the independent backstop.
 */
export function foreignToolReason(arm: ArmDefinition, use: ToolUse): string | null {
  if (use.kind === "shell") {
    if (arm.shell === null) {
      return `the ${arm.arm} arm runs with the shell disabled; only its MCP tools are available`;
    }
    const decision = arm.shell.guard(use.command);
    return decision.allowed ? null : decision.reason;
  }
  if (use.kind === "mcp") {
    return arm.mcp === null ? `the ${arm.arm} arm has no MCP server attached` : null;
  }
  return null;
}

/** A human-readable rendering of a leaked tool use, tagging it with the reason. */
function describeLeak(use: ToolUse, reason: string): string {
  switch (use.kind) {
    case "shell":
      return `foreign shell command ${JSON.stringify(use.command)} reached: ${reason}`;
    case "mcp":
      return `MCP tool "${use.server}/${use.tool}" reached: ${reason}`;
    case "other":
      return `tool "${use.name}" reached: ${reason}`;
  }
}

/**
 * Re-check a completed run's transcript against the arm's isolation rules,
 * re-applying `foreignToolReason` to every executed tool. A tool the arm should
 * never have reached — a guard-denied shell command, a shell command on the MCP
 * arm, an MCP call on a shell arm — is reported as a leak. Clean when nothing leaked.
 */
export function auditTranscript(arm: ArmDefinition, transcript: ToolUse[]): AuditResult {
  const leaks: string[] = [];
  for (const use of transcript) {
    const reason = foreignToolReason(arm, use);
    if (reason !== null) {
      leaks.push(describeLeak(use, reason));
    }
  }
  return leaks.length === 0 ? { clean: true } : { clean: false, leaks };
}
