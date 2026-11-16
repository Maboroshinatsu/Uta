'use strict'
// 宿主手动选择：不自动探测、不自动切换，旧版 auto 偏好平滑迁移。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const { loadHostModule } = require('./helpers/host-loader.cjs')
const { NO_CAPABILITIES } = loadHostModule('contracts')

function createAdapterSystem(initialStorage = {}, utaAPI) {
  const storage = { ...initialStorage }
  const mockLocalStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v) },
    removeItem: (k) => { delete storage[k] },
    clear: () => { Object.keys(storage).forEach((k) => delete storage[k]) },
  }

  const transpile = (rel) => {
    const full = path.resolve(__dirname, rel)
    return ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
  }

  const indexCode = transpile('../src/renderer/services/adapters/index.ts')
  const activeCode = transpile('../src/renderer/services/adapters/active.ts')

  const created = []

  function createMockAdapter(id) {
    const listeners = new Set()
    const emit = (state) => {
      adapter.state = state
      for (const listener of [...listeners]) {
        try {
          listener({ kind: 'connection', state })
        } catch {}
      }
    }
    const adapter = {
      id,
      connectCount: 0,
      disconnectCount: 0,
      state: 'disconnected',
      getCapabilities: () => ({ ...NO_CAPABILITIES, sendInput: id === 'maibot' }),
      getConnectionState: () => adapter.state,
      connect: () => {
        adapter.connectCount += 1
        emit('connected')
      },
      disconnect: () => {
        adapter.disconnectCount += 1
        emit('disconnected')
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      emit,
      sendUserText: () => id === 'maibot',
      sendScreenshot: () => false,
      dispose: () => {},
    }
    created.push(adapter)
    return adapter
  }

  const indexModule = { exports: {} }
  const activeModule = { exports: {} }

  const sharedContext = {
    console,
    Promise,
    Set,
    localStorage: mockLocalStorage,
    ...(utaAPI ? { window: { utaAPI } } : {}),
  }

  vm.runInNewContext(
    indexCode,
    {
      ...sharedContext,
      module: indexModule,
      exports: indexModule.exports,
      require: (spec) => {
        if (spec.includes('contracts')) return { NO_CAPABILITIES }
        if (spec.includes('codex')) return { createCodexAdapter: () => createMockAdapter('codex') }
        if (spec.includes('qoder')) return { createQoderAdapter: () => createMockAdapter('qoder') }
        if (spec.includes('antigravity'))
          return { createAntigravityAdapter: () => createMockAdapter('antigravity') }
        if (spec.includes('hook-host'))
          return { createHookHostAdapter: (options) => createMockAdapter(options.id) }
        if (spec.includes('builtin-plugin-manifests')) {
          const manifest = (id, name) => ({ id, name, description: name })
          return {
            BUILTIN_PLUGIN_MANIFESTS: [
              manifest('maibot', 'MaiBot 适配器'),
              manifest('astrbot', 'AstrBot 适配器'),
            ],
          }
        }
        if (spec.includes('plugin-http')) {
          return {
            createHttpPluginAdapter: (manifest) => createMockAdapter(manifest.id),
          }
        }
        throw new Error(`Unexpected import in index: ${spec}`)
      },
    },
  )

  vm.runInNewContext(
    activeCode,
    {
      ...sharedContext,
      module: activeModule,
      exports: activeModule.exports,
      require: (spec) => {
        if (spec.includes('contracts')) return { NO_CAPABILITIES }
        if (spec.includes('fake-host')) return { createFakeHost: () => createMockAdapter('fake') }
        if (spec.includes('./index') || spec === './index') return indexModule.exports
        throw new Error(`Unexpected import in active: ${spec}`)
      },
    },
  )

  return {
    index: indexModule.exports,
    active: activeModule.exports,
    storage,
    created,
  }
}

test('首次运行默认独立待命，不再有自动探测偏好', () => {
  const { active, storage } = createAdapterSystem()
  assert.equal(active.getHostPreference(), 'standalone')
  assert.equal(active.getActiveHostId(), 'fake')
  assert.equal(storage['uta/host-preference'], 'standalone')
})

test('detected-only filtering hides absent agent hosts but keeps the bound one', () => {
  const { index } = createAdapterSystem()
  const hosts = [
    { id: 'codex' },
    { id: 'qoder' },
    { id: 'antigravity' },
  ]
  assert.deepEqual(
    [...index.filterAvailableAgentHosts(hosts, new Set(['codex']))].map(host => host.id),
    ['codex'],
  )
  assert.deepEqual(
    [...index.filterAvailableAgentHosts(hosts, new Set(), 'qoder')].map(host => host.id),
    ['qoder'],
  )
  assert.deepEqual(
    [...index.filterAvailableAgentHosts(hosts, null)].map(host => host.id),
    ['codex', 'qoder', 'antigravity'],
    'unknown detection keeps the full registry instead of hiding everything',
  )
})

test('旧版 auto 偏好迁移到上次实际绑定的宿主', () => {
  const migrated = createAdapterSystem({
    'uta/host-preference': 'auto',
    'uta/host-id': 'codex',
  })
  assert.equal(migrated.active.getHostPreference(), 'codex')
  assert.equal(migrated.active.getActiveHostId(), 'codex')
  assert.equal(migrated.storage['uta/host-preference'], 'codex')

  const noHistory = createAdapterSystem({ 'uta/host-preference': 'auto' })
  assert.equal(noHistory.active.getHostPreference(), 'standalone')
  assert.equal(noHistory.active.getActiveHostId(), 'fake')
})

