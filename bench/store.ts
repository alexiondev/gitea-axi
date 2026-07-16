import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CellKey, ResultRecord } from "./result.js";

/** Where accumulated samples are stored when no store root is given. */
export const DEFAULT_STORE_ROOT = "bench/results";

/** Run `read`, returning `fallback` when the target does not exist yet. */
function ignoreEnoent<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

/**
 * An append-only store of result samples, one location per cell. Deepening a
 * cell's sample size appends new records; prior samples are never overwritten,
 * and reading a cell returns every accumulated sample.
 */
export interface SampleStore {
  /** Append one immutable sample to the cell derived from its arm and task id. */
  append(record: ResultRecord): void;
  /** Read every sample accumulated for a cell, in append order; `[]` if none. */
  read(cell: CellKey): ResultRecord[];
  /** Enumerate every cell that has at least one sample. */
  cells(): CellKey[];
}

/**
 * Open a sample store rooted at `root`. The store is backed by the filesystem so
 * accumulated samples persist across processes and can be deepened over many
 * separate runs.
 *
 * Each cell is one newline-delimited JSON file at `<root>/<arm>/<taskId>.jsonl`.
 * Append is a bare file append, which is what makes prior samples immutable:
 * deepening a cell only ever adds lines. Reading parses the whole file back.
 */
export function createSampleStore(root: string): SampleStore {
  function cellPath(cell: CellKey): string {
    return join(root, cell.arm, `${cell.taskId}.jsonl`);
  }

  return {
    append(record) {
      const path = cellPath({ arm: record.arm, taskId: record.taskId });
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(record)}\n`);
    },

    read(cell) {
      const contents = ignoreEnoent<string | undefined>(
        () => readFileSync(cellPath(cell), "utf8"),
        undefined,
      );
      if (contents === undefined) {
        return [];
      }
      return contents
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as ResultRecord);
    },

    cells() {
      const found: CellKey[] = [];
      const arms = ignoreEnoent<string[]>(() => readdirSync(root), []);
      for (const arm of arms) {
        let files: string[];
        try {
          files = readdirSync(join(root, arm));
        } catch {
          // Not a directory (a stray file at the root): no cells live under it.
          continue;
        }
        for (const file of files) {
          if (file.endsWith(".jsonl")) {
            found.push({ arm: arm as CellKey["arm"], taskId: file.slice(0, -".jsonl".length) });
          }
        }
      }
      return found;
    },
  };
}
