# The secrets gate runs Betterleaks in place of gitleaks

`secrets:check` runs Betterleaks 1.9.0 where it ran gitleaks 8.30.1, which `0003-scan-secrets-and-dependencies.md` chose on 2026-10-16. Everything else 0003 decided stands: the gate's scopes, its tiers, its selftest and the dependency gate. gitleaks' README says it is feature complete and ships security fixes only, so its rules stop growing, and a token format a provider introduces later goes unflagged. Betterleaks is its successor, maintained by gitleaks' original author, and its rules still grow. The operator chose the swap on 2026-10-17.

## Considered Options

- **Stay on gitleaks 8.30.1.** Rejected: a frozen rule set misses every new token format.
- **Betterleaks 2.0.0.** Rejected for now: it exists only as release candidates (rc.2 of 2026-10-07), and the pin rule takes the newest release at least two weeks old. A major version may change the flags or the report the gate reads, so its pin moves only after the selftest passes against it.

## Consequences

- The gate changed its binary name and nothing else, because Betterleaks 1.9.0 takes gitleaks' flags and writes the same JSON report (E1).
- A Target that already has `.gitleaks.toml` or `.gitleaksignore` keeps them, because Betterleaks reads both names beside its own `.betterleaks.toml` and `.betterleaksignore` (E1).
- Betterleaks can send a finding to its provider's API to check whether the credential is live. The gate leaves that off, because `--validation` is off unless passed, so the gate needs no network.
- The lock now records a cosign provenance for each Betterleaks asset, where gitleaks' entries recorded none.
- A pin moves with `gh release list -R betterleaks/betterleaks`, taking the newest release at least two weeks old, then the lock commands `template/mise.toml`'s header gives.

## Evidence

Each trial ran on the maintainer's macOS arm64 laptop on 2026-10-17, through mise 2026.10.6's pinned install of Betterleaks 1.9.0.

- **E1.** `betterleaks git --help` names `--log-opts`, `--no-banner`, `--redact`, `--report-format` and `--report-path`, and it lists `.betterleaks.toml` or `.gitleaks.toml` for the config and `.betterleaksignore` or `.gitleaksignore` for the ignore file. Over a scratch repository with the selftest's token, it exited 1 and reported `RuleID`, `File`, `StartLine`, `Commit` and `Fingerprint` (`<commit>:token.txt:github-pat:1`), as gitleaks did. With a broken `.gitleaks.toml`, it exited 1 with nothing on standard output.
- **E2.** `secrets:selftest` holds 7 of 7 cases, and `secrets:check` passes over this repository's 45 commits.

Sources, read on 2026-10-17: <https://github.com/betterleaks/betterleaks> (README, and `docs/scanning.md` and `docs/config.md` at v1.9.0); `gh release list -R betterleaks/betterleaks`; `mise registry betterleaks`, which names `aqua:betterleaks/betterleaks` first.
