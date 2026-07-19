// The scoring-spec contract: a task's expected outcome, in the form the checker
// consumes and the runner and task suite produce. Two kinds mirror the two ways
// the benchmark scores a run — a mutation task fixes the repository's expected
// end state (diffed in full so collateral damage is caught), and a read task
// fixes the facts the agent's final report must contain (matched deterministically,
// with no LLM judge).
//
// These are pure contract types with no logic; the checker (checker.ts) is the
// seam that scores an actual run against a spec of either kind. The benchmark's
// own vocabulary (arm, cell, checker, seed) is documented in bench/README.md and
// the benchmark-harness spec, deliberately kept out of the tool's own domain
// glossary.

/**
 * A repository label definition. The seed fixes each label's colour, so colour
 * and description are part of the expected end state; applied label *names* on an
 * issue or pull request are compared separately, as an order-independent set.
 */
export interface Label {
  name: string;
  color: string;
  description?: string;
}

/**
 * One comment on an issue, pull request, or review. Comments are matched by
 * author and body; the host-assigned id and timestamps are volatile and are
 * dropped before comparison.
 */
export interface Comment {
  author: string;
  body: string;
  /** Volatile: host-assigned, dropped by normalization. */
  id?: number;
  /** Volatile: dropped by normalization. */
  createdAt?: string;
}

/** An issue's open/closed state. */
export type IssueState = "open" | "closed";

/** A pull request's state; unlike an issue, it may also be merged. */
export type PullRequestState = "open" | "closed" | "merged";

/** The kind of review a single user may leave on a pull request. */
export type ReviewKind = "comment" | "approved" | "request-changes";

/**
 * One review on a pull request. The single-user seed allows comment-type reviews
 * (and, where the host permits self-review, approvals and change requests).
 * Reviews are matched by author, kind, body, and their inline comments; the
 * host-assigned id and timestamp are volatile.
 */
export interface Review {
  author: string;
  kind: ReviewKind;
  body: string;
  /** Inline review comments; matched by author and body. */
  comments: Comment[];
  /** Volatile: host-assigned, dropped by normalization. */
  id?: number;
  /** Volatile: dropped by normalization. */
  createdAt?: string;
}

/**
 * One issue in the expected (or actual) repository state. The issue number is
 * deterministic ground truth from the seed and keys the diff; the host-assigned
 * id and timestamps are volatile and dropped.
 */
export interface Issue {
  number: number;
  title: string;
  body: string;
  state: IssueState;
  /** Applied label names; compared as an order-independent set. */
  labels: string[];
  /** Assignee usernames; compared as an order-independent set. */
  assignees: string[];
  /** Comments; matched by author and body. */
  comments: Comment[];
  /** Volatile: host-assigned, dropped by normalization. */
  id?: number;
  /** Volatile: dropped by normalization. */
  createdAt?: string;
  /** Volatile: dropped by normalization. */
  updatedAt?: string;
}

/**
 * One pull request in the expected (or actual) repository state. Shares the
 * conversation surface with an issue (labels, assignees, comments) and adds the
 * merged state and reviews.
 */
export interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: PullRequestState;
  /** Applied label names; compared as an order-independent set. */
  labels: string[];
  /** Assignee usernames; compared as an order-independent set. */
  assignees: string[];
  /** Comments; matched by author and body. */
  comments: Comment[];
  /** Reviews; matched by author, kind, body, and inline comments. */
  reviews: Review[];
  /** Volatile: host-assigned, dropped by normalization. */
  id?: number;
  /** Volatile: dropped by normalization. */
  createdAt?: string;
  /** Volatile: dropped by normalization. */
  updatedAt?: string;
}

/**
 * A full snapshot of the throwaway repository's scored surface. A mutation task's
 * expected end state is one of these; the checker captures the actual post-run
 * state in the same shape and diffs the two in full, so both the intended change
 * and any collateral damage are caught.
 */
export interface RepoState {
  labels: Label[];
  issues: Issue[];
  pullRequests: PullRequest[];
}

/**
 * One fact a read task's answer must contain. The fact is satisfied when the
 * agent's final report contains any one of `anyOf`'s renderings (after
 * whitespace and case normalization), so a count or a name can be phrased
 * variously without resorting to an LLM judge. `description` names the fact in
 * diagnostics when it is missing.
 *
 * `anyOf` matches a *contiguous* substring, which is brittle for facts a human
 * naturally pads with filler — "5 issues are currently open" does not contain
 * the fixed phrase "5 issues are open". For those, supply `pattern`: a regular
 * expression (matched against the same normalized report) that satisfies the
 * fact when it matches, so the count itself can be recognised rather than one
 * exact wording. A fact is present when any `anyOf` rendering *or* `pattern`
 * matches; `anyOf` stays the human-readable renderings even when `pattern`
 * carries the real matcher.
 */
export interface RequiredFact {
  description: string;
  anyOf: string[];
  /** Optional regex (source, matched case-insensitively against the normalized report). */
  pattern?: string;
}

/**
 * A task's scoring spec: either a mutation's expected end state or a read's
 * required answer facts. The runner and task suite produce one of these per
 * task; the checker consumes it to turn a completed run into a pass/fail.
 */
export type ScoringSpec =
  | { kind: "mutation"; expected: RepoState }
  | { kind: "read"; facts: RequiredFact[] };
