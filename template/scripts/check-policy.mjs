/**
 * Policy gate. It holds the records under `tools/policy/` to the shape `CLAUDE.md` § Three kinds of
 * file, and never a fourth gives a hand-authored decision record, and to each other:
 *
 *   - every record parses as a JSON object, and holds at least one constant;
 *   - every record carries the five header fields `tools/lib/policy.ts` names (`HEADER_FIELDS`), each
 *     a non-empty string, so a reader learns what it changes before its first constant;
 *   - every constant has a `<key>Means` sibling, a non-empty string, in the same record, and every
 *     `<key>Means` has its constant there;
 *   - no key is defined in two records, so every reader of the merged policy reads one value;
 *   - `tools/policy/README.md` names every record and no record that is not there, and the directory
 *     holds nothing else, which the loader would read past;
 *   - `tools/policy.json`, the single file the records replaced, has not come back: a key added there
 *     would reach no reader, and its gate would pass.
 *
 * Its selftest also holds the loader, `tools/lib/policy.ts`, which every reader and this gate stand
 * on: what its command line prints and refuses, a key two records define refused for every reader,
 * and a fixture's edit written back to the record that held each key.
 *
 * What a constant's value must be is each reader's to hold, by the gates the record's `gatedBy`
 * names; a table's rows (`promptWordBudgets`) are `check:prompts`'. This gate holds only what every
 * record shares.
 *
 * THE FAILURE IT EXISTS TO PREVENT. No incident yet: the gate came with the split of `tools/policy.json`
 * (`docs/decisions.md` § D-27). Before it, no code read that file's five header fields, and seven gates
 * each held the `Means` of their own keys, so a key that no gate read could land with no reason beside
 * it, and a header could go stale or missing with nothing to say so. Were this gate wrong, a record
 * would reach readers with a constant whose reason is gone, or two records would define one key,
 * which `tools/lib/policy.ts` refuses only when a reader next runs, inside whichever gate reads first.
 *
 * INVOCATION.
 *
 *   mise run check:policy                          the gate
 *   mise run check:policy:selftest                 its fixtures -- every refusal on a doctored copy
 *   POLICY_CHECK_ROOT=<dir> mise run check:policy  the same gate over a doctored copy
 *
 * NEEDS only committed files: the records and `tools/policy/README.md`. No tool, no network.
 * 0.09 s wall for the gate and 0.12 s for its selftest through `node --run` (`/usr/bin/time -p`, one
 * run each) on a macOS 26.7.1 laptop with Node 26.8.1, 2026-10-02.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { editPolicy, HEADER_FIELDS, POLICY_DIR, parseRecord, readPolicy, readRecords } from '../tools/lib/policy.ts'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOADER = join(REPO_ROOT, 'tools/lib/policy.ts')
const ROOT = process.env.POLICY_CHECK_ROOT ?? REPO_ROOT
const README = `${POLICY_DIR}/README.md`
/** The one file the records replaced; a key added there would reach no reader. */
const RETIRED = 'tools/policy.json'
const RULE_HOME = '`CLAUDE.md` § Three kinds of file, and never a fourth'

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const isText = (v) => typeof v === 'string' && v.trim() !== ''
const isHeader = (key) => HEADER_FIELDS.includes(key)

