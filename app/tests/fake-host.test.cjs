'use strict'
// DP-017 验收：FakeHost 在无 WebSocket / MaiBot / Python / Electron 的情况下提供连接状态与反向命令。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { loadHostModule } = require('./helpers/host-loader.cjs')

const { createFakeHost } = loadHostModule('fake-host')
const { NO_CAPABILITIES } = loadHostModule('contracts')
const plain = (v) => JSON.parse(JSON.stringify(v))

test('connection state changes reach subscribers', () => {
  const host = createFakeHost()
  const states = []
  const off = host.subscribe((event) => states.push(event.state))

  host.connect()
  host.setConnectionState('disconnected')
  off()
  host.setConnectionState('connected')

  assert.deepEqual(states, ['connecting', 'connected', 'disconnected'])
  assert.equal(host.getConnectionState(), 'connected')
})

test('reverse commands are recorded and gated by declared capabilities', () => {
  const full = createFakeHost({ capabilities: { sendInput: true } })
  assert.equal(full.sendUserText('hi'), true)
  assert.equal(full.sendScreenshot('AAA'), true)
  assert.equal(full.sendModelEmotions(['happy']), true)
  // vm 上下文数组原型不同，JSON 归一化后比较
  assert.deepEqual(plain(full.record.userText), ['hi'])
  assert.deepEqual(plain(full.record.screenshots), ['AAA'])
  assert.deepEqual(plain(full.record.modelEmotions), [['happy']])

  // 未声明 sendInput 时必须返回 false，而不是静默丢弃
  const limited = createFakeHost()
  assert.equal(limited.getCapabilities().sendInput, false)
  assert.equal(limited.sendUserText('hi'), false)
  assert.deepEqual(plain(limited.record.userText), [])
})

test('unsubscribe stops delivery and dispose clears listeners', () => {
  const host = createFakeHost()
  let hits = 0
  const off = host.subscribe(() => { hits++ })
  host.setConnectionState('connected')
  assert.equal(hits, 1)
  off()
  host.setConnectionState('connected')
  assert.equal(hits, 1)

  host.subscribe(() => { hits++ })
  host.dispose()
  assert.equal(host.getConnectionState(), 'disconnected')
  host.setConnectionState('connected')
  assert.equal(hits, 1)
})

test('default capabilities are all false (no implied support)', () => {
  const host = createFakeHost()
  assert.deepEqual({ ...host.getCapabilities() }, { ...NO_CAPABILITIES })
})
