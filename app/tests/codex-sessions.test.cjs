'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const createLoader = require('./support/settings-loader.cjs')
const { createCodexSessionStore } = createLoader()('main/codex-sessions')

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-codex-conversations-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return { dir, store: createCodexSessionStore(dir) }
}
const meta = sessionId => ({ hostId: 'codex', sessionId })
const thinking = { command: 'agent_state', state: 'thinking', label: '思考中...' }

test('user messages choose the automatic target and background chats cannot steal it', t => {
  const { store } = fixture(t)
  store.observe({ command: 'session_bind', cwd: 'D:/a' }, meta('a'), 100)
  store.observe(thinking, meta('a'), 101)
  store.observe({ command: 'session_bind', cwd: 'D:/b' }, meta('b'), 200)
  store.observe({ command: 'agent_state', state: 'tool_running' }, meta('b'), 201)
  store.observe({ command: 'agent_state', state: 'idle' }, meta('b'), 202)
  store.observe({ command: 'agent_state', state: 'thinking', label: '处理结果...' }, meta('b'), 202)
  store.observe({ command: 'agent_state', state: 'thinking', label: '处理失败，重试中...' }, meta('b'), 202)
  assert.equal(store.target(null).sessionId, 'a')
  store.observe({ command: 'session_bind', userInitiated: true }, meta('b'), 203)
  assert.equal(store.target(null).sessionId, 'b')
  store.observe({ command: 'notify', text: 'background result' }, meta('a'), 204)
  assert.equal(store.target(null).sessionId, 'b')
})

test('restart and long inactivity preserve the exact target and workspace', t => {
  const { dir, store } = fixture(t)
  store.observe({ command: 'session_bind', cwd: 'D:/a', label: 'Codex' }, meta('a'), Date.now() - 86400000)
  const restored = createCodexSessionStore(dir)
  assert.equal(restored.list().length, 1)
  assert.equal(restored.target(null).sessionId, 'a')
  assert.equal(restored.target(null).cwd, 'D:/a')
  restored.observe({ command: 'session_bind', cwd: '' }, meta('a'))
  assert.equal(createCodexSessionStore(dir).target(null).cwd, '')
})

test('a pinned or failed target never falls through to a different chat', t => {
  const { dir, store } = fixture(t)
  store.observe(thinking, meta('a'), 1)
  store.observe(thinking, meta('b'), 2)
  const pin = { sessionId: 'a', cwd: 'D:/a', updatedAt: 1 }
  assert.equal(store.target(pin).sessionId, 'a')
  store.invalidate('a')
  assert.equal(store.target(pin), null)
  assert.equal(store.target({ ...pin, sessionId: 'missing' }), null)
  store.invalidate('b')
  assert.equal(store.target(null), null)
  const restored = createCodexSessionStore(dir)
  assert.equal(restored.target(null), null)
  restored.observe(thinking, meta('a'), 3)
  assert.equal(restored.target(null).sessionId, 'a')
})

test('profiles are isolated and stored metadata excludes message content', t => {
  const { dir, store } = fixture(t)
  store.observe(thinking, meta('a'), 100)
  store.observe({ command: 'notify', text: 'private-message-body' }, meta('a'), 6000)
  store.observe(thinking, { hostId: 'harness', sessionId: 'other' })
  store.observe(thinking, { hostId: 'codex' })
  assert.equal(store.list().length, 1)
  assert.equal(createCodexSessionStore(path.join(dir, 'other-profile')).target(null), null)
  const saved = fs.readFileSync(path.join(dir, 'codex-conversations.json'), 'utf8')
  assert.equal(saved.includes('private-message-body'), false)
})

test('corrupt metadata does not prevent startup and the next event recovers it', t => {
  const { dir } = fixture(t)
  fs.writeFileSync(path.join(dir, 'codex-conversations.json'), '{broken')
  const store = createCodexSessionStore(dir)
  assert.equal(store.target(null), null)
  store.observe(thinking, meta('a'))
  assert.equal(createCodexSessionStore(dir).target(null).sessionId, 'a')
})

test('an inactive restored Codex chat can still queue to its exact thread', async () => {
  const { EventEmitter } = require('node:events')
  const invocations = []
  const bridge = createLoader({
    './host-paths': { resolveHostPaths: () => ({ codexExe: 'fixture-codex' }) },
    'node:child_process': { spawn(command, args) {
      invocations.push({ command, args })
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.stdin = new EventEmitter()
      child.stdin.end = () => {}
      child.kill = () => {}
      setImmediate(() => child.emit('close', 0))
      return child
    } },
  })('main/host-bridge')
  const restored = { host: 'codex', sessionId: 'exact-restored-thread', cwd: '', updatedAt: Date.now() - 86400000 }
  assert.equal(bridge.getHostInputStatus('fixture', 'codex', 'private-fixture', restored).ready, true)
  const result = await bridge.sendHostMessage('fixture', 'codex', 'draft text', 'private-fixture', restored)
  assert.equal(result.ok, true)
  assert.equal(result.delivery, 'queued')
  assert.equal(invocations.length, 1)
  assert.deepEqual(Array.from(invocations[0].args), ['queue', '--thread', 'exact-restored-thread', '--message', 'draft text'])
  assert.equal(bridge.getHostInputStatus('fixture', 'codex', 'private-fixture', null).ready, false)
})

test('Codex CLI errors invalidate only an explicitly missing thread', async () => {
  const { EventEmitter } = require('node:events')
  for (const [error, expected] of [['thread not found: removed', 'no-session'], ['unknown option --message', 'failed']]) {
    const bridge = createLoader({
      './host-paths': { resolveHostPaths: () => ({ codexExe: 'fixture-codex' }) },
      'node:child_process': { spawn() {
        const child = new EventEmitter()
        child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter()
        child.stdin.end = () => {}; child.kill = () => {}
        setImmediate(() => { child.stderr.emit('data', Buffer.from(error)); child.emit('close', 1) })
        return child
      } },
    })('main/host-bridge')
    const result = await bridge.sendHostMessage('fixture', 'codex', 'draft', 'private', {
      host: 'codex', sessionId: 'exact-thread', cwd: '', updatedAt: Date.now() - 86400000,
    })
    assert.equal(result.code, expected)
    assert.equal(result.ok, false)
  }
})
