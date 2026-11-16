'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/main/runtime-sessions.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const mod = { exports: {} }
vm.runInNewContext(code, { module: mod, exports: mod.exports, console })
const { RuntimeSessionRegistry, SESSION_TTL_MS } = mod.exports

const meta = (hostId, sessionId, extra = {}) => ({ hostId, sessionId, ...extra })

test('sessions are keyed by host and session, not by host alone', () => {
  const registry = new RuntimeSessionRegistry()
  registry.touch(meta('qoder', 's1'), 'agent_state', 1000)
  registry.touch(meta('qoder', 's2'), 'agent_state', 2000)
  registry.touch(meta('harness', 's1'), 'agent_state', 3000)

  const list = registry.list(3000)
  assert.equal(list.length, 3)
  assert.equal(list[0].key, 'harness:s1')
  assert.equal(registry.get('qoder', 's2').key, 'qoder:s2')
})

test('host-scoped sessions remain separate from session-scoped ones', () => {
  const registry = new RuntimeSessionRegistry()
  registry.touch({ hostId: 'qoder' }, 'agent_state', 1000)
  registry.touch(meta('qoder', 's1'), 'agent_state', 2000)

  assert.equal(registry.list(2000).length, 2)
  assert.equal(registry.get('qoder').sessionId, undefined)
  assert.equal(registry.get('qoder', 's1').sessionId, 's1')
})

test('bind and hello enrich the same session record', () => {
  const registry = new RuntimeSessionRegistry()
  registry.declare(
    meta('harness', 's1', { hostInstanceId: 'install-a' }),
    { capabilities: ['statusEvents', 'approval'], sdkVersion: '0.6.0', label: 'DSH' },
    1000,
  )
  registry.bind(meta('harness', 's1'), { label: '会话 A', cwd: 'D:/work' }, 2000)

  const record = registry.get('harness', 's1')
  assert.equal(record.hostInstanceId, 'install-a')
  assert.deepEqual([...record.capabilities], ['statusEvents', 'approval'])
  assert.equal(record.sdkVersion, '0.6.0')
  assert.equal(record.label, '会话 A')
  assert.equal(record.cwd, 'D:/work')
  assert.equal(record.lastCommand, 'session_bind')
  assert.equal(record.lastSeen, 2000)
  registry.bind(meta('harness', 's1'), { cwd: '' }, 2500)
  assert.equal(registry.get('harness', 's1').cwd, undefined, 'explicit unknown workspace must clear a previous single cwd')
})

test('stale sessions are pruned from the list', () => {
  const registry = new RuntimeSessionRegistry()
  registry.touch(meta('qoder', 'old'), 'agent_state', 1000)
  registry.touch(meta('qoder', 'new'), 'agent_state', 5000)

  const list = registry.list(1000 + SESSION_TTL_MS + 1)
  assert.deepEqual(Array.from(list, (record) => record.sessionId), ['new'])
})

test('duplicate eventIds and old sequence numbers are rejected', () => {
  const registry = new RuntimeSessionRegistry()
  const first = registry.accept(meta('qoder', 's1', { eventId: 'e1', seq: 5 }), 1000)
  assert.deepEqual(JSON.parse(JSON.stringify(first)), { duplicate: false, gap: false })

  const duplicateId = registry.accept(meta('qoder', 's1', { eventId: 'e1', seq: 6 }), 1100)
  assert.deepEqual(JSON.parse(JSON.stringify(duplicateId)), { duplicate: true, gap: false })

  const oldSeq = registry.accept(meta('qoder', 's1', { eventId: 'e2', seq: 5 }), 1200)
  assert.deepEqual(JSON.parse(JSON.stringify(oldSeq)), { duplicate: true, gap: false })

  const record = registry.get('qoder', 's1')
  assert.equal(record.duplicates, 2)
  assert.equal(record.lastSeq, 5)
})

test('a restarted host instance may restart its sequence without being dropped', () => {
  const registry = new RuntimeSessionRegistry()
  registry.accept(meta('harness', 's1', { hostInstanceId: 'install-a', eventId: 'a1', seq: 3 }), 1000)
  registry.accept(meta('harness', 's1', { hostInstanceId: 'install-a', eventId: 'a2', seq: 4 }), 1100)

  const restarted = registry.accept(
    meta('harness', 's1', { hostInstanceId: 'install-b', eventId: 'b1', seq: 1 }),
    2000,
  )
  assert.deepEqual(JSON.parse(JSON.stringify(restarted)), { duplicate: false, gap: false })
  const record = registry.get('harness', 's1')
  assert.equal(record.hostInstanceId, 'install-b')
  assert.equal(record.lastSeq, 1)

  const replayFromOldInstance = registry.accept(
    meta('harness', 's1', { hostInstanceId: 'install-b', eventId: 'a1', seq: 2 }),
    2100,
  )
  assert.deepEqual(JSON.parse(JSON.stringify(replayFromOldInstance)), { duplicate: true, gap: false })

  const lateOldInstance = registry.accept(
    meta('harness', 's1', { hostInstanceId: 'install-a', eventId: 'a-late', seq: 6 }),
    2200,
  )
  assert.deepEqual(JSON.parse(JSON.stringify(lateOldInstance)), { duplicate: true, gap: false })
  assert.equal(registry.get('harness', 's1').hostInstanceId, 'install-b')
  assert.equal(registry.get('harness', 's1').lastSeq, 1)
  assert.equal(registry.duplicateState(meta('harness', 's1', { hostInstanceId: 'install-a', eventId: 'a-late' })), 'stale')
})

