# `docs/adr/`

**The decisions this repository has made about the Template, one record each, numbered in the
order they were made.** Each record says what was decided, the options it ruled out and what the
decision costs; where a row here and a record disagree, the record wins and the row is corrected.

| Record | What it decides |
|---|---|
| `0001-deploy-creates-tracker-bootstrap-hydrates.md` | Deploy creates a Target's Tracker once; Bootstrap only hydrates it from origin. |
| `0002-admit-installed-skills.md` | An outside skill is admitted only through the `add-skill` skill's three checks and the operator's call on any finding. |
| `0003-scan-secrets-and-dependencies.md` | The Template scans commits for secrets with gitleaks and dependencies for advisories with osv-scanner, at pre-push and in CI. |
