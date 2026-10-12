/**
 * Runs a headless agent with wall-time, turn and spend limits, saving redacted stream-json output.
 * A stalled process or a limit exit must report budget, not look like a wrong implementation;
 * credentials must not reach artifacts, even when a child splits its output across writes.
 *   node tests/template/agent.mjs canary|work <root> <prompt-file> <transcript> <stderr-log>
 * Needs Claude Code and an explicitly supplied model credential. No personal configuration is read.
 */
import { spawn } from 'node:child_process'
import { createWriteStream, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkAgentResult } from './transcripts.mjs'

export async function runLimited({ program, args, cwd, env, seconds, transcript, log }) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('invalid time limit')
  const secrets = [env.ANTHROPIC_API_KEY, env.CLAUDE_CODE_OAUTH_TOKEN].filter(Boolean)
  const redact = (text) => secrets.reduce((clean, value) => clean.split(value).join('[REDACTED]'), text)
  const output = createWriteStream(transcript, { mode: 0o600 })
  const errors = createWriteStream(log, { mode: 0o600 })
  let timedOut = false, startupError, killTimer
  const child = spawn(program, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const buffers = { stdout: '', stderr: '' }
  for (const [name, destination] of [['stdout', output], ['stderr', errors]]) {
    child[name].setEncoding('utf8')
    child[name].on('data', (chunk) => {
      buffers[name] += chunk
      let newline
      while ((newline = buffers[name].indexOf('\n')) !== -1) {
        destination.write(redact(buffers[name].slice(0, newline + 1)))
        buffers[name] = buffers[name].slice(newline + 1)
      }
    })
  }
  const kill = (signal) => {
    try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  const timer = setTimeout(() => {
    timedOut = true
    kill('SIGTERM')
    killTimer = setTimeout(() => kill('SIGKILL'), 1000)
  }, seconds * 1000)
  child.once('error', (error) => { startupError = error })
  const { code, signal } = await new Promise((done) => child.once('close', (code, signal) => done({ code, signal })))
  clearTimeout(timer)
  clearTimeout(killTimer)
  output.write(redact(buffers.stdout))
  errors.write(redact(buffers.stderr))
  await Promise.all([new Promise((done) => output.end(done)), new Promise((done) => errors.end(done))])
  if (startupError) throw new Error('agent could not start: ' + startupError.message)
  return { code, signal, timedOut }
}
export async function runAgent({ phase, root, promptFile, transcript, log }) {
  const prefix = phase === 'canary' ? 'CANARY' : phase === 'work' ? 'WORK' : null
  if (!prefix) throw new Error('unknown agent phase: ' + phase)
  const defaults = prefix === 'CANARY' ? { seconds: 300, turns: 15, usd: 2 } : { seconds: 1800, turns: 100, usd: 10 }
  const limit = (name) => Number(process.env['TEMPLATE_TEST_' + prefix + '_' + name.toUpperCase()] ?? defaults[name])
  const seconds = limit('seconds'), turns = limit('turns'), usd = limit('usd')
  if (!Number.isSafeInteger(turns) || turns <= 0 || !Number.isFinite(usd) || usd <= 0) throw new Error('invalid agent turn or spend limit')
  const args = ['-p', readFileSync(promptFile, 'utf8'), '--model', process.env.TEMPLATE_TEST_MODEL ?? 'claude-sonnet-5-5',
    '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose',
    '--max-turns', String(turns), '--max-budget-usd', String(usd), '--no-session-persistence']
  // CLI options: https://code.claude.com/docs/en/cli-reference. Hooks still judge tool calls;
  // their live refusal is required separately by the Canary's transcript check.
  const result = await runLimited({ program: 'claude', args, cwd: root, env: process.env, seconds, transcript, log })
  if (result.timedOut) throw new Error('budget: ' + phase + ' wall-time limit (' + seconds + ' seconds)')
  checkAgentResult(transcript)
  if (result.code !== 0) throw new Error('agent CLI exited ' + result.code + (result.signal ? ' (' + result.signal + ')' : ''))
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const [phase, root, promptFile, transcript, log] = process.argv.slice(2)
    await runAgent({ phase, root, promptFile, transcript, log })
    console.log('PASS ' + phase + ' agent completed within limits')
  } catch (error) { console.error('FAIL ' + error.message); process.exitCode = 1 }
}
