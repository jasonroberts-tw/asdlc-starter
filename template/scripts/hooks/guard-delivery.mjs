/**
 * PreToolUse hook. Refuses the two edits the delivery workflow forbids (AGENTS.md § Delivery
 * workflow): a change to a protected test, and code written for a feature before the operator
 * approved its design at Gate 2.
 *
 * THE FAILURE THIS PREVENTS. No incident yet. Were it wrong, a session could change a test until it
 * passes, which proves nothing, or build a story on a design the operator never approved, and both
 * would surface only at review, after the work is done. The prompts carry both rules already; this is
 * the part that holds when a session forgets them.
 *
 * PROTECTED TESTS, EVERYWHERE. The list is the file `protectedTestsFile` in `policy/delivery.json`
 * names, one `<path> <issue id>` per line, read as HEAD has it: a test is protected from the commit
 * that lists it, and a line a session drops from its working copy protects the test still. The hook
 * refuses an edit to a listed path, and an edit to the list that drops one of HEAD's lines. A
 * person's own editor runs no hook, so the operator approves a change by making it, or by deleting
 * the line in a commit of their own.
 *
 * GATE 2, ON AN AGENT BRANCH. A worktree named `<issue id>-<slug>` is on `agent/<issue id>-<slug>`,
 * and one `bd show` over every dash-prefix of the name finds the issue. On a feature's or an epic's
 * branch, and on a story's branch until its feature's spec on `origin/main` says `Design approved`
 * or `Shipped`, the hook refuses every path outside `beforeApprovalPaths`. Reading `origin/main`
 * means the approval is the merged design pull request, which a session's own branch cannot change.
 *
 * IT FAILS OPEN, like the in-session tier it sits in (AGENTS.md § The gate ladder): with no
 * policy, no git, no `bd`, a `bd` that errors, or a branch that names no issue, it allows the edit.
 * An edit made through the shell gets past it; `spec-reviewer` diffs each protected test against the
 * commit that listed it.
 *
 *   node scripts/hooks/guard-delivery.mjs < payload.json
 *
 * Needs `git`: five calls inside a checkout, and one more for a path outside `beforeApprovalPaths`.
 * On an agent branch that path adds one call to `bd`, which the Gate 2 rule needs on PATH, and on a
 * story's branch one more to git.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { editTargets, editedCheckout, gitEnv, readHookInput, readOr } from './_shared.mjs'

const APPROVED = /^\*\*Status:\*\*\s*(?:Design approved|Shipped)\b/m

const input = await readHookInput()
if (input === null) process.exit(0)

function git(root, ...args) {
  try {
    return execFileSync('git', args, { cwd: root, env: gitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

/** A list's text as a map from each protected path to the issue that protected it. */
function listed(text) {
  const map = new Map()
  for (const line of (text ?? '').split(/\r?\n/)) {
    const [path, issue = ''] = line.trim().split(/\s+/)
    if (path && !path.startsWith('#')) map.set(path, issue)
  }
  return map
}

/** The list as a Write or an Edit leaves it, or null when its payload cannot say. */
function listAfter(abs, ti) {
  if (typeof ti.content === 'string') return ti.content
  const edits = Array.isArray(ti.edits) ? ti.edits : [ti]
  let text = readOr(abs)
  for (const { old_string: from, new_string: to, replace_all: all } of edits) {
    if (typeof from !== 'string' || typeof to !== 'string') return null
    const at = text.indexOf(from)
    if (at === -1) continue
    text = all ? text.split(from).join(to) : text.slice(0, at) + to + text.slice(at + from.length)
  }
  return text
}

/** The paths a Codex patch removes from the list without adding back. */
function patchDrops(rel) {
  const removed = new Set()
  const added = new Set()
  let inList = false
  for (const line of String(input.tool_input?.command ?? '').split(/\r?\n/)) {
    const file = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line)
    if (file) {
      const path = file[2].trim().replaceAll('\\', '/')
      inList = path === rel || path.endsWith(`/${rel}`)
      if (inList && file[1] === 'Delete') return null
      continue
    }
    if (!inList || line.startsWith('---') || line.startsWith('+++')) continue
    if (line.startsWith('-')) for (const path of listed(line.slice(1)).keys()) removed.add(path)
    if (line.startsWith('+')) for (const path of listed(line.slice(1)).keys()) added.add(path)
  }
  return [...removed].filter((path) => !added.has(path))
}

function refuse(lines) {
  process.stderr.write(lines.join('\n'))
  process.exit(2)
}

