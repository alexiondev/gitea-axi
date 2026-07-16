// The maintainer-facing reporting command: render the accumulated sample store
// into the readable comparison.
//
// This is the reporting counterpart to run.ts. Where the run command spends the
// token budget on one cell, this command reads whatever samples have accumulated
// so far and prints the aggregator's comparison — headline, coverage, per-tier
// and per-token-component breakdowns, and the bonus table.
//
// Unlike run.ts, this command has no live boundary: it touches only the local
// sample store on disk (no credentials, host, or Agent SDK), so the whole command
// is deterministic and unit-tested. `parseReportArgs` is the pure argument seam.

import { pathToFileURL } from "node:url";
import type { CliDeps } from "../src/deps.js";
import { aggregate, readAllSamples, renderReport } from "./aggregate.js";
import { createSampleStore, DEFAULT_STORE_ROOT } from "./store.js";
import { buildBonusTasks, buildScoredSuite } from "./task-suite.js";

/** A fully-resolved report configuration. */
export interface ReportArgs {
  /** The sample-store root to read; defaults to {@link DEFAULT_STORE_ROOT}. */
  storeRoot: string;
  /** Whether to render the suite/bonus variant for a self-review-permitting host. */
  selfReview: boolean;
}

/** The parse outcome: a request for help, or a resolved configuration to render. */
export type ParsedReportArgs = { help: true } | ({ help: false } & ReportArgs);

/** The value-taking flags the command understands. */
const VALUE_FLAGS = new Set(["store"]);

/** The boolean flags the command understands, each with a `--no-` negation. */
const BOOLEAN_FLAGS = new Set(["self-review"]);

/** A usage error, surfaced to the maintainer with the offending detail. */
function usage(detail: string): Error {
  return new Error(`${detail}\n\nUsage: bench:report [--store <dir>] [--self-review | --no-self-review]`);
}

/**
 * Parse the report command's argv into a resolved configuration, applying
 * defaults ({@link DEFAULT_STORE_ROOT} store, self-review permitted). A report
 * needs no required selection, so no arguments is a valid invocation. Throws a
 * usage error on an unknown flag, a bare argument, a value-flag missing its
 * value, or a value handed to a boolean flag.
 */
export function parseReportArgs(argv: string[]): ParsedReportArgs {
  let storeRoot = DEFAULT_STORE_ROOT;
  let selfReview = true;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token === "--help" || token === "-h") {
      return { help: true };
    }
    if (!token.startsWith("--")) {
      throw usage(`unexpected argument "${token}"`);
    }

    const equals = token.indexOf("=");
    const rawName = equals === -1 ? token.slice(2) : token.slice(2, equals);
    const inlineValue = equals === -1 ? undefined : token.slice(equals + 1);

    // A `--no-<flag>` prefix negates a boolean flag.
    const negated = rawName.startsWith("no-");
    const name = negated ? rawName.slice(3) : rawName;

    if (BOOLEAN_FLAGS.has(name)) {
      if (inlineValue !== undefined) {
        throw usage(`flag --${rawName} takes no value`);
      }
      selfReview = !negated;
      continue;
    }

    if (negated || !VALUE_FLAGS.has(name)) {
      throw usage(`unknown flag "--${rawName}"`);
    }

    let value = inlineValue;
    if (value === undefined) {
      value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw usage(`flag --${name} needs a value`);
      }
      index += 1;
    }
    if (name === "store") {
      storeRoot = value;
    }
  }

  return { help: false, storeRoot, selfReview };
}

/** The help text printed for `--help` / `-h`. */
const HELP_TEXT = `bench:report — render the accumulated benchmark samples into a comparison.

Reads whatever samples have accumulated in the store and prints the aggregator's
comparison: the cost-equivalent-token headline, coverage annotated against the
reporting floor, per-tier and per-token-component breakdowns, and the bonus table.
Incomplete coverage is annotated rather than hidden, so a half-run matrix still
renders. This command is offline — it reads only the local store, never the host.

Usage:
  npm run bench:report -- [options]

Options:
  --store <dir>        Sample store root to read (default: ${DEFAULT_STORE_ROOT})
  --self-review        Render the variant for a self-review-permitting host (default)
  --no-self-review     Render the variant for a host that forbids self-review
  -h, --help           Show this help

--self-review only affects the bonus capability catalog (whether the approve /
request-changes review pair appears there or in the scored suite); the scored
coverage is identical either way. Set it to match the host the samples were run on.`;

/**
 * Render the accumulated sample store into the readable comparison. This is the
 * command's boundary, but — unlike the run command — it is offline: it opens the
 * local store at `--store`, drains it, aggregates against the scored suite and
 * bonus definitions (resolved against the `--self-review` variant), and prints the
 * rendered report through `out`. No orchestration, weighting, or rendering is
 * reimplemented here; it drives the `readAllSamples` / `aggregate` / `renderReport`
 * seam. Returns a process exit code.
 */
export async function runReportCommand(
  argv: string[],
  // Unused: an offline report needs no credentials, cwd, or env. Kept for signature
  // parity with the command family (runBenchCommand takes the same (argv, deps, out)).
  _deps: CliDeps,
  out: (line: string) => void,
): Promise<number> {
  const parsed = parseReportArgs(argv);
  if (parsed.help) {
    out(HELP_TEXT);
    return 0;
  }

  const suiteOptions = { selfReviewPermitted: parsed.selfReview };
  const store = createSampleStore(parsed.storeRoot);
  const report = aggregate({
    records: readAllSamples(store),
    suite: buildScoredSuite(suiteOptions),
    bonus: buildBonusTasks(suiteOptions),
  });
  out(renderReport(report));
  return 0;
}

/** Entry point: render the report and set the process exit code. */
export async function main(): Promise<void> {
  const deps: CliDeps = { env: process.env, cwd: process.cwd(), globals: {} };
  try {
    process.exitCode = await runReportCommand(
      process.argv.slice(2),
      deps,
      (line) => process.stdout.write(`${line}\n`),
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

// Run only when executed directly (e.g. `tsx bench/report.ts`), not when imported
// by a test. Under a TypeScript runner argv[1] is this file's own path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
