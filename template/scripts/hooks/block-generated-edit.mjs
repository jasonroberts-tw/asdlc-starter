/**
 * PreToolUse hook. Refuses a Write or Edit aimed at a GENERATED file, and says where the change goes.
 *
 * THE DEFECT THIS PREVENTS, which happened: hand-correcting generated output. A brief that tells the
 * reader to fix what an emitter got wrong invites the fix to land in the file that is wrong. That edit
 * survives until the next run of the emitter, which silently reverts it -- or until the gate that
 * diffs the two, which turns it into a build failure with no memory of what the edit was for.
 *
 * AND A WORKTREE IT DID NOT SEE. Until 2026-10-03 (asdlc-openspec-d2qv) the hook judged every path
 * against its own checkout, which for a session that has entered a worktree is the primary checkout
 * (`.claude/README.md` § The hooks). An edit to a generated file in a linked worktree, where most
 * agent work happens, became `.claude/worktrees/<name>/artifacts/...`, which no redirect matched, and
 * passed; the catch-all skips Markdown, so nothing at all held the trace record's README there. The
 * checkout is now placed by the edited file's own path (`editedCheckout`), never by the payload's
 * `cwd`, which would let a worktree session edit the primary checkout's generated files unrefused.
 *
 * Exit 2 is the documented way for a PreToolUse hook to block; stderr becomes the reason shown to the
 * agent. The reason is not "don't do that" -- it is the list of files the change could legitimately
 * belong to, so the next move is a redirect rather than a guess.
 *
 * Deliberately NOT blocked: the emitters themselves, under `tools/`, which is where fixes go.
 *
 *   node scripts/hooks/block-generated-edit.mjs < payload.json
 *
 * Needs `git`, which places the path: four calls inside a checkout and two outside any, each with no
 * `GIT_*` variable, since an inherited `GIT_DIR` would make git place the path in its own directory.
 * With no git on PATH, every path is judged against this hook's own checkout, as before the fix.
 * `gate-summary.selftest.mjs` runs a copy over a scratch repository and its worktrees and prints the
 * hook's wall time.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  bannerCheckApplies,
  editTarget,
  editedCheckout,
  generatedFileRedirect,
  hasGeneratedBanner,
  header,
  readHookInput,
} from './_shared.mjs'

const input = await readHookInput()
if (input === null) process.exit(0)

const { filePath, text } = editTarget(input)
const target = editedCheckout(filePath)
if (target === null) process.exit(0)
const { root, rel } = target

const specific = generatedFileRedirect(rel)
if (specific !== null) {
  process.stderr.write(`${specific}\n`)
  process.exit(2)
}

// The catch-all: a file whose own header says a generator wrote it, that the table above has not
// been taught about yet.
//
// WHICH TEXT IS THE EVIDENCE matters. For a file that already exists, its own header on disk is the
// authority -- checking the INCOMING text instead blocks any edit that merely quotes a banner, which
// is a real thing to want to write in a repository whose gates are about build products. For a path
// that does not exist yet, the incoming text is the only evidence there is, and an agent writing a
// new file that CLAIMS to be generated is making the same mistake from the other direction.
const abs = resolve(root, rel)
const banner =
  bannerCheckApplies(rel) &&
  (existsSync(abs) ? hasGeneratedBanner(header(abs)) : hasGeneratedBanner(text))
if (banner) {
  process.stderr.write(
    [
      `${rel} carries a generator's "do not edit by hand" banner in its header.`,
      '',
      'Find the tool named in that banner and change it there, then re-run it. If this file is in',
      'fact hand-written and the banner is wrong, remove the banner in the same change -- a file that',
      'lies about its own provenance is worse than either state.',
      '',
      'If a new generator now owns this path, add it to the table in',
      'scripts/hooks/_shared.mjs (generatedFileRedirect) so the next refusal names the right input.',
    ].join('\n'),
  )
  process.exit(2)
}

process.exit(0)
