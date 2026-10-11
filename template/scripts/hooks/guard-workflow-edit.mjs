/**
 * PreToolUse hook on Write and Edit. Refuses an edit that would leave a workflow other than
 * `.github/workflows/pr-review.yml` able to approve a pull request itself, or to pass the check the
 * trunk's ruleset requires on its own head: a grant of `pull-requests: write`, `statuses: write`,
 * `checks: write` or `write-all`, to every job or to one, or, in any workflow but `verify.yml`, a
 * job whose id or name is that check's. It refuses, too, an edit that would let a workflow other
 * than `prReviewAppKeyWorkflow` read the agents' App key, whose token approves a pull request the App
 * did not open, or let that one read it on another event or outside its environment
 * (`docs/decisions/asdlc-openspec-ic9h.md` § Decision). The rule is `forgeProblems` in
 * `scripts/pr-review.mjs`, which `pr-review:check` also runs over every workflow at pre-push and in
 * CI; this runs it over the file as the edit would leave it, before the edit lands.
 *
 * WHAT IT WOULD LET THROUGH IF IT WERE WRONG. No incident yet. Since 2026-10-08 (asdlc-openspec-t2ly,
 * docs/decisions.md § D-57) GitHub merges a pull request once `verify` passes on its head and one
 * approving review stands, so whatever approves, or passes `verify`, decides the merge. A branch
 * whose workflow could write pull requests would approve its own after the reviewer left it to a
 * person, and GitHub would merge a head on the high-risk floor that no person read; one that could
 * write a check or a status, or named a job `verify`, would pass the check on a head `verify.yml`
 * failed. `pr-review:check` refuses such a workflow, but `verify` runs the branch's own copy of that
 * check, which the same branch can weaken; this refuses the edit in the session that makes it.
 * Routine edits pass, such as a gate's step added to `verify.yml`, which 52 commits had made by
 * 2026-10-05 (`git rev-list --count HEAD -- .github/workflows/verify.yml`). It sees Write and Edit
 * alone: a workflow written through Bash passes it, and so does a job whose name an expression
 * builds. From 2026-10-05 to that day the grant it refused was the `pr-review` status's, which the
 * ruleset required (docs/decisions.md § D-47).
 *
 * Exit 2 blocks the edit, and stderr is the reason the agent reads. A Write is judged by its
 * `content`; an Edit by the file with its first `old_string`, or every one under `replace_all`,
 * replaced, as Claude Code applies it. An Edit whose `old_string` the file does not hold lands
 * nothing, and passes.
 *
 *   printf '%s' '{"tool_input":{"file_path":".github/workflows/x.yml","content":"permissions: write-all\n"}}' | node scripts/hooks/guard-workflow-edit.mjs
 *
 * Needs `git`, which places the path in its checkout (`editedCheckout`), and `js-yaml`, resolved
 * from this file's own checkout. It reads the reviewer's keys from the policy of the checkout the
 * edit lands in, or of the one `GUARD_WORKFLOW_ROOT` names, so a by-hand run or the selftest can
 * point it at a doctored copy, and refuses a policy `policyProblems` refuses. Every path but a
 * workflow exits 0 before any of that loads. On a workflow it fails closed: a result that does not
 * parse, or a policy or parser it cannot load, refuses the edit with the reason.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { editedCheckout, readHookInput } from './_shared.mjs'

/** A workflow file, where GitHub reads one from. */
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/

/**
 * The file's text once the edit lands, or `null` when it lands nothing. `current` is the file's text
 * now, or `null` when there is none.
 */
function editedText(toolInput, current) {
  if (typeof toolInput.content === 'string') return toolInput.content
  const { old_string: from, new_string: to, replace_all: all } = toolInput
  if (typeof from !== 'string' || typeof to !== 'string' || from === '' || current === null) return null
  const at = current.indexOf(from)
  if (at < 0) return null
  return all ? current.split(from).join(to) : `${current.slice(0, at)}${to}${current.slice(at + from.length)}`
}

function refuse(reason) {
  process.stderr.write(`BLOCKED by repository policy: ${reason}\n`)
  process.exit(2)
}

const input = await readHookInput()
if (input === null) process.exit(0)
const toolInput = input.tool_input ?? {}
const target = editedCheckout(toolInput.file_path)
if (target === null || !WORKFLOW_FILE.test(target.rel)) process.exit(0)
const { root, rel } = target
const abs = resolve(root, rel)
const text = editedText(toolInput, existsSync(abs) ? readFileSync(abs, 'utf8') : null)
if (text === null) process.exit(0)

let problems
try {
  const { load } = await import('js-yaml')
  const { readPolicy } = await import('../../tools/lib/policy.ts')
  const { forgeProblems, policyProblems } = await import('../pr-review.mjs')
  const policy = readPolicy(process.env.GUARD_WORKFLOW_ROOT ?? root)
  const unread = policyProblems(policy)
  if (unread.length > 0) throw new Error(unread.join(' '))
  problems = forgeProblems(rel, load(text), policy)
} catch (error) {
  refuse(
    `${rel} is a workflow, and this edit could not be judged: ${error.message}. A workflow other than ` +
      `.github/workflows/pr-review.yml must not be able to approve a pull request or pass the required check (docs/decisions.md § D-57), ` +
      'so the edit waits until the file parses and the policy reads.',
  )
}
if (problems.length > 0) refuse(problems.join(' '))
process.exit(0)
