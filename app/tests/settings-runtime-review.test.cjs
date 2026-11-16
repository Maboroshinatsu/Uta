'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const Vue = require('vue')
const Pinia = require('pinia')
const createLoader = require('./support/settings-loader.cjs')
const clone = x => JSON.parse(JSON.stringify(x))
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const tick = () => new Promise(resolve => setImmediate(resolve))
const load = createLoader()
const { SettingsClient } = load('renderer/services/settings-client/client')
const { createDefaultDocument } = load('main/settings-store/defaults')

function memoryBridge() {
  let doc = createDefaultDocument()
  const listeners = new Set()
  const requests = []
  const bridge = {
    getMode: async () => 'canonical-dev',
    read: async () => ({ status: 'ready', document: clone(doc) }),
    patch: async req => {
      requests.push(clone(req))
      if (req.expectedRevision !== doc.revision) return { ok: false, code: 'revision-conflict', currentRevision: doc.revision }
      doc = { ...doc, revision: doc.revision + 1, values: { ...doc.values, ...req.changes } }
      for (const listener of listeners) listener(clone(doc))
      return { ok: true, changed: true, document: clone(doc) }
    },
    onChanged: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    publish: next => { doc = clone(next); for (const fn of listeners) fn(clone(doc)) },
    listeners, requests,
  }
  return bridge
}

function runtime() {
  const handlers = new Map()
  const ipcMain = { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) }
  const loader = createLoader({ electron: { ipcMain } })
  return { loader, handlers, ...loader('main/settings-ipc'), ...loader('main/settings-ipc/lifecycle') }
}

