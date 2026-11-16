'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { test } = require('node:test')

const protocolPromise = import(
  pathToFileURL(path.join(__dirname, '../../plugin/shared/uta-protocol.mjs')).href
)

test('v1 bare commands are wrapped as legacy without changing the command', async () => {
  const { normalizeRuntimeEnvelope } = await protocolPromise
  const command = { command: 'agent_state', state: 'thinking' }
  const result = normalizeRuntimeEnvelope(command)
  assert.equal(result.ok, true)
  assert.equal(result.legacy, true)
  assert.equal(result.envelope.protocolVersion, '1.0')
  assert.equal(result.envelope.meta.hostId, 'legacy')
  assert.equal(result.envelope.meta.legacy, true)
  assert.deepEqual(result.envelope.command, command)
})

test('v2 envelopes keep host, session, turn and event identity', async () => {
  const { normalizeRuntimeEnvelope, PROTOCOL_VERSION } = await protocolPromise
  const result = normalizeRuntimeEnvelope({
    protocolVersion: PROTOCOL_VERSION,
    meta: {
      hostId: 'qoder',
      hostInstanceId: 'install-a',
      sessionId: 'session-1',
      turnId: 'turn-2',
      eventId: 'event-3',
      seq: 4,
      ts: '2026-10-21T06:00:00Z',
    },
    command: { command: 'rp_reply', text: '你好', streaming: false, done: true },
  })
  assert.equal(result.ok, true)
  assert.equal(result.legacy, false)
  assert.deepEqual(result.envelope.meta, {
    hostId: 'qoder',
    hostInstanceId: 'install-a',
    sessionId: 'session-1',
    turnId: 'turn-2',
    eventId: 'event-3',
    seq: 4,
    ts: '2026-10-21T06:00:00Z',
  })
  assert.equal(result.envelope.command.command, 'rp_reply')
})

test('v2 requires a valid hostId and a command', async () => {
  const { normalizeRuntimeEnvelope, PROTOCOL_VERSION } = await protocolPromise
  assert.equal(
    normalizeRuntimeEnvelope({ protocolVersion: PROTOCOL_VERSION, meta: {}, command: {} }).ok,
    false,
  )
  assert.equal(
    normalizeRuntimeEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      meta: { hostId: 'bad host id' },
      command: { command: 'summon' },
    }).ok,
    false,
  )
  assert.equal(
    normalizeRuntimeEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      meta: { hostId: 'qoder' },
      command: null,
    }).ok,
    false,
  )
})

test('unsupported or malformed envelopes are rejected', async () => {
  const { normalizeRuntimeEnvelope } = await protocolPromise
  assert.equal(normalizeRuntimeEnvelope(null).ok, false)
  assert.equal(normalizeRuntimeEnvelope([]).ok, false)
  assert.equal(
    normalizeRuntimeEnvelope({ protocolVersion: '9.0', meta: { hostId: 'qoder' }, command: {} }).ok,
    false,
  )
  assert.equal(
    normalizeRuntimeEnvelope({ protocolVersion: '2.0', meta: { hostId: 'qoder' } }).ok,
    false,
  )
})

test('session fields are sanitized and host-scoped when absent', async () => {
  const { normalizeRuntimeEnvelope, PROTOCOL_VERSION } = await protocolPromise
  const control = normalizeRuntimeEnvelope({
    protocolVersion: PROTOCOL_VERSION,
    meta: { hostId: 'qoder', sessionId: 'abc\u0000def' },
    command: { command: 'summon' },
  })
  assert.equal(control.ok, true)
  assert.equal(control.envelope.meta.sessionId, 'abcdef')

  const hostScoped = normalizeRuntimeEnvelope({
    protocolVersion: PROTOCOL_VERSION,
    meta: { hostId: 'qoder' },
    command: { command: 'summon' },
  })
  assert.equal(hostScoped.envelope.meta.sessionId, undefined)
})

test('wrapCommand produces a v2 envelope with a timestamp', async () => {
  const { wrapCommand, PROTOCOL_VERSION } = await protocolPromise
  const envelope = wrapCommand(
    { command: 'agent_state', state: 'thinking' },
    { hostId: 'harness', sessionId: 's1', eventId: 'e1' },
  )
  assert.equal(envelope.protocolVersion, PROTOCOL_VERSION)
  assert.equal(envelope.meta.hostId, 'harness')
  assert.equal(envelope.meta.sessionId, 's1')
  assert.equal(envelope.meta.eventId, 'e1')
  assert.ok(typeof envelope.meta.ts === 'string' && envelope.meta.ts.includes('T'))
})
