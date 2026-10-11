/**
 * Shared helpers for the Claude Code hooks in this directory.
 *
 * These hooks run on EVERY matching tool call, so the budget is a few hundred milliseconds. This file
 * imports Node's built-in `fs`, `path`, `url` and `child_process` and nothing else, and it reads no
 * file and starts no process when it is loaded. Three helpers start a process, and only when called:
 * `runTask` runs a task, after importing `scripts/lib/tasks.mjs` to read the manifest; `checkoutOf`
 * runs git; and `editedCheckout` runs it through `checkoutOf`. A hook that calls none starts none.
 *
 * Why this tier exists: most of the work in this
 * repository is done by an agent, and a gate that fires after the agent has spent twenty minutes
 * going the wrong way is worth far less than one that stops it at the first keystroke.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'

/** The repository root. This file lives at `scripts/hooks/_shared.mjs`. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * The repository's trunk -- the branch checked out in the primary worktree, the base every agent
 * branch is cut from, and the target of every pull request. Renaming trunk is this one line rather
 * than a dozen scattered string literals, and the only reason a rename is cheap is that it is named
 * once: `guard-git.mjs` and `guard-unprovisioned-worktree.mjs` both import it.
 */
export const TRUNK = 'main'

/**
 * Read the hook payload from stdin.
 *
 * Returns `null` rather than hanging when there is no stdin, so every hook in this directory can be
 * run by hand and exits cleanly with nothing to do.
 */
