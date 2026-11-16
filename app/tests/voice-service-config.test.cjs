'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript'), Vue = require('vue'), Pinia = require('pinia')
const { parse, compileScript } = require('@vue/compiler-sfc')
const createLoader = require('./support/settings-loader.cjs')
const tick = async () => { for (let index = 0; index < 12; index++) { await Promise.resolve(); await Vue.nextTick() } }

test('TTS component blocks autosave when the cloud config is unreadable', async t => {
  const memory = new Map(), writes = []
  let store
  const globals = {
    window: { location: { search: '' }, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {},
      utaAPI: {
        getCloudTtsConfig: async () => ({
          backend: store.ttsCloudBackend, endpoint: store.ttsCloudEndpoint, model: store.ttsCloudModel,
          voice: store.ttsCloudVoice, style: store.ttsCloudStyle, hasApiKey: false,
          readError: 'config-unreadable',
        }),
        saveCloudTtsConfig: async payload => {
          writes.push(payload)
          return { ok: true, config: { ...payload, hasApiKey: false } }
        },
      } },
    localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)) },
    document: { documentElement: { setAttribute() {}, style: { setProperty() {}, removeProperty() {} } } },
  }
  const load = createLoader({ vue: Vue, pinia: Pinia }, globals)
  const pinia = Pinia.createPinia()
  store = load('renderer/stores/deskpet').useDeskpetStore(pinia)
  const filename = path.resolve(__dirname, '../src/renderer/components/TtsSettingsSection.vue')
  const source = compileScript(parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'voice-config-unreadable-test' }).content
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, ...globals, console, setTimeout, clearTimeout,
    require: name => name === 'vue' ? Vue
      : name.startsWith('@/') ? load('renderer/' + name.slice(2))
        : name === '../services/unsaved-drafts' ? { registerUnsavedDraft: () => () => {} }
          : require(name),
  })
  const component = module.exports.default
  component.render = () => null
  const renderer = Vue.createRenderer({ createElement: tag => ({ tag }), createText: text => ({ text }), createComment: text => ({ text }),
    insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode() { return null }, nextSibling() { return null }, patchProp() {} })
  const app = renderer.createApp(component, { provider: 'cloud', rate: 1, volume: .5 })
  app.use(pinia); app.mount({})
  t.after(async () => { app.unmount(); await tick(); store.$dispose(); pinia._e.stop() })
  await tick()

  const state = app._instance.setupState
  assert.equal(state.cloudSaveBlocked, true)
  assert.match(state.cloudMessage, /读取失败/)
  store.ttsCloudVoice = 'changed-after-read-error'
  await new Promise(resolve => setTimeout(resolve, 700))
  await tick()
  assert.equal(writes.length, 0)
  assert.equal(await state.saveCloudTtsConfigNow(), false)
  assert.equal(writes.length, 0)
})

test('real voice service component preserves newer fields and a new key while an older save finishes', async t => {
  const memory = new Map(), writes = []
  let resolveSave, store
  const globals = {
    window: { location: { search: '' }, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {},
      utaAPI: {
        getCloudTtsConfig: async () => ({ backend: store.ttsCloudBackend, endpoint: store.ttsCloudEndpoint, model: store.ttsCloudModel, voice: store.ttsCloudVoice, style: store.ttsCloudStyle, hasApiKey: false }),
        saveCloudTtsConfig: payload => {
          writes.push(payload)
          if (writes.length === 1) return new Promise(resolve => { resolveSave = resolve })
          return Promise.resolve({ ok: true, config: { ...payload, hasApiKey: true } })
        },
      } },
    localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)) },
    document: { documentElement: { setAttribute() {}, style: { setProperty() {}, removeProperty() {} } } },
  }
  const load = createLoader({ vue: Vue, pinia: Pinia }, globals)
  const pinia = Pinia.createPinia()
  store = load('renderer/stores/deskpet').useDeskpetStore(pinia)
  const filename = path.resolve(__dirname, '../src/renderer/components/TtsSettingsSection.vue')
  const source = compileScript(parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'voice-config-test' }).content
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, ...globals, console, setTimeout, clearTimeout,
    require: name => name === 'vue' ? Vue
      : name.startsWith('@/') ? load('renderer/' + name.slice(2))
        : name === '../services/unsaved-drafts' ? { registerUnsavedDraft: () => () => {} }
          : require(name),
  })
  const component = module.exports.default
  component.render = () => null
  const renderer = Vue.createRenderer({ createElement: tag => ({ tag }), createText: text => ({ text }), createComment: text => ({ text }),
    insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode() { return null }, nextSibling() { return null }, patchProp() {} })
  const app = renderer.createApp(component, { provider: 'cloud', rate: 1, volume: .5 })
  app.use(pinia); app.mount({})
  t.after(async () => { app.unmount(); await tick(); store.$dispose(); pinia._e.stop() })
  await tick()
  const state = app._instance.setupState
  store.ttsCloudVoice = 'first-voice'; state.cloudApiKey = 'test-key-before-save'
  await tick()
  const work = state.saveCloudTtsConfigNow(); await tick()
  assert.equal(writes[0].voice, 'first-voice')
  store.ttsCloudVoice = 'newer-voice'; state.cloudApiKey = 'test-key-typed-during-save'
  resolveSave({ ok: true, config: { ...writes[0], hasApiKey: true } })
  await work; await tick()
  assert.equal(store.ttsCloudVoice, 'newer-voice')
  assert.equal(state.cloudApiKey, 'test-key-typed-during-save')
  assert.match(state.cloudMessage, /新输入仍保留/)
})

