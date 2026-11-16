'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const Vue = require('vue')
const Pinia = require('pinia')
const { test, describe, beforeEach } = require('node:test')

function createInMemoryStorage() {
  const store = new Map()
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    _store: store,
  }
}

function loadDeskpetStoreModule(mockSettingsClient, mockStorage) {
  const cache = new Map()
  const baseDir = path.join(__dirname, '../src/renderer')

  const mockWindow = {
    location: { search: '' },
    matchMedia: () => ({ matches: false }),
    utaAPI: undefined,
  }
  const mockDocument = {
    documentElement: {
      setAttribute: () => {},
      style: {
        setProperty: () => {},
        removeProperty: () => {},
      },
    },
  }

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
      if (id === 'vue') return Vue
      if (id === 'pinia') return Pinia
      if (id === '@/services/settings-client') return mockSettingsClient
      if (id === '@/services/live2d/loader') return {}
      if (id === '@/services/live2d/emotion-adapter') {
        return {
          buildModelStatePresets: () => [],
          getPresetDefaultFinishMode: () => 'hold',
          normalizePresetSteps: () => [],
          resolvePresetGroup: () => '默认',
        }
      }
      if (id.startsWith('@/')) {
        return load(id.replace('@/', './'))
      }
      if (id.startsWith('.')) {
        return load(path.resolve(path.dirname(resolved), id))
      }
      return require(id)
    }

    vm.runInNewContext(code, {
      module: mod,
      exports: mod.exports,
      require: customRequire,
      window: mockWindow,
      document: mockDocument,
      localStorage: mockStorage,
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

  return load('stores/deskpet.ts')
}

describe('Settings Pinia Deskpet Store Integration', () => {
  let localStorageMock
  let pinia

  beforeEach(() => {
    localStorageMock = createInMemoryStorage()
    pinia = Pinia.createPinia()
    Pinia.setActivePinia(pinia)
  })

  test('canonical-dev: hydrates twelve fields from client snapshot, preserves unmigrated fields from localStorage', () => {
    // 准备已存在的 localStorage 旧数据
    localStorageMock.setItem(
      'deskpet/ui-state-biophilic-v1',
      JSON.stringify({
        themeMode: 'dark', // 旧本地有 dark
        accentColor: '#111111',
        ttsCloudBackend: 'fishaudio',
        ttsCloudVoice: 'custom-voice-id',
      })
    )

    // 权威 settingsClient 快照：themeMode=light, accentColor=#4f7fa6
    const clientSnapshot = {
      themeMode: 'light',
      accentColor: '#4f7fa6',
      hoverFadeEnabled: true,
      gazeFollowEnabled: false,
      idleActionsEnabled: false,
      orbAction: 'toggle_theme',
      ttsEnabled: true,
      ttsProvider: 'http',
      ttsRate: 1.5,
      ttsVolume: 0.9,
      ttsSpeakNarration: true,
      ttsSpeakReplies: false,
    }

    const mockClient = {
      settingsClient: {
        getMode: () => 'canonical-dev',
        getCurrentSettings: () => ({ ...clientSnapshot }),
        getCurrentRevision: () => 42,
        patch: async () => ({ ok: true, changed: true, document: { revision: 43, values: clientSnapshot } }),
        subscribe: () => () => {},
      },
    }

    const deskpetModule = loadDeskpetStoreModule(mockClient, localStorageMock)
    const store = deskpetModule.useDeskpetStore()

    // 1. 十二字段来自权威快照，而非旧 localStorage
    assert.equal(store.themeMode, 'light')
    assert.equal(store.accentColor, '#4f7fa6')
    assert.equal(store.hoverFadeEnabled, true)
    assert.equal(store.gazeFollowEnabled, false)
    assert.equal(store.ttsVolume, 0.9)
    assert.equal(store.orbAction, 'toggle_theme')

    // 2. 未迁移字段保留 localStorage 的设置
    assert.equal(store.ttsCloudBackend, 'fishaudio')
    assert.equal(store.ttsCloudVoice, 'custom-voice-id')

    // 3. 权威元数据导出正常
    assert.equal(store.settingsAuthorityMode, 'canonical-dev')
    assert.equal(store.settingsRevision, 42)
  })

  test('canonical-dev: does NOT write back default values to client on startup (immediate: false)', async () => {
    let patchCalls = []
    const mockClient = {
      settingsClient: {
        getMode: () => 'canonical-dev',
        getCurrentSettings: () => ({
          themeMode: 'light',
          accentColor: '#4f7fa6',
          hoverFadeEnabled: false,
          gazeFollowEnabled: true,
          idleActionsEnabled: true,
          orbAction: 'model_picker',
          ttsEnabled: false,
          ttsProvider: 'cloud',
          ttsRate: 1,
          ttsVolume: 0.8,
          ttsSpeakNarration: false,
          ttsSpeakReplies: true,
        }),
        getCurrentRevision: () => 0,
        patch: async (req) => {
          patchCalls.push(req)
          return { ok: true, changed: true, document: { revision: 1 } }
        },
        subscribe: () => () => {},
      },
    }

    const deskpetModule = loadDeskpetStoreModule(mockClient, localStorageMock)
    const store = deskpetModule.useDeskpetStore()

    // 等待潜在的启动异步 watcher
    await Vue.nextTick()
    await new Promise((r) => setTimeout(r, 20))

    // 启动时不得自动向 client 派发 patch 回写默认值
    assert.equal(patchCalls.length, 0, 'Startup must not trigger patch write-back')
  })

  test('canonical-dev: changing a field triggers patch, failed patch exposes settingsSaveError', async () => {
    let patchCalls = []
    let shouldFail = false
    const mockClient = {
      settingsClient: {
        getMode: () => 'canonical-dev',
        getCurrentSettings: () => ({
          themeMode: 'light',
          accentColor: '#4f7fa6',
          hoverFadeEnabled: false,
          gazeFollowEnabled: true,
          idleActionsEnabled: true,
          orbAction: 'model_picker',
          ttsEnabled: false,
          ttsProvider: 'cloud',
          ttsRate: 1,
          ttsVolume: 0.8,
          ttsSpeakNarration: false,
          ttsSpeakReplies: true,
        }),
        getCurrentRevision: () => 1,
        patch: async (changes) => {
          patchCalls.push(changes)
          if (shouldFail) {
            return { ok: false, code: 'revision-conflict', currentRevision: 2 }
          }
          return {
            ok: true,
            changed: true,
            document: {
              revision: 2,
              values: { ...mockClient.settingsClient.getCurrentSettings(), ...changes },
            },
          }
        },
        subscribe: () => () => {},
      },
    }

    const deskpetModule = loadDeskpetStoreModule(mockClient, localStorageMock)
    const store = deskpetModule.useDeskpetStore()

    // 1. 成功 patch
    store.themeMode = 'dark'
    await Vue.nextTick()
    await new Promise((r) => setTimeout(r, 20))

    assert.equal(patchCalls.length, 1)
    assert.equal(patchCalls[0].themeMode, 'dark')
    assert.equal(store.settingsSaveError, null)

    // 2. 失败 patch 产生可观察错误
    shouldFail = true
    store.ttsVolume = 0.3
    await Vue.nextTick()
    await new Promise((r) => setTimeout(r, 20))

    assert.equal(patchCalls.length, 2)
    assert.ok(store.settingsSaveError)
    assert.equal(store.settingsSaveError.code, 'revision-conflict')
    assert.equal(store.ttsVolume, 0.3, 'failed edits stay available for another attempt')
    assert.equal(store.settingsUnsavedChanges.ttsVolume, 0.3)
    assert.equal(store.settingsSaveError.message, '设置未保存，请重新尝试修改。')
  })

  test('canonical-dev: remote subscription updates refs without triggering an echo patch loop', async () => {
    let remoteListener
    let patchCalls = []
    const mockClient = {
      settingsClient: {
        getMode: () => 'canonical-dev',
        getCurrentSettings: () => ({
          themeMode: 'light',
          accentColor: '#4f7fa6',
          hoverFadeEnabled: false,
          gazeFollowEnabled: true,
          idleActionsEnabled: true,
          orbAction: 'model_picker',
          ttsEnabled: false,
          ttsProvider: 'cloud',
          ttsRate: 1,
          ttsVolume: 0.8,
          ttsSpeakNarration: false,
          ttsSpeakReplies: true,
        }),
        getCurrentRevision: () => 1,
        patch: async (changes) => {
          patchCalls.push(changes)
          return { ok: true, changed: true, document: { revision: 2, values: changes } }
        },
        subscribe: (listener) => {
          remoteListener = listener
          return () => {}
        },
      },
    }

    const deskpetModule = loadDeskpetStoreModule(mockClient, localStorageMock)
    const store = deskpetModule.useDeskpetStore()

    assert.ok(remoteListener, 'Client subscribe listener must be registered')

    // 远端变更到达
    remoteListener({
      revision: 10,
      values: {
        themeMode: 'dark',
        accentColor: '#123456',
        hoverFadeEnabled: true,
        gazeFollowEnabled: false,
        idleActionsEnabled: false,
        orbAction: 'color_picker',
        ttsEnabled: true,
        ttsProvider: 'http',
        ttsRate: 1.2,
        ttsVolume: 0.7,
        ttsSpeakNarration: true,
        ttsSpeakReplies: false,
      },
    })

    await Vue.nextTick()
    await new Promise((r) => setTimeout(r, 30))

    // 验证本地 ref 已更新
    assert.equal(store.themeMode, 'dark')
    assert.equal(store.accentColor, '#123456')
    assert.equal(store.ttsVolume, 0.7)

    // 验证远端赋值绝不触发反向 patch 回写
    assert.equal(patchCalls.length, 0, 'Remote update must NOT trigger a patch echo')
  })

  test('canonical-dev: localStorage does NOT mirror the twelve fields', async () => {
    const mockClient = {
      settingsClient: {
        getMode: () => 'canonical-dev',
        getCurrentSettings: () => ({
          themeMode: 'light',
          accentColor: '#4f7fa6',
          hoverFadeEnabled: false,
          gazeFollowEnabled: true,
          idleActionsEnabled: true,
          orbAction: 'model_picker',
          ttsEnabled: false,
          ttsProvider: 'cloud',
          ttsRate: 1,
          ttsVolume: 0.8,
          ttsSpeakNarration: false,
          ttsSpeakReplies: true,
        }),
        getCurrentRevision: () => 1,
        patch: async () => ({ ok: true, changed: false }),
        subscribe: () => () => {},
      },
    }

    const deskpetModule = loadDeskpetStoreModule(mockClient, localStorageMock)
    const store = deskpetModule.useDeskpetStore()

    // 改变未迁移字段
    store.ttsVoice = 'custom-voice-42'
    await Vue.nextTick()
    await new Promise((r) => setTimeout(r, 20))

    const raw = localStorageMock.getItem('deskpet/voice-service-v1')
    assert.ok(raw)
    const parsed = JSON.parse(raw)
    assert.equal(parsed.ttsVoice, 'custom-voice-42')
    // 确认十二字段没有被写入该 JSON
    assert.equal(parsed.themeMode, undefined)
    assert.equal(parsed.accentColor, undefined)
    assert.equal(parsed.ttsVolume, undefined)
    assert.equal(parsed.hoverFadeEnabled, undefined)
  })

  for (const mode of ['canonical-dev', 'canonical-stable']) test(`${mode}: preserves original legacy bytes and reloads service-only edits independently`, async () => {
    const legacy = JSON.stringify({ themeMode: 'dark', accentColor: '#111111', ttsCloudVoice: 'old-voice', ttsEndpoint: 'http://127.0.0.1:9999', untouched: 'fixture' })
    localStorageMock.setItem('deskpet/ui-state-biophilic-v1', legacy)
    const values = require('./support/settings-loader.cjs')()('shared/settings-contracts').PUBLIC_SETTINGS_DEFAULTS
    let writes = 0
    const mockClient = { settingsClient: {
      getMode: () => mode, getCurrentSettings: () => ({ ...values }), getCurrentRevision: () => 2,
      patch: async () => { writes++; return { ok: false, code: 'store-blocked' } }, subscribe: () => () => {},
    } }
    const store = loadDeskpetStoreModule(mockClient, localStorageMock).useDeskpetStore()
    assert.equal(store.themeMode, 'light')
    assert.equal(store.ttsCloudVoice, 'old-voice')
    store.ttsCloudVoice = 'new-voice'
    await Vue.nextTick()
    assert.equal(localStorageMock.getItem('deskpet/ui-state-biophilic-v1'), legacy)
    const service = JSON.parse(localStorageMock.getItem('deskpet/voice-service-v1'))
    assert.equal(service.ttsCloudVoice, 'new-voice')
    assert.equal(service.themeMode, undefined)
    assert.equal(writes, 0)
    store.$dispose()
    const nextPinia = Pinia.createPinia(); Pinia.setActivePinia(nextPinia)
    const restarted = loadDeskpetStoreModule(mockClient, localStorageMock).useDeskpetStore()
    assert.equal(restarted.ttsCloudVoice, 'new-voice')
    assert.equal(restarted.themeMode, 'light')
    assert.equal(localStorageMock.getItem('deskpet/ui-state-biophilic-v1'), legacy)
    restarted.$dispose()
  })

  test('legacy mode regression: full localStorage persistence remains intact', async () => {
    const mockClient = {
      settingsClient: {
        getMode: () => 'legacy',
        getCurrentSettings: () => null,
        getCurrentRevision: () => null,
        patch: async () => ({ ok: false, code: 'store-blocked', currentRevision: null }),
        subscribe: () => () => {},
      },
    }

    const deskpetModule = loadDeskpetStoreModule(mockClient, localStorageMock)
    const store = deskpetModule.useDeskpetStore()

    assert.equal(store.settingsAuthorityMode, 'legacy')
    assert.equal(store.themeMode, 'light')

    // legacy 模式下修改字段应写入 localStorage 全量 blob
    store.applyLegacyHoverFade(true)
    assert.equal(store.hoverFadeEnabled, true)
    store.themeMode = 'dark'
    await Vue.nextTick()
    await new Promise((r) => setTimeout(r, 20))

    const raw = localStorageMock.getItem('deskpet/ui-state-biophilic-v1')
    assert.ok(raw)
    const parsed = JSON.parse(raw)
    assert.equal(parsed.themeMode, 'dark')
    assert.equal(parsed.accentColor, '#3d6a8e')
    assert.equal(parsed.hoverFadeEnabled, true)
  })
})
