# Mechanical enforcement for the delivery workflow: a plan

**Written:** 2026-10-16

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
