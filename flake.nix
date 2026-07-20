{
  description = "Agent-ergonomic CLI for Gitea issues and pull requests";

  # Tracks unstable to match the maintainer's system. Consumers deduplicate by
  # pointing this input at their own nixpkgs, so it governs standalone builds
  # only — never the deployed artifact.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      # x86_64-darwin is deliberately absent: nixpkgs 26.11 dropped it, and
      # `legacyPackages.x86_64-darwin` now throws rather than merely failing to
      # build — so listing it would break `nix flake show` and `nix flake check`
      # for every system, not just that one. Intel macOS needs the 26.05 branch.
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      # Hands each output both the package set and the system name — the latter
      # because the shell and the checks reach back into `self.packages` for the
      # system being evaluated, and `pkgs.system` is discouraged in favour of a
      # considerably wordier spelling.
      forAllSystems =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f {
            inherit system;
            pkgs = nixpkgs.legacyPackages.${system};
          }
        );
    in
    {
      packages = forAllSystems (
        { pkgs, ... }: rec {
          gitea-axi = pkgs.callPackage ./package.nix { };
          default = gitea-axi;
        }
      );

      # The toolchain the repository actually needs: the build and the fast tier
      # want Node, the live end-to-end tier and the benchmark harness additionally
      # shell out to `git`, `tea`, and `curl` — none of which the repository
      # specifies anywhere else.
      #
      # Not `gitea-axi` itself, which the benchmark's own arm resolves by name off
      # PATH: that has to be the locally built `dist/main.js`, so that a bench run
      # measures the working tree rather than whatever the flake last packaged.
      # Supplying it here would silently substitute the wrong binary.
      devShells = forAllSystems (
        { pkgs, system }: {
          default = pkgs.mkShell {
            packages = [
              # The package's own Node, taken from its passthru rather than named
              # a second time here. There is one reference, so development and
              # the shipped artifact cannot drift onto different majors — and
              # they cannot be set independently even by mistake.
              self.packages.${system}.gitea-axi.nodejs
              pkgs.git
              pkgs.tea
              # The benchmark's raw-api arm shells out to curl.
              pkgs.curl
            ];
          };
        }
      );

      # An alias for the package, so `nix flake check` builds it and thereby runs
      # both its verification phases — the fast tier in `checkPhase`, the
      # installed-binary tier in `installCheckPhase`.
      #
      # No granular per-stage checks: the one stage that would add coverage the
      # package build does not already have is the full typecheck, which spans
      # `test/` and `bench/` and would therefore drag the benchmark harness into
      # the derivation's inputs — undoing the source filtering that keeps
      # benchmark churn from forcing a rebuild. That typecheck stays in
      # continuous integration, where it already runs.
      checks = forAllSystems ({ system, ... }: { inherit (self.packages.${system}) gitea-axi; });
    };
}