test('sender requires a live current main frame; navigated pages lose access', () => {
  const { isValidSettingsSender, isSettingsPage } = runtime()
  const frame = {}
  const target = { mainFrame: frame, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:9281/#settings' }
  assert.equal(isValidSettingsSender({ sender: target }, [target]), false)
  assert.equal(isValidSettingsSender({ sender: target, senderFrame: null }, [target]), false)
  assert.equal(isValidSettingsSender({ sender: target, senderFrame: frame }, [target]), true)
  assert.equal(isSettingsPage(target, 'http://127.0.0.1:9281/'), true)
  target.getURL = () => 'http://127.0.0.1:9281/?onboarding=1#settings'
  assert.equal(isSettingsPage(target, 'http://127.0.0.1:9281/'), true)
  target.getURL = () => 'http://127.0.0.1:9281/other'
  assert.equal(isSettingsPage(target, 'http://127.0.0.1:9281/'), false)
  target.getURL = () => 'file:///C:/Uta/out/renderer/index.html#settings'
  assert.equal(isSettingsPage(target, 'file:///C:/Uta/out/renderer/index.html'), true)
  target.getURL = () => 'file://evil/C:/Uta/out/renderer/index.html#settings'
  assert.equal(isSettingsPage(target, 'file:///C:/Uta/out/renderer/index.html'), false)
  target.getURL = () => 'http://127.0.0.1:9281/#settings'
  target.getURL = () => 'http://evil.invalid/'
  assert.equal(isSettingsPage(target, 'http://127.0.0.1:9281/'), false)
  Object.defineProperty(target, 'mainFrame', { get() { throw new Error('destroyed frame') } })
  assert.equal(isValidSettingsSender({ sender: target, senderFrame: frame }, [target]), false)
})

test('actual startup helper opens current settings; a blocked store stays fail-closed', async () => {
  const r = runtime()
  let calls = 0
  const options = { createStore: async () => { calls++; throw new Error('private path') }, getTargets: () => [], isAllowedSender: () => true }
  const stable = await r.initializeSettingsIpc({ ...options, isStable: true })
  assert.equal(calls, 1)
  assert.equal(r.handlers.get('uta:settings:mode')({}), 'canonical-stable')
  assert.deepEqual(clone(await r.handlers.get('uta:settings:read')({})), { status: 'blocked', reason: 'io-error', backupAvailable: false })
  await stable.dispose()
  const dev = await r.initializeSettingsIpc({ ...options, isStable: false })
  assert.equal(calls, 2)
  assert.equal(r.handlers.get('uta:settings:mode')({}), 'canonical-dev')
  assert.deepEqual(clone(await r.handlers.get('uta:settings:read')({})), { status: 'blocked', reason: 'io-error', backupAvailable: false })
  await dev.dispose()
})

test('quit guard blocks reentry until queue close completes and then resumes exactly once', async () => {
  const { createSettingsQuitGuard, registerSettingsIpc } = runtime()
  const gate = deferred()
  let closes = 0, quits = 0, prevented = 0
  const controller = registerSettingsIpc({ mode: 'canonical-dev', store: {
    subscribe: () => () => {}, close: () => { closes++; return gate.promise },
  }, isAllowedSender: () => true, getTargets: () => [] })
  const guard = createSettingsQuitGuard(() => controller.dispose(), () => { quits++ })
  const event = { preventDefault() { prevented++ } }
  guard(event); guard(event)
  await tick()
  assert.equal(closes, 1)
  assert.equal(quits, 0)
  const anotherClose = controller.dispose()
  let closed = false
  anotherClose.then(() => { closed = true })
  await tick()
  assert.equal(closed, false)
  gate.resolve()
  await anotherClose; await tick()
  assert.equal(quits, 1)
  guard(event)
  assert.equal(prevented, 2)
})

test('obsolete failing init cannot tear down a successful retry; subscription failure is structured', async () => {
  const client = new SettingsClient()
  const read = deferred()
  const old = memoryBridge(); old.read = () => read.promise
  const pending = client.init(old)
  await tick()
  const next = memoryBridge()
  assert.equal((await client.init(next)).ok, true)
  read.reject(new Error('old failure'))
  assert.equal((await pending).ok, false)
  assert.equal(client.isReady(), true)
  assert.equal(next.listeners.size, 1)
  assert.equal((await client.init({ ...memoryBridge(), onChanged() { throw Error('bridge down') } })).ok, false)
  assert.equal(client.isReady(), false)
  client.dispose()
})

test('Electron missing bridge and invalid authority mode never become browser mock', async () => {
  const isolated = createLoader({}, { window: { utaAPI: {} } })
  const { SettingsClient: Client } = isolated('renderer/services/settings-client/client')
  const client = new Client()
  assert.equal((await client.init()).ok, false)
  assert.equal((await client.init({ ...memoryBridge(), getMode: async () => 'unknown' })).ok, false)
  assert.equal(client.isReady(), false)
})

test('late writes and queued edits after dispose never write into the replacement connection', async () => {
  const client = new SettingsClient()
  const old = memoryBridge(), next = memoryBridge(), gate = deferred()
  old.patch = () => gate.promise
  await client.init(old)
  const first = client.patch({ themeMode: 'dark' })
  const queued = client.patch({ ttsVolume: 0.4 })
  await tick()
  client.dispose()
  await client.init(next)
  const stale = createDefaultDocument(); stale.revision = 99
  gate.resolve({ ok: true, changed: true, document: stale })
  assert.equal((await first).code, 'closed')
  assert.equal((await queued).code, 'closed')
  assert.equal(next.requests.length, 0)
  assert.equal(client.getCurrentRevision(), 0)
  client.dispose()
})

test('an intervening remote revision conflicts queued edits instead of silently upgrading the version', async () => {
  const client = new SettingsClient(), bridge = memoryBridge(), gate = deferred()
  const save = bridge.patch
  bridge.patch = async req => { await gate.promise; return save(req) }
  await client.init(bridge)
  const p1 = client.patch({ ttsVolume: 0.4 })
  const p2 = client.patch({ accentColor: '#abcdef' })
  await tick()
  const remote = createDefaultDocument(); remote.revision = 1; remote.values.themeMode = 'dark'
  bridge.publish(remote)
  gate.resolve()
  assert.equal((await p1).code, 'revision-conflict')
  assert.equal((await p2).code, 'revision-conflict')
  assert.equal(bridge.requests.length, 1)
  assert.equal(client.getCurrentSettings().themeMode, 'dark')
  assert.equal(client.getCurrentSettings().accentColor, '#3d6a8e')
  client.dispose()
})

test('input and subscriber snapshots are isolated; own event plus ack notifies only once', async () => {
  const client = new SettingsClient(), bridge = memoryBridge()
  await client.init(bridge)
  let observed, notifications = 0
  client.subscribe(doc => { doc.values.themeMode = 'light' })
  client.subscribe(doc => { observed = doc.values.themeMode; notifications++ })
  const changes = { themeMode: 'dark' }
  const pending = client.patch(changes)
  changes.themeMode = 'light'
  assert.equal((await pending).ok, true)
  assert.equal(observed, 'dark')
  assert.equal(notifications, 1)
  assert.equal(client.getCurrentSettings().themeMode, 'dark')
  const doc = createDefaultDocument(); doc.revision = 2
  bridge.publish(doc); doc.values.ttsVolume = 0.01
  assert.equal(client.getCurrentSettings().ttsVolume, 0.8)
  client.dispose()
})

test('conflict refreshes committed snapshot without retrying; bridge failure does not poison queue', async () => {
  const client = new SettingsClient(), bridge = memoryBridge()
  await client.init(bridge)
  const remote = createDefaultDocument(); remote.revision = 1; remote.values.themeMode = 'dark'
  let writes = 0
  bridge.read = async () => ({ status: 'ready', document: remote })
  bridge.patch = async () => { writes++; return { ok: false, code: 'revision-conflict', currentRevision: 1 } }
  assert.equal((await client.patch({ ttsVolume: 0.4 })).code, 'revision-conflict')
  assert.equal(client.getCurrentSettings().themeMode, 'dark')
  assert.equal(writes, 1)
  bridge.patch = async () => { throw Error('transport failed') }
  assert.equal((await client.patch({ ttsVolume: 0.4 })).code, 'io-error')
  bridge.patch = async () => ({ ok: true, changed: true, document: { ...remote, revision: 2, values: { ...remote.values, ttsVolume: 0.4 } } })
  assert.equal((await client.patch({ ttsVolume: 0.4 })).ok, true)
  client.dispose()
})

async function realFixture(t) {
  const parent = path.resolve(__dirname, '../node_modules/.uta-settings-review-fixtures')
  fs.mkdirSync(parent, { recursive: true })
  const dir = fs.mkdtempSync(path.join(parent, 'profile-'))
  assert.equal(path.dirname(dir), parent)
  const r = runtime()
  const service = await r.loader('main/settings-store').createSettingsStore(dir)
  const targets = []
  const controller = await r.initializeSettingsIpc({ isStable: false, createStore: async () => service,
    getTargets: () => targets, isAllowedSender: event => r.isValidSettingsSender(event, targets) })
  const clients = []
  function connect() {
    const listeners = new Set(), frame = {}
    const target = { mainFrame: frame, isDestroyed: () => false, send: (channel, doc) => {
      for (const fn of listeners) fn({}, clone(doc))
    } }
    targets.push(target)
    const event = { sender: target, senderFrame: frame }
    let api
    const preloadLoader = createLoader({ electron: {
      contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'utaAPI'); api = value } },
      ipcRenderer: {
        invoke: (channel, ...args) => Promise.resolve().then(() => r.handlers.get(channel)(event, ...args)),
        on: (channel, fn) => { assert.equal(channel, 'uta:settings:changed'); listeners.add(fn) },
        removeListener: (channel, fn) => listeners.delete(fn),
      },
    } })
    preloadLoader('preload/index')
    assert.deepEqual(Object.keys(api.publicSettings).sort(), ['getMode', 'onChanged', 'patch', 'read'])
    const requests = []
    const bridge = { ...api.publicSettings, patch: req => {
      requests.push(clone(req)); return api.publicSettings.patch(req)
    } }
    const client = new SettingsClient(); clients.push(client)
    return { client, bridge, requests, listeners }
  }
  t.after(async () => {
    clients.forEach(client => client.dispose())
    await controller.dispose()
    // Only delete the exact mkdtemp child within this task's fixture parent.
    assert.equal(path.dirname(fs.realpathSync(dir)), fs.realpathSync(parent))
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { ...r, service, controller, dir, connect }
}

test('two real clients share IPC + disk store, reject stale versions and survive close/reopen', async t => {
  const f = await realFixture(t), a = f.connect(), b = f.connect()
  await Promise.all([a.client.init(a.bridge), b.client.init(b.bridge)])
  assert.equal((await a.client.patch({ themeMode: 'dark' })).ok, true)
  assert.equal(b.client.getCurrentSettings().themeMode, 'dark')
  assert.equal((await b.bridge.patch({ expectedRevision: 0, changes: { themeMode: 'light' } })).code, 'revision-conflict')
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, 'settings.v1.json'))).revision, 1)
  await f.controller.dispose()
  const reopened = await f.loader('main/settings-store').createSettingsStore(f.dir)
  assert.equal((await reopened.read()).document.values.themeMode, 'dark')
  await reopened.close()
})

