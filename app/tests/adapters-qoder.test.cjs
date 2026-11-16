'use strict'
// Qoder 适配器：能力声明、活跃探测、连接状态与反向命令边界。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const { loadHostModule } = require('./helpers/host-loader.cjs')
const { NO_CAPABILITIES } = loadHostModule('contracts')

function loadQoderAdapter() {
  const filePath = path.resolve(__dirname, '../src/renderer/services/adapters/qoder.ts')
  const code = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      require: (spec) => {
        if (spec.includes('contracts')) return { NO_CAPABILITIES }
        throw new Error(`Unexpected import: ${spec}`)
      },
      console,
      Set,
      Promise,
    },
    { filename: filePath },
  )
  return module.exports
}

test('Qoder 适配器声明角色工具能力，不假装支持输入注入', () => {
  const { createQoderAdapter } = loadQoderAdapter()
  const adapter = createQoderAdapter()

  assert.equal(adapter.id, 'qoder')
  const caps = adapter.getCapabilities()
  assert.equal(caps.characterTools, true)
  assert.equal(caps.sendInput, false)
  assert.equal(caps.statusEvents, false)
  assert.equal(caps.assistantText, false)

  assert.equal(adapter.sendUserText('hello'), false)
  assert.equal(adapter.sendScreenshot('base64'), false)
  assert.equal(adapter.sendModelEmotions(['happy']), false)
})

test('探测到活跃时进入 connected，离线时保持 disconnected', async () => {
  const { createQoderAdapter } = loadQoderAdapter()

  const online = createQoderAdapter({ isActive: async () => true })
  online.connect()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(online.getConnectionState(), 'connected')

  const offline = createQoderAdapter({ isActive: async () => false })
  offline.connect()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(offline.getConnectionState(), 'disconnected')

  const broken = createQoderAdapter({
    isActive: () => {
      throw new Error('ipc failed')
    },
  })
  broken.connect()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(broken.getConnectionState(), 'disconnected', '探测异常应按离线处理')
})

test('订阅会回放当前连接状态，并在变化时收到通知', async () => {
  const { createQoderAdapter } = loadQoderAdapter()
  const adapter = createQoderAdapter({ isActive: async () => true })
  const events = []
  const unsubscribe = adapter.subscribe((event) => events.push(event))

  assert.equal(events.length, 1, '订阅应立即拿到当前状态')
  assert.equal(events[0].kind, 'connection')

  adapter.connect()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.ok(events.some((event) => event.kind === 'connection' && event.state === 'connected'))

  unsubscribe()
  const before = events.length
  adapter.disconnect()
  assert.equal(events.length, before, '取消订阅后不再收到事件')
})
