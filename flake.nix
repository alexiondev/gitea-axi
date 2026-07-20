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

      forAllSystems =
        f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: rec {
        gitea-axi = pkgs.callPackage ./package.nix { };
        default = gitea-axi;
      });
    };
}
