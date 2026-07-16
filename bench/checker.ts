// The checker: the pure scoring seam that turns a completed run into a
// deterministic pass/fail. A mutation task is scored by diffing the entire
// post-run repository state against the expected end state (so both the intended
// change and any collateral damage are caught); a read task is scored by matching
// its required answer facts against the agent's final report, with no LLM judge.
//
// The checker is fed synthetic state snapshots and expected states; capturing the
// live state from a real repository is the runner's job. The scoring-spec contract
// it consumes lives in scoring-spec.ts.

import type {
  Comment,
  Label,
  PullRequest,
  RepoState,
  RequiredFact,
  Review,
  ScoringSpec,
} from "./scoring-spec.js";

/**
 * The checker's verdict. On failure it carries the human-readable differences —
 * each missing intended change or collateral change for a mutation, or each
 * missing fact for a read — so a failed trial can be diagnosed from the record.
 */
export type CheckResult = { pass: true } | { pass: false; differences: string[] };

/** What a completed run submits for scoring, tagged by the kind of task it was. */
export type Submission =
  | { kind: "mutation"; state: RepoState }
  | { kind: "read"; report: string };

/**
 * Score a mutation task by diffing the full actual state against the expected end
 * state. The diff walks the whole snapshot, so a difference is raised whether the
 * actual state is missing the intended change or carries a collateral one. The
 * volatile, host-assigned ids and timestamps are simply never compared, so two
 * states that agree on the meaningful fields match regardless of them.
 */
export function checkMutation(expected: RepoState, actual: RepoState): CheckResult {
  const differences: string[] = [];
  diffLabels(expected.labels, actual.labels, differences);
  diffByNumber("issue", expected.issues, actual.issues, differences, diffConversation);
  diffByNumber("pull request", expected.pullRequests, actual.pullRequests, differences, diffPullRequest);
  return differences.length === 0 ? { pass: true } : { pass: false, differences };
}

/** Diff the repository's label definitions, matched by name. */
function diffLabels(expected: Label[], actual: Label[], differences: string[]): void {
  const expectedByName = new Map(expected.map((l) => [l.name, l]));
  const actualByName = new Map(actual.map((l) => [l.name, l]));
  for (const [name, e] of expectedByName) {
    const a = actualByName.get(name);
    if (a === undefined) {
      differences.push(`missing label "${name}"`);
      continue;
    }
    if (e.color !== a.color) {
      differences.push(`label "${name}" color expected "${e.color}" but was "${a.color}"`);
    }
    if ((e.description ?? "") !== (a.description ?? "")) {
      differences.push(`label "${name}" description differs`);
    }
  }
  for (const name of actualByName.keys()) {
    if (!expectedByName.has(name)) {
      differences.push(`unexpected label "${name}" (collateral change)`);
    }
  }
}

/**
 * Match two lists of numbered entities (issues or pull requests) by their stable
 * number, reporting any expected entity missing from the actual state and any
 * actual entity the expected state does not contain (collateral), then comparing
 * the fields of each matched pair.
 */
function diffByNumber<T extends { number: number }>(
  kind: string,
  expected: T[],
  actual: T[],
  differences: string[],
  compareFields: (where: string, e: T, a: T, differences: string[]) => void,
): void {
  const expectedByNumber = new Map(expected.map((e) => [e.number, e]));
  const actualByNumber = new Map(actual.map((a) => [a.number, a]));
  for (const [number, e] of expectedByNumber) {
    const a = actualByNumber.get(number);
    if (a === undefined) {
      differences.push(`missing ${kind} #${number}`);
      continue;
    }
    compareFields(`${kind} #${number}`, e, a, differences);
  }
  for (const number of actualByNumber.keys()) {
    if (!expectedByNumber.has(number)) {
      differences.push(`unexpected ${kind} #${number} (collateral change)`);
    }
  }
}

/**
 * The conversation surface an issue and a pull request share: title, body, state,
 * applied labels, assignees, and comments. State is compared as an opaque string
 * so an issue's open/closed and a pull request's open/closed/merged both flow
 * through the same diff.
 */
interface Conversation {
  title: string;
  body: string;
  state: string;
  labels: string[];
  assignees: string[];
  comments: Comment[];
}

/** Diff the conversation fields common to issues and pull requests. */
function diffConversation(where: string, e: Conversation, a: Conversation, differences: string[]): void {
  diffScalar(where, "title", e.title, a.title, differences);
  diffScalar(where, "body", e.body, a.body, differences);
  diffScalar(where, "state", e.state, a.state, differences);
  diffSet(where, "label", e.labels, a.labels, differences);
  diffSet(where, "assignee", e.assignees, a.assignees, differences);
  diffComments(where, e.comments, a.comments, differences);
}

/** Diff a pull request: its shared conversation surface plus its reviews. */
function diffPullRequest(where: string, e: PullRequest, a: PullRequest, differences: string[]): void {
  diffConversation(where, e, a, differences);
  diffReviews(where, e.reviews, a.reviews, differences);
}

function diffScalar(where: string, field: string, e: string, a: string, differences: string[]): void {
  if (e !== a) {
    differences.push(`${where} ${field} expected "${e}" but was "${a}"`);
  }
}