/** Every problem with the records under `root`, one message each; empty when they hold. */
export function runCheck(root) {
  const dir = join(root, POLICY_DIR)
  if (!existsSync(dir)) return [`${POLICY_DIR}/ is missing under ${root}: the policy has no record.`]
  const names = readdirSync(dir).sort(byCodePoint)
  const problems = []
  if (existsSync(join(root, RETIRED))) {
    problems.push(`${RETIRED} is back, and no reader reads it: it was split into the records under ${POLICY_DIR}/ (\`docs/decisions.md\` § D-27). Move each key to the record that holds its kind.`)
  }
  const recordNames = names.filter((name) => name.endsWith('.json'))
  if (recordNames.length === 0) return [`${POLICY_DIR}/ under ${root} holds no record (no .json file).`]
  for (const name of names.filter((n) => !n.endsWith('.json') && n !== 'README.md')) {
    problems.push(`${POLICY_DIR}/${name} is neither a record (.json) nor the README; the loader reads past it. Move it out, or make it a record.`)
  }

  const home = new Map()
  for (const name of recordNames) {
    const path = `${POLICY_DIR}/${name}`
    let data
    try {
      data = parseRecord(path, readFileSync(join(root, path), 'utf8')).data
    } catch (error) {
      // The loader's own refusal, so a reader and this gate say the same of a broken record.
      problems.push(`${error.message}.`)
      continue
    }
    for (const field of HEADER_FIELDS) {
      if (!isText(data[field])) {
        problems.push(`${path} has no \`${field}\`, a non-empty string; every record opens with ${HEADER_FIELDS.join(', ')} (${RULE_HOME}).`)
      }
    }
    const keys = Object.keys(data).filter((key) => !isHeader(key))
    const constants = keys.filter((key) => !key.endsWith('Means'))
    if (constants.length === 0) problems.push(`${path} holds no constant: a record with only its header decides nothing. Delete it, or give it its constants.`)
    for (const key of constants) {
      if (!isText(data[`${key}Means`])) {
        problems.push(`\`${key}\` in ${path} has no \`${key}Means\` sibling saying what it decides and where it is changed (${RULE_HOME}).`)
      }
    }
    for (const key of keys.filter((k) => k.endsWith('Means'))) {
      const base = key.slice(0, -'Means'.length)
      if (!Object.hasOwn(data, base)) problems.push(`\`${key}\` in ${path} names no constant: ${path} has no \`${base}\`. Remove it, or restore its constant.`)
    }
    for (const key of keys) {
      const first = home.get(key)
      if (first !== undefined) problems.push(`\`${key}\` is defined in both ${first} and ${path}: a constant has one home, and every reader of the merged policy would read only one.`)
      else home.set(key, path)
    }
  }

  const readme = join(root, README)
  if (!existsSync(readme)) {
    problems.push(`${README} is missing: a directory of records has a README with a row per record (\`CLAUDE.md\` § Every directory and document says what it is, and who wins).`)
  } else {
    const text = readFileSync(readme, 'utf8')
    const named = new Set([...text.matchAll(/`([^`/\s]+\.json)`/g)].map((m) => m[1]))
    for (const name of recordNames.filter((n) => !named.has(n))) {
      problems.push(`${POLICY_DIR}/${name} is not named in ${README}: its row lands in the same change as the record.`)
    }
    for (const name of [...named].filter((n) => !recordNames.includes(n)).sort(byCodePoint)) {
      problems.push(`${README} names \`${name}\`, which is not a record under ${POLICY_DIR}/. Remove its row, or restore the record.`)
    }
  }
  return problems
}

function main() {
  const problems = runCheck(ROOT)
  if (problems.length === 0) {
    const records = readdirSync(join(ROOT, POLICY_DIR)).filter((n) => n.endsWith('.json')).length
    console.log(`policy: ${records} record(s) under ${POLICY_DIR}/ each carry their header and a Means beside every constant, define no key twice, and each has its row in ${README}.`)
    process.exit(0)
  }
  console.error(`policy: ${problems.length} problem(s).\n`)
  for (const problem of problems) console.error(`  - ${problem}\n`)
  process.exit(1)
}

/* --------------------------------------------------------------------------------- selftest ----- */

/** Edit one record of a doctored copy as parsed JSON; an edit that changes nothing is a broken fixture. */
const editRecord = (name, change) => (dir) => {
  const path = join(dir, POLICY_DIR, name)
  const before = readFileSync(path, 'utf8')
  const data = JSON.parse(before)
  change(data)
  const after = `${JSON.stringify(data, null, 2)}\n`
  if (after === before) throw new Error(`selftest fixture for ${name} changed nothing -- the doctoring missed its target`)
  writeFileSync(path, after)
}
const write = (relative, text) => (dir) => writeFileSync(join(dir, relative), text)
const appendRow = (name) => (dir) => writeFileSync(join(dir, README), `${readFileSync(join(dir, README), 'utf8')}| \`${name}\` | a fixture record |\n`)
const both = (...doctors) => (dir) => doctors.forEach((doctor) => doctor(dir))
const header = Object.fromEntries(HEADER_FIELDS.map((field) => [field, `a fixture ${field}`]))

