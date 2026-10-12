/**
 * Deploys tracked Template files, selected CLI integrations, and a new Tracker to an empty project.
 * Copying files alone leaves a remote that the next machine cannot bootstrap; init also commits
 * automatically, so its root commit must be completed before publishing rather than adding a second.
 *   node scripts/deploy.mjs --values values.json [--integrations claude,codex] <target-dir>
 * Needs Node, git, pinned bd, a git identity and a writable origin; no node_modules or GitHub API.
 * KIND: one-time project deployment.
 * INVARIANTS: preflight before copying; never replace existing work; preserve tracked bytes/modes.
 * RE-ENTRY: refuses an initialized project; failures after copying leave evidence for inspection.
 * STALE WHEN: the Template contract, tracked source, adapters or pinned bd change.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { selectIntegrations } from '../template/tools/integrations/adapters.mjs'

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const usage = 'usage: deploy.mjs --values file [--integrations claude,codex] <target-dir>'
function command(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error || result.status !== 0) {
    const operation = program === 'git' && args[0] === '-C' ? args[2] : args.slice(0, program === 'bd' ? 2 : 1).join(' ')
    throw new Error(program + ' ' + operation + ' failed: ' + (result.error?.message || result.stderr.trim() || result.stdout.trim() || 'non-zero exit'))
  }
  return result.stdout
}
function git(target, ...args) { return command('git', ['-C', target, ...args], source).trim() }
function argumentsOf(args) {
  let valuesFile, target, integrations
  const seen = new Set()
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') { console.log(usage); process.exit(0) }
    if (arg === '--values' || arg === '--integrations') {
      if (seen.has(arg)) throw new Error('Repeated argument: ' + arg)
      seen.add(arg)
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error('Missing value for ' + arg)
      if (arg === '--values') valuesFile = resolve(value)
      else integrations = value.split(',').map((id) => id.trim())
    } else if (arg.startsWith('-')) throw new Error('Unknown argument: ' + arg)
    else if (target) throw new Error('Expected one Target directory')
    else target = resolve(arg)
  }
  if (!valuesFile || !target) throw new Error(usage)
  return { valuesFile, target, integrations: selectIntegrations(integrations) }
}
function preflightTarget(target) {
  if (!existsSync(target) || !lstatSync(target).isDirectory()) throw new Error('Target is not a git repository directory')
  let top
  try { top = git(target, 'rev-parse', '--show-toplevel') }
  catch { throw new Error('Target is not a git repository') }
  if (realpathSync(top) !== realpathSync(target)) throw new Error('Target must be the git repository root')
  const head = spawnSync('git', ['-C', target, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' })
  if (head.status === 0) throw new Error('Target has a commit')
  if (git(target, 'for-each-ref', '--format=%(refname)')) throw new Error('Target has existing refs')
  let origin
  try { origin = git(target, 'remote', 'get-url', 'origin') }
  catch { throw new Error('Target has no origin remote') }
  if (!origin) throw new Error('Target has no origin remote')
  if (readdirSync(target).some((file) => file !== '.git')) throw new Error('Target is not empty')
  if (git(target, 'ls-files')) throw new Error('Target has staged files')
  if (git(target, 'ls-remote', 'origin')) throw new Error('Origin is not empty')
  return origin
}
function templateFiles() {
  const entries = command('git', ['-C', source, 'ls-files', '--stage', '-z', '--', 'template/'], source).split('\0').filter(Boolean)
  if (!entries.length) throw new Error('No tracked Template files')
  return entries.map((entry) => {
    const match = /^(\d+) [a-f0-9]+ (\d)\t(template\/(.+))$/.exec(entry)
    if (!match || match[2] !== '0') throw new Error('Unmerged Template path')
    const [, mode, , path, file] = match
    if (!['100644', '100755'].includes(mode) || !lstatSync(join(source, path)).isFile()) {
      throw new Error('Template path is not a regular tracked file: ' + path)
    }
    return { file, mode: mode === '100755' ? 0o755 : 0o644, bytes: readFileSync(join(source, path)) }
  })
}
function fill(files, input, origin) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Values must be a JSON object')
  const pattern = /<REPLACE_ME:([A-Za-z][A-Za-z0-9]*)>/g
  const names = new Set(files.flatMap(({ bytes }) => [...bytes.toString('utf8').matchAll(pattern)].map((match) => match[1])))
  const values = { ...input }
  if (names.has('trackerRemote') && values.trackerRemote === undefined) values.trackerRemote = origin
  for (const name of Object.keys(values)) {
    if (!names.has(name)) throw new Error('Unknown value: ' + name)
    const value = values[name]
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) {
      throw new Error('Value must be a string or safe integer: ' + name)
    }
    if (!String(value).trim()) throw new Error('Empty value: ' + name)
    if (/[\r\n\0"\\]/.test(String(value)) || String(value).includes('<REPLACE_ME')) {
      throw new Error('Value cannot be substituted safely: ' + name)
    }
    values[name] = String(value)
  }
  for (const name of names) if (values[name] === undefined) throw new Error('Missing required value: ' + name)
  return files.map((file) => {
    if (!file.bytes.includes(Buffer.from('<REPLACE_ME'))) return file
    const text = file.bytes.toString('utf8').replace(pattern, (_, name) => values[name])
    if (text.includes('<REPLACE_ME')) throw new Error('Unresolved placeholder in ' + file.file)
    return { ...file, bytes: Buffer.from(text) }
  })
}
function writeFiles(target, files) {
  for (const { file, bytes, mode } of files) {
    const destination = join(target, file)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, bytes, { mode })
    chmodSync(destination, mode)
  }
}
function stageFiles(target, files) {
  git(target, 'add', '--all')
  // core.filemode=false makes git ignore chmod, including on new files. The source index,
  // rather than the Target filesystem's capabilities, defines the committed Template modes.
  for (const [mode, flag] of [[0o755, '+x'], [0o644, '-x']]) {
    const paths = files.filter((file) => file.mode === mode).map((file) => file.file)
    if (paths.length) git(target, 'update-index', '--chmod=' + flag, '--', ...paths)
  }
}

try {
  const { valuesFile, target, integrations } = argumentsOf(process.argv.slice(2))
  const origin = preflightTarget(target)
  const input = JSON.parse(readFileSync(valuesFile, 'utf8'))
  const files = fill(templateFiles(), input, origin)
  writeFiles(target, files)
  const { writeIntegrations } = await import(pathToFileURL(join(target, 'tools/integrations/write.mjs')))
  const rendered = writeIntegrations({ root: target, target, integrations })
  for (const warning of rendered.warnings) console.error(warning)
  const indexedFiles = [...files, ...[...rendered.files.keys()].map((file) => ({
    file, mode: (rendered.modes.get(file) ?? 0o644) & 0o111 ? 0o755 : 0o644,
  }))]
  git(target, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  stageFiles(target, indexedFiles)
  console.log(command('bd', ['init', '--skip-agents', '--skip-hooks', '--non-interactive', '--prefix', String(input.projectName)], target).trim())
  if (!existsSync(join(target, '.beads/metadata.json')) || !existsSync(join(target, '.beads/embeddeddolt'))) {
    throw new Error('Tracker init failed: no embedded database or metadata')
  }
  // bd 1.3.0 commits automatically, edits .gitignore and strips config's newline. Restoring the
  // input bytes keeps those incidental edits out of the Template contract. Only bd's new files stay.
  // Source: https://github.com/gastownhall/beads/blob/v1.3.0/cmd/bd/init.go
  writeFiles(target, files)
  stageFiles(target, indexedFiles)
  const created = spawnSync('git', ['-C', target, 'rev-parse', '--verify', 'HEAD'])
  if (created.status === 0) git(target, 'commit', '--amend', '-m', 'Deploy project harness')
  else git(target, 'commit', '-m', 'Deploy project harness')
  git(target, 'push', '--set-upstream', 'origin', 'main')
  console.log(command('bd', ['dolt', 'push'], target).trim())
  if (git(target, 'status', '--porcelain')) throw new Error('Deploy left a dirty working tree')
  console.log('Deployed ' + integrations.join(', ') + ' into ' + target)
} catch (error) {
  console.error('Deploy: ' + error.message)
  process.exitCode = 1
}
