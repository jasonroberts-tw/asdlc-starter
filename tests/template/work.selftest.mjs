/** Exercises Work run evidence in real scratch git histories, without bd or a model.
 * node --test tests/template/work.selftest.mjs; requires Node and git.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkWorkEvidence } from './checks.mjs'
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'template-work-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Template Test', GIT_AUTHOR_EMAIL: 'template-test@example.invalid',
    GIT_COMMITTER_NAME: 'Template Test', GIT_COMMITTER_EMAIL: 'template-test@example.invalid' } }).trim()
  git('init', '--initial-branch=main')
  git('commit', '--allow-empty', '-m', 'Deploy')
  const deploy = git('rev-parse', 'main')
  const origin = join(root, 'origin.git')
  git('init', '--bare', '--initial-branch=main', origin)
  git('remote', 'add', 'origin', origin)
  git('push', 'origin', 'main')
  git('switch', '-c', 'agent/work')
  git('commit', '--allow-empty', '-m', 'Work')
  const work = git('rev-parse', 'HEAD')
  git('switch', 'main')
  git('merge', '--no-ff', 'agent/work', '-m', 'Merge work')
  const issue = join(root, 'issue.json')
  const data = { id: 'fixture-123', status: 'closed', close_reason: 'Merged commit ' + work }
  writeFileSync(issue, JSON.stringify([data]))
  return { root, origin, deploy, issue, data, git }
}
test('Work evidence control proves closure, merged agent work and unchanged origin', (t) => {
  const f = fixture(t)
  checkWorkEvidence(f.root, f.issue, f.deploy, f.origin)
})
for (const [name, change, reason] of [
  ['open issue', (f) => { f.data.status = 'open'; writeFileSync(f.issue, JSON.stringify([f.data])) }, /issue is not closed/],
  ['closure without commit', (f) => { f.data.close_reason = 'done'; writeFileSync(f.issue, JSON.stringify([f.data])) }, /closure names no reachable commit/],
  ['unreachable closure commit', (f) => { f.data.close_reason = 'deadbeef1234567890abcdef1234567890abcdef12'; writeFileSync(f.issue, JSON.stringify([f.data])) }, /closure names no reachable commit/],
  ['unmerged agent branch', (f) => f.git('branch', '-D', 'agent/work'), /no merged agent work branch/],
  ['unchanged main', (f) => f.git('reset', '--hard', f.deploy), /main did not advance/],
  ['pushed origin main', (f) => f.git('push', 'origin', 'main'), /origin main changed/],
]) {
  test('Work evidence refuses ' + name, (t) => {
    const f = fixture(t)
    change(f)
    assert.throws(() => checkWorkEvidence(f.root, f.issue, f.deploy, f.origin), reason)
  })
}
