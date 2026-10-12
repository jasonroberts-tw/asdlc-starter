/** Negative controls for the Template checks. Each copy breaks one behavior and names its reason.
 * node --test tests/template/checks.selftest.mjs; needs Node and git, no npm, Deploy or credential.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkEcho, compareTrees, checkWarnings, checkFixtureCoverage } from './checks.mjs'

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), 'template-check-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
test('Bootstrap warning control accepts only the named expected warning', (t) => {
  const root = scratch(t)
  writeFileSync(join(root, 'warnings.txt'), 'expected warning\tfixture reason\n')
  writeFileSync(join(root, 'bootstrap.log'), '\u001b[36m[devcontainer]\u001b[0m ready\n\u001b[33m[devcontainer]\u001b[0m expected warning\n')
  checkWarnings(join(root, 'bootstrap.log'), join(root, 'warnings.txt'))
})
test('Bootstrap refuses an unexpected warning with its text', (t) => {
  const root = scratch(t)
  writeFileSync(join(root, 'warnings.txt'), 'expected warning\tfixture reason\n')
  writeFileSync(join(root, 'bootstrap.log'), '\u001b[33m[devcontainer]\u001b[0m surprise\n')
  assert.throws(() => checkWarnings(join(root, 'bootstrap.log'), join(root, 'warnings.txt')), /unexpected Bootstrap warning: surprise/)
})
test('Guards fixture control covers every command hook', (t) => {
  const root = scratch(t)
  const command = 'node "$CLAUDE_PROJECT_DIR"/scripts/hooks/guard-git.mjs'
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command }] }] } }))
  for (const kind of ['refuse', 'allow']) writeFileSync(join(root, 'guard-git.' + kind + '.json'), '{}')
  checkFixtureCoverage(join(root, 'settings.json'), root)
})
test('Guards refuses a command hook with no fixture pair', (t) => {
  const root = scratch(t)
  const command = 'node "$CLAUDE_PROJECT_DIR"/scripts/hooks/new-guard.mjs'
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command }] }] } }))
  assert.throws(() => checkFixtureCoverage(join(root, 'settings.json'), root), /no fixture for .*new-guard/)
})
function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Template Test', GIT_AUTHOR_EMAIL: 'template-test@example.invalid',
      GIT_COMMITTER_NAME: 'Template Test', GIT_COMMITTER_EMAIL: 'template-test@example.invalid' },
  })
}
const echo = "process.stdout.write(process.argv.slice(2).join(' ') + '\\n')\n"
test('echo control passes every specified argument case', (t) => {
  const root = scratch(t)
  writeFileSync(join(root, 'echo.mjs'), echo)
  checkEcho(join(root, 'echo.mjs'))
})
for (const [name, code, reason] of [
  ['wrong join', "console.log(process.argv.slice(2).join(''))", /echo output/],
  ['missing newline', "process.stdout.write(process.argv.slice(2).join(' '))", /missing newline/],
  ['non-zero exit', 'process.exit(7)', /echo exit code 7/],
  ['missing file', null, /missing echo.mjs/],
]) {
  test('echo refuses ' + name, (t) => {
    const root = scratch(t)
    if (code !== null) writeFileSync(join(root, 'echo.mjs'), code)
    assert.throws(() => checkEcho(join(root, 'echo.mjs')), reason)
  })
}
function treeFixture(t) {
  const expected = scratch(t)
  git(expected, 'init', '--initial-branch=main')
  writeFileSync(join(expected, 'file.txt'), 'control\n')
  writeFileSync(join(expected, 'tool.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  git(expected, 'add', '.')
  git(expected, 'commit', '-m', 'control')
  const actual = scratch(t)
  git(actual, 'clone', expected, '.')
  return { expected, actual }
}
test('Structure control compares file set, bytes and modes', (t) => {
  const { expected, actual } = treeFixture(t)
  assert.deepEqual(compareTrees(expected, actual, 'main'), [])
})
for (const [name, change, reason] of [
  ['missing file', (root) => rmSync(join(root, 'file.txt')), /file missing: file.txt/],
  ['extra file', (root) => writeFileSync(join(root, 'extra.txt'), 'extra'), /file extra: extra.txt/],
  ['changed bytes', (root) => writeFileSync(join(root, 'file.txt'), 'changed\n'), /bytes changed: file.txt/],
  ['changed mode', (root) => chmodSync(join(root, 'file.txt'), 0o755), /mode changed: file.txt/],
  ['unfilled placeholder', (root) => writeFileSync(join(root, 'file.txt'), '<' + 'REPLACE_ME:name>'), /placeholder left: file.txt/],
]) {
  test('Structure refuses ' + name, (t) => {
    const { expected, actual } = treeFixture(t)
    change(actual)
    git(actual, 'add', '--all')
    git(actual, 'commit', '-m', name)
    assert.match(compareTrees(expected, actual, 'main').join('\n'), reason)
  })
}