/** The issue an `agent/<issue id>-<slug>` branch carries, from `bd show`, or null. */
function branchIssue(root) {
  const branch = git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD')?.trim() ?? ''
  if (!branch.startsWith('agent/')) return null
  const words = branch.slice('agent/'.length).split('-')
  const candidates = words.map((_, i) => words.slice(0, i + 1).join('-'))
  // ponytail: one bd call per code edit on an agent branch, about 0.4 s; cache the answer in
  // .worktree/ if sessions feel it.
  const r = spawnSync('bd', ['show', ...candidates, '--json'], {
    cwd: root, env: { ...gitEnv(), NO_COLOR: '1' }, encoding: 'utf8', timeout: 10000,
  })
  if (r.status !== 0) return null
  try {
    const found = [].concat(JSON.parse(r.stdout)).filter((issue) => candidates.includes(issue?.id))
    return found.sort((a, b) => b.id.length - a.id.length)[0] ?? null
  } catch {
    return null
  }
}

for (const { filePath } of editTargets(input)) {
  const target = editedCheckout(filePath)
  if (target === null) continue
  const { root, rel } = target
  let policy
  try {
    policy = JSON.parse(readOr(join(root, 'policy', 'delivery.json'), 'null'))
  } catch {
    policy = null
  }
  if (!policy) continue
  const listFile = policy.protectedTestsFile
  const protectedPaths = typeof listFile === 'string' ? listed(git(root, 'show', `HEAD:${listFile}`)) : new Map()

  if (protectedPaths.has(rel)) {
    refuse([
      `${rel} is a protected test, listed in ${listFile} for ${protectedPaths.get(rel) || 'its issue'}.`,
      '',
      'Never modify, weaken, skip or delete it. If it or the contract behind it looks wrong, stop, say',
      'why, and wait: the operator changes it, or approves the change by deleting its line in a commit',
      'of their own (AGENTS.md § Delivery workflow).',
    ])
  }
  if (rel === listFile && protectedPaths.size > 0) {
    const patch = input.tool_name === 'apply_patch'
    const after = patch ? null : listAfter(join(root, rel), input.tool_input ?? {})
    const dropped = patch
      ? patchDrops(rel)
      : after === null ? [] : [...protectedPaths.keys()].filter((path) => !listed(after).has(path))
    if (dropped === null || dropped.length > 0) {
      refuse([
        `This edit drops ${dropped === null ? 'every protected test' : dropped.join(', ')} from ${listFile}.`,
        '',
        'Only the operator lifts a protection. Add lines to the list, and ask the operator to delete',
        'one (AGENTS.md § Delivery workflow).',
      ])
    }
  }

  const open = Array.isArray(policy.beforeApprovalPaths) ? policy.beforeApprovalPaths : []
  if (open.some((prefix) => typeof prefix === 'string' && rel.startsWith(prefix))) continue
  const issue = branchIssue(root)
  if (issue === null) continue
  if (issue.issue_type === 'feature' || issue.issue_type === 'epic') {
    refuse([
      `This branch carries ${issue.issue_type} ${issue.id}, and ${rel} is outside ${open.join(', ')}.`,
      '',
      `A ${issue.issue_type}'s branch holds its spec and decision records. Code goes in a story under the`,
      'feature, on its own branch, once the operator approves the design (the `plan-stories` skill).',
    ])
  }
  const feature = (issue.dependencies ?? []).find(
    (dep) => dep?.dependency_type === 'parent-child' && dep.issue_type === 'feature',
  )
  if (issue.issue_type !== 'task' || !feature) continue
  const spec = typeof feature.spec_id === 'string' && feature.spec_id ? git(root, 'show', `origin/main:${feature.spec_id}`) : null
  if (spec === null || !APPROVED.test(spec)) {
    const status = /^\*\*Status:\*\*\s*(.*)$/m.exec(spec ?? '')?.[1]?.trim()
    refuse([
      `Story ${issue.id} belongs to feature ${feature.id}, whose spec on origin/main ` +
        (spec === null ? `does not exist (${feature.spec_id || 'no --spec-id'})` : `says ${status ? `"${status}"` : 'no status'}`) +
        '.',
      '',
      `No implementation code is written before the operator approves the design at Gate 2 (the`,
      '`design` skill), and approval is the spec on origin/main saying `Design approved`. If it',
      'merged after this branch was cut, run `git fetch origin main` and rebase; otherwise stop and',
      `report. ${open.join(', ')} stay writable.`,
    ])
  }
}

process.exit(0)
