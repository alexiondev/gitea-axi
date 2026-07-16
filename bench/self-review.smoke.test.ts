import { describe, expect, it } from "vitest";
import type { CliDeps } from "../src/deps.js";
import { resolveBenchAccess, type BenchAccess } from "./seed.js";
import { detectSelfReviewSupport } from "./self-review.js";

/**
 * The self-review probe smoke tier: a single live validation that the capability
 * probe runs end-to-end against a real host — provisioning a throwaway
 * repository, seeding it, checking whether the authenticated user may approve
 * their own pull request, and cleaning the repository up — and reaches a definite
 * boolean verdict without throwing. The benchmark-harness spec designates the
 * self-review probe, like seed provisioning, as validated by a smoke run against
 * a real host rather than by mocks, since its value is the real API interaction.
 * Like the seed smoke tier, this suite skips cleanly when GITEA_AXI_BENCH_LOGIN
 * is unset, which counts as a pass.
 *
 * The verdict itself is host-configuration-dependent — some hosts forbid a user
 * from approving their own pull request, some permit it — so the assertion is
 * only that a definite boolean is reached, never which value it is.
 */
const login = process.env.GITEA_AXI_BENCH_LOGIN;

describe.skipIf(!login)("self-review smoke: capability probe", () => {
  it(
    "runs the self-review probe against the live host and returns a definite boolean verdict",
    async () => {
      const deps: CliDeps = {
        env: process.env,
        cwd: process.cwd(),
        globals: { login },
      };
      const access: BenchAccess = await resolveBenchAccess(deps, login!);

      const result = await detectSelfReviewSupport(access);

      expect(typeof result).toBe("boolean");
    },
    180_000,
  );
});
