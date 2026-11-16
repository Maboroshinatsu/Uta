'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test, describe, beforeEach } = require('node:test')

function createTsLoader(baseDir) {
  const cache = new Map()
  function load(filePath) {
    let resolved = path.resolve(baseDir, filePath)
    if (!fs.existsSync(resolved)) {
      if (fs.existsSync(resolved + '.ts')) {
        resolved += '.ts'
      } else if (fs.existsSync(path.join(resolved, 'index.ts'))) {
        resolved = path.join(resolved, 'index.ts')
      }
    }
    if (cache.has(resolved)) return cache.get(resolved)

    const source = fs.readFileSync(resolved, 'utf8')
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText

    const mod = { exports: {} }
    cache.set(resolved, mod.exports)

    const customRequire = (id) => {
      if (id.startsWith('.')) {
        return load(path.resolve(path.dirname(resolved), id))
      }
      return require(id)
    }

    vm.runInNewContext(code, {
      module: mod,
      exports: mod.exports,
      require: customRequire,
      console,
      Buffer,
      setTimeout,
      clearTimeout,
      setImmediate,
      clearImmediate,
      queueMicrotask,
      URL,
      Promise,
      Object,
      Array,
      String,
      Number,
      Boolean,
      Error,
      TypeError,
      RangeError,
      Map,
      Set,
      JSON,
    })
    return mod.exports
  }
  return load
}