export async function readHookInput() {
  if (process.stdin.isTTY) return null
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * The file path a Write/Edit call is aimed at, from either spelling of the payload.
 *
 * `tool_input.file_path` is the documented field; the text is `content` on Write and `new_string` on
 * Edit. Both are read because a Write to a path that does not exist yet has no file on disk to
 * inspect, and the incoming TEXT is then the only evidence available.
 */
export function editTarget(input) {
  const ti = input?.tool_input ?? {}
  return {
    filePath: typeof ti.file_path === 'string' ? ti.file_path : null,
    text: [ti.content, ti.file_text, ti.new_string].find((t) => typeof t === 'string') ?? '',
  }
}

/**
 * A POSIX path relative to the checkout at `root`, this one unless the caller names another, or `null`
 * when the target is outside it.
 */
export function toRepoRel(filePath, root = ROOT) {
  if (typeof filePath !== 'string' || filePath === '') return null
  const rel = relative(root, resolve(root, filePath))
  if (rel === '' || rel.startsWith('..')) return null
  return rel.split(sep).join('/')
}

/**
 * The first 2,000 bytes of a file -- its header and nothing else.
 *
 * The window matters. An emitter contains the literal string "GENERATED ... DO NOT EDIT BY HAND"
 * because it EMITS it. A whole-file search would classify every emitter as generated output and refuse
 * every edit to the only files that can actually fix anything.
 */
export function header(absPath) {
  try {
    const fd = openSync(absPath, 'r')
    try {
      const buf = Buffer.alloc(2000)
      const n = readSync(fd, buf, 0, 2000, 0)
      return buf.subarray(0, n).toString('utf8')
    } finally {
      closeSync(fd)
    }
  } catch {
    return ''
  }
}

/**
 * Does this text carry a generator's own hands-off banner in its header?
 *
 * BOTH SIGNALS ON THE SAME LINE, which is not fussiness. Every real banner in this repository is one
 * shouted line naming the tool and forbidding the edit in the same breath. Testing the two halves
 * against the whole header instead flags any FILE THAT DISCUSSES build products: it flagged
 * scripts/assert-not-hand-edited.mjs, whose entire subject is this check.
 *
 * The two generated Markdown reports split their banner over two lines and so slip past this. They do
 * not need it -- `generatedFileRedirect` covers them by path and gives a better message anyway. This
 * function is only the catch-all for a generator nobody has told that table about.
 */
export function hasGeneratedBanner(text) {
  // Two separate patterns, applied line by line, so no line of THIS file carries both halves and
  // trips the check on itself.
  const namesATool = /\bgenerated\b/i
  const forbidsTheEdit = /do not (?:edit by hand|hand-edit)/i
  return text
    .slice(0, 2000)
    .split('\n')
    .some((line) => namesATool.test(line) && forbidsTheEdit.test(line))
}

/**
 * Is the content heuristic even worth running on this path?
 *
 * NOT ON PROSE. A document that quotes the banner in order to explain it is normal and expected,
 * and the heuristic once refused to let such a document be edited. Generated Markdown is covered by
 * `generatedFileRedirect` below, by path, with a better message than the catch-all could give. So
 * the catch-all covers code and data only.
 */
export function bannerCheckApplies(rel) {
  return !/\.(?:md|mdx|txt|rst|adoc)$/i.test(rel)
}

/* ============================================================================================= *
 * Which files a generator owns, and where a change to them actually belongs.
 * ============================================================================================= */

function redirect(rel, what, where, command) {
  return [
    `${rel} is GENERATED ${what}. A hand edit here is overwritten by the next run.`,
    '',
    `Edit instead: ${where}`,
    `Then:         ${command}`,
  ].join('\n')
}

/**
 * One row per emitter-owned path: a test over the repository-relative path, where the change
 * belongs, and the command that re-emits. Path-based rather than content-based so the message can be
 * SPECIFIC about where the change belongs; `hasGeneratedBanner` is the catch-all underneath it, for
 * a generated file this table has not been taught about yet.
 *
 * Every row goes in the same change as the emitter it names, and leaves with it: a redirect naming
 * a command that no longer exists is worse than none, because the reader runs it. A row never claims
 * a path that a different emitter owns. The kit's one row, the learning loop's `artifacts/outcomes/`,
 * left with the loop (`docs/decisions.md` § D-06).
 */
const REDIRECTS = [
  {
    owns: (rel) => rel === 'artifacts/trace/record.json',
    what: 'traceability record (tools/trace/trace.ts)',
    where: 'the specs under openspec/, the tests, contracts or Binding Surface under apps/, or the commits it reads',
    command: 'mise run trace',
  },
  {
    owns: (rel) => rel === 'artifacts/trace/README.md',
    what: "README of the trace record's directory (tools/trace/trace.ts)",
    where: '`README_TEXT` in tools/trace/trace.ts',
    command: 'mise run trace',
  },
  {
    owns: (rel) => rel === 'artifacts/trace/baseline.json',
    what: 'ratchet baseline (tools/trace/trace.ts), which may fall and never rise',
    where: 'the test that meets an obligation it lists; nothing adds one',
    command: 'mise run trace:update',
  },
  {
    owns: (rel) => rel === 'artifacts/thresholds/baseline.json',
    what: 'ratchet baseline of undetected mutants (scripts/check-thresholds.mjs), which may fall and never rise',
    where: 'the test that detects a mutant it lists, or a `Stryker disable next-line` comment with its reason; nothing adds one',
    command: 'mise run thresholds:update',
  },
  {
    owns: (rel) => rel === 'artifacts/coupling/cochange.json',
    what: 'co-change map of the pull requests merged to main (tools/coupling/coupling.ts)',
    where: 'tools/coupling/coupling.ts or its `coupling*` keys in tools/policy/tool-settings.json; `mise run coupling:update` moves its baseline',
    command: 'mise run coupling',
  },
]

/** `null` when nothing generates this path, otherwise the message to hand back. */
export function generatedFileRedirect(rel) {
  for (const row of REDIRECTS) {
    if (row.owns(rel)) return redirect(rel, row.what, row.where, row.command)
  }
  return null
}

/* ============================================================================================= *
 * Running a task without a shell.
 * ============================================================================================= */

const WINDOWS = process.platform === 'win32'

/**
 * How `runTask` launches the task `name` in the checkout at `cwd`, read from that checkout's own
 * `tasks.toml` through `scripts/lib/tasks.mjs`: `{ command, args, label }`, `mise run --quiet`, or
 * `{ refused }` with why. A checkout with no `tasks.toml`, one cut before the move to mise among them,
 * is refused with the loader's reason (`docs/decisions.md` § D-40). So is a task its `tasks.toml`
 * lacks, never launched: mise resolves a name a checkout lacks from a checkout above it, so a
 * worktree's gate would run the primary checkout's definition there, and pass on the wrong tree
 * (asdlc-openspec-8juz.1, question 1). The launch itself is `launchFor` in `scripts/lib/tasks.mjs`,
 * which `scripts/fresh-run.mjs` launches through too. Exported so `gate-summary.selftest.mjs` holds
 * the choice without starting a task.
 */
export async function taskLaunch(name, cwd = ROOT) {
  let manifest
  let lib
  try {
    lib = await import('../lib/tasks.mjs')
    manifest = lib.loadTasks(cwd)
  } catch (error) {
    return { refused: `the task manifest in ${cwd} cannot be read: ${error.message}` }
  }
  if (!Object.hasOwn(manifest.tasks, name)) {
    return {
      refused:
        `\`${name}\` is not a task in ${cwd}'s own ${manifest.file}, so it was not run: a task runs only from the` +
        ' checkout that defines it, since mise would take a definition from a checkout above this one.',
    }
  }
  return lib.launchFor(name)
}

/**
 * Run the task `name` in the checkout at `cwd`, as `taskLaunch` chooses, and resolve with its exit
 * code, its combined output and `command`, the line it ran (the name alone where it ran none).
 * Never rejects: a refusal or a launcher that cannot start resolves with code 127 and the reason.
 *
 * Windows needs a shell: since the CVE-2024-27980 fix Node refuses to `spawn` a `.cmd` file without
 * one and throws EINVAL. The whole command therefore goes through as ONE string with no argv array,
 * which is also what keeps Node's DEP0190 warning off the hook's stderr. `name` is always a literal
 * from the caller in this repository, never anything a payload supplied. `cwd` is the checkout to run
 * it in, this one unless the caller names another; `env` is added to this process's environment.
 */
export async function runTask(name, { timeoutMs = 120_000, cwd = ROOT, env = {} } = {}) {
  const launch = await taskLaunch(name, cwd)
  if (launch.refused) return { code: 127, out: launch.refused, command: name }
  return new Promise((done) => {
    const options = { cwd, env: { ...process.env, ...env } }
    const child = WINDOWS
      ? spawn([launch.command, ...launch.args].join(' '), { ...options, windowsHide: true, shell: true })
      : spawn(launch.command, launch.args, options)
    let out = ''
    const take = (b) => {
      out += b.toString('utf8')
      if (out.length > 20_000) out = out.slice(-20_000)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      done({ code: 127, out: `could not run \`${launch.label}\`: ${e.message}`, command: launch.label })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code: code ?? 1, out: out.trim(), command: launch.label })
    })
  })
}

