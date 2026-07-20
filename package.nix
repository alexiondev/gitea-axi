{
  lib,
  buildNpmPackage,
  importNpmLock,
  makeWrapper,
  nodejs,
  git,
  tea,
  which,
}:

let
  # The manifest is the canonical version: the release flow bumps it, and
  # reading it here means a store path and a released version cannot disagree.
  manifest = lib.importJSON ./package.json;

  # An explicit allowlist of what the build and its tests actually read. The
  # repository's highest-churn directories — .claude, bench, prose docs — are
  # all build-irrelevant, so a whole-repository source would let writing an ADR
  # invalidate the derivation and force a rebuild with a full test run.
  #
  # Adding a build-relevant top-level file means adding it here too; the build
  # otherwise fails on a missing file.
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
      ./src
      # The fast tier only. `test/e2e` needs a live Gitea host and is excluded
      # from the runner config, so admitting it would let end-to-end churn
      # invalidate the derivation — the very cost this allowlist exists to
      # avoid. `test/packaging` stays: task 0038 drives it against the
      # installed binary.
      (lib.fileset.difference ./test ./test/e2e)
      ./skills
      ./package.json
      ./package-lock.json
      ./tsconfig.json
      ./tsconfig.build.json
      ./vitest.config.ts
    ];
  };
in
buildNpmPackage {
  pname = "gitea-axi";
  inherit (manifest) version;
  inherit src nodejs;

  # Each dependency's fetch is derived from the integrity fields already in the
  # lockfile, so a lockfile change needs no edit here. A single fixed-output
  # hash would break on every dependency bump and be repaired by copying a hash
  # out of an error message — a permanent recurring tax.
  npmDeps = importNpmLock { npmRoot = src; };
  inherit (importNpmLock) npmConfigHook;

  nativeBuildInputs = [ makeWrapper ];

  # The builder would otherwise unpack to a generic `source` directory, which no
  # real installation resembles: under npm the tree lives at
  # `node_modules/gitea-axi`, under Nix at `…-gitea-axi-<version>/…`. The fast
  # tier's `setup hooks` test is sensitive to the difference, because the SDK
  # records the entrypoint's absolute path and recognises its own managed hook by
  # finding "gitea-axi" within it. Naming the tree makes the build representative
  # rather than an environment no operator ever has.
  #
  # This coupling is a defect, not a property worth preserving — see task 0042,
  # which removes the hook's dependence on the entrypoint path entirely. Once it
  # lands this rename should go with it.
  postUnpack = ''
    mv "$sourceRoot" gitea-axi
    export sourceRoot=gitea-axi
  '';

  # The fast tier only. The live end-to-end and benchmark smoke tiers need a
  # live Gitea host. Two of these test files invoke `git` directly and one
  # resolves it with `which`; `tea` is already stubbed within this tier.
  doCheck = true;
  nativeCheckInputs = [
    git
    which
  ];

  # `buildNpmPackage` wires config, build and install hooks but no check hook, so
  # `doCheck` alone is inert and the phase has to be spelled out. `git init` and
  # `git commit` in the fast tier also need a writable HOME, which the sandbox
  # otherwise points at a non-existent directory.
  checkPhase = ''
    runHook preCheck

    export HOME=$(mktemp -d)
    npm run test

    runHook postCheck
  '';

  # ADR 0018: append, never prepend. The operator's own `tea` owns the
  # credential store it refreshes in place, so the closure's copy is a
  # fresh-machine fallback rather than an override.
  postInstall = ''
    wrapProgram $out/bin/gitea-axi \
      --suffix PATH : ${lib.makeBinPath [ git tea ]}
  '';

  meta = {
    inherit (manifest) description homepage;

    # Looked up by SPDX identifier rather than hardcoded, for the same reason
    # the version is read from the manifest: one canonical source, no second
    # place to update on a relicence.
    license = lib.licensesSpdx.${manifest.license};

    mainProgram = "gitea-axi";

    # Broader than the flake's `systems` list, deliberately. This describes what
    # the package supports — everything, since it contains no compiled code —
    # whereas that list encodes which systems the pinned nixpkgs can still
    # evaluate. Consumed against 26.05, x86_64-darwin builds fine from here.
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}