test('an in-flight event from a retired instance cannot advance the new sequence', () => {
  const registry = new RuntimeSessionRegistry()
  const old = registry.reserve(meta('harness', 's1', { hostInstanceId: 'install-a', eventId: 'a6', seq: 6 }), 1000)
  assert.deepEqual(JSON.parse(JSON.stringify(old)), { duplicate: false, gap: false })

  registry.accept(meta('harness', 's1', { hostInstanceId: 'install-b', eventId: 'b1', seq: 1 }), 2000)
  registry.commit(meta('harness', 's1', { hostInstanceId: 'install-a', eventId: 'a6', seq: 6 }), 2100)
  const record = registry.get('harness', 's1')
  assert.equal(record.hostInstanceId, 'install-b')
  assert.equal(record.lastSeq, 1, 'the retired in-flight commit must not advance seq')

  const b2 = registry.accept(meta('harness', 's1', { hostInstanceId: 'install-b', eventId: 'b2', seq: 2 }), 2200)
  assert.deepEqual(JSON.parse(JSON.stringify(b2)), { duplicate: false, gap: false })
})

test('a sequence gap is marked incomplete instead of replaying events', () => {
  const registry = new RuntimeSessionRegistry()
  registry.accept(meta('qoder', 's1', { eventId: 'e1', seq: 1 }), 1000)
  const gap = registry.accept(meta('qoder', 's1', { eventId: 'e2', seq: 4 }), 1100)
  assert.deepEqual(JSON.parse(JSON.stringify(gap)), { duplicate: false, gap: true })
  const record = registry.get('qoder', 's1')
  assert.equal(record.incomplete, true)
  assert.equal(record.lastSeq, 4)
})

test('a failed delivery can retry the same event instead of becoming a cached duplicate', () => {
  const registry = new RuntimeSessionRegistry()
  const event = meta('qoder', 's1', { eventId: 'retry-me', seq: 1 })
  const first = registry.reserve(event, 1000)
  assert.equal(first.duplicate, false)
  registry.release(event)

  const retry = registry.reserve(event, 1100)
  assert.equal(retry.duplicate, false)
  registry.commit(event, 1100)
  assert.equal(registry.reserve(event, 1200).duplicate, true)
  assert.equal(registry.get('qoder', 's1').lastSeq, 1)
})

test('seq-only concurrent reservations are mutually exclusive at the same sequence', () => {
  const registry = new RuntimeSessionRegistry()
  const event = meta('qoder', 's1', { seq: 1 })
  assert.equal(registry.reserve(event, 1000).duplicate, false)
  assert.equal(registry.reserve(event, 1001).duplicate, true)
  registry.release(event)
  assert.equal(registry.reserve(event, 1002).duplicate, false)
  registry.commit(event, 1002)
  assert.equal(registry.reserve(event, 1003).duplicate, true)
})

test('the same seq with different event ids cannot double deliver', () => {
  const registry = new RuntimeSessionRegistry()
  const first = meta('qoder', 's1', { eventId: 'event-a', seq: 1 })
  const second = meta('qoder', 's1', { eventId: 'event-b', seq: 1 })
  assert.equal(registry.reserve(first, 1000).duplicate, false)
  assert.equal(registry.reserve(second, 1001).duplicate, true)
  registry.release(first)
  assert.equal(registry.reserve(second, 1002).duplicate, false)
  registry.commit(second, 1002)
  assert.equal(registry.reserve(first, 1003).duplicate, true)
})

test('concurrent identical reservations stay mutually exclusive', () => {
  const registry = new RuntimeSessionRegistry()
  const event = meta('qoder', 's1', { eventId: 'concurrent', seq: 1 })
  assert.equal(registry.reserve(event, 1000).duplicate, false)
  assert.equal(registry.reserve(event, 1001).duplicate, true)
  registry.release(event)
  assert.equal(registry.reserve(event, 1002).duplicate, false)
})

test('list returns copies so callers cannot mutate registry state', () => {
  const registry = new RuntimeSessionRegistry()
  registry.declare(meta('qoder', 's1'), { capabilities: ['approval'] }, 1000)
  const list = registry.list(1000)
  list[0].capabilities.push('injected')
  assert.deepEqual([...registry.get('qoder', 's1').capabilities], ['approval'])
})

test('event dedupe survives session TTL cleanup so old events cannot replay', () => {
  const registry = new RuntimeSessionRegistry()
  registry.accept(meta('qoder', 's1', { eventId: 'e-ttl', seq: 1 }), 100)
  registry.list(100 + SESSION_TTL_MS + 1)
  const replay = registry.accept(meta('qoder', 's1', { eventId: 'e-ttl' }), 100 + SESSION_TTL_MS + 2)
  assert.equal(replay.duplicate, true)
})
