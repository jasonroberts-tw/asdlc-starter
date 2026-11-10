# Git itself holds an agent's worktree, and names its commits

`template/scripts/new-worktree.sh` adds every worktree locked, and sets the GitHub App's bot account as that worktree's commit identity. Both are settings git enforces by itself. Before this, both jobs belonged to `guard-git.mjs`, a hook that reads the text of a shell command. A text guard holds only the commands a session types, in the spellings the guard knows. A lock and a config value hold whoever runs git and however the command is spelt. The operator approved this on 2026-11-10, as the first of the steps that move the git guard's rules into git.

Two incidents are behind it:

- On 2026-10-06 a `git worktree prune` run in a dev container took the record of every worktree made on the host. A hook ran it, so no command guard saw it.
- In the Target `spec-storming`, a pull request opened on 2026-11-07 carried three agent commits authored as the operator, because a session on a host commits under the operator's git config. Sessions there then wrote a guard rule that reads each `git commit` for its author, which never merged. That rule's own header lists the forms it misses: a plain `git rebase`, a commit on a detached HEAD, a git alias.

## Considered Options

- **Keep both rules in the text guard.** Rejected: the guard cannot be finished. In `spec-storming`, 20 open issues each named a spelling the guard missed, and none came from a session that ran the command.
- **Set the identity with `includeIf "onbranch:agent/**"` in the shared config.** Rejected: HEAD is detached during a rebase, so the condition fails there and each replayed commit takes the operator as its committer. The briefing tells every agent to rebase.
- **Set the identity with `includeIf "gitdir:"` for every linked worktree.** Rejected: a worktree a person made by hand for their own work would commit as the bot too.
- **Set the identity through each CLI's environment settings.** Not chosen now. It keys the identity on who runs git, which is the better key. Each of the four CLIs sets a session's environment in a different place, and only Claude Code's was checked.
- **A script that removes a worktree.** Rejected: unlock and remove are two plain git commands, so the prompts name them.

## Consequences

- `git worktree remove` refuses an agent's worktree until `git worktree unlock` has run. The removal text of the Codex, Copilot and OpenCode adapters names both commands, and the Claude Code remove hook unlocks first.
- `git worktree prune` keeps the record of a locked worktree whose directory git cannot see. That is the shape a host worktree has in a dev container.
- A session that ends without removing its worktree leaves the lock. Nothing clears it but `git worktree unlock`.
- The identity needs `extensions.worktreeConfig` in the shared `.git/config`. The script turns it on the first time, which is the one shared config write it makes. It leaves a repository alone that holds `core.worktree`, or is bare, because git reads those two keys differently once the extension is on. It then warns, and the worktree keeps the operator's identity.
- A project Deployed with no App keeps the operator's identity in every worktree.
- An operator who signs commits signs an agent's commits with a key the bot's address does not own, so GitHub shows those commits as unverified.
- A person who commits by hand inside an agent's worktree commits as the bot, unless they name themselves with `git -c user.name=... -c user.email=...`.
- The identity is a default, not a refusal. A session that sets another identity on its command line still commits under it.

## Evidence

Each trial ran on the maintainer's macOS arm64 laptop on 2026-11-10, with git 2.54.0, in scratch repositories that `template/scripts/hooks/worktree-hooks.selftest.mjs` makes.

- **E1.** A worktree the script made is listed as locked with the script's reason. `git worktree remove` refuses it with "locked working tree". After its directory is deleted, `git worktree prune` keeps its record. The same script with the lock taken out loses the record to the same prune.
- **E2.** In a worktree the script made, `git config user.email` gives the bot's address, and the primary checkout's config names nobody. A commit made there on a detached HEAD carries the bot as author and committer.
- **E3.** With `.git/config.lock` held by another process and the extension already on, the script sets the identity and writes no shared config. With the lock held and the extension off, it warns and still makes the worktree.
- **E4.** A run that fails after it added the worktree removes that locked worktree, its record and its branch. The same script with one `--force` in place of two leaves the worktree behind.
- **E5.** In a scratch repository with the extension on, from a locked worktree with the bot's identity set: Betterleaks 1.9.0 scanned the history and exited 0, osv-scanner 2.6.0 scanned `package-lock.json` and exited 0, and bd 1.3.0 listed the issues. So the Template's gates and its Tracker read such a repository.
