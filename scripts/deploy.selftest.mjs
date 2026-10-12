/**
 * Exercises Deploy through its CLI in scratch repositories with real git and embedded bd.
 * A copier can appear successful while overwriting a target or publishing no Tracker for Bob.
 *   node --test scripts/deploy.selftest.mjs
 * Needs Node, git, pinned bd and the source checkout; no npm, GitHub or credential.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(source, 'scripts/deploy.mjs')
const values = JSON.parse(readFileSync(join(source, 'tests/template/fixtures/values.json')))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !key.startsWith('BEADS_')))
Object.assign(env, {
  GIT_AUTHOR_NAME: 'Template Test', GIT_AUTHOR_EMAIL: 'template-test@example.invalid',
  GIT_COMMITTER_NAME: 'Template Test', GIT_COMMITTER_EMAIL: 'template-test@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', NO_COLOR: '1',
})
function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 })
}
function git(cwd, ...args) {
  const result = run('git', args, cwd)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'deploy-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const target = join(directory, 'target')
  const origin = join(directory, 'origin.git')
  const input = join(directory, 'values.json')
  mkdirSync(target)
  git(directory, 'init', '--bare', '--initial-branch=main', origin)
  git(target, 'init', '--initial-branch=main')
  git(target, 'remote', 'add', 'origin', origin)
  writeFileSync(input, JSON.stringify(values))
  return { directory, target, origin, input }
}
function deploy(f, extra = []) { return run(process.execPath, [cli, '--values', f.input, ...extra, f.target], source) }

test('Deploy publishes one clean main commit and a Tracker that Bob can hydrate', (t) => {
  const f = fixture(t)
  const result = deploy(f)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(git(f.target, 'rev-list', '--count', 'main'), '1')
  assert.equal(git(f.target, 'status', '--porcelain'), '')
  assert.equal(git(f.target, 'rev-parse', 'main'), git(f.origin, 'rev-parse', 'main'))
  assert.match(git(f.origin, 'show-ref', 'refs/dolt/data'), /refs\/dolt\/data/)
  assert.ok(existsSync(join(f.target, '.claude/settings.json')))
  assert.ok(!existsSync(join(f.target, '.codex')))
  assert.equal(JSON.parse(readFileSync(join(f.target, 'package.json'))).name, values.projectName)
  assert.equal(readFileSync(join(f.target, '.beads/config.yaml'), 'utf8'),
    readFileSync(join(source, 'template/.beads/config.yaml'), 'utf8').replace(/<REPLACE_ME:trackerRemote>/g, f.origin))
  const bob = join(f.directory, 'bob')
  git(f.directory, 'clone', f.origin, bob)
  const bootstrap = run('bd', ['bootstrap'], bob)
  assert.equal(bootstrap.status, 0, bootstrap.stdout + bootstrap.stderr)
  assert.equal(run('bd', ['list', '--json'], bob).status, 0)
})

for (const [name, change, reason] of [
  ['non-repository', (f) => rmSync(join(f.target, '.git'), { recursive: true }), /not a git repository/i],
  ['existing commit', (f) => git(f.target, 'commit', '--allow-empty', '-m', 'existing'), /has a commit/i],
  ['missing origin', (f) => git(f.target, 'remote', 'remove', 'origin'), /no origin/i],
  ['missing value', (f) => { const v = { ...values }; delete v.projectName; writeFileSync(f.input, JSON.stringify(v)) }, /missing required value: projectName/i],
  ['unknown value', (f) => writeFileSync(f.input, JSON.stringify({ ...values, unknown: 'x' })), /unknown value: unknown/i],
  ['empty value', (f) => writeFileSync(f.input, JSON.stringify({ ...values, projectName: '' })), /empty value: projectName/i],
  ['existing file', (f) => writeFileSync(join(f.target, 'keep.txt'), 'keep me'), /target is not empty/i],
  ['symlink destination', (f) => symlinkSync(f.directory, join(f.target, 'policy')), /target is not empty/i],
]) {
  test('Deploy refuses ' + name + ' before copying', (t) => {
    const f = fixture(t)
    change(f)
    const before = readdirSync(f.target)
    const result = deploy(f)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, reason)
    assert.deepEqual(readdirSync(f.target), before)
    assert.ok(!existsSync(join(f.target, 'package.json')))
  })
}

test('Deploy reports an origin push refusal', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.origin, 'hooks/pre-receive'), '#!/bin/sh\necho push-refused >&2\nexit 1\n', { mode: 0o755 })
  const result = deploy(f)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /push.*failed/i)
  assert.equal(git(f.origin, 'for-each-ref', '--format=%(refname)'), '')
})