test('actual queue is persisted before guarded quit; tray changes use the canonical store', async t => {
  const f = await realFixture(t), a = f.connect()
  await a.client.init(a.bridge)
  let trayValue
  const stop = await f.observeHoverFade(f.service, enabled => { trayValue = enabled })
  const store = piniaStore(a.client)
  t.after(() => store.$dispose())
  assert.equal((await f.patchHoverFade(f.service, true)).ok, true)
  assert.equal(trayValue, true)
  assert.equal(store.hoverFadeEnabled, true)
  const revision = store.settingsRevision
  store.applyLegacyHoverFade(false)
  assert.equal(store.hoverFadeEnabled, true)
  await tick()
  assert.equal(store.settingsRevision, revision)
  const pending = f.service.patch({ expectedRevision: revision, changes: { accentColor: '#abcdef' } })
  const resumed = deferred()
  const guard = f.createSettingsQuitGuard(() => f.controller.dispose(), () => resumed.resolve())
  let prevented = false
  guard({ preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  await resumed.promise
  assert.equal((await pending).ok, true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, 'settings.v1.json'))).values.accentColor, '#abcdef')
  stop()
})

function piniaStore(client) {
  const storage = new Map()
  const loader = createLoader({
    '@/services/settings-client': { settingsClient: client },
    '@/services/live2d/emotion-adapter': { buildModelStatePresets: () => [], getPresetDefaultFinishMode: () => 'hold', normalizePresetSteps: () => [], resolvePresetGroup: () => 'default' },
  }, {
    window: { location: { search: '' }, matchMedia: () => ({ matches: false }) },
    document: { documentElement: { setAttribute() {}, style: { setProperty() {}, removeProperty() {} } } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  })
  const pinia = Pinia.createPinia()
  Pinia.setActivePinia(pinia)
  return loader('renderer/stores/deskpet').useDeskpetStore(pinia)
}

test('actual Pinia retains unsaved local fields across remote events, saves only edits, exposes reactive revision and cleans up', async t => {
  const f = await realFixture(t), a = f.connect()
  const gate = deferred(), originalPatch = a.bridge.patch
  const writes = []
  a.bridge.patch = req => {
    const result = gate.promise.then(() => originalPatch(req))
    writes.push(result)
    return result
  }
  await a.client.init(a.bridge)
  const store = piniaStore(a.client)
  t.after(() => store.$dispose())
  assert.equal(a.requests.length, 0)
  assert.equal(store.settingsRevision, 0)
  store.ttsVolume = 0.4
  await tick()
  await f.service.patch({ expectedRevision: 0, changes: { themeMode: 'dark' } })
  assert.equal(store.themeMode, 'dark')
  assert.equal(store.ttsVolume, 0.4)
  assert.equal(store.settingsRevision, 1)
  gate.resolve(); await writes[0]; await tick()
  assert.equal(store.settingsSaveError.code, 'revision-conflict')
  assert.equal(store.settingsUnsavedChanges.ttsVolume, 0.4)
  assert.deepEqual(Object.keys(a.requests[0].changes), ['ttsVolume'])
  store.ttsVolume = 0.5
  await tick(); await writes[1]; await tick()
  assert.equal(store.settingsSaveError, null)
  assert.equal(store.settingsRevision, 2)
  assert.deepEqual(clone(store.settingsUnsavedChanges), {})
  assert.equal(store.themeMode, 'dark')
  const writeCount = a.requests.length
  store.$dispose()
  await f.service.patch({ expectedRevision: 2, changes: { themeMode: 'light' } })
  assert.equal(store.themeMode, 'dark')
  store.ttsVolume = 0.6
  await tick()
  assert.equal(a.requests.length, writeCount)
})

test('earlier save acknowledgements do not clear newer edits or revert their displayed values', async () => {
  const client = new SettingsClient(), bridge = memoryBridge(), gate = deferred()
  const save = bridge.patch
  bridge.patch = async req => { await gate.promise; return save(req) }
  await client.init(bridge)
  const store = piniaStore(client)
  store.ttsVolume = 0.4
  store.ttsVolume = 0.6
  gate.resolve()
  for (let i = 0; i < 20 && Object.keys(store.settingsUnsavedChanges).length; i++) await tick()
  assert.equal(store.ttsVolume, 0.6)
  assert.equal(client.getCurrentSettings().ttsVolume, 0.6)
  assert.equal(store.settingsRevision, 2)
  assert.deepEqual(clone(store.settingsUnsavedChanges), {})
  store.$dispose(); client.dispose()
})

test('real renderer bootstrap gates Pinia/mount, supports retry and ignores obsolete init failure', async () => {
  const first = deferred(), second = deferred()
  let calls = 0, pinia = 0, mounts = 0
  const container = { innerHTML: '' }
  const recoveryNodes = new Map()
  const recoveryDocument = { getElementById: id => {
    if (id === 'app') return container
    if (!recoveryNodes.has(id)) recoveryNodes.set(id, { addEventListener: (name, fn) => { recoveryNodes.get(id)[name] = fn }, focus() {} })
    return recoveryNodes.get(id)
  } }
  const loader = createLoader({
    vue: { createApp: () => ({ use() {}, mount() { mounts++ } }) },
    pinia: { createPinia: () => { pinia++; return {} } },
    '@pixi/core': { ShaderSystem: {} }, '@pixi/unsafe-eval': { install() {} },
    './App.vue': {}, './services/adapters/plugin-loader': { loadAdapterPlugins: async () => {} },
    './services/settings-client': { settingsClient: { init: () => (++calls === 1 ? first.promise : second.promise) } },
  }, { document: recoveryDocument, window: { location: { hash: '', search: '' }, utaAPI: {}, addEventListener() {} } })
  const { bootstrap } = loader('renderer/main')
  assert.equal(pinia, 0)
  first.resolve({ ok: false })
  await tick()
  assert.equal(pinia, 0)
  assert.match(container.innerHTML, /设置暂时无法读取/)
  recoveryNodes.get('retry-settings-btn').click()
  second.resolve({ ok: true })
  await tick()
  assert.equal(pinia, 1); assert.equal(mounts, 1)
  await bootstrap()
  assert.equal(mounts, 1)

  const old = deferred(), latest = deferred()
  let attempt = 0
  const raceLoader = createLoader({
    vue: { createApp: () => ({ use() {}, mount() { mounts++ } }) }, pinia: { createPinia: () => ({}) },
    '@pixi/core': { ShaderSystem: {} }, '@pixi/unsafe-eval': { install() {} }, './App.vue': {},
    './services/adapters/plugin-loader': { loadAdapterPlugins: async () => {} },
    './services/settings-client': { settingsClient: { init: () => ++attempt === 1 ? old.promise : latest.promise } },
  }, { document: { getElementById: () => { throw Error('stale failure attempted to replace UI') } } })
  const race = raceLoader('renderer/main')
  const current = race.bootstrap()
  latest.resolve({ ok: true }); await current
  old.resolve({ ok: false }); await tick()
  assert.equal(mounts, 2)
})
