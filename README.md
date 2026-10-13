# ASDLC Starter

The Template keeps shared skills, agent prompts, and hook declarations in
[template/.harness](template/.harness/README.md). CLI adapters render the integrations selected for
a Target project.

Deploy the Template, substitute project values, create its Tracker, and publish its initial commit
to an empty origin:

```sh
node scripts/deploy.mjs --values values.json ../target-project
```

To have an agent walk you through it, including the GitHub repository and App, point it at
[INSTALL.md](INSTALL.md).

The Target must be an empty git repository with an empty `origin`. Deploy needs Node, git, a git
identity, and the Template's pinned bd. It installs no npm packages. Add
`--integrations codex` or `--integrations claude,codex` to select the integrations; Claude is the
default. See [Deploy's contract](plans/template-test-plan.md#what-the-template-test-requires-of-deploy)
for the values file and [implementation notes](plans/deploy-plan.md) for failure handling.

Run the complete container test or its credential-free negative controls with PowerShell:

```powershell
pwsh -NoProfile -File tests/template/run.ps1
pwsh -NoProfile -File tests/template/run.ps1 -Selftest
```

The test builds the Template image, deploys to Alice, clones into Bob, runs Bootstrap, CI gates and
guard probes, then runs the Canary and issue-to-merge workflow when a model credential is set.
Without one, the summary explicitly skips both agent steps. Use `-RequireAgent` for a run that must
include them. [Test instructions](tests/template/README.md) cover credentials, limits, `-Ref`,
`-NoCache`, and saved artifacts. [The test plan](plans/template-test-plan.md) defines acceptance.

To render integrations for an existing project that already has the common Template files:

```sh
node template/scripts/render-integrations.mjs --integrations claude ../target-project
node template/scripts/render-integrations.mjs --integrations codex ../target-project
node template/scripts/render-integrations.mjs --integrations claude,codex ../target-project
```

Choose one command. Claude is the default when `--integrations` is omitted. The Target directory
must already exist. The renderer writes integration files and an ownership manifest, preserves
conflicting local files, and supports `--check` with the same selection to verify output without
writing. From a deployed Target project, invoke `node scripts/render-integrations.mjs` instead.

Codex uses `.codex/` for configuration and agents, and `.agents/skills/` for skill discovery.
Its unsupported worktree lifecycle hooks are reported explicitly; its workflows use the shared
worktree script. See the [source and format guide](template/.harness/README.md) for details.

Run the adapter tests with `mise run integrations:selftest` from `template/`, after installing the
Template's npm dependencies and trusting its mise configuration.