function cases() {
  const V = 'vocabulary.json'
  const T = 'tool-settings.json'
  return [
    { name: 'control: the live records, undoctored', doctor: () => {}, expect: 'pass' },
    { name: 'a record without a header field', doctor: editRecord(V, (d) => delete d.gatedBy), expect: /^tools\/policy\/vocabulary\.json has no `gatedBy`, a non-empty string/ },
    { name: 'a record with an empty header field', doctor: editRecord(T, (d) => { d.provenance = ' ' }), expect: /^tools\/policy\/tool-settings\.json has no `provenance`, a non-empty string/ },
    { name: 'a constant without its Means', doctor: editRecord(V, (d) => delete d.specChangeLabelMeans), expect: /^`specChangeLabel` in tools\/policy\/vocabulary\.json has no `specChangeLabelMeans` sibling/ },
    { name: 'a constant with an empty Means', doctor: editRecord(V, (d) => { d.specChangeLabelMeans = '' }), expect: /^`specChangeLabel` in tools\/policy\/vocabulary\.json has no `specChangeLabelMeans` sibling/ },
    { name: 'a Means with no constant', doctor: editRecord(V, (d) => delete d.specChangeLabel), expect: /^`specChangeLabelMeans` in tools\/policy\/vocabulary\.json names no constant/ },
    {
      name: 'a key defined in two records',
      doctor: editRecord(T, (d) => {
        d.specChangeLabel = 'spec-change'
        d.specChangeLabelMeans = 'a second home'
      }),
      expect: /^`specChangeLabel` is defined in both tools\/policy\/tool-settings\.json and tools\/policy\/vocabulary\.json/,
    },
    { name: 'a record that is not JSON', doctor: write(`${POLICY_DIR}/${V}`, '{\n'), expect: /^tools\/policy\/vocabulary\.json does not parse as JSON/ },
    { name: 'a record that is not an object', doctor: write(`${POLICY_DIR}/${V}`, '[]\n'), expect: /^tools\/policy\/vocabulary\.json holds no JSON object/ },
    { name: 'a record with only its header', doctor: both(write(`${POLICY_DIR}/empty.json`, JSON.stringify(header)), appendRow('empty.json')), expect: /^tools\/policy\/empty\.json holds no constant/ },
    {
      name: 'a record the README does not name',
      doctor: write(`${POLICY_DIR}/extra.json`, JSON.stringify({ ...header, extraKey: 1, extraKeyMeans: 'a fixture constant' })),
      expect: /^tools\/policy\/extra\.json is not named in tools\/policy\/README\.md/,
    },
    { name: 'the README names a record that is not there', doctor: appendRow('gone.json'), expect: /^tools\/policy\/README\.md names `gone\.json`, which is not a record/ },
    { name: 'a file that is neither a record nor the README', doctor: write(`${POLICY_DIR}/notes.yaml`, 'a: 1\n'), expect: /^tools\/policy\/notes\.yaml is neither a record \(\.json\) nor the README/ },
    { name: 'no README', doctor: (dir) => rmSync(join(dir, README)), expect: /^tools\/policy\/README\.md is missing/ },
    { name: 'the retired single file back beside the records', doctor: write(RETIRED, '{"specChangeLabel": "spec-change"}\n'), expect: /^tools\/policy\.json is back, and no reader reads it/ },
    { name: 'no record at all', doctor: (dir) => rmSync(join(dir, POLICY_DIR), { recursive: true }), expect: /^tools\/policy\/ is missing under / },
  ]
}

/** The loader's command line over a copy of the records, as a prompt or a workflow's command runs it. */
const loader = (dir, ...args) =>
  spawnSync(process.execPath, ['--no-warnings', LOADER, ...args], { cwd: dir, env: { ...process.env, POLICY_ROOT: dir }, encoding: 'utf8' })

/** Why a run of the loader is not `status` with stdout `out` and stderr matching `err`, or null. */
function ran(run, status, { out, err } = {}) {
  if (run.status !== status) return `exited ${run.status}, not ${status}: ${(run.stderr || run.stdout).trim()}`
  if (out !== undefined && run.stdout.trim() !== out) return `printed ${run.stdout.trim()}, not ${out}`
  if (err !== undefined && !err.test(run.stderr)) return `said ${JSON.stringify(run.stderr.trim())}, not ${err}`
  return null
}

/**
 * The loader itself, which every reader and this gate stand on: what its command line prints and
 * refuses, and that a fixture's edit goes back to the record that held each key. Each case runs over
 * an undoctored copy unless it doctors one, and each refusal is asserted by its reason.
 */
