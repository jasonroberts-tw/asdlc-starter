# ASDLC Starter

The Template keeps shared skills, agent prompts, and hook declarations in
[template/.harness](template/.harness/README.md). CLI adapters render the integrations selected for
a Target project.

After copying the common Template files into a Target project, render Claude, Codex, or both:

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

The integration renderer is implemented. Deploy's values substitution, Tracker creation, initial
commit, and push remain the [draft Deploy contract](plans/template-test-plan.md).

Run the adapter tests with `mise run integrations:selftest` from `template/`, after installing the
Template's npm dependencies and trusting its mise configuration.
