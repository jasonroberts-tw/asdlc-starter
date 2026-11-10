# `docs/adr/`

**The decisions this repository has made about the Template, one record each, numbered in the
order they were made.** Each record says what was decided, the options it ruled out and what the
decision costs; where a row here and a record disagree, the record wins and the row is corrected.

| Record | What it decides |
|---|---|
| `0001-deploy-creates-tracker-bootstrap-hydrates.md` | Deploy creates a Target's Tracker once; Bootstrap only hydrates it from origin. |
| `0002-admit-installed-skills.md` | An outside skill is admitted only through the `add-skill` skill's three checks and the operator's call on any finding. |
| `0003-scan-secrets-and-dependencies.md` | The Template scans commits for secrets with gitleaks and dependencies for advisories with osv-scanner, at pre-push and in CI. |
| `0004-scan-secrets-with-betterleaks.md` | The secrets gate runs Betterleaks, gitleaks' successor, in place of gitleaks. |
| `0005-git-holds-an-agents-worktree.md` | The worktree script adds each worktree locked and sets the App's bot account as its commit identity, so git holds what the git guard parsed for. |
| `0006-the-guards-stop-a-slip.md` | The in-session guards stop a slip, not an intent, and a form a guard would miss that only a way past it would write takes priority 3, not 1. |
| `0007-a-test-is-protected-from-its-merge.md` | A listed test is protected once its listing commit is on `origin/main`, and no selftest of the harness is listed. |
| `0008-claude-code-makes-its-own-worktrees.md` | Claude Code makes and removes its own worktrees, the worktree script serves the other CLIs, and one setup script is every worktree's first command. |