/* ============================================================================================= *
 * Which checkout a stopping agent worked in, and which checkout an edit lands in.
 * ============================================================================================= */

/**
 * This process's environment without any `GIT_*` key, so git answers for the directory it runs in.
 * A hook inherits its session's environment, and an inherited `GIT_DIR` outranks `cwd`: with no
 * `GIT_WORK_TREE` git takes `cwd` for the top of the work tree, so `editedCheckout` would place an
 * edit to `artifacts/trace/record.json` in that file's own directory, where no redirect matches, and
 * pass it (a branch review of asdlc-openspec-d2qv found this before it merged). `guard-git.mjs` runs
 * its git through it too (asdlc-openspec-hn4x). The same function is `gitEnv` in
 * `tools/lib/git-env.ts`; it is not imported, because this file imports Node's built-ins only and
 * the selftests run a copy of it alone.
 */
export function gitEnv() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value
  return env
}

/** An absolute path `git rev-parse` gives for `flag` in `dir`, resolved, or null outside a checkout. */
function gitPath(dir, flag) {
  try {
    const out = execFileSync('git', ['rev-parse', '--path-format=absolute', flag], {
      cwd: dir,
      env: gitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return realpathSync(out.trim())
  } catch {
    return null
  }
}

/**
 * The top of the checkout `cwd` is in, when that checkout is `ownRoot`'s repository (the primary
 * checkout or a linked worktree, which share one git directory), and `ownRoot` otherwise: no `cwd`,
 * a `cwd` outside any checkout, or one in another repository. One git call with no `cwd`, two when
 * `cwd` is outside any checkout, and four when it is inside one.
 */
export function checkoutOf(cwd, ownRoot = ROOT) {
  const own = gitPath(ownRoot, '--show-toplevel') ?? ownRoot
  if (typeof cwd !== 'string' || cwd === '') return own
  const top = gitPath(cwd, '--show-toplevel')
  if (top === null) return own
  const theirs = gitPath(cwd, '--git-common-dir')
  const ours = gitPath(ownRoot, '--git-common-dir')
  return theirs !== null && theirs === ours ? top : own
}

/**
 * The checkout of this repository an edit to `filePath` lands in, placed by the path itself, and the
 * path relative to it: `{ root, rel }`, or `null` when the path is in no checkout of this repository.
 * Never by the payload's `cwd`: a session in a worktree can edit the primary checkout's files too.
 * A relative path resolves against `ownRoot`, as in `toRepoRel`. The nearest of its directories that
 * exists places it, since a Write may make the file's directory and git answers only in one that
 * exists; and it is compared in its real form, the form `checkoutOf` gives a checkout's top in.
 * Starts git through `checkoutOf`: four calls inside a checkout, two outside any.
 */
export function editedCheckout(filePath, ownRoot = ROOT) {
  if (typeof filePath !== 'string' || filePath === '') return null
  const abs = resolve(ownRoot, filePath)
  let dir = dirname(abs)
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir)
  const real = (p) => {
    try {
      return realpathSync(p)
    } catch {
      return p
    }
  }
  const root = real(checkoutOf(dir, ownRoot))
  const rel = toRepoRel(join(real(dir), relative(dir, abs)), root)
  return rel === null ? null : { root, rel }
}

/** Read a file, or a fallback. */
export function readOr(absPath, fallback = '') {
  try {
    return readFileSync(absPath, 'utf8')
  } catch {
    return fallback
  }
}
