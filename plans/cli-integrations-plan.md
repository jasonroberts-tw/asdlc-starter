# CLI integration adapter

**Written:** 2026-10-11

**The Template maintains one set of harness definitions and renders the CLI integrations selected for a Target project.** This plan governs integration rendering; the Deploy contract in `template-test-plan.md` governs values, the Tracker, commits, and origin.

## Contract

- Keep skills, agent prompts, hook declarations, the Claude instruction entry point, and the worktree briefing under `template/.harness/` as hand-maintained source.
- Render Claude by default; accept an explicit selection of any of `claude`, `codex` and `copilot`. Reject unknown names and an empty selection before writing anything.
- Claude receives `.claude/skills/`, Markdown agents, settings hooks, its worktree briefing, and `CLAUDE.md`.
- Codex receives `.agents/skills/`, `.codex/agents/*.toml`, and `.codex/config.toml`. Shared `AGENTS.md` remains the instruction authority. Use the documented native formats; do not invent a `.codex/skills` discovery location.
- Hook declarations name logical events and scripts. Each adapter maps those events to its CLI's configuration. Report unsupported lifecycle events; never imply that a skipped hook is active.
- Codex invokes the existing worktree provisioning script explicitly. Its patch edit payload must reach the generated-file guard for every affected path.
- GitHub Copilot CLI receives `.github/skills/`, `.github/agents/*.agent.md`, and `.github/hooks/harness.json` in its Claude-compatible `PreToolUse` format. It reads `AGENTS.md` natively. Like Codex, it invokes the worktree provisioning script explicitly. Its edit payloads use Copilot's argument names, and they must reach every edit guard.
- Provide a dependency-free renderer API for Deploy to call, plus `node template/scripts/render-integrations.mjs --integrations claude,codex <target-dir>`. The caller copies common Template files first. The adapter neither creates a Tracker nor commits or pushes.
- Generated paths are recorded in `.harness/integrations.json`. Repeated rendering is deterministic. Updating or deselecting an integration touches only unchanged files recorded as owned; refuse conflicting local files and symlink destinations before any mutation.
- `--check` compares the selected output, including stale owned paths, without writing. Sources remain in the Target project so changes can be rendered again there.

## Implementation and validation

1. Migrate the existing assets without changing their workflow rules, except for explicit CLI substitutions and shared worktree-context loading.
2. Implement logical event mapping and deterministic Markdown, JSON, and TOML output using Node built-ins. Keep each adapter in its own file.
3. Add a safe writer and CLI argument validation, with an in-memory API separate from filesystem mutation.
4. Update guards, source references, worktree tests, and the draft Deploy postconditions for generated integration files.
5. Run the integration selftest through `mise run integrations:selftest`, plus the existing Template gate selftests and policy/citation checks. Test both adapters, both together, unsupported hooks, Codex edit payloads, invalid selections, idempotence, stale output, conflicts, and paths with spaces.

Use the existing ES module style and no new package dependency. Add the Template selftest task to its pre-push jobs and CI. Do not change machine Bootstrap or install a CLI as part of this adapter.

## Official format references

- [Codex skill discovery](https://learn.chatgpt.com/docs/build-skills)
- [Codex custom agent schema](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Codex hook events, matchers, payloads, and trust](https://learn.chatgpt.com/docs/hooks)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Copilot CLI hooks reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference)
- [Copilot custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)

CLI execution and hook trust review are separate from writing their configuration. The automated tests validate native configuration and execute the hook scripts over fixtures without a model credential.