/**
 * Diff two order-independent sets of named things (applied labels, assignees),
 * naming each element the expected state requires but the actual state lacks, and
 * each the actual state carries but the expected state does not (collateral), so
 * the divergence is diagnosable down to the specific label or assignee.
 */
function diffSet(where: string, noun: string, e: string[], a: string[], differences: string[]): void {
  const { missing, extra } = matchByKey(a, e, (name) => name);
  for (const name of missing) {
    differences.push(`${where} missing ${noun} "${name}"`);
  }
  for (const name of extra) {
    differences.push(`${where} unexpected ${noun} "${name}" (collateral change)`);
  }
}

/**
 * Diff two sets of comments, matched by author and body (volatile id and
 * timestamp ignored) and compared order-independently. Each comment the expected
 * state requires but the actual lacks, and each the actual carries but the
 * expected does not (collateral), is named by its author and body.
 */
function diffComments(where: string, e: Comment[], a: Comment[], differences: string[]): void {
  const { missing, extra } = matchByKey(a, e, commentKey);
  for (const comment of missing) {
    differences.push(`${where} missing comment ${describeComment(comment)}`);
  }
  for (const comment of extra) {
    differences.push(`${where} unexpected comment ${describeComment(comment)} (collateral change)`);
  }
}

/** The key a comment is matched by: its author and body, volatile fields dropped. */
function commentKey(comment: Comment): string {
  return JSON.stringify([comment.author, comment.body]);
}

/** A readable rendering of the author and body a comment is matched by. */
function describeComment(comment: Comment): string {
  return `from ${comment.author}: ${JSON.stringify(comment.body)}`;
}

/**
 * Diff two sets of reviews, matched order-independently — like comments and
 * labels — by author, kind, body, and their inline comments (themselves matched
 * by author and body, order-independently). Each review the expected state
 * requires but the actual lacks, and each collateral review the actual carries,
 * is named by its author, kind, and body.
 */
function diffReviews(where: string, e: Review[], a: Review[], differences: string[]): void {
  const { missing, extra } = matchByKey(a, e, reviewKey);
  for (const review of missing) {
    differences.push(`${where} missing review ${describeReview(review)}`);
  }
  for (const review of extra) {
    differences.push(`${where} unexpected review ${describeReview(review)} (collateral change)`);
  }
}

/** The key a review is matched by: author, kind, body, and its inline comments as a set. */
function reviewKey(review: Review): string {
  const comments = review.comments.map((c) => [c.author, c.body]).sort();
  return JSON.stringify([review.author, review.kind, review.body, comments]);
}

/** A readable rendering of the author, kind, and body a review is matched by. */
function describeReview(review: Review): string {
  return `by ${review.author} (${review.kind}): ${JSON.stringify(review.body)}`;
}

/**
 * Match two collections order-independently by a key, returning the expected
 * items with no actual counterpart (`missing`) and the actual items with no
 * expected counterpart (`extra`). Each expected item matches at most one actual
 * item, so duplicates are honored (two identical expected comments require two
 * in the actual state).
 */
function matchByKey<T>(
  actual: T[],
  expected: T[],
  key: (item: T) => string,
): { missing: T[]; extra: T[] } {
  const unmatched = expected.map((item) => ({ item, key: key(item) }));
  const extra: T[] = [];
  for (const item of actual) {
    const k = key(item);
    const index = unmatched.findIndex((candidate) => candidate.key === k);
    if (index >= 0) {
      unmatched.splice(index, 1);
    } else {
      extra.push(item);
    }
  }
  return { missing: unmatched.map((entry) => entry.item), extra };
}

/**
 * Score a read task by matching its required answer facts against the agent's
 * final report — no LLM judge. A fact is present when the report contains any one
 * of its acceptable renderings, compared after lower-casing and collapsing
 * whitespace so trivial phrasing differences do not matter. The answer passes
 * only when every required fact is present.
 */
export function checkReadAnswer(facts: RequiredFact[], report: string): CheckResult {
  const haystack = normalizeText(report);
  const missing = facts.filter(
    (fact) => !fact.anyOf.some((rendering) => haystack.includes(normalizeText(rendering))),
  );
  if (missing.length === 0) {
    return { pass: true };
  }
  return {
    pass: false,
    differences: missing.map((fact) => `missing required fact: ${fact.description}`),
  };
}

/** Lower-case and collapse runs of whitespace so incidental phrasing does not matter. */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Score a completed run against its scoring spec, dispatching on the task kind: a
 * mutation spec is scored by the full-state diff against the submitted repository
 * state, a read spec by the answer-match against the submitted report. The
 * submission's kind must match the spec's — a mismatch is a caller error and
 * throws, rather than silently scoring the wrong thing.
 */
export function score(spec: ScoringSpec, submission: Submission): CheckResult {
  if (spec.kind === "mutation") {
    if (submission.kind !== "mutation") {
      throw new Error(
        `a mutation spec must be scored against a mutation submission, got "${submission.kind}"`,
      );
    }
    return checkMutation(spec.expected, submission.state);
  }
  if (submission.kind !== "read") {
    throw new Error(
      `a read spec must be scored against a read submission, got "${submission.kind}"`,
    );
  }
  return checkReadAnswer(spec.facts, submission.report);
}
