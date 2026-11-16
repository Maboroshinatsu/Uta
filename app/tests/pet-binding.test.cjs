'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createLoader = require('./support/settings-loader.cjs')

const mod = createLoader()('main/pet-binding')

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-pet-binding-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('a pet binds to one platform and refuses a different one', t => {
  const dir = tempDir(t)
  const store = mod.createPetBindingStore(dir)
  assert.equal(store.get(), null)
  const first = store.bind('codex')
  assert.equal(first.ok, true)
  assert.equal(first.binding.hostId, 'codex')
  assert.equal(store.bind('codex').ok, true)

  const other = store.bind('harness')
  assert.equal(other.ok, false)
  assert.equal(other.error, 'already-bound')
  assert.equal(other.boundHostId, 'codex')
  assert.equal(store.get().hostId, 'codex')

  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'pet-binding.json'), 'utf8'))
  assert.equal(saved.hostId, 'codex')
  assert.equal(saved.version, 1)

  assert.equal(store.clear(), true)
  assert.equal(store.get(), null)
  assert.equal(store.bind('harness').ok, true)
})

test('invalid host ids and corrupt binding files are rejected safely', t => {
  const dir = tempDir(t)
  const store = mod.createPetBindingStore(dir)
  assert.equal(store.bind('standalone').ok, false)
  assert.equal(store.bind('../codex').ok, false)

  fs.writeFileSync(path.join(dir, 'pet-binding.json'), '{"version":1,"hostId":"../unknown"}')
  const corrupt = mod.createPetBindingStore(dir)
  assert.equal(corrupt.get(), null)
  assert.equal(corrupt.bind('qoder').ok, true)
  assert.equal(corrupt.clear(), true)
  assert.equal(corrupt.bind('my-agent').ok, true, 'external adapter ids remain bindable')
})

test('manual reconnect persists discovery for the current host without opting old bindings in', t => {
  const dir = tempDir(t)
  const store = mod.createPetBindingStore(dir)
  store.bind('codex')
  assert.equal(store.get().sharedDiscovery, undefined)
  assert.equal(store.rebind('codex', true).binding.sharedDiscovery, true)
  assert.equal(mod.createPetBindingStore(dir).get().sharedDiscovery, true)
  assert.equal(store.rebind('harness').binding.sharedDiscovery, undefined)
})

test('rebind switches the one durable binding without weakening bind()', t => {
  const dir = tempDir(t)
  const store = mod.createPetBindingStore(dir)
  assert.equal(store.bind('codex').ok, true)

  // 'harness' is the pre-unification id; rebinding it must persist the canonical 'deepseek-harness'.
  const switched = store.rebind('harness')
  assert.equal(switched.ok, true)
  assert.equal(switched.binding.hostId, 'deepseek-harness')
  assert.equal(store.get().hostId, 'deepseek-harness')
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dir, 'pet-binding.json'), 'utf8')).hostId,
    'deepseek-harness',
  )
  assert.equal(store.bind('qoder').ok, false, 'onboarding bind still refuses a second platform')

  assert.equal(store.rebind('standalone').ok, false)
  assert.equal(store.get().hostId, 'deepseek-harness', 'invalid switch leaves the current binding intact')
  assert.equal(store.rebind('deepseek-harness').ok, true, 'switching to the current host is a no-op')
})

test('quick host switching is wired to the rebind IPC and broadcasts changes', () => {
  const source = (relativePath) =>
    fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
  const main = source('src/main/index.ts')
  assert.match(main, /ipcMain\.handle\('pet-switch-host'/)
  assert.match(main, /petBindingStore\.rebind\(/)
  assert.match(main, /notifyPetBindingChanged\(\)/)
  assert.match(main, /pet-binding-changed/)

  const preload = source('src/preload/index.ts')
  assert.match(preload, /switchPetHost:.*pet-switch-host/s)
  assert.match(preload, /pet-binding-changed/)

  assert.match(
    source('src/renderer/settings-window/SettingsWindowApp.vue'),
    /onPetBindingChanged/,
  )
  assert.match(
    source('src/renderer/settings-window/domains/ConnectionsDomain.vue'),
    /onPetBindingChanged/,
  )
})
