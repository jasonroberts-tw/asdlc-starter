/**
 * WorktreeRemove hook. The teardown half of scripts/hooks/worktree-create.mjs.
 *
 * THE DEFECT THIS PREVENTS: worktrees that cannot be removed and so are never removed. Two of them
 * were found registered days after their work had landed, and the reason they survived was not
 * neglect -- `git worktree remove` fails inside the agent sandbox:
 *
 *     error: failed to delete '.git/worktrees/<name>': Device or resource busy
 *
 * The sandbox's bind mounts hold the admin directory open, so the removal an exiting agent attempts
 * cannot succeed, and the same run leaves a read-only `.git/config.lock` behind that then blocks
 * every later `git config` write. Both are worked around below. Without a hook the harness falls
 * back to plain `git worktree remove` and inherits the whole failure.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: delete the branch. `git worktree remove` only ever removes a
 * checkout, and the branch is the work. CLAUDE.md routes a worktree's branch to trunk through a pull
 * request the orchestrator merges, which means the branch outliving its worktree is the normal case,
 * not a leak. Deleting it here would discard unpushed commits at session exit -- silently, since
 * nothing reads a hook's stdout on the remove path.
 *
 * WHAT IT DOES DO INSTEAD, once the removal is done: run `scripts/prune-worktree-branches.mjs`,
 * which removes ABANDONED sibling checkouts -- registered, clean, unattended, on a branch whose work
 * is ALREADY IN `origin/main` -- deletes worktree branches whose work is already in `origin/main` and,
 * with each one, the `branch.<name>.remote` / `.merge` pair the agent's `git push -u` wrote to the
 * shared `.git/config`, as provisioning also did until it cut the branch with `--no-track`
 * (asdlc-openspec-686). The paragraph above is why that is a separate step rather than a line here: the
 * branch being torn down now is usually unmerged, so the sweep will keep it and collect the leavings
 * of EARLIER worktrees whose pull requests have since landed -- including checkouts no teardown ever
 * ran for, because this hook fires only when the harness removes a worktree and a background job
 * that simply ends leaves its checkout registered. Nothing is deleted without proof of containment,
 * so the distinction the paragraph above draws is preserved rather than traded away -- see that
 * script's header for the two proofs it accepts, the conditions a checkout must meet to count as
 * abandoned, and why a stale or missing `origin/main` can only make it more conservative. Without
 * this the two keys per worktree accumulate for the life of the repository; 222 of 241 local config
 * keys were `branch.agent/*` when it was added.
 *
 * Its report goes to STDERR, like every other message here. The harness reads this hook's stdout,
 * and worktree-hooks.selftest.mjs asserts it stays empty.
 *
 * CONTRACT (verified against the CLI, 2.1.241). stdin is JSON:
 *   { "hook_event_name": "WorktreeRemove", "worktree_path": "<absolute path>", ... }
 * Exit zero once the worktree is gone. The harness checks the path afterwards and warns
 * "WorktreeRemove hook did not remove worktree, kept at: ..." if it is still there, so a zero exit
 * over a failed removal buys nothing.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/** Best-effort git, on stderr. Every caller below has a fallback, so a failure is not fatal. */
