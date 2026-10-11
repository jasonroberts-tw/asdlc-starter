/**
 * Self-test for scripts/hooks/worktree-create.mjs, scripts/hooks/worktree-remove.mjs,
 * scripts/prune-worktree-branches.mjs, scripts/render-worktree-context.mjs with the briefing
 * template it renders, scripts/new-worktree.sh's choice of which copy of that template renders, its
 * copy of the primary checkout's Vale styles, its run beside another that holds `.git/config.lock`
 * and the branch a failed run of it made, and for the hook registrations in
 * .claude/settings.json: each must load
 * whatever the session's working directory is (the last section says what broke).
 *
 * Covers the halves of the contract that are cheap to exercise and easy to get wrong: what the hooks
 * accept on stdin, what they refuse, and -- for the remove hook -- that stdout stays clean and the
 * sandbox fallback actually deletes a directory `git worktree remove` will not touch. It deliberately
 * does NOT provision a real worktree: `git worktree add` needs the primary checkout, and a
 * worktree-isolated session is refused it by scripts/hooks/guard-git.mjs. That one round trip is
 * verified by running the create hook from the primary checkout; see the PR body. The new-worktree
 * case runs the script only in a scratch repository of its own.
 *
 * THE PRUNE CASES ARE DIFFERENT IN KIND from everything else here, and the difference is the point:
 * that script DELETES BRANCHES AND REMOVES CHECKOUTS, so what is asserted is not that it works but
 * that it refuses, in each of the ways it can be asked to do damage. Two rules follow from that and
 * both were learned the hard way. First, every refusal is asserted by the REASON reported, not by
 * mere survival -- the checked-out case passed with the guard deleted, because `git branch -D`
 * refuses a checked-out branch by itself, which made the check vacuous; `git worktree remove` refuses
 * a dirty or locked tree by itself in exactly the same way. Second, nothing in this file may run the
 * sweep against THIS repository: `worktree:selftest` is a pre-push job, and an earlier version of the
 * remove hook swept the real repo on every invocation, deleting 104 local branches. The scratch
 * repository below and the hook's own ownership check are what keep that separated.
 *
 *   node scripts/hooks/worktree-hooks.selftest.mjs
 *
 * Needs `git`, `bash` and a POSIX `sh` on PATH, and `/proc` or `lsof` for the prune sweep's
 * liveness case, which fails rather than skips on Linux and macOS without them. It reads nothing
 * outside the temporary directory
 * but this checkout's own files. The render and new-worktree cases bind loopback ports for a moment,
 * as the renderer's port probe does.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyPolicy, editPolicy, readPolicy } from '../../tools/lib/policy.ts'

const HOOKS = resolve(dirname(fileURLToPath(import.meta.url)))
const CREATE = join(HOOKS, 'worktree-create.mjs')
const REMOVE = join(HOOKS, 'worktree-remove.mjs')

let failures = 0

/**
 * Run a hook with `input` on stdin. Never throws; the exit code is part of what is asserted.
 *
 * `spawnSync` rather than `execFileSync` because stderr has to survive a SUCCESSFUL run:
 * `execFileSync` returns stdout only and reaches stderr through the thrown error, so on exit 0 it
 * dropped the stream on the floor. These hooks report everything they did on stderr -- stdout is
 * reserved for the harness -- which makes stderr the only evidence of what a zero-exit run actually
 * did, including whether it swept the real repository.
 */