test('cloud TTS autosave failure can be retried without re-entering the key', async t => {
  const memory = new Map(), writes = []
  let fail = true, store
  const globals = {
    window: { location: { search: '' }, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {},
      utaAPI: {
        getCloudTtsConfig: async () => ({ backend: store.ttsCloudBackend, endpoint: store.ttsCloudEndpoint, model: store.ttsCloudModel, voice: store.ttsCloudVoice, style: store.ttsCloudStyle, hasApiKey: true }),
        saveCloudTtsConfig: async payload => {
          writes.push(payload)
          return fail ? { ok: false } : { ok: true, config: { ...payload, hasApiKey: true } }
        },
      } },
    localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)) },
    document: { documentElement: { setAttribute() {}, style: { setProperty() {}, removeProperty() {} } } },
  }
  const load = createLoader({ vue: Vue, pinia: Pinia }, globals)
  const pinia = Pinia.createPinia()
  store = load('renderer/stores/deskpet').useDeskpetStore(pinia)
  const filename = path.resolve(__dirname, '../src/renderer/components/TtsSettingsSection.vue')
  const source = compileScript(parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'voice-config-retry-test' }).content
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, ...globals, console, setTimeout, clearTimeout,
      require: name => name === 'vue' ? Vue
        : name.startsWith('@/') ? load('renderer/' + name.slice(2))
          : name === '../services/unsaved-drafts' ? { registerUnsavedDraft: () => () => {} }
            : require(name),
    })
  const component = module.exports.default
  component.render = () => null
  const renderer = Vue.createRenderer({ createElement: tag => ({ tag }), createText: text => ({ text }), createComment: text => ({ text }),
    insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode() { return null }, nextSibling() { return null }, patchProp() {} })
  const app = renderer.createApp(component, { provider: 'cloud', rate: 1, volume: .5 })
  app.use(pinia); app.mount({})
  t.after(async () => { app.unmount(); await tick(); store.$dispose(); pinia._e.stop() })
  await tick()
  const state = app._instance.setupState
  store.ttsCloudVoice = 'retry-voice'
  await state.persistCloudConfigSilently()
  assert.equal(state.cloudAutoState, 'error')
  fail = false
  await state.persistCloudConfigSilently()
  assert.equal(state.cloudAutoState, 'saved')
  assert.equal(writes.length, 2)
  assert.equal(writes[1].voice, 'retry-voice')
  assert.equal(Object.hasOwn(writes[1], 'apiKey'), false)
})

test('DeepSeek settings load, switch voices and save the native preset without copying another key', async t => {
  const memory = new Map(), writes = []
  const globals = {
    window: { location: { search: '' }, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {},
      utaAPI: {
        getCloudTtsConfig: async () => ({ backend: 'deepseek', endpoint: 'https://api.deepseek.com/v1/tools/tts',
          model: '', voice: 'tide', style: '', hasApiKey: true }),
        saveCloudTtsConfig: async payload => {
          writes.push(payload)
          return { ok: true, config: { ...payload, hasApiKey: false } }
        },
      } },
    localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)) },
    document: { documentElement: { setAttribute() {}, style: { setProperty() {}, removeProperty() {} } } },
  }
  const load = createLoader({ vue: Vue, pinia: Pinia }, globals)
  const pinia = Pinia.createPinia()
  const store = load('renderer/stores/deskpet').useDeskpetStore(pinia)
  const filename = path.resolve(__dirname, '../src/renderer/components/TtsSettingsSection.vue')
  const source = compileScript(parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'deepseek-settings-test' }).content
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, ...globals, console, setTimeout, clearTimeout,
      require: name => name === 'vue' ? Vue
        : name.startsWith('@/') ? load('renderer/' + name.slice(2))
          : name === '../services/unsaved-drafts' ? { registerUnsavedDraft: () => () => {} }
            : require(name),
    })
  const component = module.exports.default
  component.render = () => null
  const renderer = Vue.createRenderer({ createElement: tag => ({ tag }), createText: text => ({ text }), createComment: text => ({ text }),
    insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode() { return null }, nextSibling() { return null }, patchProp() {} })
  const app = renderer.createApp(component, { provider: 'cloud', rate: 1.6, volume: .5 })
  app.use(pinia); app.mount({})
  t.after(async () => { app.unmount(); await tick(); store.$dispose(); pinia._e.stop() })
  await tick()
  const state = app._instance.setupState
  assert.equal(store.ttsCloudBackend, 'deepseek')
  assert.equal(store.ttsCloudVoice, 'tide')
  assert.equal(state.isDeepSeek, true)
  assert.equal(state.cloudKeySaved, true)
  store.ttsCloudVoice = 'stella'
  await state.persistCloudConfigSilently()
  assert.equal(writes[0].voice, 'stella')
  assert.equal(Object.hasOwn(writes[0], 'apiKey'), false)

  state.cloudApiKey = 'unsaved-key-for-previous-service'
  store.ttsCloudBackend = 'openai'; state.onCloudBackendChange()
  assert.equal(state.isDeepSeek, false)
  store.ttsCloudBackend = 'deepseek'; state.onCloudBackendChange()
  assert.equal(state.isDeepSeek, true)
  assert.equal(store.ttsCloudEndpoint, 'https://api.deepseek.com/v1/tools/tts')
  assert.equal(store.ttsCloudModel, '')
  assert.equal(store.ttsCloudVoice, 'stella')
  assert.equal(state.cloudApiKey, '')
  assert.equal(state.cloudKeySaved, false)
})
