import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Building the npm distribution artifact, factored out so the two packaging
// facets can each take just the part they need: the tarball facet packs and
// extracts, the installed-binary facet packs and installs.

export const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Pack the real tarball into `destDir`, returning its path.
 *
 * `npm pack --json` reports the tarball filename; the shape shifted across npm
 * majors (an array of entries on npm <12, an object keyed by package name on
 * npm 12+), so accept either and pull the one filename out.
 */
export function packTarball(destDir: string): string {
  const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", destDir], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const packResult = JSON.parse(packOutput) as unknown;
  const packEntries = Array.isArray(packResult)
    ? (packResult as Array<{ filename: string }>)
    : Object.values(packResult as Record<string, { filename: string }>);
  return join(destDir, packEntries[0]!.filename);
}

/**
 * Extract `tarball` into a fresh `extract/` under `destDir`, returning the
 * directory npm nests everything under (`<destDir>/extract/package`).
 */
export function extractTarball(tarball: string, destDir: string): string {
  const extractDir = join(destDir, "extract");
  mkdirSync(extractDir);
  execFileSync("tar", ["-xzf", tarball, "-C", extractDir]);
  return join(extractDir, "package");
}

/**
 * Install `tarball` globally into a throwaway prefix under `destDir`, returning
 * the path of the installed binary on that prefix's bin dir.
 */
export function installGlobally(tarball: string, destDir: string): string {
  const prefix = join(destDir, "prefix");
  execFileSync("npm", ["install", "-g", "--prefix", prefix, tarball], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return join(prefix, "bin", "gitea-axi");
}
