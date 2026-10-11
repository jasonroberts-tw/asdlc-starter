---
name: bead
description: Work one or more issues from the task store end to end - verify the premise, claim, implement, gate, open the pull request, close once it merges. Use when asked to work, pick up or finish an issue.
---

# Work an issue

The argument is one issue id, several, or nothing (then take the top of
`bd ready`. Work agreed in conversation that no issue
carries yet is filed before it is worked, in step 3. 

## 1. Verify the premise before any work

An issue's title is not evidence, and nor is a "blocked on" line in its prose: `bd show` lists the
dependencies the tracker records. Read the issue, then read the code it talks about, and decide
which of four things is true, citing file and line for each claim:

- **still valid**: the defect or the gap is there, as described;
- **already fixed**: name the commit or the pull request that fixed it;
- **obsolete**: what it asks for no longer applies, and why;
- **blocked**: the work needs something that is in neither the repository nor the issue's own
  scope; name it, and the open issue that carries it, if one does.

Read that code as the trunk has it: this step runs in the primary checkout, whose `main` trails
`origin/main` until someone pulls it. Run `git fetch origin main`, then read with
`git show origin/main:<path>`. Where a fetch is not wanted yet, `gh api "repos/{owner}/{repo}/contents/<path>?ref=main" -H "Accept: application/vnd.github.raw"`
reads the same file without one. An agent sent to read the code reads the checkout's copy unless its
brief says otherwise (not verified against the CLI), so say so.

Name, too, any recision record an acceptance criterion implies or that names the issue 
and each criterion this session cannot meet from where it runs.

What happens next depends on who is listening:

- **With a live user:** when the premise does not hold, show the evidence and stop. The user decides
  whether the issue closes, changes or stands. When it changes, record that in the issue before any
  work: rewrite its title and description, with a dated section naming what was dropped and why so
  it is never re-filed, and file any part split out as its own issue. The same holds when the user
  changes the scope once work has begun: record it before the work it adds, and rewrite any
  follow-up already filed from the issue to match, so neither still describes the old scope.
- **In an autonomous session:** write the evidence into the issue as a note, leave the issue open,
  and move to the next one. Never close an issue on your own reading of its premise.
- **Blocked:** with a live user, taking on the prerequisite is the user's call on scope. In an
  autonomous session, take it on only when no open issue carries it and the acceptance criteria
  cannot be met without it: write its smallest form. Otherwise it is a premise that does not hold,
  handled as above.

## 2. Partition before claiming

With several issues, use the `fan-out-work` sub-agent

## 3. Claim, then work in a worktree

Claim the issue in the tracker (`bd update <id> --claim`); with several, claim every one step 2
kept, in one bracket, before the first worktree. Make the worktree with the one worktree script,
never natively: `EnterWorktree`. Read `.worktree/CONTEXT.md` there. Tracker writes that carry a
body, such as step 1's re-scoping, are made from here. Work agreed in conversation has no issue to
claim yet, so the order turns round: make the worktree, search for an issue that already carries the
work, then file it from here and claim it. Step 1
still applies, with what was agreed standing for the issue: each part of it is a premise, and a part
that does not hold goes back to the user with its evidence before anything is filed, even a part the
session proposed itself.

## 4. Implement, regenerate, gate

Stage every file the change adds (`git add`) before the gates run: a new file not yet added passes
the citations gate unread. Run `mise run gates`, the build check here.  
Run no task name `tasks.toml` does not list. 
A red gate is fixed or reported, never bypassed; where its cause is not yet known, the
`root-cause` skill finds it first.

A defect found on the way is fixed in this branch only when it sits in a file the issue already
changes or causes an existing gate to fail. 
One left unfixed is filed as its own issue, never folded in, and before the pull request
opens, so the pull request's body names the new id. File it with `foundIssueCommand` in
`policy/vocabulary.json`; here the found-at label is bead's.

## 5. Rebase and gate again

As `AGENTS.md` § The gate ladder says.

## 6. Open the pull request and watch its checks

Before writing the body, hold the branch to each criterion as worded and to itself: a gap the body
admits merges anyway off the high-risk floor. Fix one the body would disclose, or make the
tree say what is true and file its follow-up (step 4). A criterion the work will not meet as worded
is changed by the user before the push, as step 1 says.

Open it with the `open-pr` skill.

## 7. Close on the merge, with a reason

Once `open-pr` reports the merge, close the issue with a reason that names the pull request, passed
with `bd close <id> --reason-file <file>`. Handed back unmerged, the issue stays open, with a note
naming the pull request and any issue it waits on, until it merges: closed sooner, it claims an
unmet criterion. Whoever sees
the merge closes it. An acceptance criterion that acts outside the repository is not performed: it
becomes a follow-up issue labelled `human`, created with its label at creation.

## 8. Report

Keep it short. It says what step 1 verified and where, what changed and what was
regenerated. It gives both gate runs as measured, and the pull request, with why it waits when it
waits for a person or on an issue. It ends with the issue's final state and every follow-up filed.
