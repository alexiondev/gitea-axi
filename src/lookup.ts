import type { Label } from "gitea-js";
import type { GiteaClient } from "./client.js";
import type { RepoContext } from "./context.js";
import { axiError, classifyHttpError } from "./errors.js";
import { fetchAllPages } from "./paginate.js";

/**
 * Name→ID resolution for the Gitea endpoints that only accept numeric ids.
 * Shared by every command that takes a `--label` or `--milestone` name.
 */

/** Fetch every label in the repository, paging until the API runs out. */
async function listAllLabels(api: GiteaClient, context: RepoContext): Promise<Label[]> {
  try {
    const { items } = await fetchAllPages<Label>((page, limit) =>
      api.repos.issueListLabels(context.owner, context.name, { page, limit }),
    );
    return items;
  } catch (error) {
    throw classifyHttpError(error);
  }
}

/**
 * Resolve label names to their ids, case-insensitively. Every name must exist:
 * creating an issue while silently dropping a label the caller asked for would
 * misreport what was created.
 */
export async function resolveLabelIds(
  api: GiteaClient,
  context: RepoContext,
  names: string[],
): Promise<number[]> {
  if (names.length === 0) {
    return [];
  }
  const labels = await listAllLabels(api, context);
  const byName = new Map<string, number>();
  for (const label of labels) {
    if (label.name === undefined || label.id === undefined) {
      continue;
    }
    const key = label.name.toLowerCase();
    // First match wins, so a duplicate name resolves deterministically.
    if (!byName.has(key)) {
      byName.set(key, label.id);
    }
  }

  const ids: number[] = [];
  for (const name of names) {
    const id = byName.get(name.toLowerCase());
    if (id === undefined) {
      const available = labels
        .map((label) => label.name)
        .filter((label): label is string => Boolean(label));
      throw axiError(
        `Label "${name}" not found in ${context.owner}/${context.name}` +
          (available.length > 0 ? ` (available: ${available.join(", ")})` : ""),
        "VALIDATION_ERROR",
      );
    }
    ids.push(id);
  }
  return ids;
}

/** Resolve a milestone name to its id via the name-filtered milestone query. */
export async function resolveMilestoneId(
  api: GiteaClient,
  context: RepoContext,
  name: string,
): Promise<number> {
  let milestones;
  try {
    const response = await api.repos.issueGetMilestonesList(context.owner, context.name, {
      name,
    });
    milestones = response.data ?? [];
  } catch (error) {
    throw classifyHttpError(error);
  }
  // The `name` query only narrows the candidates — the title is re-checked here
  // so that neither the caller's casing nor a looser server-side match (Gitea
  // filters with a LIKE) can resolve to a milestone the caller did not name.
  const match = milestones.find(
    (milestone) => milestone.title?.toLowerCase() === name.toLowerCase(),
  );
  if (!match?.id) {
    throw axiError(
      `Milestone "${name}" not found in ${context.owner}/${context.name}`,
      "VALIDATION_ERROR",
    );
  }
  return match.id;
}
