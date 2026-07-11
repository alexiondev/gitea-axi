# Use direct Gitea API (`gitea-js`) instead of wrapping the `tea` subprocess

gitea-axi calls the Gitea REST API directly via `gitea-js` rather than shelling out to the `tea` binary.
Tea was the original plan because it provides auth, multi-instance login, and full command coverage out of the box, but hands-on evaluation found too many gaps that made subprocess wrapping a patchwork rather than a clean pipeline.

## Considered Options

**Wrap `tea` with `--output json`** (rejected) — Tea's create commands (`issues create`, `pulls create`) have no `--output json` flag, requiring text parsing plus a follow-up get call. `pulls list` has no head-branch filter, forcing a full list scan for PR idempotency checks. Tea's JSON exposes no review counts or response totals. Diff content requires a direct HTTP GET regardless. Open issues for some of these gaps (#403 for non-interactive comments) have been stale for 3+ years, making upstream fixes an unreliable dependency.

**Contribute missing features to `tea` upstream, then wrap** — Viable long-term but blocks gitea-axi's timeline on upstream PR acceptance velocity, which is low.

**Direct Gitea API via `gitea-js`** (chosen) — Typed responses, `X-Total-Count` headers for true pagination totals, head-branch filtering on PR list, review counts, and immediate JSON from create operations. All gaps from the tea approach disappear. Auth still comes from tea's login store via `tea login list --output json`, so the operator's existing `tea` configuration is reused without gitea-axi owning a credential store.

## Consequences

Tea remains a runtime dependency for credential discovery only (`tea login list --output json`).
Operators must have `tea` installed and at least one login configured.
The `TEA_NOT_INSTALLED` error code covers the case where tea is absent.
Tea improvements (especially `--output json` on create commands) should still be contributed upstream as goodwill PRs, decoupled from gitea-axi's development.