function run(script, input) {
  const r = spawnSync('node', [script], { input, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`)
    failures += 1
  }
}

console.log('create hook: input it must refuse')
for (const [label, input] of [
  ['non-JSON stdin', 'not json at all'],
  ['no name field', '{"hook_event_name":"WorktreeCreate"}'],
  ['name with a slash', '{"hook_event_name":"WorktreeCreate","name":"a/b"}'],
  ['name with a backslash', '{"hook_event_name":"WorktreeCreate","name":"a\\\\b"}'],
  ['dot-segment name', '{"hook_event_name":"WorktreeCreate","name":".."}'],
  ['traversal name', '{"hook_event_name":"WorktreeCreate","name":"../escape"}'],
  ['empty name', '{"hook_event_name":"WorktreeCreate","name":""}'],
  ['non-string name', '{"hook_event_name":"WorktreeCreate","name":42}'],
  ['leading-dot name', '{"hook_event_name":"WorktreeCreate","name":".hidden"}'],
]) {
  const r = run(CREATE, input)
  // A refusal must be non-zero AND must not print a path, or the harness would try to use one.
  check(
    label,
    r.code !== 0 && r.stdout.trim() === '',
    `code=${r.code} stdout=${JSON.stringify(r.stdout)}`,
  )
}

console.log('remove hook: input it must refuse')
for (const [label, input] of [
  ['non-JSON stdin', 'not json at all'],
  ['no worktree_path', '{"hook_event_name":"WorktreeRemove"}'],
  ['empty worktree_path', '{"hook_event_name":"WorktreeRemove","worktree_path":""}'],
]) {
  const r = run(REMOVE, input)
  check(label, r.code !== 0, `code=${r.code}`)
}

console.log('remove hook: the sandbox fallback')
// A plain directory is not a registered worktree, so `git worktree remove` fails on it exactly as it
// does under the sandbox's bind mounts. The direct-removal branch is what must clear it.
const scratch = mkdtempSync(join(tmpdir(), 'wt-remove-'))
const victim = join(scratch, 'not-a-worktree')
mkdirSync(join(victim, 'nested'), { recursive: true })
writeFileSync(join(victim, 'nested', 'file.txt'), 'content')
const removed = run(
  REMOVE,
  JSON.stringify({ hook_event_name: 'WorktreeRemove', worktree_path: victim }),
)
check('exits zero', removed.code === 0, `code=${removed.code} stderr=${removed.stderr}`)
check('directory is gone', !existsSync(victim))
check('stdout stays empty', removed.stdout.trim() === '', JSON.stringify(removed.stdout))
// THE CHECK WHOSE ABSENCE COST 104 BRANCHES. The hook runs prune-worktree-branches.mjs after a
// removal, and that sweep mutates branches and `.git/config` -- shared state, in the REAL
// repository, since the sweep is keyed off the hook's own location and not off `worktree_path`.
// This case hands the hook a `/tmp` victim, and `worktree:selftest` is a pre-push job, so without
// the ownership check in the hook every push swept the real repo. Assert the refusal, by its
// reason, rather than trusting that a test directory is obviously not a worktree.
check(
  'a foreign path is not swept',
  removed.stderr.includes('sweep skipped') && !removed.stderr.includes('worktree gc:'),
  JSON.stringify(removed.stderr.slice(0, 400)),
)

console.log('remove hook: a path that cannot be removed')
// Nothing to delete is still "gone", so this must succeed rather than fail on a missing directory.
const absent = run(
  REMOVE,
  JSON.stringify({
    hook_event_name: 'WorktreeRemove',
    worktree_path: join(scratch, 'never-existed'),
  }),
)
check('absent path exits zero', absent.code === 0, `code=${absent.code} stderr=${absent.stderr}`)

/* --------------------------------------------------------------------------------------------- *
 * guard-unprovisioned-worktree: the unprovisioned-worktree tripwire.
 *
 * The one failure the WorktreeCreate hook cannot catch is the one where no WorktreeCreate hook ran.
 * A session whose settings file registers no WorktreeCreate hook gets `EnterWorktree`'s native
 * behaviour instead: a `worktree-<name>` branch cut from `origin/main` rather than `agent/<name>` cut
 * from `origin/main`. Since both now use the same LOCATION, the branch name is the discriminator.
 * `guard-unprovisioned-worktree.mjs` is a PreToolUse Bash hook, so it fires whether or not that hook
 * is registered -- and this asserts it does. Until 2026-10-08 the check lived in `guard-git.mjs`,
 * which the high-risk floor holds; `guard-git.mjs` must now let the same command through, or the
 * check would still be on the floor (`docs/decisions.md` § D-58).
 *
 * Unlike the create-hook cases above, this one CAN provision real worktrees, because it builds a
 * throwaway repository in a temp directory. The header's "no real worktree" constraint is about
 * `git worktree add` against THIS repository from an isolated session; a scratch repo is untouched
 * by it.
 * --------------------------------------------------------------------------------------------- */
console.log('guard-unprovisioned-worktree: the unprovisioned-worktree tripwire')
const GUARD = join(HOOKS, 'guard-git.mjs')
const PROVISION_GUARD = join(HOOKS, 'guard-unprovisioned-worktree.mjs')
const repo = mkdtempSync(join(tmpdir(), 'wt-guard-'))
const primary = join(repo, 'primary')

/**
 * The environment for the scratch repository, with every `GIT_*` variable removed.
 *
 * THIS IS NOT HYGIENE, IT IS THE DIFFERENCE BETWEEN A TEST AND AN INCIDENT. Run from a linked
 * worktree, which is where agents push here, `git push` exports `GIT_DIR` (that worktree's absolute
 * git directory) into its pre-push hook, and `git commit` exports it into pre-commit with an
 * absolute `GIT_INDEX_FILE`, so a `git` call made from either hook inherits them and operates on
 * THE REAL REPOSITORY no matter what `cwd` it is given. From the primary checkout neither hook gets
 * `GIT_DIR`, pre-commit gets the relative `GIT_INDEX_FILE=.git/index`, and no hook from either
 * kind of checkout gets `GIT_WORK_TREE`. Measured on Git 2.54.0 (Apple Git-157) and Git 2.55.0 on
 * 2026-10-03, in scratch repositories; `tools/lib/git-env.ts` has the rest. Run without this scrub,
 * these cases registered both scratch worktrees against the actual repo, created their branches in
 * it, wrote `user.email=selftest@example.invalid` into `.git/config` -- which would have
 * misattributed every later commit -- and flipped `core.bare` to `true` on the primary checkout. It
 * passed under `lefthook run pre-push`, where those variables are absent, and failed only under a
 * real push: the worst possible split, because the failing run is the one that also does the damage.
 *
 * `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` are pinned to /dev/null for the same reason in the
 * other direction: the scratch repo must not read or write the developer's own git configuration.
 */
const GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
}

/** Run a git command in the scratch repo. Throws on failure, which fails the selftest loudly. */
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: 'pipe' })

execFileSync('git', ['init', '-q', '-b', 'main', primary], { env: GIT_ENV, encoding: 'utf8' })
writeFileSync(join(primary, 'f.txt'), 'hi\n')
git(primary, 'add', 'f.txt')
// Identity via -c, so the scratch repo needs no config file written to it at all.
const AS = ['-c', 'user.email=selftest@example.invalid', '-c', 'user.name=selftest']
git(primary, ...AS, 'commit', '-qm', 'init')
// `origin/main` has to exist for the base-distance corroboration to have anything to measure.
git(primary, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
// Both worktrees sit in the NEW sanctioned location; only the branch name separates them.
git(primary, 'worktree', 'add', '-q', '.claude/worktrees/native', '-b', 'worktree-native', 'HEAD')
git(primary, 'worktree', 'add', '-q', '.claude/worktrees/ours', '-b', 'agent/ours', 'HEAD')

/**
 * Run guard-git as the harness runs it on a command typed from `dir`, in a session that started in
 * the primary checkout: the process in `dir`, the payload's `cwd` naming `dir`, and
 * `CLAUDE_PROJECT_DIR` naming the primary checkout, where the harness keeps it after `EnterWorktree`
 * (https://code.claude.com/docs/en/worktrees.md, the note "Hook paths don't follow the worktree").
 *
 * Until 2026-09-25 this set `CLAUDE_PROJECT_DIR` to `dir`, which the harness never does, and so it
 * passed over a guard that read that variable, judged the primary checkout, and applied no git rule
 * in any worktree a session had entered (asdlc-openspec-bvf).
 *
 * `payloadDir` moves the payload's `cwd` away from the process's directory, for the cases that show
 * which of the two decides; `null` leaves it out of the payload. `env` is added to the guard's
 * environment, for the cases an inherited `GIT_DIR` would mislead. `hook` is the script run,
 * `guard-git.mjs` unless a case names another Bash hook.
 */
function guardFrom(dir, { command = 'echo hello', payloadDir = dir, env = {}, hook = GUARD } = {}) {
  const payload = { tool_input: { command } }
  if (payloadDir !== null) payload.cwd = payloadDir
  try {
    execFileSync('node', [hook], {
      input: JSON.stringify(payload),
      cwd: dir,
      env: { ...GIT_ENV, CLAUDE_PROJECT_DIR: primary, ...env },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { code: 0, stderr: '' }
  } catch (err) {
    return { code: err.status ?? 1, stderr: err.stderr ?? '' }
  }
}

const nativeDir = join(primary, '.claude', 'worktrees', 'native')
const PROVISION_RULE = 'not an agent/* branch'
const native = guardFrom(nativeDir, { hook: PROVISION_GUARD })
check(
  'a worktree-* branch is refused, by its reason',
  native.code === 2 && native.stderr.includes(PROVISION_RULE),
  `code=${native.code} ${JSON.stringify(native.stderr.slice(0, 200))}`,
)
check(
  'the refusal names the branch',
  native.stderr.includes("'worktree-native'"),
  JSON.stringify(native.stderr.slice(0, 200)),
)
// The hook reads no command, so an unreadable payload changes only where it looks: the process's
// directory, which is still the native worktree.
const nativeNoCwd = guardFrom(nativeDir, { hook: PROVISION_GUARD, payloadDir: null })
check(
  "with no cwd in the payload, the process's directory decides, and it is refused",
  nativeNoCwd.code === 2 && nativeNoCwd.stderr.includes(PROVISION_RULE),
  `code=${nativeNoCwd.code} ${JSON.stringify(nativeNoCwd.stderr.slice(0, 200))}`,
)
// An inherited `GIT_DIR` naming the primary checkout's `.git` would make git answer for the primary
// checkout, find no linked worktree and allow the command, as it did the guard until 2026-10-06
// (asdlc-openspec-hn4x); the hook runs its git with no `GIT_*` variable, as the guard does.
const nativeGitDir = guardFrom(nativeDir, { hook: PROVISION_GUARD, env: { GIT_DIR: join(primary, '.git') } })
check(
  'an inherited GIT_DIR naming the primary checkout does not move the checkout judged',
  nativeGitDir.code === 2 && nativeGitDir.stderr.includes(PROVISION_RULE),
  `code=${nativeGitDir.code} ${JSON.stringify(nativeGitDir.stderr.slice(0, 200))}`,
)
// The check left the floor's guard: the same command there passes it.
const nativeByGuard = guardFrom(nativeDir)
check(
  'guard-git.mjs no longer refuses a command in a worktree-* worktree',
  nativeByGuard.code === 0,
  `code=${nativeByGuard.code} ${JSON.stringify(nativeByGuard.stderr.slice(0, 200))}`,
)
// The scratch worktree starts at origin/main, as a `fresh` fallback does while the default branch is
// the trunk, so the refusal must claim neither a distance nor a base other than origin/main.
check(
  'at distance 0 the refusal makes no claim about the base',
  !/behind origin\/main|not taken from origin\/main/.test(native.stderr),
  JSON.stringify(native.stderr.slice(0, 200)),
)
// Both controls matter: a tripwire that fires everywhere would block the whole repository. The
// agent/* worktree sits at the SAME path shape as the refused one, so this also proves the check
// keys on provenance rather than on location.
const ours = guardFrom(join(primary, '.claude', 'worktrees', 'ours'), { hook: PROVISION_GUARD })
check('an agent/* worktree is allowed', ours.code === 0, `code=${ours.code} ${ours.stderr}`)
const prim = guardFrom(primary, { hook: PROVISION_GUARD })
check('primary checkout is allowed', prim.code === 0, `code=${prim.code} ${prim.stderr}`)

// THE GIT RULES, IN A WORKTREE THE SESSION HAS ENTERED. Each refusal is asserted by its reason. The
// control is the same command in the primary checkout, where the git rules do not apply: without
// it, a guard that refused every `git worktree` everywhere would pass these cases.
console.log('guard-git: the git rules in a worktree the session has entered')
const oursDir = join(primary, '.claude', 'worktrees', 'ours')
const WORKTREE_RULE = 'worktree management belongs to the orchestrator'
const why = (r) => `code=${r.code} ${JSON.stringify(r.stderr.slice(0, 200))}`

const primList = guardFrom(primary, { command: 'git worktree list' })
check('control: the primary checkout allows `git worktree list`', primList.code === 0, why(primList))
const listed = guardFrom(oursDir, { command: 'git worktree list' })
check(
  'the worktree refuses it, by its reason',
  listed.code === 2 && listed.stderr.includes(WORKTREE_RULE),
  why(listed),
)
mkdirSync(join(oursDir, 'sub'))
const pushed = guardFrom(join(oursDir, 'sub'), { command: 'git push origin main' })
check(
  'a subdirectory of it, after a cd, refuses a push to main, by its reason',
  pushed.code === 2 && pushed.stderr.includes('you cannot push to a long-lived branch'),
  why(pushed),
)
const byPayload = guardFrom(primary, { command: 'git worktree list', payloadDir: oursDir })
check(
  "the payload's cwd decides, not the process's directory",
  byPayload.code === 2 && byPayload.stderr.includes(WORKTREE_RULE),
  why(byPayload),
)
const noCwd = guardFrom(oursDir, { command: 'git worktree list', payloadDir: null })
check(
  "with no cwd in the payload, the process's directory decides",
  noCwd.code === 2 && noCwd.stderr.includes(WORKTREE_RULE),
  why(noCwd),
)

// A STRAY WORKTREE DIRECTORY (asdlc-openspec-0ga): what a worktree removed under a live session
// leaves once the session writes a file there, a directory under `.claude/worktrees/<name>/` with no
// `.git` file, where git walks up to the primary checkout. Every git call there is refused by its
// reason, which names both paths, reads included. The controls are the same rebase in a registered
// worktree, where the briefing asks for it, and a command that is not git in the stray directory.
console.log('guard-git: git in a stray worktree directory')
const strayRoot = join(primary, '.claude', 'worktrees', 'gone')
mkdirSync(join(strayRoot, 'scripts'), { recursive: true })
writeFileSync(join(strayRoot, 'scripts', 'test-trace.mjs'), '// written after the removal\n')
const STRAY_RULE = `runs git in ${strayRoot}, but git there answers for ${realpathSync(primary)}`
const strayCases = [
  ['a rebase in it is refused', strayRoot, 'git rebase origin/main'],
  ['a read in a subdirectory of it is refused', join(strayRoot, 'scripts'), 'git status'],
  ['a fetch inside bash -c is refused', strayRoot, "bash -c 'git fetch origin'"],
]
for (const [label, dir, command] of strayCases) {
  const r = guardFrom(dir, { command })
  check(`${label}, by its reason`, r.code === 2 && r.stderr.includes(STRAY_RULE), why(r))
}
const oursRebase = guardFrom(oursDir, { command: 'git rebase origin/main' })
check('control: a registered worktree allows the rebase', oursRebase.code === 0, why(oursRebase))
const strayEcho = guardFrom(strayRoot, { command: 'ls scripts' })
check('control: a command that is not git is allowed there', strayEcho.code === 0, why(strayEcho))

/* --------------------------------------------------------------------------------------------- *
 * guard-git: an approval, and a merge past the checks, from any checkout.
 *
 * GitHub merges a pull request once `verify` passes and one approving review stands, which the
 * reviewer gives off the high-risk floor and a person gives on it, and `gh pr merge --admin` merges
 * past the checks with the maintainer's bypass, which is a person's (docs/decisions.md § D-57 and
 * § D-47). So the guard refuses `gh pr review --approve` and `--admin` everywhere, and from a
 * worktree any merge but auto-merge. Each refusal is asserted by its reason. The controls are the
 * merge the primary checkout may make, auto-merge from a worktree in each spelling, a comment and a
 * request for changes, and the approval label, whose rule retired with the label: without them, a
 * guard that refused every `gh pr merge` or every `gh pr review`, or still every label, would pass.
 * The cases after these hold the parser: a flag before `pr create` once hid a missing `--base`, as
 * did gh's alias `pr new`, and a brace inside a word once split the statement, which hid the
 * endpoint of `repos/{owner}/{repo}/…`.
 * --------------------------------------------------------------------------------------------- */
console.log('guard-git: an approval, and a merge past the checks, from any checkout')
const POLICY_ROOT = resolve(HOOKS, '..', '..')

/** guard-git on `command` typed from `dir`. */
function ghGuard(dir, command) {
  const r = spawnSync('node', [GUARD], {
    input: JSON.stringify({ cwd: dir, tool_input: { command } }),
    cwd: dir,
    env: { ...GIT_ENV, CLAUDE_PROJECT_DIR: primary },
    encoding: 'utf8',
  })
  return { code: r.status ?? 1, stderr: r.stderr ?? '' }
}
const refusedFor = (r, reason) => r.code === 2 && r.stderr.includes(reason)
const ADMIN_RULE = "merges past the checks the trunk's ruleset requires"
const APPROVE_RULE = "an approval is the person's gate on a head on the high-risk floor"
const MERGE_RULE = "a merge now is the orchestrator's call"

for (const [label, dir, command] of [
  ['a merge from the primary checkout', primary, 'gh pr merge 12 --rebase'],
  ['auto-merge from a worktree', oursDir, 'gh pr merge 12 --auto --rebase'],
  ['auto-merge spelt --auto=true, from a worktree', oursDir, 'gh pr merge 12 --auto=true --rebase'],
  ['auto-merge turned off from a worktree', oursDir, 'gh pr merge 12 --disable-auto'],
  ['the approval label, whose rule retired with it', oursDir, 'gh pr edit 12 --add-label review:approved'],
  ['a comment review, which approves nothing', oursDir, 'gh pr review 12 --comment -b "read it"'],
  ['a request for changes, which approves nothing', primary, 'gh pr review 12 --request-changes -b "no"'],
  ['--approve=false, which gh reads as no approval', oursDir, 'gh pr review 12 --approve=false --comment -b "read it"'],
  ['a comment whose body holds the letter, which is no flag', primary, 'gh pr review 12 --comment --body "a"'],
]) {
  const r = ghGuard(dir, command)
  check(`control: the guard allows ${label}`, r.code === 0, why(r))
}
for (const [label, dir, command] of [
  ['--admin, in the primary checkout', primary, 'gh pr merge 12 --admin --rebase'],
  ['--admin beside --auto, in a worktree', oursDir, 'gh pr merge 12 --auto --admin --rebase'],
  ['--admin=true after a flag before the group', primary, 'gh --repo o/r pr merge 12 --admin=true --rebase'],
  ['--admin inside bash -c', oursDir, 'bash -c "gh pr merge 12 --admin --rebase"'],
]) {
  const r = ghGuard(dir, command)
  check(`${label} is refused, by its reason`, refusedFor(r, ADMIN_RULE), why(r))
}
for (const [label, dir, command] of [
  ['an approval, in the primary checkout', primary, 'gh pr review 12 --approve'],
  ['an approval spelt -a, in a worktree', oursDir, 'gh pr review 12 -a -b "looks fine"'],
  ['--approve=true after a flag before the group', primary, 'gh --repo o/r pr review 12 --approve=true'],
  ['an approval inside bash -c', oursDir, 'bash -c "gh pr review 12 --approve"'],
  ['an approval after another statement', primary, 'git status; gh pr review 12 --approve'],
  ['an approval in a cluster of short flags, which gh reads as -a then -b', oursDir, 'gh pr review 12 -ab "looks fine"'],
  ['an approval spelt -a=true', primary, 'gh pr review 12 -a=true'],
]) {
  const r = ghGuard(dir, command)
  check(`${label} is refused, by its reason`, refusedFor(r, APPROVE_RULE), why(r))
}
for (const [label, command] of [
  ['a merge now, from a worktree', 'gh pr merge 12 --rebase'],
  ['auto-merge spelt --auto=false, from a worktree', 'gh pr merge 12 --auto=false --rebase'],
]) {
  const r = ghGuard(oursDir, command)
  check(`${label} is refused, by its reason`, refusedFor(r, MERGE_RULE), why(r))
}

const flagFirst = ghGuard(primary, 'gh --repo o/r pr create --fill')
check(
  'a flag before `pr create` no longer hides a missing --base, by its reason',
  refusedFor(flagFirst, 'a pull request must name `main` as its base'),
  why(flagFirst),
)
const flagFirstBase = ghGuard(primary, 'gh --repo o/r pr create --base main --fill')
check('control: the same with --base main is allowed', flagFirstBase.code === 0, why(flagFirstBase))
const aliased = ghGuard(primary, 'gh pr new --fill')
check(
  'gh pr new, the alias of create, with no --base is refused, by its reason',
  refusedFor(aliased, 'a pull request must name `main` as its base'),
  why(aliased),
)
// A brace inside a word is now a letter, so `{owner}` above keeps its endpoint; one standing as a
// word must still group commands, or the push inside this group would be read as the command `{`.
const grouped = ghGuard(oursDir, '{ git push origin main; }')
check(
  'a brace group still splits statements, so its push to main is refused, by its reason',
  refusedFor(grouped, 'you cannot push to a long-lived branch'),
  why(grouped),
)

// AN INHERITED GIT_DIR (asdlc-openspec-hn4x): one in the hook's environment outranks the payload's
// cwd, so the guard judged the checkout it named. Each case runs with it and, as its control,
// without any GIT_* key, and both must give the same verdict, by its reason: the unfixed guard
// refused the push from a subdirectory by the stray rule's reason, so asserting the refusal alone
// passed. The primary checkout's value is the one git exports to a hook run from that worktree.
console.log('guard-git: an inherited GIT_DIR does not move the checkout judged')
const PUSH_RULE = 'you cannot push to a long-lived branch'
const SHARED_GIT_DIR = { GIT_DIR: join(primary, '.git') }
const WORKTREE_GIT_DIR = { GIT_DIR: join(primary, '.git', 'worktrees', 'ours') }
for (const [label, dir, command, env, reason] of [
  ['a push to main from the worktree', oursDir, 'git push origin main', SHARED_GIT_DIR, PUSH_RULE],
  ['a push to main from a subdirectory of it', join(oursDir, 'sub'), 'git push origin main', SHARED_GIT_DIR, PUSH_RULE],
  ['a merge now from the worktree', oursDir, 'gh pr merge 1 --rebase', SHARED_GIT_DIR, MERGE_RULE],
  ['a push to main from the primary checkout', primary, 'git push origin main', WORKTREE_GIT_DIR, null],
]) {
  for (const [how, extra] of [['with GIT_DIR', env], ['control, with no GIT_* key', {}]]) {
    const r = guardFrom(dir, { command, env: extra })
    const verdict = reason === null ? 'allowed' : 'refused, by its reason'
    check(`${how}: ${label} is ${verdict}`, reason === null ? r.code === 0 : refusedFor(r, reason), why(r))
  }
}

// A BARE `git worktree prune`, EVERYWHERE (asdlc-openspec-486e): in a dev container a session works
// in the primary checkout, where the git rules are off, and a prune there takes every host worktree's
// record. Refused by its own reason from the primary checkout and from a worktree; the control is its
// dry run, which only reports.
console.log('guard-git: a bare git worktree prune, from any checkout')
const PRUNE_RULE = 'git worktree prune` takes every record git reads as stale'
for (const [label, dir, command, reason] of [
  ['git worktree prune, in the primary checkout', primary, 'git worktree prune', PRUNE_RULE],
  ['git worktree prune -v, in a worktree', oursDir, 'git worktree prune -v', PRUNE_RULE],
  // git honours the last of the pair, so a guard that looked for `--dry-run` anywhere let this prune.
  ['git worktree prune --dry-run --no-dry-run, in the primary checkout', primary, 'git worktree prune --dry-run --no-dry-run', PRUNE_RULE],
  ['control: git worktree prune --dry-run, in the primary checkout', primary, 'git worktree prune --dry-run', null],
  ['control: git worktree prune -n -v, in the primary checkout', primary, 'git worktree prune -n -v', null],
]) {
  const r = guardFrom(dir, { command })
  const verdict = reason === null ? 'allowed' : 'refused, by its reason'
  check(`${label} is ${verdict}`, reason === null ? r.code === 0 : refusedFor(r, reason), why(r))
}

/* --------------------------------------------------------------------------------------------- *
 * guard-workflow-edit: an edit that would let a workflow approve, or forge the required check.
 *
 * GitHub merges a head once `verify` passes and one approving review stands, so a workflow other
 * than the reviewer's that can write pull requests could approve its own, and one that can write a
 * status or a check, or names a job for the required check, could pass it on its own head
 * (docs/decisions.md § D-57). Each payload names a file under this checkout's `.github/workflows/`,
 * and the hook only reads: an Edit is applied to the file in memory and a Write's content judged, so
 * nothing is written. Each refusal is asserted by its reason. The controls are a routine step added
 * to `verify.yml`, the reviewer's own workflow, the same grant outside the workflows, and an Edit
 * whose `old_string` the file does not hold: without them, a hook that refused every workflow edit
 * would pass. A doctored copy of the policy, with the check respelled, proves the hook reads it
 * from `tools/policy/` rather than writing it in. A new workflow that reads the agents' App key is
 * refused by its reason, and one that reads another secret is a control
 * (`docs/decisions/asdlc-openspec-ic9h.md` § Decision).
 * --------------------------------------------------------------------------------------------- */
console.log('guard-workflow-edit: an edit that would let a workflow approve, or forge the required check')
const FORGE_HOOK = join(HOOKS, 'guard-workflow-edit.mjs')
const WORKFLOWS_DIR = join(POLICY_ROOT, '.github', 'workflows')
const VERIFY_FILE = join(WORKFLOWS_DIR, 'verify.yml')
const FORGE_FILE = join(WORKFLOWS_DIR, 'forge.yml')
const CHECK = readPolicy(POLICY_ROOT).prReviewRequiredCheck
const APP_KEY = readPolicy(POLICY_ROOT).prReviewAppKeySecret
const FORGE_RULE = 'may approve a pull request or write a check run or a commit status'

/** guard-workflow-edit on one Write or Edit, reading the policy under `root` when one is given. */
function forgeHook(toolInput, root = null) {
  const env = { ...GIT_ENV }
  delete env.GUARD_WORKFLOW_ROOT
  if (root !== null) env.GUARD_WORKFLOW_ROOT = root
  const r = spawnSync('node', [FORGE_HOOK], { input: JSON.stringify({ tool_input: toolInput }), cwd: POLICY_ROOT, env, encoding: 'utf8' })
  return { code: r.status ?? 1, stderr: r.stderr ?? '' }
}
const GRANT = 'permissions:\n  contents: read\n'
// The `gates` job's: since D-55 every job of verify.yml has a steps line.
const STEPS = '  gates:\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    steps:\n'
const TRIGGER = '  pull_request_target:\n'
const REVIEW_FILE = join(WORKFLOWS_DIR, 'pr-review.yml')
const verifyText = readFileSync(VERIFY_FILE, 'utf8')
check(
  "the fixture: verify.yml holds the grant and the `gates` job's steps line, and pr-review.yml its trigger, that the edits below anchor on, once each",
  verifyText.split(GRANT).length === 2 && verifyText.split(STEPS).length === 2 && readFileSync(REVIEW_FILE, 'utf8').split(TRIGGER).length === 2,
  'the anchors moved: re-anchor the edits below',
)
const jobNamed = (name) => `name: forge\non: pull_request\njobs:\n  ${name}:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n`

for (const [label, toolInput] of [
  ['a step added to verify.yml', { file_path: VERIFY_FILE, old_string: STEPS, new_string: `${STEPS}      - run: mise run x:check\n` }],
  ["the reviewer's own workflow, which may write pull requests", { file_path: REVIEW_FILE, content: readFileSync(REVIEW_FILE, 'utf8') }],
  ['the same grant outside the workflows', { file_path: join(POLICY_ROOT, 'docs', 'forge.yml'), content: 'permissions: write-all\n' }],
  ['an Edit whose old_string the file does not hold, which lands nothing', { file_path: VERIFY_FILE, old_string: 'no such text\n', new_string: 'permissions: write-all\n' }],
  ['a new workflow that reads only', { file_path: FORGE_FILE, content: `permissions:\n  contents: read\n${jobNamed('x')}` }],
  ['a new workflow that reads a secret other than the App key', { file_path: FORGE_FILE, content: `${jobNamed('x')}        env:\n          KEY: \${{ secrets.OTHER_TOKEN }}\n` }],
]) {
  const r = forgeHook(toolInput)
  check(`control: the hook allows ${label}`, r.code === 0, why(r))
}
for (const [label, toolInput, reason] of [
  ['pull-requests: write granted in verify.yml, which could approve', { file_path: VERIFY_FILE, old_string: GRANT, new_string: `${GRANT}  pull-requests: write\n` }, `grants \`pull-requests: write\` to every job: only .github/workflows/pr-review.yml ${FORGE_RULE}`],
  ['statuses: write granted in verify.yml', { file_path: VERIFY_FILE, old_string: GRANT, new_string: `${GRANT}  statuses: write\n` }, `grants \`statuses: write\` to every job: only .github/workflows/pr-review.yml ${FORGE_RULE}`],
  ['checks: write granted in verify.yml under replace_all', { file_path: VERIFY_FILE, old_string: GRANT, new_string: `${GRANT}  checks: write\n`, replace_all: true }, 'grants `checks: write` to every job'],
  ['a new workflow granting write-all', { file_path: FORGE_FILE, content: `permissions: write-all\n${jobNamed('x')}` }, 'grants `write-all` to every job'],
  ['a new workflow whose job is named for the required check', { file_path: FORGE_FILE, content: jobNamed(CHECK) }, `job is named \`${CHECK}\`, so its check run carries \`${CHECK}\``],
  ['a second verify.yml job named for the required check', { file_path: VERIFY_FILE, old_string: STEPS, new_string: `  gates:\n    name: ${CHECK}\n${STEPS.slice('  gates:\n'.length)}` }, `verify.yml has 2 jobs whose check is \`${CHECK}\``],
  ['a workflow that will not parse', { file_path: FORGE_FILE, content: 'jobs: [unclosed\n' }, 'is a workflow, and this edit could not be judged'],
  ["the reviewer's own workflow given an event where a branch's copy runs", { file_path: REVIEW_FILE, old_string: TRIGGER, new_string: `  pull_request:\n${TRIGGER}` }, "runs on `pull_request`: on an event but `pull_request_target` a branch's own copy"],
  ["a new workflow that reads the agents' App key", { file_path: FORGE_FILE, content: `${jobNamed('x')}        env:\n          KEY: \${{ secrets.${APP_KEY} }}\n` }, `names the \`secrets\` context in a form that could read \`${APP_KEY}\``],
]) {
  const r = forgeHook(toolInput)
  check(`${label} is refused, by its reason`, refusedFor(r, reason), why(r))
}
const respelledCheck = mkdtempSync(join(tmpdir(), 'forge-policy-'))
copyPolicy(POLICY_ROOT, respelledCheck)
editPolicy(respelledCheck, (policy) => {
  policy.prReviewRequiredCheck = 'merge-gate'
})
const renamedJob = forgeHook({ file_path: FORGE_FILE, content: jobNamed('merge-gate') }, respelledCheck)
check(
  "the policy's required check is the one refused, by its reason",
  refusedFor(renamedJob, 'job is named `merge-gate`'),
  why(renamedJob),
)
const oldCheck = forgeHook({ file_path: FORGE_FILE, content: jobNamed(CHECK) }, respelledCheck)
check('and the old spelling is then allowed', oldCheck.code === 0, why(oldCheck))
const noPolicyRoot2 = mkdtempSync(join(tmpdir(), 'forge-nopolicy-'))
const unreadContext = forgeHook({ file_path: FORGE_FILE, content: jobNamed('x') }, noPolicyRoot2)
check(
  'with no policy to read, a workflow edit is refused, by its reason',
  refusedFor(unreadContext, 'is a workflow, and this edit could not be judged'),
  why(unreadContext),
)

/* --------------------------------------------------------------------------------------------- *
 * guard-git: graphify's eroding commands, from any checkout.
 *
 * graphify's `update`, `watch` and `hook install` rebuild the local code graph through the path that
 * erodes its document layer, and `claude install` writes graphify's advice to run `update` into
 * CLAUDE.md (docs/decisions.md § D-20), so the guard refuses each, in the primary checkout as in a
 * worktree. Each refusal is asserted by its reason, which names the command, `mise run code-graph`
 * and D-20, and the module cases hold each way Python reads `-m`. The controls are graphify's
 * reading commands, which must still run, and the near misses: a command that shares a first word
 * with a refused one, a refused word as another command's argument or as graphify's second, and a
 * refused command asking for help, which graphify answers with a line of help alone. Without them, a
 * guard that refused every graphify command, matched the first word alone, matched the words
 * anywhere in the line or among graphify's arguments, or refused a request for help would pass.
 * --------------------------------------------------------------------------------------------- */
console.log("guard-git: graphify's eroding commands, from any checkout")
const graphifyRefusal = (words) => (r) =>
  r.code === 2 &&
  r.stderr.includes(`\`graphify ${words}\``) &&
  r.stderr.includes('mise run code-graph') &&
  r.stderr.includes('docs/decisions.md § D-20')
for (const [label, dir, words, command] of [
  ['graphify update, in the primary checkout', primary, 'update', 'graphify update .'],
  ['graphify watch, in a worktree', oursDir, 'watch', 'graphify watch .'],
  ['graphify hook install, in the primary checkout', primary, 'hook install', 'graphify hook install'],
  ['graphify claude install, in a worktree', oursDir, 'claude install', 'graphify claude install'],
  [
    'graphify update by path, after an environment assignment',
    primary,
    'update',
    'GRAPHIFY_FORCE=1 ~/.local/bin/graphify update . --force',
  ],
  ['graphify run as a Python module', primary, 'update', 'python3 -u -m graphify update .'],
  ['graphify as a module past an option with a value', primary, 'update', 'python3 -X dev -m graphify update .'],
  ['graphify as a module in a group of flags', oursDir, 'watch', 'python3 -um graphify watch .'],
  ['graphify as a module named in the flag', primary, 'hook install', 'python3 -mgraphify hook install'],
  ["graphify's __main__ run as a module", primary, 'claude install', 'python3 -m graphify.__main__ claude install'],
  ['graphify watch inside bash -c', primary, 'watch', "bash -c 'graphify watch .'"],
  ['graphify hook install after another statement', oursDir, 'hook install', 'git status; graphify hook install'],
]) {
  const r = ghGuard(dir, command)
  check(`${label} is refused, by its reason`, graphifyRefusal(words)(r), why(r))
}
for (const [label, command] of [
  ['graphify query', 'graphify query "what calls guard-git"'],
  ['graphify path', 'graphify path "guard-git.mjs" "policy.ts"'],
  ['graphify explain', 'graphify explain "guard-git.mjs"'],
  ['graphify extract', 'graphify extract . --code-only'],
  ['graphify hook status, which shares its first word with hook install', 'graphify hook status'],
  ['graphify claude uninstall, which shares its first word with claude install', 'graphify claude uninstall'],
  ["graphify update's words as another command's argument", 'echo graphify update'],
  ["a refused command's word as graphify's second argument", 'graphify explain update'],
  ['graphify update --help, which graphify answers with help alone', 'graphify update --help'],
  ['graphify query run as a Python module', 'python3 -m graphify query "what calls guard-git"'],
]) {
  const r = ghGuard(primary, command)
  check(`control: the primary checkout allows ${label}`, r.code === 0, why(r))
}

/* --------------------------------------------------------------------------------------------- *
 * prune-worktree-branches: the safety rule.
 *
 * The script deletes branches and removes checkouts, so what has to be tested is not that it works
 * but that it REFUSES in each of the ways it can be asked to do damage. For branches: an unmerged
 * branch, a branch a kept worktree has checked out, and a branch that is not worktree-provisioned at
 * all. For worktrees, one case per condition of the abandonment proof: a dirty tree, a locked tree, a
 * tree whose branch is not in the trunk, a tree outside `.claude/worktrees/`, a tree with a process
 * inside it, a tree whose HEAD moved within `worktreeGcMinAgeHours`, and the tree the sweep itself
 * runs from. The positive cases -- a rebase-merged branch, a clean contained checkout nobody has used
 * for days, one its caller names as finished, and a registration whose directory is already gone --
 * are only interesting because they prove the negatives are not vacuous: a script that deleted
 * nothing would pass every refusal.
 *
 * The interesting positive is the REBASE-MERGED shape, which is what this repository's pull requests
 * actually leave behind: the branch is not an ancestor of the trunk, its commit SHA appears nowhere
 * on it, and only the patch-id matches. Built below with a cherry-pick, because that is exactly what
 * a rebase merge does to one commit.
 *
 * Every worktree below is cut from the trunk commit and so trivially contained. `abandoned` alone has
 * had HEAD still past the threshold; `between-calls` differs from it in that alone, and each other
 * refusal in one condition the sweep checks before the age, which is what lets a refusal be pinned
 * to its reason.
 * --------------------------------------------------------------------------------------------- */
console.log('prune-worktree-branches: the safety rule')
const GC = resolve(HOOKS, '..', 'prune-worktree-branches.mjs')
const gcRepo = mkdtempSync(join(tmpdir(), 'wt-gc-'))
const gcPrimary = join(gcRepo, 'primary')
// The platforms whose liveness check this selftest holds: `/proc` on Linux, `lsof` on macOS. On
// either, a missing check is a failure of the case below, never a skip.
const LIVE_CHECK = process.platform === 'linux' || process.platform === 'darwin'

execFileSync('git', ['init', '-q', '-b', 'main', gcPrimary], { env: GIT_ENV, encoding: 'utf8' })
writeFileSync(join(gcPrimary, 'base.txt'), 'base\n')
git(gcPrimary, 'add', 'base.txt')
git(gcPrimary, ...AS, 'commit', '-qm', 'base')

// A branch whose one commit is later cherry-picked onto the trunk: same patch, different SHA.
git(gcPrimary, ...AS, 'checkout', '-q', '-b', 'agent/rebase-merged')
writeFileSync(join(gcPrimary, 'landed.txt'), 'landed\n')
git(gcPrimary, 'add', 'landed.txt')
git(gcPrimary, ...AS, 'commit', '-qm', 'work that landed')

// A branch carrying a commit that never reaches the trunk. This is the one that must survive.
git(gcPrimary, ...AS, 'checkout', '-q', 'main')
git(gcPrimary, ...AS, 'checkout', '-q', '-b', 'agent/unmerged')
writeFileSync(join(gcPrimary, 'pending.txt'), 'pending\n')
git(gcPrimary, 'add', 'pending.txt')
git(gcPrimary, ...AS, 'commit', '-qm', 'work still in flight')

git(gcPrimary, ...AS, 'checkout', '-q', 'main')
git(gcPrimary, ...AS, 'cherry-pick', 'agent/rebase-merged')
// The trunk the script measures against is the remote-tracking ref, not the local branch.
git(gcPrimary, 'update-ref', 'refs/remotes/origin/main', 'HEAD')

// A plain branch that is trivially contained -- it is the trunk commit itself -- and must still be
// spared, for a reason that has nothing to do with containment.
git(gcPrimary, 'branch', 'not-an-agent-branch', 'main')

// The worktrees. `wt` cuts `agent/<name>` from the trunk commit into the sanctioned location.
const WT = join(gcPrimary, '.claude', 'worktrees')
const wt = (name) => {
  const path = join(WT, name)
  git(gcPrimary, 'worktree', 'add', '-q', '-b', `agent/${name}`, path, 'main')
  return path
}
// THE AGE RULE holds on every host (asdlc-openspec-m4m): a clean, contained worktree with no process
// in it goes only once HEAD there has sat still for `worktreeGcMinAgeHours`, or at once when the
// caller names it with `--finished`. `age` sets the mtime of each file the script reads HEAD's last
// move from, in the scratch repository `primary` names.
const MIN_AGE = readPolicy(POLICY_ROOT).worktreeGcMinAgeHours
const age = (path, name, hours, primary = gcPrimary) => {
  const then = new Date(Date.now() - hours * 3_600_000)
  const admin = join(primary, '.git', 'worktrees', name)
  for (const file of [join(path, '.git'), join(admin, 'HEAD'), join(admin, 'logs', 'HEAD')]) {
    if (existsSync(file)) utimesSync(file, then, then)
  }
}
const abandoned = wt('abandoned') // clean, contained, nobody in it, HEAD still for days: THE ONE THAT GOES
age(abandoned, 'abandoned', MIN_AGE * 2)
// The shape asdlc-openspec-m4m lost on 2026-09-30: a workflow agent's worktree, clean, at the trunk,
// with no process in it because the agent is between two calls, each of which starts and ends.
const betweenCalls = wt('between-calls')
const finished = wt('finished') // the same, but its caller has finished with it and names it
const dirty = wt('dirty')
writeFileSync(join(dirty, 'wip.txt'), 'wip\n') // one untracked file is one uncommitted change
const locked = wt('locked')
git(gcPrimary, 'worktree', 'lock', locked)
const inflight = wt('inflight')
writeFileSync(join(inflight, 'flight.txt'), 'flight\n')
git(inflight, 'add', 'flight.txt')
git(inflight, ...AS, 'commit', '-qm', 'committed but not in the trunk')
const elsewhere = join(gcRepo, 'elsewhere') // same shape, wrong place
git(gcPrimary, 'worktree', 'add', '-q', '-b', 'agent/elsewhere', elsewhere, 'main')
const gone = wt('gone') // registered, directory deleted behind git's back: prunable
rmSync(gone, { recursive: true, force: true })
const busy = wt('busy') // clean and contained, but a process is standing in it
// `spawn` returns once the child has exec'd, its cwd already set, so `/proc/<pid>/cwd` and `lsof`
// both see it as soon as it returns. This is the case asdlc-openspec-zlz lost on macOS: a worktree
// just cut, clean and contained, with a live process in it.
const sleeper = LIVE_CHECK ? spawn('sleep', ['120'], { cwd: busy, stdio: 'ignore' }) : null
process.on('exit', () => sleeper?.kill())

// Tracking config of the shape an agent's `git push -u` leaves behind, as provisioning did before it
// cut with `--no-track`, plus one section whose branch does not exist at all -- the orphan case,
// which is collected on its own evidence and needs no trunk.
for (const b of [
  'agent/rebase-merged',
  'agent/unmerged',
  'agent/abandoned',
  'agent/dirty',
  'agent/gone',
  'not-an-agent-branch',
]) {
  git(gcPrimary, 'config', '--local', `branch.${b}.remote`, 'origin')
  git(gcPrimary, 'config', '--local', `branch.${b}.merge`, `refs/heads/${b}`)
}
git(gcPrimary, 'config', '--local', 'branch.agent/ghost.remote', 'origin')
git(gcPrimary, 'config', '--local', 'branch.agent/ghost.merge', 'refs/heads/agent/ghost')

/**
 * The script's own output, run against the scratch repo. `liveness` sets `WORKTREE_GC_LIVENESS`;
 * unset here, so a value in the caller's environment cannot choose the check for the default run.
 * `mergedPrs` sets `WORKTREE_GC_MERGED_PRS`, `none` unless a case says otherwise, so no run reaches
 * GitHub; `null` leaves it unset, for the cases that put a stub `gh` first on `path`. `repo` is the
 * scratch repository the sweep runs on.
 */
function runGcWith(
  { script = GC, liveness = undefined, mergedPrs = 'none', path = undefined, repo = gcPrimary },
  ...extra
) {
  const env = { ...GIT_ENV }
  delete env.WORKTREE_GC_LIVENESS
  delete env.WORKTREE_GC_MERGED_PRS
  if (liveness !== undefined) env.WORKTREE_GC_LIVENESS = liveness
  if (mergedPrs !== null) env.WORKTREE_GC_MERGED_PRS = mergedPrs
  if (path !== undefined) env.PATH = path
  try {
    return execFileSync('node', [script, '--repo', repo, ...extra], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    return `EXIT ${err.status}: ${err.stdout ?? ''}${err.stderr ?? ''}`
  }
}
const runGc = (...extra) => runGcWith({}, ...extra)

const branchExists = (b) => {
  try {
    git(gcPrimary, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`)
    return true
  } catch {
    return false
  }
}
const registered = (name) => existsSync(join(gcPrimary, '.git', 'worktrees', name))
const configKeys = () => {
  const out = git(gcPrimary, 'config', '--local', '--name-only', '--list')
  return out.split('\n').filter((k) => k.startsWith('branch.'))
}

// --dry-run first: it must report the same verdicts and change absolutely nothing.
const preview = runGc('--dry-run')
const keysBeforeGc = configKeys().length
check(
  'dry run reports the rebase-merged branch',
  preview.includes('agent/rebase-merged'),
  preview.slice(0, 300),
)
const ABANDONED_LINE = `.claude/worktrees/abandoned  agent/abandoned  (clean, HEAD idle ${(MIN_AGE * 2).toFixed(1)}h, ancestor of origin/main)`
check('dry run reports the abandoned worktree', preview.includes(ABANDONED_LINE), preview.slice(0, 900))
// A prunable registration holds no checkout, so it must not shield its branch even before `prune`.
check(
  'dry run reports the branch behind a prunable registration',
  /agent\/gone {2}[0-9a-f]{8} {2}\(/.test(preview),
  preview.slice(0, 900),
)
check('dry run deletes nothing', branchExists('agent/rebase-merged') && branchExists('agent/gone'))
check('dry run removes nothing', existsSync(abandoned) && registered('abandoned'))
check('dry run changes no config', configKeys().length === keysBeforeGc)

// THE SWEEP MUST NEVER REMOVE THE WORKTREE IT RUNS FROM. `abandoned` qualifies on every other
// count, so running the sweep from inside it is the one way to reach this refusal -- in dry-run,
// since the run would otherwise collect everything else.
const fromInside = runGcWith({ repo: abandoned }, '--dry-run')
check(
  'the worktree the sweep runs from is kept, by reason',
  fromInside.includes(
    '.claude/worktrees/abandoned  agent/abandoned  -- the worktree this sweep runs from',
  ),
  fromInside.slice(0, 900),
)

const report = runGc('--finished', 'finished')
sleeper?.kill()

// The positives.
check(
  'the rebase-merged branch is gone',
  !branchExists('agent/rebase-merged'),
  report.slice(0, 400),
)
check('its config section is gone', !configKeys().some((k) => k.includes('agent/rebase-merged')))
check('the orphan config section is gone', !configKeys().some((k) => k.includes('agent/ghost')))
check('the abandoned worktree is gone', !existsSync(abandoned), report.slice(0, 900))
check('its registration is gone', !registered('abandoned'))
check('its branch went with it', !branchExists('agent/abandoned'))
check('and its config section', !configKeys().some((k) => k.includes('agent/abandoned')))
check(
  'the report says so',
  report.includes('removed 2 abandoned worktree(s)') && report.includes(ABANDONED_LINE),
  report.slice(0, 900),
)
check('the prunable registration is reconciled', !registered('gone'))
check('and the branch behind it is collected', !branchExists('agent/gone'))

// THE KEEP asdlc-openspec-m4m asks for, by its reason, where a liveness check works and saw no
// process: the age rule is read there too. `abandoned` above is its control, still removed; and a
// worktree its caller names goes at once, which is how a session that has finished with a lane
// removes it without waiting the threshold out.
check(
  'a worktree an agent works in, between its calls, is kept by its reason',
  report.includes(
    `.claude/worktrees/between-calls  agent/between-calls  -- HEAD moved 0.0h ago, under worktreeGcMinAgeHours (${MIN_AGE})`,
  ),
  report.slice(0, 1500),
)
check('and survives, with its branch', existsSync(betweenCalls) && branchExists('agent/between-calls'))
check(
  'a worktree named --finished goes at once, by that proof',
  !existsSync(finished) &&
    !branchExists('agent/finished') &&
    report.includes('.claude/worktrees/finished  agent/finished  (clean, named by --finished, ancestor of origin/main)'),
  report.slice(0, 1500),
)
check(
  'the report names the age rule and what --finished waived',
  report.includes(`  min age: ${MIN_AGE}h (worktreeGcMinAgeHours), waived for --finished finished\n`),
  report.slice(0, 400),
)

// AN ORCHESTRATED LANE NO PROOF CONTAINS (asdlc-openspec-dss): a prompt review's rejected group, or
// a fan-out lane whose pick was rewritten, has a commit the trunk will never hold. `--discard` names
// its branch once the run has taken what it wants from it, and the worktree and the branch go at
// once, the tip logged. `rejected` is that lane, just committed; `discard-dirty` is the same with a
// file left in it, kept by its reason, since `--discard` waives only containment and the age rule;
// `agent/discard-bare` is a lane branch whose worktree is already gone. `inflight`, as uncontained
// and named by nobody, is the control: it stays. The guard's two cases are the route's reason: from
// a worktree a session has entered, `git worktree remove` typed there is refused, and the sweep is not.
const lane = (name, { dirty = false } = {}) => {
  const path = wt(name)
  writeFileSync(join(path, `${name}.txt`), 'rejected\n')
  git(path, 'add', `${name}.txt`)
  git(path, ...AS, 'commit', '-qm', `work the run did not carry, in ${name}`)
  if (dirty) writeFileSync(join(path, 'left.txt'), 'left\n')
  return [path, git(path, 'rev-parse', 'HEAD').trim()]
}
const [rejected, rejectedTip] = lane('rejected')
const [discardDirty] = lane('discard-dirty', { dirty: true })
git(gcPrimary, 'branch', 'agent/discard-bare', 'agent/rejected')
const discarded = runGc(
  '--discard', 'agent/rejected',
  '--discard', 'agent/discard-dirty',
  '--discard', 'agent/discard-bare',
  '--discard', 'agent/no-such-lane',
)
check(
  'a lane named by --discard goes at once, its commit in no trunk, by that reason',
  !existsSync(rejected) &&
    !registered('rejected') &&
    !branchExists('agent/rejected') &&
    discarded.includes('.claude/worktrees/rejected  agent/rejected  (clean, named by --discard)'),
  discarded.slice(0, 1500),
)
check(
  'its branch is reported deleted by that reason, and its tip logged',
  discarded.includes(`agent/rejected  ${rejectedTip.slice(0, 8)}  (named by --discard)`) &&
    readFileSync(join(gcPrimary, '.git', 'worktree-gc.log'), 'utf8').includes(`${rejectedTip} agent/rejected\n`),
  discarded.slice(0, 1500),
)
check(
  'a lane branch whose worktree is already gone is deleted by that reason',
  !branchExists('agent/discard-bare') && discarded.includes(`agent/discard-bare  ${rejectedTip.slice(0, 8)}  (named by --discard)`),
  discarded.slice(0, 1500),
)
check(
  'a dirty lane named by --discard is kept by its reason, with its branch',
  discarded.includes('.claude/worktrees/discard-dirty  agent/discard-dirty  -- 1 uncommitted change(s)') &&
    existsSync(discardDirty) &&
    branchExists('agent/discard-dirty'),
  discarded.slice(0, 1500),
)
check(
  'a name matching no branch is reported',
  discarded.includes('  --discard agent/no-such-lane: no local branch of that name'),
  discarded.slice(0, 600),
)
check(
  'control: an uncontained lane nobody names stays, by its reason',
  existsSync(inflight) &&
    branchExists('agent/inflight') &&
    discarded.includes('.claude/worktrees/inflight  agent/inflight  -- branch agent/inflight: 1 of 1 commit(s) not in origin/main'),
  discarded.slice(0, 1500),
)
const typedRemove = guardFrom(oursDir, { command: 'git worktree remove .claude/worktrees/rejected' })
check(
  'from a worktree, the guard refuses `git worktree remove` typed there, by its reason',
  typedRemove.code === 2 && typedRemove.stderr.includes(WORKTREE_RULE),
  why(typedRemove),
)
const discardRoute = guardFrom(oursDir, { command: 'mise run worktree:gc --discard agent/rejected' })
check('and lets the sweep run with --discard', discardRoute.code === 0, why(discardRoute))

// The worktree refusals, each by its reason. Survival alone would be VACUOUS for `dirty` and
// `locked`: `git worktree remove` refuses both on its own, exactly as `git branch -D` refuses a
// checked-out branch. The reason reported is the only evidence that the guard, not git, spared it.
check(
  'a dirty worktree is kept by its reason',
  report.includes('.claude/worktrees/dirty  agent/dirty  -- 1 uncommitted change(s)'),
  report.slice(0, 1200),
)
check('and survives', existsSync(dirty) && branchExists('agent/dirty'))
check(
  'its branch names the worktree and the reason, not "live"',
  report.includes(
    'agent/dirty  -- checked out by .claude/worktrees/dirty (1 uncommitted change(s))',
  ) && !report.includes('live worktree'),
  report.slice(0, 1200),
)
check(
  'its config survives with it',
  configKeys().some((k) => k === 'branch.agent/dirty.remote'),
)
check(
  'a locked worktree is kept by its reason',
  report.includes('.claude/worktrees/locked  agent/locked  -- locked'),
  report.slice(0, 1200),
)
check('and survives', existsSync(locked) && branchExists('agent/locked'))
check(
  'an in-flight worktree is kept by its reason',
  report.includes(
    '.claude/worktrees/inflight  agent/inflight  -- branch agent/inflight: 1 of 1 commit(s) not in origin/main',
  ),
  report.slice(0, 1200),
)
check('and survives', existsSync(inflight) && branchExists('agent/inflight'))
check(
  'a worktree outside .claude/worktrees/ is kept by its reason',
  report.includes('agent/elsewhere  -- outside .claude/worktrees/'),
  report.slice(0, 1200),
)
check('and survives', existsSync(elsewhere) && branchExists('agent/elsewhere'))
if (LIVE_CHECK) {
  const method = process.platform === 'linux' ? 'proc' : 'lsof'
  check(`the liveness check is ${method}`, report.includes(`  liveness: ${method}\n`), report.slice(0, 300))
  check(
    'a worktree with a process inside is kept by its reason',
    report.includes(`.claude/worktrees/busy  agent/busy  -- in use by process ${sleeper.pid}`),
    report.slice(0, 1200),
  )
  check('and survives', existsSync(busy) && branchExists('agent/busy'))
} else {
  console.log(`  skip a worktree with a process inside (no liveness check held on ${process.platform})`)
}
check('the primary checkout is not reported as a worktree', !report.includes('  .  main  --'))

// The branch refusals.
check('an unmerged branch survives', branchExists('agent/unmerged'), report.slice(0, 400))
check(
  'its config survives with it',
  configKeys().some((k) => k === 'branch.agent/unmerged.remote'),
)
check('a non-agent branch survives', branchExists('not-an-agent-branch'))
check(
  'its config survives with it',
  configKeys().some((k) => k === 'branch.not-an-agent-branch.remote'),
)
check('the trunk survives', branchExists('main'))

// A missing trunk is no evidence of containment, so neither the worktree sweep nor the branch sweep
// may run -- while the orphan sweep, which never needed the trunk, still does.
const spare = wt('spare') // clean, contained, nobody in it, named: would go on any run with a trunk
git(gcPrimary, 'config', '--local', 'branch.agent/ghost2.remote', 'origin')
const noTrunk = runGc('--trunk', 'origin/does-not-exist', '--finished', 'spare')
check('a missing trunk skips both sweeps', noTrunk.includes('MISSING'), noTrunk.slice(0, 300))
check('and still deletes nothing', branchExists('agent/unmerged') && branchExists('agent/spare'))
check(
  'and still removes nothing',
  existsSync(spare) && !noTrunk.includes('abandoned worktree'),
  noTrunk.slice(0, 300),
)
check(
  'but still collects an orphan section',
  !configKeys().some((k) => k.includes('agent/ghost2')),
  noTrunk.slice(0, 300),
)

// WHERE NO LIVENESS CHECK WORKS, the age rule is all there is (asdlc-openspec-zlz).
// `WORKTREE_GC_LIVENESS=none` stands in for such a host. `spare` was just cut, as a lane is at
// launch; `idle` has had HEAD still for twice the threshold; `rebased` is as old, but HEAD moved a
// moment ago, as a lane's rebase moves it.
const idle = wt('idle')
age(idle, 'idle', MIN_AGE * 2)
const rebased = wt('rebased')
age(rebased, 'rebased', MIN_AGE * 2)
const nowStamp = new Date()
utimesSync(join(gcPrimary, '.git', 'worktrees', 'rebased', 'HEAD'), nowStamp, nowStamp)

// With the policy unreadable there is no threshold, so nothing unseen is removed, however idle. The
// script reads the policy beside itself, so a copy with the loader beside it and no records stands in.
const noPolicyRoot = mkdtempSync(join(tmpdir(), 'wt-gc-nopolicy-'))
mkdirSync(join(noPolicyRoot, 'scripts'))
mkdirSync(join(noPolicyRoot, 'tools', 'lib'), { recursive: true })
copyFileSync(GC, join(noPolicyRoot, 'scripts', 'prune-worktree-branches.mjs'))
copyFileSync(join(POLICY_ROOT, 'tools', 'lib', 'policy.ts'), join(noPolicyRoot, 'tools', 'lib', 'policy.ts'))
const unpolicied = runGcWith({
  script: join(noPolicyRoot, 'scripts', 'prune-worktree-branches.mjs'),
  liveness: 'none',
})
check(
  'with no liveness check and no policy, an idle worktree is kept by its reason',
  unpolicied.includes('.claude/worktrees/idle  agent/idle  -- no worktreeGcMinAgeHours to wait out'),
  unpolicied.slice(0, 1200),
)
check('and survives', existsSync(idle) && branchExists('agent/idle'))

const blind = runGcWith({ liveness: 'none' })
check(
  'the report names the missing liveness check',
  blind.includes('  liveness: none (WORKTREE_GC_LIVENESS=none)'),
  blind.slice(0, 300),
)
check(
  'with no liveness check, a worktree just cut is kept by its reason',
  blind.includes(
    `.claude/worktrees/spare  agent/spare  -- HEAD moved 0.0h ago, under worktreeGcMinAgeHours (${MIN_AGE})`,
  ),
  blind.slice(0, 1500),
)
check('and survives', existsSync(spare) && branchExists('agent/spare'))
check(
  'with no liveness check, a worktree whose HEAD just moved is kept by its reason',
  blind.includes(
    `.claude/worktrees/rebased  agent/rebased  -- HEAD moved 0.0h ago, under worktreeGcMinAgeHours (${MIN_AGE})`,
  ),
  blind.slice(0, 1500),
)
check('and survives', existsSync(rebased) && branchExists('agent/rebased'))
check(
  'with no liveness check, a worktree idle past the threshold is removed',
  !existsSync(idle) &&
    !branchExists('agent/idle') &&
    blind.includes(`.claude/worktrees/idle  agent/idle  (clean, HEAD idle ${(MIN_AGE * 2).toFixed(1)}h`),
  blind.slice(0, 1500),
)

/* --------------------------------------------------------------------------------------------- *
 * A worktree record this checkout cannot see (asdlc-openspec-486e).
 *
 * git cannot tell a worktree that was removed from one whose path it cannot see: both read as
 * `prunable`, and `git worktree prune` deletes both records. In a container on a bind-mounted clone,
 * every record of a worktree made on the host names a host path, so every one is the second kind. On
 * 2026-10-06 a push from such a container ran this selftest, whose foreign-path cases above made the
 * remove hook run `git worktree prune` on the real repository, and every linked worktree on the host
 * lost its record. In a scratch repository of its own, `unseen` has that shape, its parent directory
 * gone with it; `removed` was deleted from inside `.claude/worktrees/`, whose parent stays; `lane` is
 * live. Given a path it does not own, the remove hook touches no record: not `lane`'s, which shares
 * the foreign path's last name and so was deleted as its admin directory, and no stale one, which its
 * own prune took. The sweep refuses `prune` while a stale record's parent is missing, and keeps that
 * record holding its branch. The control is the same repository once `unseen`'s parent is back.
 * --------------------------------------------------------------------------------------------- */
console.log('a worktree record this checkout cannot see (asdlc-openspec-486e)')
const unseenRepo = mkdtempSync(join(tmpdir(), 'wt-unseen-'))
const unseenPrimary = join(unseenRepo, 'primary')
execFileSync('git', ['init', '-q', '-b', 'main', unseenPrimary], { env: GIT_ENV, encoding: 'utf8' })
git(unseenPrimary, ...AS, 'commit', '-q', '--allow-empty', '-m', 'base')
git(unseenPrimary, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
const unseenWt = (path, name) =>
  git(unseenPrimary, 'worktree', 'add', '-q', '-b', `agent/${name}`, path, 'main')
unseenWt(join(unseenPrimary, '.claude', 'worktrees', 'lane'), 'lane')
unseenWt(join(unseenPrimary, '.claude', 'worktrees', 'removed'), 'removed')
const hostSide = join(unseenRepo, 'host')
unseenWt(join(hostSide, 'worktrees', 'unseen'), 'unseen')
rmSync(join(unseenPrimary, '.claude', 'worktrees', 'removed'), { recursive: true, force: true })
rmSync(hostSide, { recursive: true, force: true })
const unseenRegistered = (name) => existsSync(join(unseenPrimary, '.git', 'worktrees', name))

// The hook works on the checkout it sits in, so a copy sits in the scratch one, run with no GIT_* key:
// under a real push an inherited GIT_DIR would point its git at this repository.
const unseenHook = join(unseenPrimary, 'scripts', 'hooks', 'worktree-remove.mjs')
mkdirSync(dirname(unseenHook), { recursive: true })
copyFileSync(REMOVE, unseenHook)
const foreign = join(unseenRepo, 'foreign', 'lane')
mkdirSync(foreign, { recursive: true })
const foreignRun = spawnSync('node', [unseenHook], {
  input: JSON.stringify({ hook_event_name: 'WorktreeRemove', worktree_path: foreign }),
  env: GIT_ENV,
  encoding: 'utf8',
})
check('the hook removes a foreign directory', foreignRun.status === 0 && !existsSync(foreign), foreignRun.stderr)
check("a live worktree sharing the foreign path's last name keeps its record", unseenRegistered('lane'))
check('a record this checkout cannot see keeps it', unseenRegistered('unseen'))
check('a removed worktree keeps it too: the hook prunes nothing', unseenRegistered('removed'))

const pruneRefused = runGcWith({ repo: unseenPrimary })
check(
  'the sweep refuses prune, by its reason',
  pruneRefused.includes('  prune refused: 1 stale record(s) whose parent directory is missing too'),
  pruneRefused.slice(0, 900),
)
check('and both stale records survive', unseenRegistered('unseen') && unseenRegistered('removed'))
check(
  'the unseen record keeps its branch, by its reason',
  git(unseenPrimary, 'branch', '--list', 'agent/unseen').trim() !== '' &&
    pruneRefused.includes('agent/unseen  -- stale record, kept while prune is refused'),
  pruneRefused.slice(0, 1500),
)
mkdirSync(join(hostSide, 'worktrees'), { recursive: true })
const prunedAfter = runGcWith({ repo: unseenPrimary })
check(
  "control: once the record's parent is back, both stale records are pruned",
  !prunedAfter.includes('prune refused') && !unseenRegistered('unseen') && !unseenRegistered('removed'),
  prunedAfter.slice(0, 900),
)
check('and the live worktree keeps its record', unseenRegistered('lane'))
// The fallback's own admin directory, for a path the hook owns. git names one after the worktree's
// last path segment and adds a number on a collision, so `.git/worktrees/<basename>` can be another
// worktree's. `elsewhere/lane` is registered first, as `lane`; the owned `lane` second, as `lane1`,
// and locked, so `git worktree remove --force` refuses it, as the sandbox does, and the fallback runs.
const twinPrimary = join(realpathSync(mkdtempSync(join(tmpdir(), 'wt-twin-'))), 'primary')
execFileSync('git', ['init', '-q', '-b', 'main', twinPrimary], { env: GIT_ENV, encoding: 'utf8' })
git(twinPrimary, ...AS, 'commit', '-q', '--allow-empty', '-m', 'base')
git(twinPrimary, 'worktree', 'add', '-q', '-b', 'agent/elsewhere-lane', join(dirname(twinPrimary), 'elsewhere', 'lane'), 'main')
const ownedLane = join(twinPrimary, '.claude', 'worktrees', 'lane')
git(twinPrimary, 'worktree', 'add', '-q', '-b', 'agent/lane', ownedLane, 'main')
git(twinPrimary, 'worktree', 'lock', ownedLane)
const twinHook = join(twinPrimary, 'scripts', 'hooks', 'worktree-remove.mjs')
mkdirSync(dirname(twinHook), { recursive: true })
copyFileSync(REMOVE, twinHook)
const ownedRun = spawnSync('node', [twinHook], {
  input: JSON.stringify({ hook_event_name: 'WorktreeRemove', worktree_path: ownedLane }),
  env: { ...GIT_ENV, WORKTREE_GC: '0' },
  encoding: 'utf8',
})
const twinRecord = (id) => existsSync(join(twinPrimary, '.git', 'worktrees', id))
check(
  'the fallback removes an owned worktree and its own record',
  ownedRun.stderr.includes('removing directly') && !existsSync(ownedLane) && !twinRecord('lane1'),
  ownedRun.stderr,
)
check('and keeps the record of the worktree whose name its own collided with', twinRecord('lane'))
// Its `.git` file is the worktree's to write, so it is not trusted alone: one rewritten to name
// another worktree's admin directory must not get that record deleted. The fallback takes only an
// admin directory whose own `gitdir` names this worktree back, the link git itself keeps.
const forged = join(twinPrimary, '.claude', 'worktrees', 'forged')
git(twinPrimary, 'worktree', 'add', '-q', '-b', 'agent/forged', forged, 'main')
git(twinPrimary, 'worktree', 'lock', forged)
writeFileSync(join(forged, '.git'), `gitdir: ${join(twinPrimary, '.git', 'worktrees', 'lane')}\n`)
const forgedRun = spawnSync('node', [twinHook], {
  input: JSON.stringify({ hook_event_name: 'WorktreeRemove', worktree_path: forged }),
  env: { ...GIT_ENV, WORKTREE_GC: '0' },
  encoding: 'utf8',
})
check(
  "a worktree whose .git file names another's admin directory leaves that record alone",
  forgedRun.stderr.includes('removing directly') && !existsSync(forged) && twinRecord('lane'),
  forgedRun.stderr,
)
// The image's half: `git gc` prunes a stale record once its index is older than
// gc.worktreePruneExpire, so in the container it would take an old host worktree's. No selftest
// builds the image, so this reads the Dockerfile's text; the trunk's before this case had no such line.
check(
  "the dev container's image sets gc.worktreePruneExpire to never",
  /^\s*(?:RUN|&&) git config --system gc\.worktreePruneExpire never\s*$/m.test(
    readFileSync(join(POLICY_ROOT, '.devcontainer', 'Dockerfile'), 'utf8'),
  ),
)

/* --------------------------------------------------------------------------------------------- *
 * prune-worktree-branches: containment after a rebase merge (asdlc-openspec-dxf).
 *
 * A rebase merge replays a branch's commits onto a trunk that has moved, and `git cherry`'s patch-id
 * hashes the diff's context lines, so a commit whose neighbouring line changed on the trunk in
 * between reads as unmerged. Two proofs follow the ancestor proof: GitHub's record of a pull request
 * merged into the trunk's branch whose head is the branch's tip, read through `gh` -- a stub first on
 * PATH here, so no case reaches GitHub -- and, where that proves nothing, a patch-id of the changed
 * lines alone. Each positive has a negative beside it that differs in the one thing its proof reads.
 * A scratch repository of its own holds only these branches, since every run of the sweep walks
 * every worktree and branch there, and the one above has many by now.
 * --------------------------------------------------------------------------------------------- */
console.log('prune-worktree-branches: containment after a rebase merge')
const rmPrimary = join(mkdtempSync(join(tmpdir(), 'wt-gc-rebase-')), 'primary')
execFileSync('git', ['init', '-q', '-b', 'main', rmPrimary], { env: GIT_ENV, encoding: 'utf8' })
const onTrunk = (file, text, msg) => {
  writeFileSync(join(rmPrimary, file), text)
  git(rmPrimary, 'add', file)
  git(rmPrimary, ...AS, 'commit', '-qm', msg)
  return git(rmPrimary, 'rev-parse', 'HEAD').trim()
}
/** `agent/<name>` cut from the trunk with one commit per `[file, text, msg]`; each commit's SHA. */
const branchWith = (name, ...commits) => {
  git(rmPrimary, 'checkout', '-q', '-b', name, 'main')
  const shas = commits.map(([file, text, msg]) => onTrunk(file, text, msg))
  git(rmPrimary, 'checkout', '-q', 'main')
  return shas
}
const rmBranchExists = (b) => {
  try {
    git(rmPrimary, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`)
    return true
  } catch {
    return false
  }
}
onTrunk('context.txt', 'one\ntwo\nthree\nfour\nfive\n', 'a file with neighbours')
onTrunk('edited.txt', 'alpha\n', 'a file whose change lands edited')
branchWith('agent/context-moved', ['context.txt', 'one\ntwo\nTHREE\nfour\nfive\n', 'change a line'])
branchWith('agent/line-edited', ['edited.txt', 'ALPHA\n', 'change a line that lands edited'])
const [prMerged] = branchWith('agent/pr-merged', ['pr-merged.txt', 'merged\n', 'merged work'])
const [prOther] = branchWith('agent/pr-other-base', ['pr-other.txt', 'other\n', 'other base'])
const [prStaleHead] = branchWith(
  'agent/pr-stale-head',
  ['pr-stale.txt', 'pushed\n', 'the head the pull request merged'],
  ['pr-stale.txt', 'pushed, then more\n', 'a commit after it'],
)
/** A worktree on `agent/<name>` with one commit of its own, which a pull request below merges; its tip. */
const mergedTree = (name) => {
  const path = join(rmPrimary, '.claude', 'worktrees', name)
  git(rmPrimary, 'worktree', 'add', '-q', '-b', `agent/${name}`, path, 'main')
  writeFileSync(join(path, `${name}.txt`), 'tree\n')
  git(path, 'add', `${name}.txt`)
  git(path, ...AS, 'commit', '-qm', `merged work in ${name}`)
  return [path, git(path, 'rev-parse', 'HEAD').trim()]
}
// `pr-worktree` is a lane long finished: HEAD still past the threshold. `pr-live` is the same shape
// with HEAD just moved, as an agent's is while it works on after its pull request merged, or after
// it rebased onto a branch that then merged (asdlc-openspec-zlz): a commit beyond `origin/main`,
// contained, no process in it between two calls.
const [prTree, prTreeTip] = mergedTree('pr-worktree')
age(prTree, 'pr-worktree', MIN_AGE * 2, rmPrimary)
const [prLive, prLiveTip] = mergedTree('pr-live')

// The trunk: a neighbour of `context-moved`'s line changes, then its commit lands as a rebase merge
// lands it; `line-edited`'s commit lands with its own changed line edited, as a resolved conflict.
onTrunk('context.txt', 'ONE\ntwo\nthree\nfour\nfive\n', 'a neighbour changes on the trunk')
git(rmPrimary, ...AS, 'cherry-pick', 'agent/context-moved')
onTrunk('edited.txt', 'ALPHA, as the merge resolved it\n', 'change a line that lands edited')
git(rmPrimary, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
check(
  'the neighbour case is one git cherry cannot see',
  git(rmPrimary, 'cherry', 'origin/main', 'agent/context-moved').startsWith('+'),
)

const merged = [
  { number: 101, headRefOid: prMerged, baseRefName: 'main' },
  { number: 102, headRefOid: prOther, baseRefName: 'release' },
  { number: 103, headRefOid: prStaleHead, baseRefName: 'main' },
  { number: 104, headRefOid: prTreeTip, baseRefName: 'main' },
  { number: 105, headRefOid: prLiveTip, baseRefName: 'main' },
]
const ghDir = mkdtempSync(join(tmpdir(), 'wt-gc-gh-'))
const mergedFile = join(ghDir, 'merged.json')
writeFileSync(mergedFile, JSON.stringify(merged))
const ghArgsFile = join(ghDir, 'args')
const stubGh = (body) => writeFileSync(join(ghDir, 'gh'), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
const ghPath = ghDir + delimiter + process.env.PATH
const MERGED_LIMIT = readPolicy(POLICY_ROOT).worktreeGcMergedPrLimit

// gh failing is no proof and no failure: the sweep runs, names why, and falls through.
stubGh("echo 'gh: offline' >&2\nexit 4")
// The two dry runs assert branch lines only, so they skip the liveness scan, the costly part of a run.
const offline = runGcWith(
  { mergedPrs: null, path: ghPath, liveness: 'none', repo: rmPrimary },
  '--dry-run',
)
check(
  'with gh failing, the report names why and the sweep still runs',
  offline.includes('  merged pull requests: none (gh exited 4)') && !offline.startsWith('EXIT'),
  offline.slice(0, 600),
)
check(
  'and a merged pull request proves nothing, so its branch is kept by its patch reason',
  offline.includes('agent/pr-merged  -- 1 of 1 commit(s) not in origin/main'),
  offline.slice(0, 1500),
)
check(
  'but the changed-lines proof still holds a moved neighbour offline',
  /agent\/context-moved {2}[0-9a-f]{8} {2}\(all 1 patch\(es\) already in origin\/main, 1 by its changed lines alone\)/.test(
    offline,
  ),
  offline.slice(0, 1500),
)

// A fixture stands in for gh, for a by-hand run.
const byFile = runGcWith(
  { mergedPrs: mergedFile, liveness: 'none', repo: rmPrimary },
  '--dry-run',
)
check(
  'WORKTREE_GC_MERGED_PRS names a fixture in place of gh',
  byFile.includes(`  merged pull requests: ${mergedFile} (${merged.length})`) &&
    /agent\/pr-merged {2}[0-9a-f]{8} {2}\(merged as pull request #101\)/.test(byFile),
  byFile.slice(0, 1500),
)

stubGh(`printf '%s\\n' "$@" > '${ghArgsFile}'\ncat '${mergedFile}'`)
const afterMerge = runGcWith({ mergedPrs: null, path: ghPath, repo: rmPrimary })
check(
  'gh is asked for the trunk branch\'s merged pull requests, up to worktreeGcMergedPrLimit',
  existsSync(ghArgsFile) &&
    readFileSync(ghArgsFile, 'utf8').trim().split('\n').join(' ') ===
      `pr list --state merged --base main --limit ${MERGED_LIMIT} --json number,headRefOid,baseRefName`,
  existsSync(ghArgsFile) ? readFileSync(ghArgsFile, 'utf8') : 'gh was not called',
)
check(
  'the report names gh as the source',
  afterMerge.includes(`  merged pull requests: gh (${merged.length})`),
  afterMerge.slice(0, 600),
)
check(
  'a branch whose tip a merged pull request\'s head is goes, by that proof',
  !rmBranchExists('agent/pr-merged') &&
    /agent\/pr-merged {2}[0-9a-f]{8} {2}\(merged as pull request #101\)/.test(afterMerge),
  afterMerge.slice(0, 1500),
)
check(
  'a pull request merged into another base proves nothing',
  rmBranchExists('agent/pr-other-base') &&
    afterMerge.includes('agent/pr-other-base  -- 1 of 1 commit(s) not in origin/main'),
  afterMerge.slice(0, 1500),
)
check(
  'a branch with a commit past the merged head is kept by its reason',
  rmBranchExists('agent/pr-stale-head') &&
    afterMerge.includes('agent/pr-stale-head  -- 2 of 2 commit(s) not in origin/main'),
  afterMerge.slice(0, 1500),
)
check(
  'a branch whose neighbouring line moved on the trunk goes, by its changed lines',
  !rmBranchExists('agent/context-moved') &&
    /agent\/context-moved {2}[0-9a-f]{8} {2}\(all 1 patch\(es\) already in origin\/main, 1 by its changed lines alone\)/.test(
      afterMerge,
    ),
  afterMerge.slice(0, 1500),
)
check(
  'a branch whose own changed line landed edited is kept by its reason',
  rmBranchExists('agent/line-edited') &&
    afterMerge.includes('agent/line-edited  -- 1 of 1 commit(s) not in origin/main'),
  afterMerge.slice(0, 1500),
)
check(
  'a worktree whose branch a pull request merged, idle past the threshold, is removed, by that proof',
  !existsSync(prTree) &&
    afterMerge.includes(
      `.claude/worktrees/pr-worktree  agent/pr-worktree  (clean, HEAD idle ${(MIN_AGE * 2).toFixed(1)}h, merged as pull request #104)`,
    ),
  afterMerge.slice(0, 1500),
)
check(
  'the same with HEAD just moved, as an agent works on between its calls, is kept by its reason',
  existsSync(prLive) &&
    rmBranchExists('agent/pr-live') &&
    afterMerge.includes(
      `.claude/worktrees/pr-live  agent/pr-live  -- HEAD moved 0.0h ago, under worktreeGcMinAgeHours (${MIN_AGE})`,
    ),
  afterMerge.slice(0, 1500),
)

/* --------------------------------------------------------------------------------------------- *
 * prune-worktree-branches: the trunk remote's branches, with --remote (asdlc-openspec-jbi4).
 *
 * A pushed agent/* branch whose commits another branch's pull request carried is never a pull
 * request's head, so GitHub never deletes it, and the sweep listed `refs/heads/` alone, so it never
 * saw one with no local copy. The remote here is a fixture BARE repository under the temporary
 * directory, so every deletion lands there. `landed` is the incident's shape: pushed, its commit
 * landed on the trunk with a new hash, and no local copy. Each refusal is asserted by its reason:
 * `pending` has a commit not upstream, `release` and `main` are protected, `held` is checked out by
 * a kept worktree, and `raced` moved on the remote to a tip this repository never fetched. A stub
 * `git` then reports `raced` at its old tip, as a push landing between the read and the deletion
 * leaves it, and the lease refuses the deletion. A run given --discard, as an orchestrator runs it
 * through the task that passes --remote, must delete no
 * remote branch, `landed` included, and either flag with no value after it must be refused. The
 * undoctored control is the run the `WorktreeRemove` hook makes, with no --remote, which must neither
 * read nor change the remote.
 * --------------------------------------------------------------------------------------------- */
console.log("prune-worktree-branches: the trunk remote's branches, with --remote")
const rbRoot = mkdtempSync(join(tmpdir(), 'wt-gc-remote-'))
const rbBare = join(rbRoot, 'remote.git')
const rbPrimary = join(rbRoot, 'primary')
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', rbBare], { env: GIT_ENV, encoding: 'utf8' })
execFileSync('git', ['init', '-q', '-b', 'main', rbPrimary], { env: GIT_ENV, encoding: 'utf8' })
/** Commit `file` holding `text` in the checkout `cwd`; the new commit's SHA. */
const rbCommit = (cwd, file, text, msg) => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', file)
  git(cwd, ...AS, 'commit', '-qm', msg)
  return git(cwd, 'rev-parse', 'HEAD').trim()
}
/** The tip of `refs/heads/<b>` on the fixture remote, or `null` once it is gone. */
const onRemote = (b) => {
  try {
    return git(rbBare, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`).trim()
  } catch {
    return null
  }
}
rbCommit(rbPrimary, 'base.txt', 'base\n', 'base')
git(rbPrimary, 'remote', 'add', 'origin', rbBare)
git(rbPrimary, 'checkout', '-q', '-b', 'agent/landed')
const rbLanded = rbCommit(rbPrimary, 'landed.txt', 'landed\n', 'work another pull request carried')
git(rbPrimary, 'checkout', '-q', '-b', 'agent/pending', 'main')
rbCommit(rbPrimary, 'pending.txt', 'pending\n', 'work still in flight')
git(rbPrimary, 'checkout', '-q', 'main')
// The trunk moves on, then gains `landed`'s commit with a new hash, as a rebase merge gives it.
rbCommit(rbPrimary, 'trunk.txt', 'trunk\n', 'the trunk moves on')
git(rbPrimary, ...AS, 'cherry-pick', 'agent/landed')
const rbTrunk = git(rbPrimary, 'rev-parse', 'HEAD').trim()
// Every branch but `landed` and `pending` is pushed at the trunk commit, so only its name or a
// guard keeps it.
const rbRefspecs = [
  'main:refs/heads/main',
  'agent/landed:refs/heads/agent/landed',
  'agent/pending:refs/heads/agent/pending',
  'main:refs/heads/release',
  'main:refs/heads/feature/human',
  'main:refs/heads/agent/held',
  'main:refs/heads/agent/raced',
]
const rbPushed = rbRefspecs.map((spec) => spec.slice(spec.indexOf(':refs/heads/') + ':refs/heads/'.length))
git(rbPrimary, 'push', '-q', 'origin', ...rbRefspecs)
git(rbPrimary, 'branch', '-D', 'agent/landed', 'agent/pending')
git(rbPrimary, 'worktree', 'add', '-q', '-b', 'agent/held', join(rbPrimary, '.claude', 'worktrees', 'held'), 'main')
// Another clone moves `raced` on to a commit this repository never fetches.
const rbOther = join(rbRoot, 'other')
execFileSync('git', ['clone', '-q', '-b', 'agent/raced', rbBare, rbOther], { env: GIT_ENV, encoding: 'utf8' })
const rbRaced = rbCommit(rbOther, 'raced.txt', 'raced\n', 'pushed after the sweep read the remote')
git(rbOther, 'push', '-q', 'origin', 'agent/raced')
check(
  'the fixture: landed is no ancestor of the trunk, so only its patches can clear it',
  git(rbPrimary, 'cherry', 'origin/main', rbLanded).startsWith('-') &&
    rbPushed.every((b) => onRemote(b) !== null) &&
    onRemote('agent/raced') === rbRaced,
)
const rbRun = (...extra) => runGcWith({ liveness: 'none', repo: rbPrimary }, ...extra)
const LANDED_LINE = `origin/agent/landed  ${rbLanded.slice(0, 8)}  (all 1 patch(es) already in origin/main)`

const rbControl = rbRun()
check(
  'control: without --remote, as the WorktreeRemove hook runs it, the remote is neither read nor changed',
  !/^ {2}(?:remote|kept \d+ remote|would delete \d+ remote|deleted \d+ remote)/m.test(rbControl) &&
    !rbControl.startsWith('EXIT') &&
    rbPushed.every((b) => onRemote(b) !== null),
  rbControl.slice(0, 900),
)

const rbPreview = rbRun('--remote', '--dry-run')
check(
  '--dry-run reports the remote branch it would delete, by its proof',
  rbPreview.includes(`  remote origin: ${rbPushed.length} branch(es) listed\n`) &&
    rbPreview.includes('  would delete 1 remote branch(es) whose work is already in origin/main:\n') &&
    rbPreview.includes(`    ${LANDED_LINE}\n`),
  rbPreview.slice(0, 1500),
)
check('and deletes none', rbPushed.every((b) => onRemote(b) !== null), rbPreview.slice(0, 1500))

git(rbPrimary, 'remote', 'set-url', 'origin', join(rbRoot, 'nowhere.git'))
const rbUnreachable = rbRun('--remote')
git(rbPrimary, 'remote', 'set-url', 'origin', rbBare)
check(
  'an unreachable remote deletes no remote branch, says why, and the run does not fail',
  /^ {2}remote origin: not read \(fatal: .*does not appear to be a git repository\), so no remote branch is deleted$/m.test(
    rbUnreachable,
  ) &&
    !rbUnreachable.startsWith('EXIT') &&
    onRemote('agent/landed') === rbLanded,
  rbUnreachable.slice(0, 1500),
)

// THE DISCARD RUN. An orchestrator's `mise run worktree:gc --discard <branch>` carries the task's
// `--remote`, and an agent that runs it was not asked to write to origin, so it deletes no remote
// branch: `landed`, which the run below deletes, must survive it. `discarded` is the lane it names,
// with a commit no trunk holds, and its deletion shows the run did not stop short.
git(rbPrimary, 'checkout', '-q', '-b', 'agent/discarded')
const rbDiscarded = rbCommit(rbPrimary, 'discarded.txt', 'discarded\n', 'a lane the run did not carry')
git(rbPrimary, 'checkout', '-q', 'main')
const rbDiscardRun = rbRun('--discard', 'agent/discarded', '--remote')
check(
  'a run given --discard deletes no remote branch, even with --remote, and says why',
  rbPushed.every((b) => onRemote(b) !== null) &&
    onRemote('agent/landed') === rbLanded &&
    rbDiscardRun.includes(
      '  remote origin: not read (--discard was given; only a run without --discard or --finished sweeps the remote), so no remote branch is deleted\n',
    ),
  rbDiscardRun.slice(0, 1500),
)
check(
  'while the branch it names is deleted, by that reason',
  rbDiscardRun.includes(`    agent/discarded  ${rbDiscarded.slice(0, 8)}  (named by --discard)\n`),
  rbDiscardRun.slice(0, 1500),
)

// THE FINISHED RUN, and the flags with no value (2026-10-05, the push security review of #147).
// `open-pr` § 8 runs `mise run worktree:gc --finished <worktree>` for real once its dry run
// names only its own worktree, which a remote line does not contradict, so it too carries the task's
// `--remote` from an agent: `landed` must survive it. `--discard` or `--finished` with nothing after
// it, or with a flag after it, is the caller's name left out, so the run is refused rather than made
// without it, a bare run that would sweep the remote, or with the flag swallowed as the name.
const rbFinishedRun = rbRun('--finished', 'no-such-worktree', '--remote')
check(
  'a run given --finished deletes no remote branch, even with --remote, and says why',
  rbPushed.every((b) => onRemote(b) !== null) &&
    onRemote('agent/landed') === rbLanded &&
    rbFinishedRun.includes(
      '  remote origin: not read (--finished was given; only a run without --discard or --finished sweeps the remote), so no remote branch is deleted\n',
    ),
  rbFinishedRun.slice(0, 1500),
)
/** Every pushed branch's tip on the fixture remote, so a case can show its run changed none. */
const rbTips = () => rbPushed.map(onRemote).join()
for (const [label, extra, reason] of [
  ['--discard with no branch after it', ['--remote', '--discard'], 'prune-worktree-branches: --discard needs a branch\n'],
  [
    '--discard with a flag where its branch goes',
    ['--remote', '--discard', '--dry-run'],
    'prune-worktree-branches: --discard needs a branch, and --dry-run is a flag\n',
  ],
  [
    '--finished with a flag where its worktree goes',
    ['--remote', '--finished', '--dry-run'],
    'prune-worktree-branches: --finished needs a worktree name or path, and --dry-run is a flag\n',
  ],
]) {
  const before = rbTips()
  const refused = rbRun(...extra)
  check(
    `${label} is refused, by its reason, and the remote is unchanged`,
    refused === `EXIT 1: ${reason}` && rbTips() === before,
    refused.slice(0, 600),
  )
}

const rbSwept = rbRun('--remote')
check(
  'a remote branch whose patches are upstream is deleted, by that proof',
  onRemote('agent/landed') === null &&
    rbSwept.includes('  deleted 1 remote branch(es) whose work is already in origin/main:\n') &&
    rbSwept.includes(`    ${LANDED_LINE}\n`),
  rbSwept.slice(0, 1500),
)
const rbLog = join(rbPrimary, '.git', 'worktree-gc.log')
check(
  'and logged, with its restore command',
  existsSync(rbLog) &&
    readFileSync(rbLog, 'utf8').includes(` ${rbLanded} origin/agent/landed\n`) &&
    rbSwept.includes('  restore any of them with:  git push origin <sha>:refs/heads/<branch>\n'),
  rbSwept.slice(0, 1500),
)
for (const [label, branch, reason] of [
  ['a remote branch with a commit not upstream', 'agent/pending', '1 of 1 commit(s) not in origin/main'],
  ['a protected remote branch', 'release', 'a protected branch'],
  ['the trunk itself', 'main', 'a protected branch'],
  [
    'a remote branch a kept worktree has checked out',
    'agent/held',
    `checked out by .claude/worktrees/held (HEAD moved 0.0h ago, under worktreeGcMinAgeHours (${MIN_AGE}))`,
  ],
  [
    'a remote branch whose tip this repository never fetched',
    'agent/raced',
    `tip ${rbRaced.slice(0, 8)} is not in this repository; fetch it first`,
  ],
]) {
  check(
    `${label} is kept, by its reason`,
    onRemote(branch) !== null && rbSwept.includes(`    origin/${branch}  -- ${reason}\n`),
    rbSwept.slice(0, 1500),
  )
}
check(
  'a human branch is neither touched nor reported',
  onRemote('feature/human') !== null && !rbSwept.includes('feature/human'),
  rbSwept.slice(0, 1500),
)

// THE LEASE. A stub `git` first on PATH answers `ls-remote` with `raced` at the trunk commit it was
// pushed at, which the sweep proves contained; the remote holds the newer commit, so the deletion
// must be refused by git's lease, by its reason, and the newer commit must survive.
const rbStubDir = mkdtempSync(join(tmpdir(), 'wt-gc-remote-git-'))
const realGit = execFileSync('sh', ['-c', 'command -v git'], { env: GIT_ENV, encoding: 'utf8' }).trim()
writeFileSync(
  join(rbStubDir, 'git'),
  `#!/bin/sh\nif [ "$3" = ls-remote ]; then printf '%s\\trefs/heads/agent/raced\\n' '${rbTrunk}'; exit 0; fi\nexec '${realGit}' "$@"\n`,
  { mode: 0o755 },
)
const rbRacedRun = runGcWith(
  { liveness: 'none', repo: rbPrimary, path: rbStubDir + delimiter + process.env.PATH },
  '--remote',
)
check(
  'a remote branch that moved after the read is kept, by the lease refusing its deletion',
  onRemote('agent/raced') === rbRaced &&
    rbRacedRun.includes(
      '    origin/agent/raced  -- git push --delete refused it: ! [rejected] (delete) -> agent/raced (stale info)\n',
    ),
  rbRacedRun.slice(0, 1500),
)

/* --------------------------------------------------------------------------------------------- *
 * render-worktree-context: the briefing a new worktree opens with.
 *
 * THE GAP (asdlc-openspec-pb2). This job's glob names the template and its renderer, and until
 * 2026-09-25 no case here read either, so a change to the template ran a selftest that passed without
 * looking at it. Two template changes were proved by a render run by hand into `.scratch/` instead:
 * asdlc-openspec-iy4's on 2026-09-23, and asdlc-openspec-zgh.6's port paragraphs on 2026-09-24.
 *
 * The renderer and the committed template are COPIED into a scratch checkout, because the renderer
 * finds the template beside itself and has no root override: run in place, a write relative to its own
 * checkout would land in this one. The copy runs from an empty directory, and every file under the
 * scratch root is listed afterwards, so a write anywhere but the path it was handed shows. The values
 * are hostile on purpose: `&` and `\` are what `sed` mangled (the renderer's header records `a&b`
 * rendering as `a{{WORKTREE_PATH}}b`), and `$&`, `$$` and `$1` are what `String.replace` expands when
 * it is handed a replacement string rather than a function.
 *
 * The control is the committed template, which must render clean. The negative is the same template
 * with a placeholder the renderer does not supply, which must be refused by its reason with nothing
 * written: without it, a renderer that lost its leftover check would still pass the control.
 * --------------------------------------------------------------------------------------------- */
console.log('render-worktree-context: the briefing template, rendered')
const RENDERER = resolve(HOOKS, '..', 'render-worktree-context.mjs')
const TEMPLATE_TEXT = readFileSync(
  resolve(HOOKS, '..', '..', '.claude', 'worktree-CONTEXT.md.tmpl'),
  'utf8',
)
const HOSTILE = { BRANCH: 'agent/b&r\\$&', BASE_SHA: 's&h\\$$a', TASK_REF: 't&sk\\$&$1' }
const COPIED = [
  join('checkout', '.claude', 'worktree-CONTEXT.md.tmpl'),
  join('checkout', 'scripts', 'render-worktree-context.mjs'),
].sort()

/**
 * Render `template` through a copy of the renderer in a fresh scratch checkout, with the arguments
 * `scripts/new-worktree.sh` passes, into a worktree directory named `a&b`. Returns the run, the
 * worktree path it was handed, and every file under the scratch root afterwards, relative to it.
 */
function render(template) {
  const root = mkdtempSync(join(tmpdir(), 'wt-render-'))
  const copy = join(root, 'checkout', 'scripts', 'render-worktree-context.mjs')
  mkdirSync(dirname(copy), { recursive: true })
  mkdirSync(join(root, 'checkout', '.claude'))
  copyFileSync(RENDERER, copy)
  writeFileSync(join(root, 'checkout', '.claude', 'worktree-CONTEXT.md.tmpl'), template)
  const worktree = join(root, 'a&b')
  mkdirSync(worktree)
  mkdirSync(join(root, 'cwd'))
  // GIT_ENV, because the renderer runs `git worktree list` to spare its siblings' ports, and under a
  // real push an inherited GIT_DIR would point that at this repository.
  const r = spawnSync('node', [copy, worktree, HOSTILE.BRANCH, HOSTILE.BASE_SHA, HOSTILE.TASK_REF], {
    cwd: join(root, 'cwd'),
    env: GIT_ENV,
    encoding: 'utf8',
  })
  const files = readdirSync(root, { recursive: true })
    .filter((p) => statSync(join(root, p)).isFile())
    .sort()
  return { code: r.status ?? 1, stderr: r.stderr ?? '', worktree, files }
}

const rendered = render(TEMPLATE_TEXT)
check(
  'the committed template renders',
  rendered.code === 0,
  `code=${rendered.code} ${rendered.stderr}`,
)
const contextFile = join(rendered.worktree, '.worktree', 'CONTEXT.md')
const context = existsSync(contextFile) ? readFileSync(contextFile, 'utf8') : ''
// Broader than the renderer's own `{{[A-Z_]+}}`, so a mistyped `{{app_port}}` is caught here too.
const survivors = context.match(/\{\{[^}]*\}\}/g) ?? []
check(
  'no {{PLACEHOLDER}} survives',
  context !== '' && survivors.length === 0,
  survivors.join(', '),
)
// Each value appears exactly as often as its placeholder does in the template. A mangled value is
// missing from the count; one that `$&` expanded also leaves its placeholder for the check above.
let exercised = 0
for (const [key, value] of Object.entries({ WORKTREE_PATH: rendered.worktree, ...HOSTILE })) {
  const want = TEMPLATE_TEXT.split(`{{${key}}}`).length - 1
  if (want === 0) continue
  exercised += 1
  const got = context.split(value).length - 1
  check(
    `${key} renders ${JSON.stringify(value)} literally`,
    got === want,
    `${got} of ${want} occurrence(s)`,
  )
}
check('the template carries a placeholder the hostile values reach', exercised > 0)
const WRITTEN = [join('a&b', '.worktree', 'CONTEXT.md'), join('a&b', '.worktree', 'ports.env')]
check(
  'CONTEXT.md and ports.env are written under the path given, and nothing else is',
  JSON.stringify(rendered.files) === JSON.stringify([...COPIED, ...WRITTEN].sort()),
  JSON.stringify(rendered.files),
)
// The banner once said the file was read by a `vite.config.ts` this repository never had
// (asdlc-openspec-5pf). It must name its reader, every file it names must exist here, and the pair
// must be in the one form that reader parses, or the next worktree is handed the same ports.
const portsFile = join(rendered.worktree, '.worktree', 'ports.env')
const portsText = existsSync(portsFile) ? readFileSync(portsFile, 'utf8') : ''
const banner = portsText.split('\n').filter((line) => line.startsWith('#'))
const named = banner.join('\n').match(/[\w./-]+\.(?:mjs|js|ts|md|json|sh)\b/g) ?? []
const missing = named.filter((path) => !existsSync(resolve(HOOKS, '..', '..', path)))
check(
  'ports.env names its reader, and every file it names exists',
  named.includes('scripts/render-worktree-context.mjs') && missing.length === 0,
  `named ${JSON.stringify(named)}, missing ${JSON.stringify(missing)}`,
)
check(
  'and it holds the pair in the form that reader parses',
  JSON.stringify([...portsText.matchAll(/^([A-Z_]+)=\d+$/gm)].map((m) => m[1])) ===
    JSON.stringify(['APP_PORT', 'SB_PORT']),
  JSON.stringify(portsText),
)

const refused = render(`${TEMPLATE_TEXT}\n{{DB_NAME}}\n`)
check(
  'a placeholder the renderer does not supply is refused, by its reason',
  refused.code === 1 &&
    refused.stderr.includes('unsubstituted placeholders in the rendered context: {{DB_NAME}}'),
  `code=${refused.code} ${JSON.stringify(refused.stderr.slice(0, 200))}`,
)
check(
  'and nothing is written',
  JSON.stringify(refused.files) === JSON.stringify(COPIED),
  JSON.stringify(refused.files),
)

/* --------------------------------------------------------------------------------------------- *
 * new-worktree.sh: the briefing is the base's template, not the checkout's.
 *
 * THE INCIDENT (asdlc-openspec-kce). The script ran the primary checkout's renderer, which reads the
 * template beside itself, so a worktree cut from `origin/main` opened with whatever template the
 * checkout's working tree held. On 2026-09-23 and again on 2026-09-25 that was an older one, and the
 * briefing, which `CLAUDE.md` gives precedence, carried steps the base had already replaced. The
 * render case above could not see it: it copies one template beside the renderer, so there is no
 * second template to read by mistake.
 *
 * So this case builds a scratch repository whose checkout trails its remote by one commit, a commit
 * that changes only the template, and runs the checkout's copy of the script from the checkout, as
 * the WorktreeCreate hook runs it. The briefing must be the base's template, rendered, word for word.
 * The negative is the same script doctored back to the checkout's renderer, which must render the
 * checkout's template: without it, a scratch repository whose two templates never differed would
 * pass the case.
 * --------------------------------------------------------------------------------------------- */
console.log("new-worktree: the briefing is the base's template, not the checkout's")
const PROVISION = resolve(HOOKS, '..', 'new-worktree.sh')
const trailing = mkdtempSync(join(tmpdir(), 'wt-base-'))
const trailingPrimary = join(trailing, 'primary')
const trailingOrigin = join(trailing, 'origin.git')
const templateOf = (where) =>
  `rendered from the ${where}: {{BRANCH}} cut at {{BASE_SHA}} for {{TASK_REF}}\n`

execFileSync('git', ['init', '-q', '--bare', '-b', 'main', trailingOrigin], { env: GIT_ENV })
execFileSync('git', ['init', '-q', '-b', 'main', trailingPrimary], { env: GIT_ENV })
mkdirSync(join(trailingPrimary, 'scripts'))
mkdirSync(join(trailingPrimary, '.claude'))
copyFileSync(PROVISION, join(trailingPrimary, 'scripts', 'new-worktree.sh'))
copyFileSync(RENDERER, join(trailingPrimary, 'scripts', 'render-worktree-context.mjs'))
const trailingTemplate = join(trailingPrimary, '.claude', 'worktree-CONTEXT.md.tmpl')
writeFileSync(trailingTemplate, templateOf('checkout'))
git(trailingPrimary, 'add', '.')
git(trailingPrimary, ...AS, 'commit', '-qm', 'the template the checkout keeps')
writeFileSync(trailingTemplate, templateOf('base'))
git(trailingPrimary, ...AS, 'commit', '-qam', 'the template the base moves on to')
git(trailingPrimary, 'remote', 'add', 'origin', trailingOrigin)
git(trailingPrimary, 'push', '-q', 'origin', 'main')
// The checkout falls one commit behind the remote, as a primary checkout nobody has pulled does.
git(trailingPrimary, 'reset', '-q', '--hard', 'HEAD~1')

/**
 * Provision `name` by running `script` with bash from a scratch checkout, `primary` (the trailing
 * one unless named), as the WorktreeCreate hook runs it, and return the run with the worktree's path
 * and the briefing it wrote. The variables the script reads are pinned, so a developer's own
 * `WORKTREE_ROOT` or `TRUNK_BRANCH` cannot move the case.
 */
function provision(script, name, primary = trailingPrimary) {
  const worktrees = join(primary, '.claude', 'worktrees')
  const r = spawnSync('bash', [script, name], {
    cwd: primary,
    env: { ...GIT_ENV, WORKTREE_ROOT: worktrees, TRUNK_BRANCH: 'main', LIFETIME_HOURS: '2' },
    encoding: 'utf8',
  })
  const briefing = join(worktrees, name, '.worktree', 'CONTEXT.md')
  return {
    code: r.status ?? 1,
    stderr: r.stderr ?? '',
    path: join(worktrees, name),
    text: existsSync(briefing) ? readFileSync(briefing, 'utf8') : '',
  }
}
/** The template `where` holds, rendered with the values the script passes for `name`. */
function expected(where, name) {
  const base = git(trailingPrimary, 'rev-parse', '--short', 'origin/main').trim()
  const values = { BRANCH: `agent/${name}`, BASE_SHA: base, TASK_REF: name }
  return templateOf(where).replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => values[key])
}

const fromBase = provision(join(trailingPrimary, 'scripts', 'new-worktree.sh'), 'fresh')
check(
  'a checkout trailing its base provisions a worktree',
  fromBase.code === 0,
  `code=${fromBase.code} ${JSON.stringify(fromBase.stderr.slice(0, 300))}`,
)
check(
  "its briefing is the base's template, rendered",
  fromBase.text === expected('base', 'fresh'),
  JSON.stringify(fromBase.text),
)

const RUNS_ITS_OWN = 'node "$WORKTREE_PATH/scripts/render-worktree-context.mjs"'
const doctoredScript = join(trailing, 'new-worktree.doctored.sh')
const provisionSource = readFileSync(PROVISION, 'utf8')
writeFileSync(
  doctoredScript,
  provisionSource.replace(RUNS_ITS_OWN, 'node "$REPO_ROOT/scripts/render-worktree-context.mjs"'),
)
check(
  "negative: the doctoring reaches the script's renderer line",
  provisionSource.includes(RUNS_ITS_OWN),
  `no ${RUNS_ITS_OWN} in scripts/new-worktree.sh`,
)
const fromCheckout = provision(doctoredScript, 'doctored')
check(
  "doctored to run the checkout's renderer, it renders the checkout's template",
  fromCheckout.code === 0 && fromCheckout.text === expected('checkout', 'doctored'),
  `code=${fromCheckout.code} ${JSON.stringify(fromCheckout.text || fromCheckout.stderr.slice(0, 300))}`,
)

/* --------------------------------------------------------------------------------------------- *
 * new-worktree.sh: a worktree gets the primary checkout's Vale styles.
 *
 * THE INCIDENT (asdlc-openspec-hv8). `.vale.ini` names a StylesPath that `.gitignore` ignores,
 * because `vale sync` downloads it, so `git worktree add` brought no styles across. The
 * vale@agent-tools plugin's hook then answered every Write and Edit in a worktree with "E201: The
 * path '<worktree>/.vale-styles' does not exist", a notice that reads like a check that ran, while
 * no prose written in a worktree was checked. Seen on 2026-09-30 in two worktrees cut at ff2aaad.
 *
 * So this case gives a scratch checkout this checkout's own `.vale.ini` and `.gitignore`, and a
 * styles directory at the StylesPath that `.vale.ini` names, made before `git add .`, as `vale sync`
 * leaves one. The worktree must hold the same styles and stay clean to `git status`, because
 * `git worktree remove` refuses a tree that is not. With no styles in the checkout, the script must
 * still provision, and say that Vale checks nothing and what it needs. The negative is the script
 * doctored to skip the copy, which must leave the worktree without styles: without it, styles the
 * copied `.gitignore` failed to ignore would be committed, reach the worktree by checkout, and pass
 * the case.
 * --------------------------------------------------------------------------------------------- */
console.log("new-worktree: a worktree gets the primary checkout's Vale styles")
const CHECKOUT_ROOT = resolve(HOOKS, '..', '..')
const vale = mkdtempSync(join(tmpdir(), 'wt-vale-'))
const valePrimary = join(vale, 'primary')
const valeOrigin = join(vale, 'origin.git')
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', valeOrigin], { env: GIT_ENV })
execFileSync('git', ['init', '-q', '-b', 'main', valePrimary], { env: GIT_ENV })
mkdirSync(join(valePrimary, 'scripts'))
mkdirSync(join(valePrimary, '.claude'))
copyFileSync(PROVISION, join(valePrimary, 'scripts', 'new-worktree.sh'))
copyFileSync(RENDERER, join(valePrimary, 'scripts', 'render-worktree-context.mjs'))
writeFileSync(join(valePrimary, '.claude', 'worktree-CONTEXT.md.tmpl'), templateOf('base'))
for (const file of ['.vale.ini', '.gitignore']) {
  copyFileSync(join(CHECKOUT_ROOT, file), join(valePrimary, file))
}
const stylesPath = /^\s*StylesPath\s*=\s*(.+?)\s*$/m.exec(
  readFileSync(join(valePrimary, '.vale.ini'), 'utf8'),
)?.[1]
if (!stylesPath) throw new Error('.vale.ini names no StylesPath, so the Vale case has nothing to copy')
const RULE = join('Probe', 'Rule.yml')
const RULE_TEXT = "extends: existence\nmessage: probe\ntokens: ['probe']\n"
/** Give the scratch checkout styles at StylesPath, as `vale sync` leaves them. */
function syncStyles() {
  mkdirSync(join(valePrimary, stylesPath, 'Probe'), { recursive: true })
  writeFileSync(join(valePrimary, stylesPath, RULE), RULE_TEXT)
}
syncStyles()
git(valePrimary, 'add', '.')
git(valePrimary, ...AS, 'commit', '-qm', 'a checkout that has adopted Vale')
git(valePrimary, 'remote', 'add', 'origin', valeOrigin)
git(valePrimary, 'push', '-q', 'origin', 'main')
const valeScript = join(valePrimary, 'scripts', 'new-worktree.sh')
/** The styles rule in `worktree`, or null when the worktree has none. */
const ruleIn = (worktree) => {
  const rule = join(worktree, stylesPath, RULE)
  return existsSync(rule) ? readFileSync(rule, 'utf8') : null
}

const synced = provision(valeScript, 'synced', valePrimary)
check(
  'a checkout with synced styles provisions a worktree',
  synced.code === 0,
  `code=${synced.code} ${JSON.stringify(synced.stderr.slice(0, 300))}`,
)
check(
  "the worktree holds the checkout's styles",
  ruleIn(synced.path) === RULE_TEXT,
  `no ${join(stylesPath, RULE)} in ${synced.path}`,
)
const syncedStatus = existsSync(synced.path)
  ? git(synced.path, 'status', '--porcelain', '--untracked-files=all')
  : '(no worktree)'
check(
  'and stays clean to git status, so `git worktree remove` takes it',
  syncedStatus.trim() === '',
  JSON.stringify(syncedStatus),
)

const COPIES_STYLES = 'cp -R "$entry" "$WORKTREE_PATH/$STYLES/"'
check(
  "negative: the doctoring reaches the script's copy of the styles",
  provisionSource.includes(COPIES_STYLES),
  `no ${COPIES_STYLES} in scripts/new-worktree.sh`,
)
const noCopyScript = join(vale, 'new-worktree.no-copy.sh')
writeFileSync(noCopyScript, provisionSource.replace(COPIES_STYLES, ':'))
const noCopy = provision(noCopyScript, 'no-copy', valePrimary)
check(
  'doctored to skip the copy, it leaves the worktree without styles',
  noCopy.code === 0 && ruleIn(noCopy.path) === null,
  `code=${noCopy.code} rule=${JSON.stringify(ruleIn(noCopy.path))}`,
)

/*
 * A style the base tracks under the StylesPath, as it tracks `Layout` (asdlc-openspec-m7p). The
 * worktree then has the StylesPath from its own checkout, and the copy once skipped the StylesPath
 * whole whenever the worktree had it, so the synced styles never arrived and Vale loaded no config.
 * The checkout's own `.gitignore` decides what is tracked, so the case also holds that it tracks
 * `Layout` and no synced style. The tracked style must stay the base's even where the primary's
 * working copy of it differs. The negative doctors the per-entry test back to the StylesPath's, the
 * old skip, which must leave the synced styles out.
 */
const TRACKED = join('Layout', 'Rule.yml')
const TRACKED_TEXT = "extends: existence\nmessage: tracked\ntokens: ['tracked']\n"
/** The tracked rule in `worktree`, or null when the worktree has none. */
const trackedIn = (worktree) => {
  const rule = join(worktree, stylesPath, TRACKED)
  return existsSync(rule) ? readFileSync(rule, 'utf8') : null
}
mkdirSync(join(valePrimary, stylesPath, 'Layout'), { recursive: true })
writeFileSync(join(valePrimary, stylesPath, TRACKED), TRACKED_TEXT)
git(valePrimary, 'add', '.')
const staged = git(valePrimary, 'diff', '--cached', '--name-only').trim()
check(
  "the checkout's .gitignore tracks a style named Layout under the StylesPath, and no synced one",
  staged === `${stylesPath}/Layout/Rule.yml`,
  JSON.stringify(staged),
)
git(valePrimary, ...AS, 'commit', '-qm', 'a checkout that tracks a style of its own')
git(valePrimary, 'push', '-q', 'origin', 'main')
writeFileSync(join(valePrimary, stylesPath, TRACKED), "the primary's working copy, never committed\n")

const tracked = provision(valeScript, 'tracked', valePrimary)
check(
  'a checkout whose base tracks a style provisions a worktree',
  tracked.code === 0,
  `code=${tracked.code} ${JSON.stringify(tracked.stderr.slice(0, 300))}`,
)
check(
  "the worktree holds the tracked style as the base has it, and the checkout's synced styles",
  trackedIn(tracked.path) === TRACKED_TEXT && ruleIn(tracked.path) === RULE_TEXT,
  `tracked=${JSON.stringify(trackedIn(tracked.path))} synced=${JSON.stringify(ruleIn(tracked.path))}`,
)
const trackedStatus = existsSync(tracked.path)
  ? git(tracked.path, 'status', '--porcelain', '--untracked-files=all')
  : '(no worktree)'
check('and stays clean to git status', trackedStatus.trim() === '', JSON.stringify(trackedStatus))

const SKIPS_EACH = '[ -e "$WORKTREE_PATH/$STYLES/$(basename "$entry")" ]'
check(
  "negative: the doctoring reaches the script's per-entry test",
  provisionSource.includes(SKIPS_EACH),
  `no ${SKIPS_EACH} in scripts/new-worktree.sh`,
)
const wholeScript = join(vale, 'new-worktree.whole.sh')
writeFileSync(wholeScript, provisionSource.replace(SKIPS_EACH, '[ -e "$WORKTREE_PATH/$STYLES" ]'))
const whole = provision(wholeScript, 'whole', valePrimary)
check(
  'doctored to skip the StylesPath whole when the worktree has it, it leaves the synced styles out',
  whole.code === 0 && trackedIn(whole.path) === TRACKED_TEXT && ruleIn(whole.path) === null,
  `code=${whole.code} tracked=${JSON.stringify(trackedIn(whole.path))} synced=${JSON.stringify(ruleIn(whole.path))}`,
)

rmSync(join(valePrimary, stylesPath, 'Probe'), { recursive: true, force: true })
git(valePrimary, 'checkout', '--', stylesPath)
const trackedOnly = provision(valeScript, 'tracked-only', valePrimary)
check(
  'a checkout whose only style is the tracked one provisions a worktree, and says Vale checks no prose',
  trackedOnly.code === 0 && /Vale checks no prose/.test(trackedOnly.stderr) && trackedIn(trackedOnly.path) === TRACKED_TEXT,
  `code=${trackedOnly.code} ${JSON.stringify(trackedOnly.stderr.slice(0, 400))}`,
)

rmSync(join(valePrimary, stylesPath), { recursive: true, force: true })
const unsynced = provision(valeScript, 'unsynced', valePrimary)
check(
  'a checkout with no styles still provisions a worktree',
  unsynced.code === 0,
  `code=${unsynced.code} ${JSON.stringify(unsynced.stderr.slice(0, 300))}`,
)
check(
  'and says that Vale checks no prose there, and that `vale sync` would fetch the styles',
  /Vale checks no prose/.test(unsynced.stderr) &&
    unsynced.stderr.includes(stylesPath) &&
    unsynced.stderr.includes('vale sync'),
  JSON.stringify(unsynced.stderr.slice(0, 400)),
)

/* --------------------------------------------------------------------------------------------- *
 * new-worktree.sh: concurrent runs, and the branch a failed run made.
 *
 * THE INCIDENT (asdlc-openspec-686). On 2026-09-26 a fan-out sweep launched eleven lanes in one
 * message, and two WorktreeCreate hooks failed with "could not lock config file .git/config: File
 * exists": `git worktree add -b ... origin/main` set the new branch's upstream, a write to the
 * shared `.git/config` that concurrent runs race for, and the cleanup trap acted only once the
 * worktree existed, so each failure left its branch behind with no worktree. A `.git/config.lock`
 * the case holds stands in for the concurrent run that holds it, which makes the race certain.
 *
 * So, with the lock held, the script must provision and write no tracking config. The negative is
 * the script doctored back to that one `git worktree add -b`, which must fail by the lock's reason
 * and leave its branch: without it, a git that set up no upstream would pass the case unraced. A run
 * that fails after making its branch, at an occupied worktree path, must delete that branch, by its
 * reason, and leave the directory as it found it. The control is a name whose branch already exists,
 * which must fail and keep that branch, which the run did not make: without it, a trap that deleted
 * whatever branch the name gave would pass the case above.
 * --------------------------------------------------------------------------------------------- */
console.log('new-worktree: concurrent runs, and the branch a failed run made')
const race = mkdtempSync(join(tmpdir(), 'wt-race-'))
const racePrimary = join(race, 'primary')
const raceOrigin = join(race, 'origin.git')
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', raceOrigin], { env: GIT_ENV })
execFileSync('git', ['init', '-q', '-b', 'main', racePrimary], { env: GIT_ENV })
mkdirSync(join(racePrimary, 'scripts'))
mkdirSync(join(racePrimary, '.claude'))
copyFileSync(PROVISION, join(racePrimary, 'scripts', 'new-worktree.sh'))
copyFileSync(RENDERER, join(racePrimary, 'scripts', 'render-worktree-context.mjs'))
writeFileSync(join(racePrimary, '.claude', 'worktree-CONTEXT.md.tmpl'), templateOf('base'))
git(racePrimary, 'add', '.')
git(racePrimary, ...AS, 'commit', '-qm', 'a checkout lanes are cut from')
git(racePrimary, 'remote', 'add', 'origin', raceOrigin)
git(racePrimary, 'push', '-q', 'origin', 'main')
const raceScript = join(racePrimary, 'scripts', 'new-worktree.sh')
/** The tip of `agent/<name>` in the scratch checkout, or null when it has no such branch. */
const raceTip = (name) => {
  try {
    return git(racePrimary, 'rev-parse', '--verify', '--quiet', `refs/heads/agent/${name}`).trim()
  } catch {
    return null
  }
}
/** The `branch.agent/<name>.*` keys in the scratch checkout's own config. */
const trackingKeys = (name) =>
  git(racePrimary, 'config', '--local', '--name-only', '--list')
    .split('\n')
    .filter((key) => key.startsWith(`branch.agent/${name}.`))
const raceWhy = (r) => `code=${r.code} ${JSON.stringify(r.stderr.slice(0, 400))}`

const configLock = join(racePrimary, '.git', 'config.lock')
writeFileSync(configLock, '')
const held = provision(raceScript, 'held', racePrimary)
check(
  'with .git/config.lock held, as a concurrent run holds it, the script provisions a worktree',
  held.code === 0 && held.text !== '',
  raceWhy(held),
)
check('and writes no tracking config', trackingKeys('held').length === 0, JSON.stringify(trackingKeys('held')))

const CUTS_BRANCH = 'git -C "$REPO_ROOT" branch --no-track "$BRANCH" "origin/$TRUNK"'
const ADDS_WORKTREE = 'git -C "$REPO_ROOT" worktree add "$WORKTREE_PATH" "$BRANCH"'
check(
  "negative: the doctoring reaches the script's branch and worktree lines",
  provisionSource.includes(CUTS_BRANCH) && provisionSource.includes(ADDS_WORKTREE),
  `no ${CUTS_BRANCH} or no ${ADDS_WORKTREE} in scripts/new-worktree.sh`,
)
const oneStepScript = join(race, 'new-worktree.one-step.sh')
writeFileSync(
  oneStepScript,
  provisionSource
    .replace(CUTS_BRANCH, 'git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE_PATH" "origin/$TRUNK"')
    .replace(ADDS_WORKTREE, ':'),
)
const oneStep = provision(oneStepScript, 'one-step', racePrimary)
check(
  'doctored back to one `git worktree add -b`, it fails by the lock and leaves its branch behind',
  oneStep.code !== 0 &&
    oneStep.stderr.includes('could not lock config file') &&
    raceTip('one-step') !== null &&
    !existsSync(oneStep.path),
  `${raceWhy(oneStep)} branch=${raceTip('one-step')}`,
)
rmSync(configLock, { force: true })

const occupied = join(racePrimary, '.claude', 'worktrees', 'occupied')
mkdirSync(occupied, { recursive: true })
const OCCUPANT = 'a file the run did not write\n'
writeFileSync(join(occupied, 'occupant.txt'), OCCUPANT)
const blocked = provision(raceScript, 'occupied', racePrimary)
check(
  'a run that fails after making its branch deletes that branch, by its reason',
  blocked.code !== 0 &&
    blocked.stderr.includes('already exists') &&
    blocked.stderr.includes('deleting agent/occupied, the branch this run made') &&
    raceTip('occupied') === null,
  `${raceWhy(blocked)} branch=${raceTip('occupied')}`,
)
check(
  'and leaves the directory it found as it found it',
  existsSync(join(occupied, 'occupant.txt')) &&
    readFileSync(join(occupied, 'occupant.txt'), 'utf8') === OCCUPANT &&
    JSON.stringify(readdirSync(occupied)) === JSON.stringify(['occupant.txt']),
  JSON.stringify(existsSync(occupied) ? readdirSync(occupied) : null),
)

git(racePrimary, 'branch', '--no-track', 'agent/taken', 'main')
const takenTip = raceTip('taken')
const taken = provision(raceScript, 'taken', racePrimary)
check(
  'control: a run whose branch already exists fails, and keeps that branch, which it did not make',
  taken.code !== 0 &&
    taken.stderr.includes("a branch named 'agent/taken' already exists") &&
    raceTip('taken') === takenTip &&
    !existsSync(taken.path),
  `${raceWhy(taken)} branch=${raceTip('taken')}`,
)

/* --------------------------------------------------------------------------------------------- *
 * .claude/settings.json: every registered hook loads whatever the working directory is.
 *
 * THE INCIDENT (asdlc-openspec-7dj). Every hook was registered as `node scripts/hooks/<name>.mjs`,
 * a path relative to the directory the harness runs a hook in, which is the session's current one.
 * On 2026-09-25, after a Bash `cd docs`, the Stop hook failed with "Cannot find module
 * .../docs/scripts/hooks/gate-summary.mjs" and printed no verdict, and `guard-git.mjs` failed to
 * load the same way; its exit 1 does not block, so the next command ran unguarded. Each command now
 * names its script through `$CLAUDE_PROJECT_DIR` (`.claude/README.md` § The hooks).
 *
 * Each registered command runs as the harness runs a command hook, through `sh -c` with
 * `CLAUDE_PROJECT_DIR` naming this checkout, from a subdirectory of it (the incident's shape) and
 * from a directory outside it. The `node` first on PATH is a stand-in that reports the script it was
 * handed and runs nothing, because `worktree-create.mjs` provisions a real worktree when it runs. So
 * every command must be `node <script>`: that is what lets this case test one without running it.
 *
 * The control is the old relative form from the checkout root, which must load; the negative is the
 * same form from the subdirectory, which must be refused for that reason. Without the pair, a
 * stand-in that refused everything, or loaded everything, would pass every case below it.
 * --------------------------------------------------------------------------------------------- */
console.log('settings: every registered hook loads whatever the working directory')
const CHECKOUT = resolve(HOOKS, '..', '..')
const settings = JSON.parse(readFileSync(join(CHECKOUT, '.claude', 'settings.json'), 'utf8'))
const hookCommands = Object.entries(settings.hooks ?? {}).flatMap(([event, groups]) =>
  groups.flatMap((group) =>
    (group.hooks ?? [])
      .filter((hook) => hook.type === 'command')
      .map((hook) => ({ event, command: hook.command })),
  ),
)

const stubBin = mkdtempSync(join(tmpdir(), 'hook-node-'))
writeFileSync(
  join(stubBin, 'node'),
  [
    '#!/bin/sh',
    '# Stands in for node: reports the script it was handed, and runs nothing.',
    'if [ -f "$1" ]; then printf "loads %s\\n" "$1"; exit 0; fi',
    'printf "no such script: %s\\n" "$1" >&2',
    'exit 3',
    '',
  ].join('\n'),
  { mode: 0o755 },
)
const subdir = join(CHECKOUT, 'docs')
const outside = mkdtempSync(join(tmpdir(), 'hook-cwd-'))

/** Run one hook command as the harness would, from `cwd`, with the stand-in `node` first on PATH. */
function loadFrom(command, cwd) {
  const r = spawnSync('sh', ['-c', command], {
    cwd,
    env: {
      ...process.env,
      PATH: `${stubBin}${delimiter}${process.env.PATH ?? ''}`,
      CLAUDE_PROJECT_DIR: CHECKOUT,
    },
    encoding: 'utf8',
  })
  return { code: r.status ?? 1, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() }
}

const RELATIVE = 'node scripts/hooks/guard-git.mjs'
const fromRoot = loadFrom(RELATIVE, CHECKOUT)
check(
  'control: the relative form loads from the checkout root',
  fromRoot.code === 0 && fromRoot.stdout === 'loads scripts/hooks/guard-git.mjs',
  `code=${fromRoot.code} ${fromRoot.stdout} ${fromRoot.stderr}`,
)
const fromSubdir = loadFrom(RELATIVE, subdir)
check(
  'the relative form is refused from a subdirectory, by its reason',
  fromSubdir.code === 3 && fromSubdir.stderr === 'no such script: scripts/hooks/guard-git.mjs',
  `code=${fromSubdir.code} ${fromSubdir.stdout} ${fromSubdir.stderr}`,
)

check('settings.json registers a command hook', hookCommands.length > 0)
const HOOK_DIR = `${join(CHECKOUT, 'scripts', 'hooks')}${sep}`
for (const { event, command } of hookCommands) {
  if (!/^node\s/.test(command)) {
    check(`${event}: ${command} is a node command`, false, 'nothing else can be tested unrun')
    continue
  }
  for (const [where, cwd] of [
    ['a subdirectory', subdir],
    ['outside the checkout', outside],
  ]) {
    const r = loadFrom(command, cwd)
    check(
      `${event}: ${command} loads from ${where}`,
      r.code === 0 && r.stdout.startsWith(`loads ${HOOK_DIR}`),
      `code=${r.code} ${r.stdout} ${r.stderr}`,
    )
  }
}

console.log(failures === 0 ? '\nall worktree hook checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