function loaderCases() {
  const live = readPolicy(REPO_ROOT)
  const verifyTrace = Object.fromEntries(Object.entries(live).filter(([k]) => k.startsWith('verifyTrace') && !k.endsWith('Means')))
  return [
    {
      name: 'loader: prints the keys it is named, from two records, in the merged order and nothing else',
      check: (dir) => {
        const named = ['specChangeLabel', 'prReviewMergeMethod']
        const out = JSON.stringify(Object.fromEntries(Object.entries(live).filter(([k]) => named.includes(k))))
        return ran(loader(dir, ...named), 0, { out })
      },
    },
    {
      name: 'loader: a prefix prints its constants and none of their Means',
      check: (dir) => (Object.keys(verifyTrace).length === 0 ? 'cannot be exercised: no verifyTrace key' : ran(loader(dir, '--prefix', 'verifyTrace'), 0, { out: JSON.stringify(verifyTrace) })),
    },
    { name: 'loader: a key no record holds is refused, by its name', check: (dir) => ran(loader(dir, 'noSuchKey'), 1, { err: /^policy: no record under tools\/policy\/ holds `noSuchKey`/ }) },
    { name: 'loader: a prefix with no value is refused', check: (dir) => ran(loader(dir, '--prefix'), 2, { err: /^policy: --prefix needs a value/ }) },
    { name: 'loader: no key and no prefix is refused', check: (dir) => ran(loader(dir), 2, { err: /^policy: name at least one key or --prefix/ }) },
    {
      name: 'loader: a key two records define is refused for every reader, naming both',
      doctor: editRecord('tool-settings.json', (d) => {
        d.specChangeLabel = 'spec-change'
      }),
      check: (dir) => ran(loader(dir, 'typesafeModel'), 1, { err: /^policy: `specChangeLabel` is defined in both tools\/policy\/tool-settings\.json and tools\/policy\/vocabulary\.json/ }),
    },
    {
      name: "loader: a fixture's edit goes back to the record that held each key, and a new Means beside its constant",
      doctor: editRecord('vocabulary.json', (d) => delete d.specChangeLabelMeans),
      check: (dir) => {
        editPolicy(dir, (p) => {
          p.couplingMinTogether = 999
          p.specChangeLabelMeans = 'a fixture reason'
        })
        const records = Object.fromEntries(readRecords(dir).map((r) => [r.path, r.data]))
        if (records['tools/policy/tool-settings.json'].couplingMinTogether !== 999) return 'the changed key did not go back to tool-settings.json'
        if (records['tools/policy/vocabulary.json'].specChangeLabelMeans !== 'a fixture reason') return 'the new Means did not go beside its constant'
        try {
          editPolicy(dir, () => {})
          return 'an edit that changed nothing was not refused'
        } catch (error) {
          return /changed nothing/.test(error.message) ? null : `refused for another reason: ${error.message}`
        }
      },
    },
  ]
}

function selftest() {
  const base = mkdtempSync(join(tmpdir(), 'check-policy-'))
  const results = []
  try {
    for (const { name, doctor, check } of loaderCases()) {
      const dir = join(base, name.replace(/[^a-z0-9]+/gi, '-'))
      cpSync(join(REPO_ROOT, POLICY_DIR), join(dir, POLICY_DIR), { recursive: true })
      doctor?.(dir)
      const problem = check(dir)
      results.push({ name, ok: problem === null, detail: problem ?? 'holds' })
    }
    for (const { name, doctor, expect } of cases()) {
      const dir = join(base, name.replace(/[^a-z0-9]+/gi, '-'))
      cpSync(join(REPO_ROOT, POLICY_DIR), join(dir, POLICY_DIR), { recursive: true })
      doctor(dir)
      const problems = runCheck(dir)
      let ok
      let detail
      if (expect === 'pass') {
        ok = problems.length === 0
        detail = ok ? 'passes' : `unexpected problem(s): ${problems.join(' | ')}`
      } else {
        ok = problems.some((problem) => expect.test(problem))
        detail = ok
          ? `fails for that reason (${problems.length} problem(s))`
          : problems.length === 0
            ? 'PASSED, but should have failed'
            : `failed, but not for that reason: ${problems.join(' | ')}`
      }
      results.push({ name, ok, detail })
      if (name.startsWith('control') && !ok) {
        console.error(`selftest: the undoctored copy does not pass, so no case can be trusted: ${detail}`)
        process.exit(1)
      }
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
  const failed = results.filter((result) => !result.ok)
  for (const { name, ok, detail } of results) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name} -- ${detail}`)
  const gate = cases().length
  console.log(
    `policy selftest: ${results.length - failed.length}/${results.length} cases hold ` +
      `(the gate's control plus ${gate - 1} doctored copies, and ${results.length - gate} of the loader's).`,
  )
  process.exit(failed.length === 0 ? 0 : 1)
}

if (process.argv.includes('--selftest')) selftest()
else main()
