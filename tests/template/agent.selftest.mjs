/** Tests the agent process boundary with real child processes and fake credentials, no model.
 * node --test tests/template/agent.selftest.mjs; requires only Node.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runLimited } from './agent.mjs'
function options(t, code, seconds = 5) {
  const root = mkdtempSync(join(tmpdir(), 'template-agent-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { program: process.execPath, args: ['-e', code], cwd: root, seconds,
    transcript: join(root, 'run.jsonl'), log: join(root, 'run.log'), env: { ...process.env } }
}
test('agent process control saves a transcript and completes', async (t) => {
  const input = options(t, 'console.log(JSON.stringify({type:"result",subtype:"success",is_error:false}))')
  const result = await runLimited(input)
  assert.equal(result.code, 0)
  assert.equal(result.timedOut, false)
  assert.equal(JSON.parse(readFileSync(input.transcript)).subtype, 'success')
})
test('agent wall-time limit kills a stalled process and reports budget', async (t) => {
  const result = await runLimited(options(t, 'setInterval(() => {}, 1000)', 0.1))
  assert.equal(result.timedOut, true)
  assert.notEqual(result.code, 0)
})
test('agent logs redact credentials even when output splits them across chunks', async (t) => {
  const input = options(t, 'process.stdout.write("fixture-"); setTimeout(() => { console.log("secret"); console.error("fixture-secret") }, 20)')
  input.env.ANTHROPIC_API_KEY = 'fixture-secret'
  await runLimited(input)
  assert.equal(readFileSync(input.transcript, 'utf8'), '[REDACTED]\n')
  assert.equal(readFileSync(input.log, 'utf8'), '[REDACTED]\n')
})
test('agent process refuses invalid time limits before launch', async (t) => {
  await assert.rejects(runLimited(options(t, '', 0)), /invalid time limit/)
})
