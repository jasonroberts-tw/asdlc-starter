# Outside skills are admitted, behind an assessment and an audit

The Template lets a Target project load skills it did not write: Claude Code plugins, and skills the `skills` CLI installs, each named in `policy/skill-sources.json`. A skill joins `installedSkills` only through the `add-skill` skill, which runs three checks on it at a pinned commit (the command guards over its code blocks, the read-only `skill-assessor` agent against the Target's rules, and the skills.sh audit), and a finding from any of them waits for the operator to accept, reject or reconcile it. This departs from the Template's own rule that every rule an agent follows lives in a tracked file (`template/AGENTS.md` § Rules for agents live in tracked files, and nowhere else), which names the exception. We take it because good skills are published outside, and the only way to use one without the exception is to vendor and keep up an adapted copy by hand.

## Considered Options

- **No outside skills; vendor an adapted copy under `.harness/skills/`.** Kept as one of the operator's choices on a finding (reconcile), not the only route: every copy is upkeep a Target pays for as long as it keeps up with upstream.
- **Admit on the skills.sh audit alone.** Rejected: the audit names no commit, a skill nobody installed with telemetry on has none, and it looks for security issues, not for text that contradicts the Target's rules.
- **Assess at every sync.** Rejected: a model judges the same text differently from run to run, so machines would disagree about one commit, and every container start would need a model key. The pin fixes the text, so one assessment covers every machine; the audit, which can change while the pin stands still, is re-read at each sync.

## Consequences

- An admitted skill loads word for word on every machine, and nobody in the Target can edit it, so a conflict the assessment misses reaches every session until the pin moves or the row goes.
- A rule added to `AGENTS.md` after an admission only draws a warning at each sync until someone re-runs the assessment.
- A sync removes a skill whose audit worsens to `fail`, HIGH or CRITICAL, so a scanner's false positive takes a good skill off every machine until the operator accepts the new result.
- The `skills` CLI is a dev dependency of the Template, pinned exactly, run with telemetry off and no GitHub token.
- Each admission and removal waits for a person's merge. The Template ships no protected-path config, so a Target gets that only from its own branch protection.
