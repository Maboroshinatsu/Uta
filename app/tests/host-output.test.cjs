'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')
const { parseHostOutput } = createLoader()('main/host-output')

test('Claude results exclude tool and diagnostic text and require the requested session', () => {
  const output = [
    'diagnostic line',
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', input: { secret: 'must not be shown' } }] } }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'A', result: 'hello' }),
  ].join('\n')
  assert.equal(parseHostOutput('claude-code', output, 'A').text, 'hello')
  assert.equal(parseHostOutput('claude-code', output, 'B').kind, 'unknown')
  assert.equal(parseHostOutput('claude-code', '{broken', 'A').kind, 'unknown')
})

test('a structured failed turn is accepted input, not a failed-send retry', () => {
  const result = parseHostOutput('claude-code', JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'A', result: 'internal details' }), 'A')
  assert.equal(result.kind, 'failed')
  assert.equal(result.text, undefined)
  assert.match(result.error, /已接收/)
})

test('ZCode JSON summaries are checked against the exact resumed session', () => {
  const output = JSON.stringify({ sessionId: 'A', traceId: 'trace', response: 'answer' })
  assert.equal(parseHostOutput('zcode', output, 'A').text, 'answer')
  assert.equal(parseHostOutput('zcode', output, 'B').kind, 'unknown')
})

test('OpenCode stream parts are deduplicated and require a matching final stop event', () => {
  const events = [
    { type: 'step_start', sessionID: 'A', part: {} },
    { type: 'text', sessionID: 'A', part: { id: 'p1', text: 'answer' } },
    { type: 'text', sessionID: 'A', part: { id: 'p1', text: 'answer updated' } },
    { type: 'tool_use', sessionID: 'A', part: { text: 'not assistant text' } },
    { type: 'step_finish', sessionID: 'A', part: { reason: 'stop' } },
  ]
  const output = events.map(event => JSON.stringify(event)).join('\n')
  assert.equal(parseHostOutput('opencode', output, 'A').text, 'answer updated')
  assert.equal(parseHostOutput('opencode', output, 'B').kind, 'unknown')
  assert.equal(parseHostOutput('opencode', JSON.stringify(events[1]), 'A').kind, 'unknown')
})

test('input readiness distinguishes missing program, missing session and recorded permission', () => {
  const paths = { codexExe: 'fake-native', zcodeCli: 'fake-zcode', nodeExe: 'fake-node' }
  const load = createLoader({ './host-paths': { resolveHostPaths: () => paths } })
  const { getHostInputStatus } = load('main/host-bridge')
  const session = { host: 'codex', sessionId: 'A', cwd: '', updatedAt: Date.now() - 5000 }
  assert.equal(getHostInputStatus('unused', 'antigravity').supported, false)
  assert.equal(getHostInputStatus('unused', 'codex', undefined, null).ready, false)
  assert.equal(getHostInputStatus('unused', 'codex', undefined, session).mode, 'queue')
  assert.equal(getHostInputStatus('unused', 'codex', undefined, session).ready, true)
  const zcode = { ...session, host: 'zcode', cwd: 'recorded-workspace' }
  assert.equal(getHostInputStatus('unused', 'zcode', undefined, zcode).ready, false)
  assert.equal(getHostInputStatus('unused', 'zcode', undefined, { ...zcode, permissionMode: 'plan' }).ready, true)
  paths.codexExe = ''
  const missing = getHostInputStatus('unused', 'codex', undefined, session)
  assert.equal(missing.supported, true)
  assert.equal(missing.configured, false)
  assert.equal(missing.ready, false)
})
