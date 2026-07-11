import type { RepoContext } from "./context.js";

/**
 * Build a next-step suggestion line, appending `-R`/`--login` overrides when
 * the context did not come from the git remote (an agent's next call in the
 * same working directory would auto-detect the same context otherwise).
 */
export function suggestCommand(
  context: RepoContext,
  commandLine: string,
  note: string,
): string {
  let command = `gitea-axi ${commandLine}`;
  if (context.repoSource !== "auto") {
    command += ` -R ${context.owner}/${context.name}`;
  }
  if (context.loginSource !== "auto" && context.loginName) {
    command += ` --login ${context.loginName}`;
  }
  return `Run \`${command}\` ${note}`;
}
