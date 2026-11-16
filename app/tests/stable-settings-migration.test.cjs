'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), fsp = require('node:fs/promises'), os = require('node:os'), path = require('node:path')
const { EventEmitter } = require('node:events')
const createLoader = require('./support/settings-loader.cjs')
const plain = value => JSON.parse(JSON.stringify(value))
async function setup(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-migration-'))
  const load = createLoader(overrides)
  const migrationModule = load('main/settings-store/stable-migration')
  const migration = new migrationModule.StableSettingsMigration(directory)
  const sender = new EventEmitter(); sender.mainFrame = {}; sender.isDestroyed = () => false
  const event = { sender, senderFrame: sender.mainFrame }
  const controller = load('main/settings-ipc/import-preview').createSettingsImportController({
    isAllowedSender: e => e.sender === sender && e.senderFrame === sender.mainFrame,
    getStore: () => migration.getStore(), allowNoSources: true, onCommitted: result => migration.accept(result),
  })
  t.after(async () => { controller.dispose(); await migration.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  return { directory, load, migration, controller, event, ...migrationModule,
    preview: sources => controller.preview(event, sources),
    apply: (preview, selections = {}) => controller.apply(event, { token: preview.token, selections }),
    read: name => fs.readFileSync(path.join(directory, name), 'utf8'),
  }
}
const sources = [{ sourceId: 'legacy.origin.biophilic-v1', values: { themeMode: 'dark', ttsVolume: .25 } }]
const selections = { themeMode: 'legacy.origin.biophilic-v1', ttsVolume: 'legacy.origin.biophilic-v1' }
test('a missing marker stays legacy; preview and cancel never persist defaults or a marker', async t => {
  const h = await setup(t)
  assert.equal(await h.inspectStableAuthority(h.directory), 'legacy')
  const review = await h.preview(sources)
  assert.equal(review.ok, true)
  assert.equal(review.preview.currentValues.themeMode, 'light')
  assert.equal(h.controller.cancel(h.event), true)
  assert.deepEqual(fs.readdirSync(h.directory), [])
  assert.equal((await h.apply(review.preview, selections)).code, 'preview-expired')
})
test('explicit migration writes reviewed preferences and backup before a bounded authority marker', async t => {
  const h = await setup(t), review = await h.preview(sources)
  const result = await h.apply(review.preview, selections)
  assert.equal(result.ok, true); assert.equal(result.restartRequired, true)
  assert.equal(JSON.parse(h.read('settings.v1.json')).values.themeMode, 'dark')
  assert.equal(JSON.parse(h.read('settings.v1.backup.json')).values.themeMode, 'light')
  const marker = JSON.parse(h.read(h.AUTHORITY_MARKER))
  assert.equal(marker.scope, 'public-preferences'); assert.equal(marker.firstRevision, 1)
  assert.equal(await h.inspectStableAuthority(h.directory), 'accepted')
  assert.equal(await h.migration.getStore(), null)
  assert.deepEqual(fs.readdirSync(h.directory).sort(), [h.AUTHORITY_MARKER, 'settings.v1.backup.json', 'settings.v1.json'].sort())
})
test('an explicit empty-source confirmation persists defaults rather than accepting an in-memory-only store', async t => {
  const h = await setup(t), review = await h.preview([])
  assert.equal(review.ok, true); assert.equal(review.preview.rows.length, 0)
  assert.equal((await h.apply(review.preview)).restartRequired, true)
  assert.equal(JSON.parse(h.read('settings.v1.json')).revision, 0)
  assert.equal(await h.inspectStableAuthority(h.directory), 'accepted')
})
test('marker failure leaves legacy authority and can resume without replaying or losing the import', async t => {
  let fail = true
  const h = await setup(t, { 'node:fs/promises': { ...fsp, async link(...args) { if (fail) throw Error('fixture permission denied'); return fsp.link(...args) } } })
  const first = await h.preview(sources)
  assert.equal((await h.apply(first.preview, selections)).code, 'io-error')
  const committed = h.read('settings.v1.json'), backup = h.read('settings.v1.backup.json')
  assert.equal(await h.inspectStableAuthority(h.directory), 'legacy')
  fail = false
  const retry = await h.preview(sources)
  assert.equal(retry.preview.rows.length, 0)
  assert.equal(retry.preview.currentValues.themeMode, 'dark')
  assert.equal((await h.apply(retry.preview)).restartRequired, true)
  assert.equal(h.read('settings.v1.json'), committed); assert.equal(h.read('settings.v1.backup.json'), backup)
})
test('a fresh process can resume a persisted import without a completion marker', async t => {
  const h = await setup(t), review = await h.preview(sources)
  const store = await h.migration.getStore()
  const imported = await store.importLegacy({ expectedRevision: 0, sources, selections })
  assert.equal(imported.ok, true)
  await h.migration.close()
  const restarted = new h.StableSettingsMigration(h.directory)
  t.after(() => restarted.close())
  const pendingStore = await restarted.getStore()
  assert.equal((await restarted.accept({ ok: true, changed: false, document: (await pendingStore.read()).document })).restartRequired, true)
  assert.equal(JSON.parse(h.read('settings.v1.json')).revision, 1)
})
test('a concurrently-created future marker is not replaced by acceptance', async t => {
  const future = JSON.stringify({ version: 999, scope: 'public-preferences' })
  const h = await setup(t, { 'node:fs/promises': { ...fsp, async link(from, to) { fs.writeFileSync(to, future); return fsp.link(from, to) } } })
  const review = await h.preview(sources)
  assert.equal((await h.apply(review.preview, selections)).code, 'io-error')
  assert.equal(h.read(h.AUTHORITY_MARKER), future)
  assert.equal(await h.inspectStableAuthority(h.directory), 'blocked')
  assert.equal(fs.readdirSync(h.directory).some(name => name.endsWith('.tmp')), false)
})
test('corrupt, oversized, unknown-scope and future markers block instead of resuming legacy', async t => {
  const h = await setup(t), file = path.join(h.directory, h.AUTHORITY_MARKER)
  for (const text of ['{broken', ' '.repeat(4097), JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, scope: 'all-data', firstRevision: 0, completedAt: new Date().toISOString() })]) {
    fs.writeFileSync(file, text)
    assert.equal(await h.inspectStableAuthority(h.directory), 'blocked')
    assert.equal(await h.migration.getStore(), null)
    assert.equal(fs.readFileSync(file, 'utf8'), text)
  }
})
test('a directory or junction used as a marker is rejected without following it', async t => {
  const h = await setup(t), file = path.join(h.directory, h.AUTHORITY_MARKER), target = path.join(h.directory, 'marker-target')
  fs.mkdirSync(target); fs.symlinkSync(target, file, 'junction')
  assert.equal(await h.inspectStableAuthority(h.directory), 'blocked')
  assert.deepEqual(fs.readdirSync(target), [])
})
test('accepted migration never silently recreates lost main and backup as defaults', async t => {
  const h = await setup(t)
  const store = await h.load('main/settings-store').createSettingsStore(h.directory, { requireExisting: true })
  t.after(() => store.close())
  assert.equal((await store.read()).status, 'blocked')
  assert.equal(await store.retryRead(), false)
  assert.deepEqual(fs.readdirSync(h.directory), [])
})
test('external document replacement before acceptance is retained and refuses the success marker', async t => {
  const h = await setup(t), review = await h.preview(sources), store = await h.migration.getStore()
  const imported = await store.importLegacy({ expectedRevision: 0, sources, selections })
  const future = JSON.stringify({ schemaVersion: 999 })
  fs.writeFileSync(path.join(h.directory, 'settings.v1.json'), future)
  assert.equal((await h.migration.accept(imported)).code, 'revision-conflict')
  assert.equal(h.read('settings.v1.json'), future)
  assert.equal(await h.inspectStableAuthority(h.directory), 'legacy')
  assert.equal(review.ok, true)
})
test('new public edits after marker acceptance remain valid across subsequent authority checks', async t => {
  const h = await setup(t), review = await h.preview(sources)
  assert.equal((await h.apply(review.preview, selections)).ok, true)
  await h.migration.close()
  const store = await h.load('main/settings-store').createSettingsStore(h.directory, { requireExisting: true })
  t.after(() => store.close())
  assert.equal((await store.patch({ expectedRevision: 1, changes: { ttsVolume: .6 } })).ok, true)
  assert.equal(await h.inspectStableAuthority(h.directory), 'accepted')
  assert.equal((await store.read()).document.revision, 2)
})
test('stable always exposes current settings; blocked markers fail closed without creating a store', async () => {
  const handlers = new Map(), load = createLoader({ electron: { ipcMain: { handle: (key, value) => handlers.set(key, value), removeHandler: key => handlers.delete(key) } } })
  const initialize = load('main/settings-ipc/lifecycle').initializeSettingsIpc
  let factories = 0
  for (const authority of ['legacy', 'blocked', 'accepted']) {
    const controller = await initialize({ isStable: true, stableAuthority: authority, isAllowedSender: () => true, getTargets: () => [],
      createStore: async () => { factories++; return { subscribe: () => () => {}, close: async () => {} } },
    })
    assert.equal(controller.mode, 'canonical-stable')
    await controller.dispose()
  }
  assert.equal(factories, 2)
})
test('canonical-stable clients hydrate and patch through the same revision authority', async () => {
  const load = createLoader(), client = new (load('renderer/services/settings-client/client').SettingsClient)()
  let doc = load('main/settings-store/defaults').createDefaultDocument(), writes = 0
  const bridge = { getMode: async () => 'canonical-stable', onChanged: () => () => {}, read: async () => ({ status: 'ready', document: doc }),
    patch: async req => { writes++; assert.equal(req.expectedRevision, doc.revision); doc = { ...doc, revision: doc.revision + 1, values: { ...doc.values, ...req.changes } }; return { ok: true, changed: true, document: doc } },
  }
  assert.equal((await client.init(bridge)).ok, true)
  assert.equal((await client.patch({ themeMode: 'dark' })).ok, true)
  assert.equal(writes, 1); assert.equal(client.getCurrentSettings().themeMode, 'dark')
  client.dispose()
})
test('concurrent applies consume a review once, even while the store lookup is asynchronous', async t => {
  const h = await setup(t), review = await h.preview(sources)
  const results = await Promise.all([h.apply(review.preview, selections), h.apply(review.preview, selections)])
  assert.equal(results.filter(result => result.ok).length, 1)
  assert.equal(results.filter(result => result.code === 'preview-expired').length, 1)
  assert.equal(JSON.parse(h.read('settings.v1.json')).revision, 1)
})
test('pending recovery is opt-in and restoring its backup does not activate canonical authority', async t => {
  const h = await setup(t)
  assert.equal(await h.migration.peekStore(), null)
  const backup = h.load('main/settings-store/defaults').createDefaultDocument()
  backup.revision = 7; backup.values.themeMode = 'dark'
  fs.writeFileSync(path.join(h.directory, 'settings.v1.backup.json'), JSON.stringify(backup))
  fs.writeFileSync(path.join(h.directory, 'settings.v1.json'), '{interrupted')
  const failed = await h.preview(sources)
  assert.equal(failed.error, 'store-blocked')
  const store = await h.migration.peekStore()
  const preview = await store.previewRecovery()
  assert.equal(preview.available, true)
  assert.equal((await store.restoreBackup(preview.token)).ok, true)
  assert.equal(await h.inspectStableAuthority(h.directory), 'legacy')
  const resumed = await h.preview(sources)
  assert.equal(resumed.preview.currentValues.themeMode, 'dark')
  assert.equal(h.migration.isAccepted(), false)
  assert.equal((await h.apply(resumed.preview, { themeMode: 'current', ttsVolume: 'current' })).restartRequired, true)
  assert.equal(h.migration.isAccepted(), true)
})
