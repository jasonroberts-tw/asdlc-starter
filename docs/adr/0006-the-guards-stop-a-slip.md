# The guards stop a slip, not an intent

The Template now says what its in-session guards are for: they stop a command or an edit that a session makes by mistake. They do not stop a session that is set on an effect, because that session has the shell. `template/scripts/hooks/guard-git.mjs` says so in its header, and `template/AGENTS.md` § Guards says so to every session. The priority rows follow. Priority 1 is a safeguard that fails silently on work done as the prompts ask. A form of a command that a guard would miss, and that a session would write only to get past the guard, takes priority 3. The operator approved this on 2026-11-10.

Before this, nothing stated the guards' purpose, and two sentences read as absolute. The git guard's header said "A guard that allows the command when it cannot read the payload is not a guard". The priority 1 row said "a gate or a guard passes or skips what it should refuse". In the Target `spec-storming`, reviewers and probes then filed each form the git guard missed at priority 1, and each sweep worked those issues before the planned work. The guard grew from 910 lines to 1,348 on that Target's `main`, and to 1,736 on a sweep that never merged.

A guard that reads command text cannot be finished. The effect of a command is decided after the hook has read it, by a variable, an alias, a script written one call earlier, or a writer that runs no git at all.

## Considered Options

- **Keep the absolute wording and keep parsing.** Rejected: the 20 open issues below show the queue it makes, and no parser closes the shell.
- **An allowlist of git verbs.** Rejected: a legitimate `git cherry-pick` would be refused, and each such refusal stops a session for the operator.
- **A `git` wrapper first on PATH.** Rejected: `/usr/bin/git` skips it.
- **Remote rules only.** Rejected: a Target with no ruleset, or with an origin that is not GitHub, would take a push to `main`.

## Consequences

- A miss that a session could reach by a slip nobody has made yet waits at priority 3. One example is a launcher before a refused command, such as `timeout 60 git push origin main`, on a Target with no ruleset.
- A session files such a form once and does not probe a guard for more, unless the operator asks for that review.
- What must hold against any spelling moves into git itself. `0005-git-holds-an-agents-worktree.md` did that for a worktree's removal and its commit identity. A hook on ref writes is the next step, for writes to `main`.
- The guard still fails closed when it cannot read its payload, in a linked worktree.

## Evidence

- **E1.** The Target's Tracker, exported on 2026-11-09, held 83 issues. 28 named the git guard, and 20 of those were not closed. 17 of the 20 were at priority 1.
- **E2.** A review of those 20 on 2026-11-09 found that none came from a session that had run the command. It judged 8 to be forms a session could type by accident, and 12 to be forms only a search for a way past would write.
- **E3.** The incidents the guard's own header records from real runs are a guard that judged the wrong directory (2026-09-25), a prune that a hook ran (2026-10-06) and a merge after a `cd` (2026-10-17). None was a spelling chosen to get past the guard.