test('外部插件偏好不会在插件加载前被覆盖成独立运行', () => {
  const { active, storage } = createAdapterSystem({
    'uta/host-preference': 'external-x',
  })
  assert.equal(active.getHostPreference(), 'external-x')
  assert.equal(storage['uta/host-preference'], 'external-x')

  // 插件加载完成后若仍未注册，才清理为独立运行
  active.normalizeHostPreference()
  assert.equal(storage['uta/host-preference'], 'standalone')
})

test('手动选择会持久化并立即连接，切换时会释放旧适配器', () => {
  const { active, storage } = createAdapterSystem()

  const adapter = active.setHostPreference('codex')
  assert.equal(adapter.id, 'codex')
  assert.equal(adapter.connectCount, 1)
  assert.equal(active.getHostPreference(), 'codex')
  assert.equal(active.getActiveHostId(), 'codex')
  assert.equal(storage['uta/host-preference'], 'codex')
  assert.equal(storage['uta/host-id'], 'codex')

  active.setHostPreference('standalone')
  assert.equal(active.getActiveHostId(), 'fake')
  assert.equal(storage['uta/host-preference'], 'standalone')
})

test('重连只作用于当前宿主，绝不自动改选其他宿主', async () => {
  const { active } = createAdapterSystem()
  active.setHostPreference('qoder')
  const adapter = active.getActiveAdapter()

  assert.equal(adapter.connectCount, 1)
  assert.equal(await active.reconnectActiveHost(), 'qoder')
  assert.equal(active.getActiveHostId(), 'qoder')
  assert.equal(adapter.connectCount, 2)
  assert.equal(adapter.disconnectCount, 1)
})

test('reconnect pairs the bound instance before probing, and refuses a failed pairing', async () => {
  let finish
  const api = {
    petBinding: { binding: { hostId: 'codex' } },
    switchPetHost: id => new Promise(resolve => { assert.equal(id, 'codex'); finish = resolve }),
  }
  const { active } = createAdapterSystem({}, api)
  const adapter = active.getActiveAdapter()
  const pending = active.reconnectActiveHost()
  assert.equal(adapter.connectCount, 1)
  finish({ ok: true })
  assert.equal(await pending, 'codex')
  assert.equal(adapter.connectCount, 2)
  api.switchPetHost = async () => ({ ok: false })
  await assert.rejects(active.reconnectActiveHost(), /配对失败/)
  assert.equal(adapter.connectCount, 2)
})

test('自动探测与降级接口已彻底移除', () => {
  const { active } = createAdapterSystem()
  for (const name of [
    'detectBestHost',
    'probeHost',
    'refreshHostConnection',
    'getFallbackEnabled',
    'setFallbackEnabled',
    'startAutoProbe',
    'stopAutoProbe',
  ]) {
    assert.equal(active[name], undefined, `${name} 不应再存在`)
  }
})

test('onHostChanged listener receives switch notifications', () => {
  const { active } = createAdapterSystem()
  const events = []
  const unsub = active.onHostChanged((id, state) => {
    events.push({ id, state })
  })

  active.switchActiveHost('codex')
  assert.ok(events.length >= 1)
  assert.deepEqual(events[events.length - 1], { id: 'codex', state: 'connected' })

  const countBeforeUnsub = events.length
  unsub()
  active.switchActiveHost('maibot')
  assert.equal(events.length, countBeforeUnsub)
})

test('当前适配器的连接状态变化会实时转发给设置面板', () => {
  const { active } = createAdapterSystem()
  active.setHostPreference('qoder')
  const adapter = active.getActiveAdapter()
  const events = []
  const unsub = active.onHostChanged((id, state) => {
    events.push({ id, state })
  })

  adapter.emit('connecting')
  adapter.emit('connected')
  adapter.emit('disconnected')

  assert.deepEqual(events, [
    { id: 'qoder', state: 'connecting' },
    { id: 'qoder', state: 'connected' },
    { id: 'qoder', state: 'disconnected' },
  ])
  unsub()
})

test('切换宿主后，旧适配器的迟到状态不会覆盖新宿主', () => {
  const { active } = createAdapterSystem()
  active.setHostPreference('codex')
  const oldAdapter = active.getActiveAdapter()
  active.setHostPreference('maibot')

  const events = []
  const unsub = active.onHostChanged((id, state) => {
    events.push({ id, state })
  })
  oldAdapter.emit('connecting')
  oldAdapter.emit('connected')

  assert.deepEqual(events, [])
  unsub()
})

test('getAgentHosts and getAdapterHosts return cleanly separated host registries', () => {
  const { index } = createAdapterSystem()
  const agents = index.getAgentHosts()
  const adapters = index.getAdapterHosts()

  assert.equal(agents.some((h) => h.id === 'codex'), true)
  assert.equal(agents.some((h) => h.id === 'antigravity'), true)
  assert.equal(agents.some((h) => h.id === 'claude-code'), true)
  assert.equal(agents.some((h) => h.id === 'zcode'), true)
  assert.equal(agents.some((h) => h.id === 'opencode'), true)
  assert.equal(agents.some((h) => h.id === 'deepseek-harness'), true)
  assert.equal(agents.every((h) => h.category === 'agent'), true)

  assert.equal(adapters.some((h) => h.id === 'maibot'), true)
  assert.equal(adapters.some((h) => h.id === 'astrbot'), true)
  assert.equal(adapters.some((h) => h.id === 'custom'), false)
  assert.equal(adapters.every((h) => h.category === 'adapter'), true)
})