describe('Settings Client Integration', () => {
  let clientModule
  let defaultsModule

  beforeEach(() => {
    const loader = createTsLoader(path.join(__dirname, '../src/renderer/services/settings-client'))
    clientModule = loader('./client.ts')
    const defaultsLoader = createTsLoader(path.join(__dirname, '../src/main/settings-store'))
    defaultsModule = defaultsLoader('./defaults.ts')
  })

  function createMockBridge(options = {}) {
    let mode = options.mode || 'canonical-dev'
    let doc = options.initialDoc || defaultsModule.createDefaultDocument()
    let changeListeners = []
    let callOrder = []
    let patchCount = 0

    const bridge = {
      _callOrder: callOrder,
      getMode: async () => {
        callOrder.push('getMode')
        if (options.modeError) throw options.modeError
        return mode
      },
      read: async () => {
        callOrder.push('read')
        if (options.readError) throw options.readError
        if (options.readBlocked) {
          return { status: 'blocked', reason: 'io-error', backupAvailable: false }
        }
        return { status: 'ready', document: JSON.parse(JSON.stringify(doc)) }
      },
      patch: async (request) => {
        callOrder.push('patch')
        patchCount++
        if (request.expectedRevision !== doc.revision) {
          return { ok: false, code: 'revision-conflict', currentRevision: doc.revision }
        }
        const candidate = JSON.parse(JSON.stringify(doc))
        candidate.revision += 1
        Object.assign(candidate.values, request.changes)
        doc = candidate
        for (const l of changeListeners) {
          l(JSON.parse(JSON.stringify(candidate)))
        }
        return { ok: true, changed: true, document: candidate }
      },
      onChanged: (listener) => {
        callOrder.push('onChanged')
        changeListeners.push(listener)
        return () => {
          changeListeners = changeListeners.filter((l) => l !== listener)
        }
      },
      _triggerRemoteChanged: (newDoc) => {
        doc = newDoc
        for (const l of changeListeners) {
          l(JSON.parse(JSON.stringify(newDoc)))
        }
      },
      _getListenerCount: () => changeListeners.length,
      _getPatchCount: () => patchCount,
    }
    return bridge
  }

  test('no preload bridge falls back cleanly to browser-mock mode', async () => {
    const client = new clientModule.SettingsClient()
    const res = await client.init(undefined)
    assert.equal(res.ok, true)
    assert.equal(res.mode, 'browser-mock')
    assert.equal(client.getMode(), 'browser-mock')
    assert.equal(client.isReady(), true)
    client.dispose()
  })

  test('legacy bridge resolves to legacy mode without subscribing or creating doc', async () => {
    const client = new clientModule.SettingsClient()
    const bridge = createMockBridge({ mode: 'legacy' })
    const res = await client.init(bridge)
    assert.equal(res.ok, true)
    assert.equal(res.mode, 'legacy')
    assert.equal(client.getMode(), 'legacy')
    assert.equal(client.getCurrentDocument(), null)
    assert.deepEqual(bridge._callOrder, ['getMode'])
    client.dispose()
  })

  test('canonical-dev: strictly subscribes before read, takes highest revision, does not stack listeners on retry', async () => {
    const client = new clientModule.SettingsClient()
    const bridge = createMockBridge({ mode: 'canonical-dev' })

    const res = await client.init(bridge)
    assert.equal(res.ok, true)
    assert.equal(res.mode, 'canonical-dev')
    assert.ok(res.document)
    assert.equal(res.document.revision, 0)

    // 验证调用顺序：getMode -> onChanged (订阅) -> read (读取)
    assert.deepEqual(bridge._callOrder, ['getMode', 'onChanged', 'read'])
    assert.equal(bridge._getListenerCount(), 1)

    // 重试初始化验证：不会叠加监听器
    await client.init(bridge)
    assert.equal(bridge._getListenerCount(), 1, 'Re-init must not stack onChanged listeners')

    client.dispose()
    assert.equal(bridge._getListenerCount(), 0, 'Dispose must remove bridge listener')
  })

  test('canonical-dev: handles monotonic revision when remote event arrives ahead of in-flight read', async () => {
    const client = new clientModule.SettingsClient()
    let delayedResolveRead
    const customBridge = {
      getMode: async () => 'canonical-dev',
      read: () => new Promise((resolve) => { delayedResolveRead = resolve }),
      onChanged: (listener) => {
        customBridge._listener = listener
        return () => {}
      },
    }

    const initPromise = client.init(customBridge)
    // 此时 read 还在 pending，外部先推送 revision 5 的更新
    await new Promise((r) => setTimeout(r, 10))
    assert.ok(customBridge._listener, 'Must have subscribed before read completes')
    const rev5Doc = defaultsModule.createDefaultDocument()
    rev5Doc.revision = 5
    rev5Doc.values.themeMode = 'dark'
    customBridge._listener(rev5Doc)

    // 晚到的 read 返回 revision 0（过时快照）
    const rev0Doc = defaultsModule.createDefaultDocument()
    rev0Doc.revision = 0
    delayedResolveRead({ status: 'ready', document: rev0Doc })

    const res = await initPromise
    assert.equal(res.ok, true)
    // 客户端快照必须保持单调更高的 revision 5
    assert.equal(client.getCurrentRevision(), 5)
    assert.equal(client.getCurrentSettings().themeMode, 'dark')
    client.dispose()
  })

  test('blocked settings store prevents client ready state with structured error', async () => {
    const client = new clientModule.SettingsClient()
    const bridge = createMockBridge({ mode: 'canonical-dev', readBlocked: true })
    const res = await client.init(bridge)
    assert.equal(res.ok, false)
    assert.ok(res.error.includes('blocked'))
    assert.equal(client.isReady(), false)
    assert.equal(bridge._getListenerCount(), 0, 'Blocked init must clean up subscriptions')
    client.dispose()
  })

  test('patch copies input, filters to changed twelve fields, and queues concurrent requests sequentially', async () => {
    const client = new clientModule.SettingsClient()
    const bridge = createMockBridge({ mode: 'canonical-dev' })
    await client.init(bridge)

    // 1. 无实际变更的 patch 立即返回，不发起 IPC
    const initialPatchCount = bridge._getPatchCount()
    const noopRes = await client.patch({ themeMode: 'light' }) // 初始就是 light
    assert.equal(noopRes.ok, true)
    assert.equal(noopRes.changed, false)
    assert.equal(bridge._getPatchCount(), initialPatchCount)

    // 2. 未知字段必须拒绝，不能把无效请求伪装成成功。
    assert.equal((await client.patch({ unknownField: 'invalid' })).code, 'invalid-request')
    const res1 = await client.patch({
      themeMode: 'dark',
      accentColor: '#abcdef',
    })
    assert.equal(res1.ok, true)
    assert.equal(res1.changed, true)
    assert.equal(res1.document.revision, 1)
    assert.equal(res1.document.values.themeMode, 'dark')
    assert.equal(res1.document.values.accentColor, '#abcdef')
    assert.equal(res1.document.values.unknownField, undefined)

    // 3. 并发 patch 串行化测试
    const p1 = client.patch({ ttsVolume: 0.5 })
    const p2 = client.patch({ ttsVolume: 0.9 })
    const [r1, r2] = await Promise.all([p1, p2])

    assert.equal(r1.ok, true)
    assert.equal(r2.ok, true)
    assert.equal(client.getCurrentRevision(), 3)
    assert.equal(client.getCurrentSettings().ttsVolume, 0.9)

    client.dispose()
  })

  test('revision conflict returns structured failure without auto-overwriting', async () => {
    const client = new clientModule.SettingsClient()
    const bridge = createMockBridge({ mode: 'canonical-dev' })
    await client.init(bridge)

    // 模拟另一窗口在后台提交，revision 跃升到 10
    const remoteDoc = defaultsModule.createDefaultDocument()
    remoteDoc.revision = 10
    remoteDoc.values.themeMode = 'dark'
    // 但暂未收到通知（模拟并发竞争），调用 patch 遇到冲突
    const conflictBridge = {
      getMode: async () => 'canonical-dev',
      read: async () => ({ status: 'ready', document: defaultsModule.createDefaultDocument() }),
      onChanged: () => () => {},
      patch: async () => ({ ok: false, code: 'revision-conflict', currentRevision: 10 }),
    }

    const c2 = new clientModule.SettingsClient()
    await c2.init(conflictBridge)
    const patchRes = await c2.patch({ themeMode: 'dark' })
    assert.equal(patchRes.ok, false)
    assert.equal(patchRes.code, 'revision-conflict')
    assert.equal(patchRes.currentRevision, 10)

    c2.dispose()
    client.dispose()
  })
})
