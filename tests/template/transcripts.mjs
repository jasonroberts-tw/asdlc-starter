/**
 * Checks stream-json tool evidence by tool_use_id and the terminal agent result.
 * Searching prose for "blocked" or "gates passed" would accept an agent's claim without a tool run.
 *   node tests/template/transcripts.mjs guard|gates|bypasses|result <jsonl> [patterns-file]
 * Needs only Node and saved transcripts. Never executes model output.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function events(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line) }
    catch { throw new Error('invalid transcript JSON at line ' + (index + 1)) }
  })
}
const text = (content) => typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter((block) => block.type === 'text').map((block) => block.text).join('\n') : ''
function evidence(file) {
  const calls = [], results = new Map()
  for (const event of events(file)) {
    const blocks = Array.isArray(event.message?.content) ? event.message.content : []
    for (const block of blocks) {
      if (block.type === 'tool_use' && block.name === 'Bash' && typeof block.input?.command === 'string') {
        calls.push({ id: block.id, command: block.input.command })
      }
      if (block.type === 'tool_result') {
        const raw = blocks.filter((item) => item.type === 'tool_result').length === 1 ? event.tool_use_result : null
        results.set(block.tool_use_id, {
          error: block.is_error === true || raw?.interrupted === true ||
            (raw?.exit_code !== undefined && raw.exit_code !== 0) || (raw?.exitCode !== undefined && raw.exitCode !== 0),
          text: [text(block.content), raw?.stdout, raw?.stderr].filter(Boolean).join('\n'),
        })
      }
    }
  }
  return { calls, results }
}
// Only recognize direct shell invocations. Quoted prose such as printf 'mise run gates' is one
// argument, not three commands; compound commands split only at unquoted shell separators.
// Here-document bodies are data: quotes and command-looking lines there cannot affect the scan.
function invocations(command) {
  const segments = [], words = [], hereDocs = []
  let word = '', quote = '', escaped = false, hereDoc = null
  const flushWord = () => {
    if (word) {
      words.push(word)
      if (hereDoc) { hereDocs.push({ ...hereDoc, delimiter: word }); hereDoc = null }
    }
    word = ''
  }
  const flushSegment = () => { flushWord(); if (words.length) segments.push(words.splice(0)) }
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if (escaped) { word += char; escaped = false }
    else if (char === '\\' && quote !== "'") escaped = true
    else if (quote) { if (char === quote) quote = ''; else word += char }
    else if (char === "'" || char === '"') quote = char
    else if (char === '<' && command.slice(index, index + 3) === '<<<') {
      flushWord()
      words.push('<<<')
      index += 2
    }
    else if (char === '<' && command[index + 1] === '<' && command[index + 2] !== '<') {
      flushWord()
      hereDoc = { stripTabs: command[index + 2] === '-' }
      words.push('<<')
      index += hereDoc.stripTabs ? 2 : 1
    }
    else if (char === '\n') {
      flushSegment()
      for (const { delimiter, stripTabs } of hereDocs.splice(0)) {
        while (index < command.length) {
          const next = command.indexOf('\n', index + 1)
          const end = next === -1 ? command.length : next
          const line = command.slice(index + 1, end)
          index = end
          if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) break
        }
      }
    }
    else if (/[;&|()]/.test(char)) flushSegment()
    else if (/\s/.test(char)) flushWord()
    else word += char
  }
  flushSegment()
  return segments.map((tokens) => {
    if (tokens[0] === 'env') tokens.shift()
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0] ?? '')) tokens.shift()
    return tokens
  })
}
export function checkGuardTranscript(file) {
  const { calls, results } = evidence(file)
  if (!calls.some(({ id, command }) => invocations(command).some(([a, b, c]) => a === 'gh' && b === 'pr' && c === 'create') &&
      results.get(id)?.text.includes('BLOCKED by repository policy'))) throw new Error('guard refusal absent')
}
export function checkGatesTranscript(file) {
  const { calls, results } = evidence(file)
  const call = calls.findLast(({ command }) => invocations(command).some(([a, b, c]) => a === 'mise' && b === 'run' && c === 'gates'))
  if (!call) throw new Error('gates call missing')
  const result = results.get(call.id)
  if (!result) throw new Error('gates result missing')
  if (result.error || /(?:exit code|exit_code)\s*[:=]?\s*[1-9]\d*/i.test(result.text) ||
      !/\b\d+ passed,\s*0 failed,\s*0 skipped\b/.test(result.text)) throw new Error('last gates call failed')
}
export function checkBypasses(file, patternsFile) {
  const patterns = readFileSync(patternsFile, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
    const [pattern, reason] = line.split('\t')
    if (!reason?.trim()) throw new Error('bypass pattern needs a reason')
    return { regex: new RegExp(pattern), reason }
  })
  for (const { command } of evidence(file).calls) {
    for (const { regex, reason } of patterns) if (regex.test(command)) throw new Error('hook bypass: ' + reason)
  }
}
export function checkAgentResult(file) {
  const result = events(file).findLast((event) => event.type === 'result')
  if (!result) throw new Error('agent result missing')
  if (/max_turns|max_budget|budget/i.test(result.subtype ?? '')) throw new Error('budget: ' + result.subtype)
  if (result.is_error || result.subtype !== 'success') throw new Error('agent failed: ' + (result.subtype ?? 'unknown result'))
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const [check, ...args] = process.argv.slice(2)
    const checks = { guard: checkGuardTranscript, gates: checkGatesTranscript, bypasses: checkBypasses, result: checkAgentResult }
    if (!checks[check]) throw new Error('unknown transcript check: ' + check)
    checks[check](...args)
    console.log('PASS transcript ' + check)
  } catch (error) { console.error('FAIL ' + error.message); process.exitCode = 1 }
}
