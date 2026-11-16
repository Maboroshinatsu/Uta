'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const Vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')

const appRoot = path.join(__dirname, '..')

function scriptSetup(relative, imports, globals = {}, mount = false) {
  const file = path.join(appRoot, 'src', relative)
  const { descriptor } = parse(fs.readFileSync(file, 'utf8'), { filename: file })
  const compiled = compileScript(descriptor, { id: 'connections-race-test' })
  const code = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  const mounts = [], unmounts = []
  const localVue = { ...Vue, onMounted: fn => mounts.push(fn), onUnmounted: fn => unmounts.push(fn) }
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports,
    require: id => id === 'vue' ? localVue : (Object.hasOwn(imports, id) ? imports[id] : {}),
    console, process, Buffer, URL, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
    ...globals,
  }, { filename: file })
  const exposed = {}
  const scope = Vue.effectScope()
  const state = scope.run(() => mod.exports.default.setup({}, {
    expose: value => Object.assign(exposed, value),
    emit: () => {},
  }))
  if (mount) mounts.forEach(fn => fn())
  return { state, stop: () => { if (mount) unmounts.forEach(fn => fn()); scope.stop() } }
}

test('a late session reply from the previous host cannot replace the new host list', async () => {
  const oldReply = {}
  oldReply.promise = new Promise(resolve => { oldReply.resolve = resolve })
  const newReply = {}
  newReply.promise = new Promise(resolve => { newReply.resolve = resolve })
  const { state, stop } = scriptSetup(
    'renderer/settings-window/domains/ConnectionsDomain.vue',
    {
      '@/stores/deskpet': { useDeskpetStore: () => ({}) },
      '@/services/adapters': { getHostPreference: () => 'codex', findHost: () => ({ available: true }), getAgentHosts: () => [] },
      '@/services/adapters/plugin-loader': { adapterPluginEntries: Vue.ref([]) },
    },
    {
      window: {
        utaAPI: {
          getHostSessions: id => id === 'codex' ? oldReply.promise : newReply.promise,
          getHostPathInfo: async () => ({ ok: true, path: '' }),
        },
      },
      localStorage: { getItem: () => null },
    },
  )
  try {
    state.hostPreference.value = 'codex'
    state.currentHostId.value = 'codex'
    const first = state.refreshSessions()

    state.hostPreference.value = 'harness'
    state.currentHostId.value = 'harness'
    await Vue.nextTick()
    newReply.resolve({ ok: true, sessions: [{ sessionId: 'harness-new' }], selectedSessionId: 'harness-new' })
    await new Promise(resolve => setTimeout(resolve, 10))
    await Vue.nextTick()
    assert.equal(state.hostSessions.value[0]?.sessionId, 'harness-new')

    oldReply.resolve({ ok: true, sessions: [{ sessionId: 'codex-old' }], selectedSessionId: 'codex-old' })
    await first
    await new Promise(resolve => setTimeout(resolve, 10))
    await Vue.nextTick()
    assert.equal(state.hostPreference.value, 'harness')
    assert.deepEqual(state.hostSessions.value.map(session => session.sessionId), ['harness-new'])
    assert.equal(state.selectedSessionId.value, 'harness-new')
    assert.equal(state.sessionsLoading.value, false)
  } finally {
    stop()
  }
})

test('a late session selection from the previous host is ignored', async () => {
  let selectedId = ''
  const { state, stop } = scriptSetup(
    'renderer/settings-window/domains/ConnectionsDomain.vue',
    {
      '@/stores/deskpet': { useDeskpetStore: () => ({}) },
      '@/services/adapters': { getHostPreference: () => 'codex', findHost: () => ({ available: true }), getAgentHosts: () => [] },
      '@/services/adapters/plugin-loader': { adapterPluginEntries: Vue.ref([]) },
    },
    {
      window: {
        utaAPI: {
          getHostSessions: async host => host === 'harness'
            ? { ok: true, sessions: [{ sessionId: 'harness-live' }], selectedSessionId: null }
            : { ok: true, sessions: [{ sessionId: 'codex-live' }], selectedSessionId: null },
          getHostPathInfo: async () => ({ ok: true, path: '' }),
          selectHostSession: (host, sessionId) => {
            selectedId = host
            return new Promise(resolve => {
              setTimeout(() => resolve({ ok: true, sessions: [{ sessionId: 'stale' }], selectedSessionId: sessionId }), 10)
            })
          },
        },
      },
    },
  )
  try {
    state.hostPreference.value = 'codex'
    state.currentHostId.value = 'codex'
    state.hostSessions.value = [{ sessionId: 'codex-live' }]
    const selection = state.selectSession(null)
    state.hostPreference.value = 'harness'
    state.currentHostId.value = 'harness'
    await Vue.nextTick()
    await new Promise(resolve => setTimeout(resolve, 5))
    state.selectedSessionId.value = null
    await selection
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(selectedId, 'codex')
    assert.deepEqual(state.hostSessions.value.map(session => session.sessionId), ['harness-live'])
    assert.equal(state.selectedSessionId.value, null)
    assert.equal(state.sessionsLoading.value, false)
  } finally {
    stop()
  }
})

test('the mounted connections page updates discovered chats without refresh or clearing a draft', async () => {
  const callbacks = []
  let chat = null
  const store = { quickInputDraft: 'unfinished draft', requestModelAction: async () => ({ ok: true,
    data: { preference: 'codex', activeHostId: 'codex', state: 'connected' } }) }
  const { state, stop } = scriptSetup('renderer/settings-window/domains/ConnectionsDomain.vue', {
    '@/stores/deskpet': { useDeskpetStore: () => store },
    '@/services/adapters': { findHost: () => ({ available: true }), getAgentHosts: () => [] },
    '@/services/adapters/plugin-loader': { adapterPluginEntries: Vue.ref([]) },
  }, {
    setInterval: fn => { callbacks.push(fn); return callbacks.length }, clearInterval() {},
    localStorage: { getItem: () => null },
    window: { addEventListener() {}, removeEventListener() {}, utaAPI: {
      getPetBinding: async () => ({ binding: { hostId: 'codex' } }),
      getHostSessions: async () => ({ ok: true, sessions: chat ? [{ sessionId: chat, lastSeen: Date.now() }] : [],
        selectedSessionId: null, automaticSessionId: chat }),
    } },
  }, true)
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await Vue.nextTick() }
  try {
    await settle()
    assert.equal(state.hostSessions.value.length, 0)
    chat = 'newly-discovered-chat'
    callbacks[0]()
    await settle()
    assert.equal(state.hostSessions.value[0].sessionId, chat)
    assert.equal(state.automaticSessionId.value, chat)
    assert.equal(state.sessionsLoading.value, false)
    assert.equal(store.quickInputDraft, 'unfinished draft')
    state.currentHostState.value = 'disconnected'
    assert.equal(state.connectionLabel.value, '待命')
  } finally { stop() }
})
