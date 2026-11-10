# Git itself refuses a write to `main` or `release` from a linked worktree

The rule that no worktree pushes to, switches to or rewrites a long-lived branch is now held by Git, in two places. A `reference-transaction` hook refuses a write to `refs/heads/main` or `refs/heads/release` that is made in a linked worktree. The pre-push event refuses a push from a linked worktree that names either branch on the remote. `template/scripts/git-hooks.mjs` installs the first and runs the second. `template/scripts/hooks/guard-git.mjs` no longer reads `git push`, `checkout`, `switch` or `branch` for such a write. The operator approved this on 2026-11-10, as the last of the steps that `0006-the-guards-stop-a-slip.md` names.

The git guard read the text of a command, and Git decides what a command writes after that text has been read. In the Target `spec-storming`, 20 open issues each named a form the guard's parser missed. Each fix added a form to parse and a selftest to keep, and the guard there grew from 910 lines to 1,736.

A ref hook does not read the command. Git runs it before it writes any ref, and gives it the full name of each ref the transaction would write. So the hook sees the same thing for `git branch -f`, for an alias, for `sh -c`, and for a ref spelt in another case.

## Considered Options

- **Keep the parser and add each missed form.** Rejected: the queue of missed forms never emptied, and no parser closes the shell.
- **A script file as the hook.** Rejected: a hook that names a file fails when Git runs it in a directory that does not hold the file yet, such as a worktree it is still filling, and a failing ref hook stops the operation. The hook's whole text sits in one config value and needs no file. A branch that edits the repository's scripts does not change it either.
- **Refuse the write in the primary checkout too.** Rejected: a person works there, and the briefing's `via-merge` finish fast-forwards `main` there.
- **Refuse only in the folders the CLIs keep their worktrees in.** Rejected: the rule in `AGENTS.md` covers every worktree, and a worktree root can be moved.
- **Keep a text rule for a push beside the hooks.** Rejected: two readings of one command can disagree, and the session then gets two refusals with different advice.

## Consequences

- **The refusal lands inside the operation.** A `git rebase --update-refs` that would move `release` stops part-way, and the session must abort the rebase.
- **A person's own linked worktree is held too.** Someone who keeps `release` checked out in a linked worktree is refused each commit there. They commit in the primary checkout, or switch the hook off for one command.
- **A session that points Git at the primary checkout is judged as the primary checkout.** `git -C <primary> push origin main`, typed in a worktree, was refused by the text guard and is not refused now. Claude Code's own worktree isolation refuses `git -C` there. The other CLIs have no such layer, so for them the remote's ruleset is what holds.
- **A hook can be skipped by a session set on it.** `git push --no-verify` skips pre-push, and `git -c hook.asdlc-protect-refs.enabled=false` skips the ref hook. A ref file written with no Git at all passes both. This matches `0006`: the guards stop a slip, not an intent.
- **Every ref write now starts a shell, several times.** Git calls the hook at each state of each transaction: 7 times for one commit, and more for each commit a rebase replays. On Linux the cost is small. On macOS, where a process is slower to start, a commit takes about 50 ms longer and a long rebase much longer (E5). The hook reads its input with the shell alone, and asks Git where it runs only when a line names a protected branch.
- **`mise run gates`, the doctor and Bootstrap hold the hook's entry.** A clone that has not run `mise run hooks:install` since this change is refused by `gates`, with that command as the fix. `npm ci` installs it too.
- **The text guard keeps what no ref hook sees:** the object store, the worktree records, a merge of the trunk into a branch, a merge into the primary checkout, and the `gh` commands.

## Evidence

Each trial ran on the maintainer's macOS arm64 laptop on 2026-11-10, with git 2.54.0, in scratch repositories.

- **E1.** `mise run hooks:selftest` holds 41 cases, 3 of them new. From a linked worktree, 12 forms were each refused with `main` and `release` unmoved: `update-ref`, `update-ref` in another case, `update-ref --stdin`, `branch -f`, `branch --forc`, `branch -D`, `branch -m`, `checkout -B`, `switch -C`, a forced fetch into `release`, a git alias, and a commit with HEAD pointed at `release`. The same write with the hook switched off moved the branch, so the hook is what held it. In the same repository a commit, a branch, a fetch and the `via-merge` fast-forward all passed, and so did a commit on `main` in the primary checkout.
- **E2.** Four forms of a push to `main` from a linked worktree were refused with the remote unmoved: `HEAD:main`, `HEAD:refs/heads/main`, `+agent/lane:main` and `:main`. A push of the worktree's own branch passed, and so did a push of `main` from the primary checkout.
- **E3.** A separate scratch trial held 18 forms, which added `sh -c`, a launcher (`env git ...`), `git push . HEAD:main` and `git rebase --update-refs` with `release` inside the rebased range. Ten ordinary operations passed, among them a new worktree, a stash and a tag.
- **E4.** `gates` refused a checkout whose ref hook entry was missing, and one whose entry had been changed, and named `mise run hooks:install` each time.
- **E5.** The hook's cost, in scratch repositories. In the dev container's image (Linux, git 2.55.0, dash), one commit took 4 ms against 2 ms with the hook off, and a rebase of 100 commits took 0.65 s against 0.07 s. On the laptop (macOS arm64, git 2.54.0), one commit took 71 ms against 23 ms, and a rebase of 111 commits took 18.7 s against 0.5 s. A hook file that only exits cost 66 ms a commit on the laptop, so starting the shell is the cost, not the script. Written first as a second shell inside Git's own, the same rebase took 31.7 s, which is why the hook is one shell function.
- **Not measured.** The time the hook adds to a large fetch, which is one transaction however many refs it moves.