function git(args) {
  try {
    execFileSync('git', ['-C', ROOT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

const raw = await readStdin()
let input
try {
  input = JSON.parse(raw)
} catch {
  console.error(`WorktreeRemove: stdin was not JSON (${raw.slice(0, 120)})`)
  process.exit(1)
}

const worktreePath = input.worktree_path
if (typeof worktreePath !== 'string' || worktreePath.length === 0) {
  console.error('WorktreeRemove: no worktree_path on stdin')
  process.exit(1)
}

// A stale read-only lock left by an earlier sandboxed run makes every git write below fail with
// "could not lock config file". It is a zero-byte file with no process behind it by the time a
// removal runs, so clearing it is safe and is the difference between this hook working and not.
const configLock = join(ROOT, '.git', 'config.lock')
try {
  if (existsSync(configLock)) {
    unlinkSync(configLock)
    console.error('WorktreeRemove: cleared a stale .git/config.lock')
  }
} catch {
  /* not fatal; the removal below may still succeed */
}

// Whether the path removed is one this repository provisions, inside `<ROOT>/.claude/worktrees/`.
// A foreign path means this hook is being exercised rather than used, and nothing of this
// repository's is touched for one: no admin directory and no sweep (`gcRefusal` below).
const OWNED_DIR = join(ROOT, '.claude', 'worktrees') + sep
const owned = resolve(worktreePath).startsWith(OWNED_DIR)

/**
 * The admin directory the worktree's `.git` file names, or `null`. Not `.git/worktrees/<basename>`:
 * git adds a number to that name on a collision, so it can be another worktree's record. And not the
 * `.git` file's word alone, which anything in the worktree can rewrite: the directory must sit
 * directly under ROOT's `.git/worktrees/` and its own `gitdir` must name this worktree back, the
 * two-way link git keeps.
 */
function adminDirOf(path) {
  try {
    const match = /^gitdir: (.+)$/m.exec(readFileSync(join(path, '.git'), 'utf8'))
    if (match === null) return null
    const admin = resolve(path, match[1].trim())
    if (dirname(admin) !== join(ROOT, '.git', 'worktrees')) return null
    const back = resolve(admin, readFileSync(join(admin, 'gitdir'), 'utf8').trim())
    return realpathSync(back) === realpathSync(join(path, '.git')) ? admin : null
  } catch {
    return null
  }
}

// The ordinary path first. It is the only one that also tidies the admin directory by itself.
let removed = git(['worktree', 'remove', '--force', worktreePath])

// The sandbox path. `git worktree remove` refused because something holds `.git/worktrees/<name>`
// open, so the checkout and, for a path this repository owns, the admin directory are removed
// directly; the sweep's prune reconciles any record left. `rmSync` succeeds where git's own unlink
// loop gives up.
if (!removed) {
  console.error(`WorktreeRemove: git worktree remove failed for ${worktreePath}; removing directly`)
  try {
    const admin = owned ? adminDirOf(worktreePath) : null
    rmSync(worktreePath, { recursive: true, force: true })
    if (admin !== null) rmSync(admin, { recursive: true, force: true })
    removed = true
  } catch (err) {
    console.error(`WorktreeRemove: direct removal failed: ${err.message}`)
  }
}

// NO `git worktree prune` HERE, and the incident that took it out. This hook ran one on `ROOT` on
// every call, before the ownership check, so each run of `worktree:selftest`, a pre-push job, pruned
// the real repository through that suite's foreign-path cases. On a host that took only records
// whose worktree was gone. On 2026-10-06 a dev container on the bind-mounted primary checkout pushed,
// and there every record names a host path the container cannot see: git read each as stale,
// pruned them all, and git and bd stopped working in every linked worktree on the host
// (asdlc-openspec-486e). The same suite's foreign path also named the admin directory of a live
// worktree that shared its last name, hence `owned` above. Pruning is the sweep's, by its rule.

/**
 * Whether the sweep may run at all, as a reason string, or `null` to proceed.
 *
 * THE INCIDENT THIS PREVENTS, and it is not hypothetical -- it happened during this hook's own
 * development. The sweep below mutates branches and `.git/config`, which are SHARED state, while
 * `worktree_path` is whatever the caller passed. `worktree-hooks.selftest.mjs` deliberately calls
 * this hook with a throwaway `/tmp` directory to exercise the sandbox-removal fallback, and the
 * sweep, keyed off `ROOT` rather than off that path, therefore ran against THE REAL REPOSITORY on
 * every invocation. `worktree:selftest` is a pre-push job, so that made an ordinary `git push` a
 * branch-deleting event; run against a copy of the script with its safety guards deliberately
 * mutated for a mutation test, it deleted 104 local branches. They were restored from
 * `worktree-gc.log`, which is exactly why that log exists.
 *
 * So the sweep runs only when the path removed is one this repository actually provisions -- inside
 * `<ROOT>/.claude/worktrees/`. A foreign path means this hook is being exercised rather than used,
 * and the correct response to a teardown of something we do not own is to touch nothing.
 * `WORKTREE_GC=0` is the second layer, for a caller that wants the removal without the sweep.
 */
function gcRefusal() {
  if (process.env.WORKTREE_GC === '0') return 'WORKTREE_GC=0'
  if (!owned) return `${worktreePath} is not under ${OWNED_DIR}`
  return null
}

const refusal = gcRefusal()

// Collect the config and branches left by worktrees whose work has landed. Best-effort and last:
// a failure here has no bearing on whether the removal succeeded, which is the only thing the
// harness judges this hook by, and the sweep is a no-op when there is nothing provably contained.
// The branch just torn down is free once its record is gone, which the removal above or the sweep's
// own prune sees to.
if (refusal !== null) {
  console.error(`WorktreeRemove: branch/config sweep skipped (${refusal})`)
} else {
  try {
    const report = execFileSync('node', [join(ROOT, 'scripts', 'prune-worktree-branches.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    for (const line of report.trimEnd().split('\n')) console.error(`WorktreeRemove: ${line}`)
  } catch (err) {
    console.error(`WorktreeRemove: branch/config sweep failed: ${err.message}`)
  }
}

if (existsSync(worktreePath)) {
  console.error(`WorktreeRemove: ${worktreePath} still exists`)
  process.exit(1)
}
console.error(`WorktreeRemove: removed ${worktreePath}`)
