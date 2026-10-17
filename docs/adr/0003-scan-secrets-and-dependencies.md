# The Template scans commits with gitleaks and dependencies with osv-scanner

The Template gains two gates, each a pre-push job and a CI step. `secrets:check` runs gitleaks 8.30.1 over commits: at pre-push, the commits on HEAD that no remote-tracking branch holds; in CI, every commit reachable from HEAD. `deps:check` runs osv-scanner 2.6.0 over every tracked lockfile and manifest, against osv.dev: at pre-push when a lockfile changes, and in CI on every pull request and every push to `main`. Both tools are pinned in `template/mise.toml` through mise's aqua backend, and each gate's script header (`template/scripts/check-secrets.mjs`, `template/scripts/check-deps.mjs`) says what it reads and why. Before this, nothing in the harness looked for a committed credential or a dependency with a published advisory, and a Target project on a private GitHub repository gets neither from GitHub without Advanced Security.

## Considered Options

- **GitHub's own secret scanning, push protection and Dependabot alerts.** Rejected: a private repository has none of them without GitHub Advanced Security, and none runs before a push.
- **gitleaks plus `npm audit`.** Rejected: `npm audit` reads only `package-lock.json`, so a Target that adds Python or Go dependencies would get no check. osv-scanner reads the lockfiles of every ecosystem its supported list names, npm's among them.
- **Betterleaks in place of gitleaks.** Not weighed when the operator chose; found during this assessment. It is gitleaks' successor, by the same author: MIT, in mise's registry as `aqua:betterleaks/betterleaks`, 1.9.0 of 2026-09-29, with 2.0.0 in release candidates (rc.2 of 2026-10-07). It is the option to weigh when gitleaks stops shipping security fixes, or once 2.0.0 has been out two weeks.
- **Neither.** Rejected: a credential pushed to origin stays readable in every clone and has to be revoked, and a vulnerable dependency merges with nothing to say so.

## Consequences

- gitleaks' rules no longer grow. Its README says it is feature complete and that future releases are security patches only, so a token format a provider introduces later goes unflagged until the pin moves to a successor.
- A push that changes a lockfile fails on a machine with no network, because osv.dev is unreachable and the gate reads that as a failure, never a skip.
- A new advisory against a lockfile nobody changed fails the next pull request's CI, whoever opened it.
- The pre-push secrets job reads HEAD, because the hook runner gives a job no standard input and so no push line. A push of another ref is read by CI alone.
- CI reads every commit reachable from HEAD, so a secret already on `main` fails every pull request until its fingerprint is in `.gitleaksignore` or the history is rewritten and the secret revoked.
- The Template's `package-lock.json` moved `qs` from 6.15.1 to 6.16.0, through `typed-rest-client` 2.3.0, to clear three advisories (E2). `@stryker-mutator/core` 10.0.0 still asks for `typed-rest-client ~2.3.0`, whose 2.3.1 pins `qs` 6.15.1 exactly, so an `npm update` that moves it to 2.3.1 brings the advisories back, and the dependency gate refuses that lockfile.
- `deps:selftest` takes about 20 s, about 17 s of it osv-scanner's four attempts against a proxy that refuses every connection (E4).
- A pin moves with `gh release list -R gitleaks/gitleaks` and `gh release list -R google/osv-scanner`, taking the newest release at least two weeks old, then the lock commands `template/mise.toml`'s header gives.

## Assessment

The questions of the Template's `should-i-adopt` skill, each answered with its severity: **blocks**, **costs** or **none**.

