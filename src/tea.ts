import type { CliDeps } from "./deps.js";
import { axiError } from "./errors.js";
import { runSubprocess } from "./subprocess.js";

export interface TeaLogin {
  name: string;
  url: string;
  sshHost: string;
  isDefault: boolean;
}

interface RawTeaLogin {
  name?: string;
  url?: string;
  ssh_host?: string;
  default?: string;
}

function teaNotInstalled(): never {
  throw axiError("tea is not installed", "TEA_NOT_INSTALLED", [
    "Install tea (https://gitea.com/gitea/tea) — gitea-axi discovers credentials from tea's login store",
    "Then run `tea login add` to configure a login",
  ]);
}

function failureDetail(result: { stderr: string; code: number | null }): string {
  return firstLine(result.stderr) || `exit code ${result.code}`;
}

export async function listLogins(deps: CliDeps): Promise<TeaLogin[]> {
  const result = await runSubprocess("tea", ["login", "list", "--output", "json"], {
    env: deps.env,
  });
  if (result.enoent) {
    teaNotInstalled();
  }
  if (result.code !== 0) {
    throw axiError(`\`tea login list\` failed: ${failureDetail(result)}`, "UNKNOWN");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    throw axiError("`tea login list --output json` returned invalid JSON", "UNKNOWN");
  }
  if (!Array.isArray(raw)) {
    throw axiError("`tea login list --output json` returned unexpected output", "UNKNOWN");
  }
  return (raw as RawTeaLogin[]).map((entry) => ({
    name: entry.name ?? "",
    url: entry.url ?? "",
    sshHost: entry.ssh_host ?? "",
    isDefault: entry.default === "true",
  }));
}

// The list output carries no token (its columns are name, url, ssh_host, user,
// default), so the token comes from tea's git-credential interface, which also
// refreshes OAuth tokens transparently.
export async function getToken(deps: CliDeps, login: TeaLogin, host: string): Promise<string> {
  let protocol = "https";
  try {
    protocol = new URL(login.url).protocol.replace(/:$/, "");
  } catch {
    // Fall back to https; the helper only requires the host.
  }
  const result = await runSubprocess(
    "tea",
    ["login", "helper", "get", "--login", login.name],
    {
      env: deps.env,
      stdin: `protocol=${protocol}\nhost=${host}\n\n`,
    },
  );
  if (result.enoent) {
    teaNotInstalled();
  }
  if (result.code !== 0) {
    throw axiError(
      `tea could not provide a token for login "${login.name}": ${failureDetail(result)}`,
      "AUTH_REQUIRED",
      [`Run \`tea login edit ${login.name}\` to repair the login`],
    );
  }
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("password=")) {
      const token = line.slice("password=".length).trim();
      if (token) {
        return token;
      }
    }
  }
  throw axiError(
    `tea returned no token for login "${login.name}"`,
    "AUTH_REQUIRED",
    [`Run \`tea login edit ${login.name}\` to repair the login`],
  );
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0]?.trim() ?? "";
}
