# The Nix wrapper appends `git` and `tea` to PATH rather than prepending them

The Nix-packaged `gitea-axi` binary is wrapped with `makeWrapper --suffix PATH`, not `--prefix`.
The operator's own `git` and `tea` win whenever they are present; the ones from the Nix closure are a fallback that makes the tool work on a machine where neither is installed.

This is the reverse of the usual Nix instinct, which is to pin runtime dependencies so the packaged tool behaves identically everywhere.

## Considered Options

**`--prefix PATH` for both** (rejected) — The hermetic choice: the closure's `git` and `tea` always win, `TEA_NOT_INSTALLED` becomes unreachable, and a half-upgraded system `tea` cannot break gitea-axi.
It fails on `tea` specifically.
Per ADR 0001 as amended, the token comes from `tea login helper get`, which **refreshes near-expiry OAuth tokens in place** — so the invoked `tea` does not merely read `~/.config/tea/config.yml`, it *writes* to it.
Prefixing would put two `tea` versions on one mutable store: the operator's, used interactively for `tea login add`, and the closure's, used for token refresh.
nixpkgs currently carries 0.14.0 while ADR 0001 was verified against 0.14.2, so this is a live version skew, not a hypothetical one.
Divergence in that file surfaces later as an auth failure with no visible connection to its cause.

**`--set PATH`** (rejected) — Fully sealing the environment is defensible in principle, because `src/subprocess.ts` is the single spawn point and invokes only these two binaries, so the surface is small enough to seal.
It inherits every problem above in stronger form, and additionally breaks whatever `git` itself shells out to that is not in the closure: credential helpers, LFS filters, diff and merge drivers, and `ssh` for SSH remotes — which would take `pr checkout` with it.

**`--prefix` for `git`, `--suffix` for `tea`** (rejected) — Puts the hermetic guarantee where state is not shared and defers where it is.
Examined and dropped because the reproducibility it buys on `git` is largely illusory: a pinned `git` still reads the operator's `~/.gitconfig`, so behaviour is not pinned, only the binary is.
Worse, a closure `git` missing an extension the operator relies on can *introduce* the divergence prefixing was meant to prevent.
That leaves a two-rule wrapper paying real explanatory cost for close to nothing.

**`--suffix PATH` for both** (chosen) — One rule, one sentence to explain.
A single `tea` — the one that created the credential store — owns reading and writing it.
The fresh-machine fallback is preserved, so nothing regresses for an operator who has neither binary.

## Consequences

- gitea-axi's behaviour depends on ambient `PATH`, so it is not reproducible across machines in the way a Nix package normally is.
  This is accepted deliberately: the tool's job is to drive *the operator's* repositories using *the operator's* credentials, both of which are ambient state already.
- An operator whose `tea` predates the `login helper` interface hits an obscure failure while a working `tea` sits unused in the closure.
  Judged acceptable — that interface exists in 0.14.0, the oldest version in nixpkgs.
- The closure carries `git` and `tea` that are usually unused. This is the price of the fallback.
- If the `tea` dependency is ever removed (see ADR 0002's retained credential-discovery role), the argument here collapses to the `git`-only case, and prefixing could be reconsidered — though the `~/.gitconfig` objection would still stand.
