/** GitHub Copilot CLI's native skills, agents, and command hooks; prevents Claude-shaped inert config.
 * Called by renderIntegrations. Formats follow the official references in .harness/README.md.
 * Needs no CLI or network. Worktree lifecycle events are explicitly reported as unsupported.
 */
import { generatedMarkdown, json } from './formats.mjs'

// PascalCase `PreToolUse` selects Claude's payload and matcher names. Copilot maps its own tools to
// them: bash and powershell to Bash, create to Write, edit and apply_patch to Edit.
const matchers = {
  'before-command': 'Bash',
  'before-edit': 'Write|Edit',
}

export const copilot = {
  id: 'copilot',
  outputPaths: ['.github/skills/', '.github/agents/', '.github/hooks/harness.json'],
  // Copilot also reads .claude/skills and .agents/skills, but .github/skills wins a name both hold
  // (`copilot skill list`, 1.0.94), so Copilot gets its own substitutions beside another CLI's.
  skillDirectory: '.github/skills',
  entryPoints: {},
  replacements: {
    CLI_WORKTREE_CREATE: 'HARNESS_CLI=copilot bash "$(git rev-parse --show-toplevel)/scripts/new-worktree.sh" <task-ref> <slug>',
    CLI_WORKTREE_REMOVE: 'end the worktree session, then run `git worktree remove <path>` from the primary checkout',
    CLI_WORKTREE_ISOLATION: '',
  },
  agent(agent, source, file) {
    return ['.github/agents/' + agent.name + '.agent.md', generatedMarkdown(source, file)]
  },
  hooks(groups) {
    const PreToolUse = []
    const warnings = []
    for (const group of groups) {
      const matcher = matchers[group.event]
      if (!matcher) {
        warnings.push('copilot: unsupported ' + group.event + ' hook; provision with scripts/new-worktree.sh and remove worktrees explicitly after work finishes.')
        continue
      }
      // Copilot shows no status message for a command hook, so statusMessage has no field here.
      for (const { script, timeout } of group.handlers) {
        PreToolUse.push({ type: 'command', matcher, command: 'node "$(git rev-parse --show-toplevel)/' + script + '"', timeoutSec: timeout })
      }
    }
    return { file: '.github/hooks/harness.json', contents: json({ version: 1, hooks: { PreToolUse } }), warnings }
  },
}
