# A listed test is protected from its merge, and no harness selftest is listed

A test in `protectedTestsFile` is now protected once the commit that lists it is on `origin/main`. Before, it was protected from that commit itself. `template/scripts/hooks/guard-delivery.mjs` reads the list as `origin/main` has it. Until the merge, the branch that listed a test may correct it, in a commit that says why, and the `spec-reviewer` agent reads each such change. A selftest of the harness, of a gate, a hook or a script, is never listed. The operator approved both changes on 2026-11-10.

The rule exists because a session that owns both a failing test and the code can change the test until it passes. That risk is real for a test another change relies on. It is small for a test the same branch wrote an hour earlier, and the old rule charged the same price for both.

In the Target `spec-storming`, sessions listed 21 tests over 47 hours. The hook refused no weakening of one. It did stop one guard fix twice, each time on a selftest that no merge had reached, which the fix had to change. Each stop waited on the operator, 47 minutes and then 69, and the operator ended the run at the third request.

## Considered Options

- **Keep protection from the listing commit.** Rejected: every wait above was for a test still inside its own branch.
- **List product tests only, and change nothing else.** Taken as one half of this decision. Alone it would leave a story's own tests locked against the story.
- **The reviewer shows each changed protected test in the pull request, and the operator approves by merging.** Not chosen: an operator who skims a pull request of 11 issues can merge a weakened assertion.
- **A gate that holds each merged test unchanged at pre-push.** Planned as the next step. It catches an edit made through the shell, which the edit hook cannot see.

## Consequences

- A session can weaken a test it listed itself, inside its branch, and only the review sees it.
- A session can loosen a guard's selftest and then the guard, because no harness selftest is protected.
- Only a prompt keeps a harness selftest off the list. No hook and no gate reads which tests are the harness's.
- A defect in the harness is still reproduced by a failing test that is committed before the fix. That test is not listed.
- The operator still lifts the protection of a merged test, by changing it or by deleting its line in a commit of their own.

## Evidence

- **E1.** On 2026-11-10, `protectedTestsFile` on the Target's `origin/main` held no line, and the two commits in which the operator lifted a protection, `bd2970a` and `f6e4073`, each deleted one line from the list on a branch that never merged. So both lifts were for tests no merge had reached.
- **E2.** Of the 21 listed tests, all reproduced defects, and 13 were selftests of the harness (a review of the Target on 2026-11-09).
- **E3.** `template/scripts/hooks/guard-delivery.selftest.mjs` holds the new rule in a scratch repository. An edit to a test the branch listed is allowed, and so is an edit that drops a line the branch added. An edit to a test `origin/main` lists is refused, and so is an edit that drops one of its lines. Once the listing commit is on `origin/main`, the same test is refused. With an `origin/main` that holds no list, nothing is protected yet.