1. **Where its instructions live.** Neither tool ships a prompt or a skill. Each gate's rules are its script header and its `tasks.toml` description. None.
2. **What files it adds.** Two hand-maintained scripts. A Target may add `.gitleaks.toml`, `.gitleaksignore` or `osv-scanner.toml` by hand; neither tool writes one. None.
3. **What it reads, which decides its tier.** gitleaks reads commits only, so it is a pre-push job and a CI step: 0.49 s over the 35 commits reachable from this repository's HEAD. osv-scanner reads tracked lockfiles and osv.dev: 0.82 s for the Template's 223 packages. Costs: the network at pre-push, scoped to a push that changes a lockfile.
4. **What it writes outside its own files.** Neither, online. osv-scanner's offline mode creates a database directory under the user cache directory, and only the selftest runs offline, against a directory it makes under the temporary directory. None.
5. **How it behaves in a linked worktree.** osv-scanner's walk applies every `.gitignore` from `/` down, so in a worktree under `.claude/worktrees/`, which the Template's `.gitignore` lists, `-r` finds no package source and exits 128 (E3). Blocks as osv-scanner documents its use; the gate names each tracked file instead. gitleaks runs `git -C <root>`, which a hook's `GIT_DIR` outranks, so the gate drops every `GIT_*` key. Costs.
6. **What it does to output an agent reads.** The gates print one line per finding and one line on a pass, not osv-scanner's table or gitleaks' log, and a secret's text never. None.
7. **The commands a session would run.** `mise run secrets:check` and `mise run deps:check`. No trial checked whether `scripts/hooks/guard-git.mjs` allows them: the guard matches git subcommands, and neither command is one, but this session's own worktree isolation refused the trial command. Unverified.
8. **Dependencies and platforms.** Two Go binaries from each project's GitHub releases, locked for Linux x64 and arm64, macOS x64 and arm64, and Windows x64, each asset's checksum matching the project's own checksum file. No npm package. Neither lock entry records a provenance attestation, as `gh`'s does. None.
9. **Cost.** No money and no tokens. CI gains four steps, about 28 s in all on the maintainer's laptop, 20.5 s of it `deps:selftest`. No prompt gains a word. None.
10. **Health.** gitleaks: MIT; 8.30.1 of 2026-03-21 is the newest release; feature complete, security patches only; since 2026-05-30 its commits are a bot's dependency updates and their merges. osv-scanner: Apache-2.0, maintained at Google, a release most months (2.3.0 of 2025-11-19 through 2.7.0 of 2026-10-12); 2.6.0 of 2026-09-14 is the newest at least two weeks old. Costs, for gitleaks.
11. **Reversal.** Delete the two pins, two scripts, four tasks, four pre-push jobs and four CI steps. Each machine keeps the installs in mise's cache until `mise prune`. None.

## Evidence

Each trial ran on the maintainer's macOS arm64 laptop on 2026-10-16, through mise 2026.10.6's pinned installs. The skill asks for trials in a container; this session ran in a linked worktree, where its isolation refuses a container command that runs git, so no Linux trial ran here. The Template test runs every CI step in Linux.

- **E1.** `gitleaks dir` over this repository's tree, 970 KB: no leaks. Its history, `git log -p -U0 --all --full-history` into `gitleaks stdin`, 2.62 MB: no leaks. So no `.gitleaks.toml` allowlist is needed. (The session's isolation refused `gitleaks git`, so the history went through standard input.)
- **E2.** osv-scanner over `template/package-lock.json`: 223 packages; `qs` 6.15.1 (dev) with GHSA-4mjr-xmp4-gh2g, GHSA-q8mj-m7cp-5q26 and GHSA-x5fp-wj9c-mxmx, fixed in 6.15.2 and 6.16.0. After `npm audit fix --package-lock-only --before=2026-10-02`: "No issues found". osv.dev's query API returns no advisory for `qs` 6.16.0.
- **E3.** `osv-scanner -r template/` in this linked worktree: "No package sources found", exit 128. The same in the primary checkout: 223 packages. In the worktree with `--no-ignore`, or with the lockfile named: 223 packages. The cause is in osv-scalibr's walker: `extractor/filesystem/filesystem.go` calls `ParseParentGitignores` from the walk's root, `/`.
- **E4.** osv-scanner with `HTTPS_PROXY` at a closed loopback port: exit 127 after 16.9 s, "max retries exceeded: attempt 4", with an empty JSON report on standard output.
- **E5.** osv-scanner 2.6.0 reads its offline database from `<dir>/osv-scalibr/<ecosystem>/all.zip` (osv-scalibr `enricher/vulnmatch/osvlocal/matcher.go`, `setupLocalDBDirectory`). Its `docs/offline-mode.md` at v2.6.0 names `osv-scanner/`; a database there was not found.
- **E6.** `secrets:selftest` holds 7 of 7 cases and `deps:selftest` 9 of 9. Each ran again over a copy of its gate with one thing broken, eight copies in all, and failed on seven. The one it passed dropped `--redact`, which changes no output, because the gate never prints a secret's text.

Sources, read on 2026-10-16:

- gitleaks: <https://github.com/gitleaks/gitleaks> (README, licence, commits) and <https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1>; the aqua registry's `pkgs/gitleaks/gitleaks/registry.yaml` (<https://github.com/aquaproj/aqua-registry>), which `mise registry gitleaks` names first as `aqua:gitleaks/gitleaks`.
- osv-scanner: <https://github.com/google/osv-scanner> (licence, contributors), <https://github.com/google/osv-scanner/releases/tag/v2.6.0> and `releases/tag/v2.7.0`; its `docs/supported_languages_and_lockfiles.md` and `docs/offline-mode.md` at v2.6.0; the aqua registry's `pkgs/google/osv-scanner/registry.yaml`, which `mise registry osv-scanner` names as `aqua:google/osv-scanner`.
- Betterleaks: <https://github.com/betterleaks/betterleaks> (README, licence, releases); `mise registry betterleaks`.
- `qs` and `typed-rest-client` release dates and dependency ranges: `npm view` against registry.npmjs.org; advisories: <https://api.osv.dev/v1/query>.
