/**
 * Compares Target trees as bytes/modes and checks observable script and workflow outcomes.
 * Text greps can mistake an agent's claim for a tool result; filename-only diffs lose executable modes.
 *   node tests/template/checks.mjs <check> <arguments...>; checks.sh supplies POSIX entry points.
 * Pure checks need Node and git, no model; Bootstrap's CI reader uses the Target's installed YAML parser.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function git(root, args, encoding = 'utf8') {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const result = spawnSync('git', ['-C', root, ...args], { env, encoding, maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0) throw new Error('git ' + args[0] + ' failed: ' + (result.error?.message || result.stderr))
  return result.stdout
}
function note(status, label) {
  const line = status + ' ' + label + '\n'
  process.stdout.write(line)
  if (process.env.TEMPLATE_TEST_RESULTS) appendFileSync(process.env.TEMPLATE_TEST_RESULTS, line)
}
export function checkEcho(file) {
  if (!existsSync(file)) throw new Error('missing echo.mjs')
  for (const [args, expected] of [
    [['hello', 'world'], 'hello world\n'], [['a  b', 'c'], 'a  b c\n'], [[], '\n'],
  ]) {
    const result = spawnSync(process.execPath, [file, ...args], { timeout: 10000 })
    if (result.status !== 0) throw new Error('echo exit code ' + result.status + ': ' + (result.error?.message || result.stderr))
    if (result.stdout.at(-1) !== 10) throw new Error('echo missing newline')
    if (!result.stdout.equals(Buffer.from(expected))) throw new Error('echo output differs for ' + JSON.stringify(args))
  }
}
export function compareTrees(expected, actual, ref) {
  const wanted = new Map(git(expected, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean).map((entry) => {
    const [, mode, path] = /^(\d+) [a-f0-9]+ 0\t(.+)$/.exec(entry)
    return [path, { mode, bytes: readFileSync(resolve(expected, path)) }]
  }))
  const got = new Map(git(actual, ['ls-tree', '-r', '-z', ref]).split('\0').filter(Boolean).map((entry) => {
    const [, mode, path] = /^(\d+) \w+ [a-f0-9]+\t(.+)$/.exec(entry)
    return [path, { mode, bytes: git(actual, ['show', ref + ':' + path], null) }]
  }))
  const errors = []
  for (const path of [...new Set([...wanted.keys(), ...got.keys()])].sort()) {
    const a = wanted.get(path), b = got.get(path)
    if (!b) errors.push('file missing: ' + path)
    else if (!a) errors.push('file extra: ' + path)
    else {
      if (a.mode !== b.mode) errors.push('mode changed: ' + path)
      if (!a.bytes.equals(b.bytes)) errors.push('bytes changed: ' + path)
    }
    if (b?.bytes.includes(Buffer.from('<REPLACE_ME'))) errors.push('placeholder left: ' + path)
  }
  return errors
}
export async function checkStructure(source, valuesFile, origin, alice, fixtures) {
  const expected = mkdtempSync(join(tmpdir(), 'template-expected-'))
  try {
    const values = { trackerRemote: git(alice, ['remote', 'get-url', 'origin']).trim(), ...JSON.parse(readFileSync(valuesFile)) }
    const entries = git(source, ['ls-files', '--stage', '-z', '--', 'template/']).split('\0').filter(Boolean)
    if (!entries.length) throw new Error('no tracked Template files')
    for (const entry of entries) {
      const [, mode, sourceFile, path] = /^(\d+) [a-f0-9]+ 0\t(template\/(.+))$/.exec(entry)
      const file = join(expected, path)
      const input = readFileSync(join(source, sourceFile))
      const bytes = input.includes(Buffer.from('<REPLACE_ME'))
        ? Buffer.from(input.toString('utf8').replace(/<REPLACE_ME:([A-Za-z][A-Za-z0-9]*)>/g, (_, name) => {
          if (values[name] === undefined) throw new Error('expected value missing: ' + name)
          return String(values[name])
        })) : input
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, bytes)
      chmodSync(file, mode === '100755' ? 0o755 : 0o644)
    }
    const { writeIntegrations } = await import(pathToFileURL(join(expected, 'tools/integrations/write.mjs')))
    writeIntegrations({ root: expected, target: expected, integrations: ['claude'] })
    const actualMetadata = JSON.parse(git(origin, ['show', 'main:.beads/metadata.json']))
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(actualMetadata.project_id)) {
      throw new Error('Tracker metadata has no project UUID')
    }
    // The project UUID is created by bd, not by Deploy. Its shape is checked above; every other
    // byte and key is derived independently from the pinned Tracker's probe and project value.
    writeFileSync(join(expected, '.beads/metadata.json'), JSON.stringify({
      database: 'dolt', backend: 'dolt', dolt_mode: 'embedded',
      dolt_database: String(values.projectName).replaceAll('-', '_'), project_id: actualMetadata.project_id,
    }, null, 2))
    writeFileSync(join(expected, '.beads/README.md'), readFileSync(join(fixtures, 'tracker-README.md')))
    git(expected, ['init', '--initial-branch=main'])
    git(expected, ['add', '--all'])
    const errors = compareTrees(expected, origin, 'main')
    if (errors.length) throw new Error(errors.join('\n'))
  } finally { rmSync(expected, { recursive: true, force: true }) }
}
export function checkWarnings(log, allowFile) {
  const allowed = new Set(readFileSync(allowFile, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
    const [warning, reason] = line.split('\t')
    if (!warning || !reason?.trim()) throw new Error('warning allowance needs a reason')
    return warning
  }))
  const warnings = [...readFileSync(log, 'utf8').matchAll(/\x1b\[33m\[devcontainer\]\x1b\[0m (.*)/g)].map((match) => match[1])
  const unexpected = warnings.filter((warning) => !allowed.has(warning))
  if (unexpected.length) throw new Error('unexpected Bootstrap warning: ' + unexpected.join('; '))
}
export function checkBootstrap(root) {
  const wanted = createHash('sha256').update(readFileSync(join(root, 'package-lock.json'))).digest('hex')
  const marker = join(root, 'node_modules/.devcontainer-lock-hash')
  if (!existsSync(marker) || readFileSync(marker, 'utf8') !== wanted) throw new Error('Bootstrap npm lock hash missing or wrong')
  const events = ['pre-commit', 'prepare-commit-msg', 'post-checkout', 'post-merge', 'pre-push']
  for (const event of events) {
    const command = git(root, ['config', '--get', 'hook.asdlc-' + event + '.command']).trim()
    if (command !== 'node scripts/git-hooks.mjs ' + event) throw new Error('Bootstrap hook command wrong: ' + event)
  }
  if (!existsSync(join(root, '.beads/embeddeddolt'))) throw new Error('Bootstrap embedded Tracker missing')
}
export function runCI(root) {
  const require = createRequire(join(root, 'package.json'))
  const workflow = require('js-yaml').load(readFileSync(join(root, '.github/workflows/verify.yml'), 'utf8'))
  let count = 0
  const failures = []
  for (const job of Object.values(workflow.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (typeof step.run !== 'string' || !/^mise\s+run\s/.test(step.run.trim())) continue
      count++
      const result = spawnSync('sh', ['-c', step.run], {
        cwd: root, env: { ...process.env, ...workflow.env, ...job.env, ...step.env }, stdio: 'inherit',
      })
      const label = step.run.trim()
      note(result.status === 0 ? 'PASS' : 'FAIL', 'CI ' + label)
      if (result.status !== 0) failures.push(label)
    }
  }
  if (!count) throw new Error('deployed CI has no mise run steps')
  if (failures.length) throw new Error('CI steps failed: ' + failures.join(', '))
}
export function checkFixtureCoverage(settingsFile, fixtures) {
  const settings = JSON.parse(readFileSync(settingsFile))
  const hooks = []
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    for (const group of groups) for (const hook of group.hooks ?? []) {
      const match = typeof hook.command === 'string' && /scripts\/hooks\/([a-z0-9-]+)\.mjs$/.exec(hook.command)
      if (hook.type !== 'command' || !match || !['refuse', 'allow'].every((kind) => existsSync(join(fixtures, match[1] + '.' + kind + '.json')))) {
        throw new Error('no fixture for ' + (hook.command ?? hook.type))
      }
      hooks.push({ event, command: hook.command, name: match[1] })
    }
  }
  if (!hooks.length) throw new Error('settings have no command hooks')
  return hooks
}
export function runGuards(root, fixtures) {
  const hooks = checkFixtureCoverage(join(root, '.claude/settings.json'), fixtures)
  const expectations = JSON.parse(readFileSync(join(fixtures, 'expectations.json')))
  const unprovisioned = join(dirname(root), 'unprovisioned')
  const provisioned = join(root, '.claude/worktrees/probe')
  const substitutions = { __BOB__: root, __UNPROVISIONED__: unprovisioned, __WORKTREE__: provisioned }
  const failures = []
  let created = false
  function verify(label, action) {
    try { action(); note('PASS', label) }
    catch (error) { failures.push(error.message); note('FAIL', label + ': ' + error.message) }
  }
  function payload(name, kind) {
    const replace = (value) => {
      if (typeof value === 'string') return Object.entries(substitutions).reduce((text, [key, path]) => text.replaceAll(key, path), value)
      if (Array.isArray(value)) return value.map(replace)
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]))
      return value
    }
    return JSON.stringify(replace(JSON.parse(readFileSync(join(fixtures, name + '.' + kind + '.json')))))
  }
  git(root, ['worktree', 'add', '-b', 'template-test/unprovisioned', unprovisioned, 'main'])
  try {
    for (const hook of hooks) {
      for (const kind of ['refuse', 'allow']) {
        verify(hook.name + ' ' + kind, () => {
          const before = git(root, ['worktree', 'list', '--porcelain'])
          const result = spawnSync('sh', ['-c', hook.command], {
            cwd: dirname(root), env: { ...process.env, CLAUDE_PROJECT_DIR: root },
            input: payload(hook.name, kind), encoding: 'utf8', timeout: 120000,
          })
          process.stdout.write(result.stdout ?? '')
          process.stderr.write(result.stderr ?? '')
          if (result.error || result.status === null) throw new Error('hook could not run: ' + (result.error?.message ?? result.signal))
          if (kind === 'refuse') {
            const expectation = expectations[hook.name]
            if (!expectation) throw new Error('no refusal expectation for ' + hook.command)
            const correctExit = expectation.exit === 'non-zero' ? result.status !== 0 : result.status === expectation.exit
            if (!correctExit || !result.stderr.includes(expectation.reason)) {
              throw new Error('expected refusal ' + expectation.exit + ' with ' + expectation.reason + ', got ' + result.status)
            }
            if (git(root, ['worktree', 'list', '--porcelain']) !== before) throw new Error('refused hook changed worktrees')
          } else {
            if (result.status !== 0) throw new Error('allow fixture exited ' + result.status)
            if (hook.name === 'worktree-create') {
              if (result.stdout.trim() !== provisioned || !existsSync(provisioned)) throw new Error('WorktreeCreate did not return its worktree path')
              if (git(provisioned, ['branch', '--show-current']).trim() !== 'agent/probe') throw new Error('WorktreeCreate made the wrong branch')
              created = true
            }
            if (hook.name === 'worktree-remove') {
              if (!created || existsSync(provisioned) || git(root, ['worktree', 'list', '--porcelain']).includes('worktree ' + provisioned + '\n')) {
                throw new Error('WorktreeRemove did not remove the created worktree')
              }
              git(root, ['rev-parse', '--verify', 'refs/heads/agent/probe'])
            }
          }
        })
      }
    }
  } finally {
    git(root, ['worktree', 'remove', '--force', unprovisioned])
    git(root, ['branch', '-D', 'template-test/unprovisioned'])
    if (created && !existsSync(provisioned)) git(root, ['branch', '-D', 'agent/probe'])
  }
  if (failures.length) throw new Error('Guards failed: ' + failures.join('; '))
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const [check, ...args] = process.argv.slice(2)
    if (check === 'echo') checkEcho(...args)
    else if (check === 'structure') await checkStructure(...args)
    else if (check === 'warnings') checkWarnings(...args)
    else if (check === 'bootstrap') checkBootstrap(...args)
    else if (check === 'ci') runCI(...args)
    else if (check === 'guards') runGuards(...args)
    else throw new Error('Unknown check: ' + check)
    console.log('PASS ' + check)
  } catch (error) {
    console.error('FAIL ' + error.message)
    process.exitCode = 1
  }
}
