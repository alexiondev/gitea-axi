/** The subset of a Gitea `User` this module reads: just the login, if present. */
interface AssigneeLike {
  login?: string;
}

/**
 * The logins of an entity's current assignees, dropping any without one. The
 * shared read side of fetch-then-patch: `issue edit` and `pr edit` both take the
 * `assignees` off a freshly fetched entity and feed the result to
 * {@link mergeAssignees}.
 */
export function assigneeLogins(assignees: AssigneeLike[] | undefined): string[] {
  return (assignees ?? []).flatMap((assignee) => (assignee.login ? [assignee.login] : []));
}

/**
 * The full assignee login list to PATCH under fetch-then-patch semantics
 * (ADR 0007): the entity's current assignees with the requested additions
 * appended and removals dropped. Matching is case-insensitive and the result is
 * de-duplicated, order-preserving, so a login already assigned never lands in the
 * list twice. Shared by `issue edit` and `pr edit`, whose PATCH bodies both
 * replace the whole assignee list rather than adding or removing individual
 * entries.
 */
export function mergeAssignees(current: string[], add: string[], remove: string[]): string[] {
  const removeSet = new Set(remove.map((login) => login.toLowerCase()));
  const seen = new Set<string>();
  const result: string[] = [];
  const push = (login: string): void => {
    const key = login.toLowerCase();
    if (removeSet.has(key) || seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(login);
  };
  for (const login of current) {
    push(login);
  }
  for (const login of add) {
    push(login);
  }
  return result;
}
