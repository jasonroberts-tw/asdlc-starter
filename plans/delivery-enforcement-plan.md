# Mechanical enforcement for the delivery workflow: a plan

**Written:** 2026-10-16

**Status:** Built on 2026-10-16 by commits 2ab69f8, a323f95, da3958e and 6a0adf6 (the delivery hook
and the trace check), ea27d6c (the doctor's probe) and c3a27e5 (the scanners). On 2026-10-17 the secrets gate moved
to Betterleaks (`docs/adr/0004-scan-secrets-with-betterleaks.md`). § What was built
says what each row became, and what is still open.

**The delivery workflow (`template/AGENTS.md` § Delivery workflow and the skills it names) shipped as
prompts and policy only. This plan holds the checks that would enforce its invariants, which the
workflow rules leave to hooks and CI. The rules hold whether or not each check is in place.**

Each check lands under `template/AGENTS.md` § Standing rules for prompts and gates: a header, a
selftest, and a root override. A check that adopts an outside tool goes through the `should-i-adopt`
skill first.

| Invariant | Suggested mechanism | Open question |
|---|---|---|
| No implementation code for a feature before Gate 2 | The operator records approval somewhere the agent can't write. A pre-tool-use hook blocks writes outside spec and test paths for any feature without that approval. | Where an approval lives that an agent cannot write: a protected branch's spec `**Status:**` line, a GitHub review, or a signed tag |
| Protected tests are not modified without operator approval | Record protected test paths when they are committed. A hook blocks edits to them during Do. Review diffs them against the commit that protected them. | Today the protecting commit is a `bd note` on the issue; a hook needs a machine-readable record |
| Nothing reaches `main` without review acceptance and green CI | Branch protection that requires passing CI and an operator approval | Story pull requests auto-merge after `verify` and the pull-request reviewer pass, so the operator's acceptance is per feature, after the merge |
| CI runs secret scanning and dependency vulnerability checks | Jobs in `.github/workflows/verify.yml` | Which scanners; each is a `should-i-adopt` run |
| Module dependencies are acyclic, where the stack supports checking it | A stack-specific dependency-check tool, run in CI | The Template has no product stack, so a Target's walking skeleton adds it |
| Traceability is complete before Review starts | A script that matches criterion IDs in the spec to stories in beads, and to test names, tags or manual-verify items | The spec's criterion ID format must be fixed for a script to parse it |

## What was built

The operator answered the open questions on 2026-10-16, each with the recommended option.

| Invariant | What enforces it now | What is still open |
|---|---|---|
| No implementation code before Gate 2 | `scripts/hooks/guard-delivery.mjs` refuses writes outside `beforeApprovalPaths` on a feature's branch, and on a story's branch until `<specDirectory>/<feature id>.md` on `origin/main` says `Design approved` | The hook finds the issue from the worktree name, so a `fan-out-work` lane, whose name the Agent tool generates, and a `refine` session, which files its feature after making its worktree, go unchecked |
| Protected tests are not modified without operator approval | The same hook refuses an edit to a test `protectedTestsFile` lists as HEAD has it, and an edit that drops a line. `spec-reviewer` diffs each test against the commit that listed it | An edit through the shell gets past the hook, and only the review sees it |
| Nothing reaches `main` without review acceptance and green CI | The doctor warns when no ruleset or branch protection on `main` requires the `gates` check and one approving review, and `INSTALL.md` § 8 says how to set one | The repository's "Allow auto-merge" setting, which `open-pr` needs, is not probed. Whether GitHub counts an author's approval of their own pull request is unverified |
| CI runs secret scanning and dependency vulnerability checks | `secrets:check` (Betterleaks) and `deps:check` (osv-scanner), at pre-push and in `verify.yml`, each with a selftest; `docs/adr/0003-scan-secrets-and-dependencies.md` records the adoption | No pre-commit secrets job, and no scheduled run for new advisories on an unchanged `main` |
| Module dependencies are acyclic | The `plan-stories` skill's walking skeleton adds the stack's module-dependency check to the gates | Nothing checks that the skeleton did |
| Traceability is complete before Review starts | `scripts/check-trace.mjs <feature id>` reads criterion IDs of the form `AC-<code>-<n>`. `plan-stories` runs it with `--plan` after filing, and `spec-reviewer` runs it at Review | A test that names an ID only counts as covering it; the check does not run the test |
