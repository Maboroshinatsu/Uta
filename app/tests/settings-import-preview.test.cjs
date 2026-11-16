'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { EventEmitter } = require('node:events')
const createLoader = require('./support/settings-loader.cjs')
const plain = value => JSON.parse(JSON.stringify(value))
const source = (sourceId, values) => ({ sourceId, values })

async function setup(t, options) {
  const root = path.resolve(os.tmpdir()), directory = fs.mkdtempSync(path.join(root, 'uta-import-review-'))
  const load = createLoader(), module = load('main/settings-store'), store = await module.createSettingsStore(directory, options)
  const event = { sender: new EventEmitter(), senderFrame: {} }
  let clock = 0
  const controller = load('main/settings-ipc/import-preview').createSettingsImportController({ isAllowedSender: e => e.sender === event.sender,
    getStore: () => store, now: () => clock })
  t.after(async () => { controller.dispose(); await store.close(); if (!directory.startsWith(path.join(root, 'uta-import-review-'))) throw Error('cleanup outside owned temp'); fs.rmSync(directory, { recursive: true, force: true }) })
  return { directory, load, store, controller, event, clock: value => { clock = value },
    preview: sources => controller.preview(event, sources),
    apply: (preview, selections) => controller.apply(event, { token: preview.token, selections }),
  }
}

test('legacy collector transports only validated public fields and never changes raw sources', () => {
  const load = createLoader(), collect = load('renderer/settings-window/legacy-preferences').collectLegacyPreferences
  const raw = JSON.stringify({ themeMode: 'dark', ttsVolume: .4, ttsRate: 20, orbAction: 'toggle_theme', apiKey: 'test-private-value', ttsEndpoint: 'private-endpoint', modelPath: 'private-model', presets: ['private'] })
  const storage = { getItem: key => key === 'deskpet/ui-state-biophilic-v1' ? raw : '{invalid' }
  const result = collect(storage)
  assert.deepEqual(plain(result.sources), [source('legacy.origin.biophilic-v1', { themeMode: 'dark', ttsVolume: .4 })])
  assert.equal(result.notes.length, 2)
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.equal(JSON.stringify(result).includes('orbAction'), false)
  assert.equal(storage.getItem('deskpet/ui-state-biophilic-v1'), raw)
})
test('preview is read-only and binds all options to the actual current revision', async t => {
  const h = await setup(t)
  const result = await h.preview([source('legacy.a', { themeMode: 'dark' }), source('legacy.b', { themeMode: 'light' })])
  assert.equal(result.ok, true)
  assert.equal(result.preview.rows[0].claimed, false)
  assert.equal(result.preview.rows[0].options.length, 2)
  assert.equal(result.preview.revision, 0)
  assert.deepEqual(fs.readdirSync(h.directory), [])
  assert.equal((await h.store.read()).document.revision, 0)
})
test('reviewed choices and provenance commit once with a first-import rollback backup', async t => {
  const h = await setup(t)
  const result = await h.preview([source('legacy.a', { themeMode: 'dark', ttsVolume: .2 }), source('legacy.b', { themeMode: 'light' })])
  const applied = await h.apply(result.preview, { themeMode: 'legacy.a', ttsVolume: 'current' })
  assert.equal(applied.ok, true)
  assert.equal(applied.document.revision, 1)
  assert.equal(applied.document.values.themeMode, 'dark')
  assert.equal(applied.document.values.ttsVolume, .8)
  assert.equal(applied.document.imports.length, 2)
  assert.equal(applied.document.conflicts.length, 0)
  assert.ok(applied.document.claimedKeys.includes('ttsVolume'))
  const backup = JSON.parse(fs.readFileSync(path.join(h.directory, 'settings.v1.backup.json'), 'utf8'))
  assert.equal(backup.revision, 0)
  assert.equal(backup.values.themeMode, 'light')
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.directory, 'settings.v1.json'), 'utf8')).revision, 1)
})
test('claimed values default to current in preview; an explicit incoming selection can replace them atomically', async t => {
  const h = await setup(t)
  await h.store.patch({ expectedRevision: 0, changes: { accentColor: '#123456' } })
  const result = await h.preview([source('legacy.a', { accentColor: '#654321' })])
  assert.equal(result.preview.rows[0].claimed, true)
  assert.equal(result.preview.rows[0].current, '#123456')
  const applied = await h.apply(result.preview, { accentColor: 'legacy.a' })
  assert.equal(applied.document.values.accentColor, '#654321')
  assert.equal(applied.document.revision, 2)
  const backup = JSON.parse(fs.readFileSync(path.join(h.directory, 'settings.v1.backup.json'), 'utf8'))
  assert.equal(backup.values.accentColor, '#123456')
})
test('all choices must be explicit and cannot inject unknown fields or a different source', async t => {
  const h = await setup(t), result = await h.preview([source('legacy.a', { themeMode: 'dark', ttsVolume: .3 })])
  for (const selections of [{}, { themeMode: 'legacy.a' }, { themeMode: 'missing', ttsVolume: 'current' }, { themeMode: 'current', ttsVolume: 'current', apiKey: 'other' }]) {
    assert.equal((await h.apply(result.preview, selections)).code, 'invalid-request')
  }
  assert.deepEqual(fs.readdirSync(h.directory), [])
})
test('an external edit after preview rejects the old review and retains its latest values', async t => {
  const h = await setup(t), result = await h.preview([source('legacy.a', { themeMode: 'dark' })])
  await h.store.patch({ expectedRevision: 0, changes: { ttsVolume: .25 } })
  const before = fs.readFileSync(path.join(h.directory, 'settings.v1.json'), 'utf8')
  assert.equal((await h.apply(result.preview, { themeMode: 'legacy.a' })).code, 'revision-conflict')
  assert.equal(fs.readFileSync(path.join(h.directory, 'settings.v1.json'), 'utf8'), before)
})
test('tokens are frame-bound, short lived and single use; unauthorized callers do not write', async t => {
  const h = await setup(t), sources = [source('legacy.a', { themeMode: 'dark' })]
  const first = await h.preview(sources)
  assert.equal((await h.controller.apply({ sender: {}, senderFrame: h.event.senderFrame }, { token: first.preview.token, selections: { themeMode: 'legacy.a' } })).code, 'invalid-request')
  assert.equal((await h.controller.apply({ sender: h.event.sender, senderFrame: {} }, { token: first.preview.token, selections: { themeMode: 'legacy.a' } })).code, 'preview-expired')
  h.clock(120001)
  assert.equal((await h.apply(first.preview, { themeMode: 'legacy.a' })).code, 'preview-expired')
  const fresh = await h.preview(sources)
  assert.equal((await h.apply(fresh.preview, { themeMode: 'legacy.a' })).ok, true)
  assert.equal((await h.apply(fresh.preview, { themeMode: 'legacy.a' })).code, 'preview-expired')
})
test('already reviewed source content is skipped without another write or conflict', async t => {
  const h = await setup(t), sources = [source('legacy.a', { themeMode: 'dark' })]
  const first = await h.preview(sources)
  await h.apply(first.preview, { themeMode: 'current' })
  const second = await h.preview(sources)
  assert.equal(second.preview.rows.length, 0)
  assert.deepEqual(plain(second.preview.processedSources), ['legacy.a'])
  assert.equal((await h.store.read()).document.revision, 1)
})
test('cancel, renderer reload, crash and close invalidate previews before any import can be submitted', async t => {
  const h = await setup(t)
  for (const action of [() => h.controller.cancel(h.event), () => h.event.sender.emit('did-start-navigation', {}, 'page', false, true),
    () => h.event.sender.emit('render-process-gone'), () => h.event.sender.emit('destroyed')]) {
    const result = await h.preview([source('legacy.a', { themeMode: 'dark' })])
    action()
    assert.equal((await h.apply(result.preview, { themeMode: 'legacy.a' })).code, 'preview-expired')
  }
  assert.deepEqual(fs.readdirSync(h.directory), [])
})
test('a failed backup write leaves defaults and source values intact and cleans its temporary file', async t => {
  const load = createLoader(), io = load('main/settings-store/atomic-writer').defaultIoHooks
  const h = await setup(t, { io: { async writeFile(file, data, encoding) { await io.writeFile(file, data, encoding); throw Object.assign(Error('fixture disk failure'), { code: 'EIO' }) } } })
  const result = await h.preview([source('legacy.a', { themeMode: 'dark' })])
  assert.equal((await h.apply(result.preview, { themeMode: 'legacy.a' })).code, 'io-error')
  assert.equal((await h.store.read()).document.values.themeMode, 'light')
  assert.deepEqual(fs.readdirSync(h.directory), [])
})
test('candidate rename failure preserves a valid rollback backup and never commits half the import', async t => {
  const load = createLoader(), io = load('main/settings-store/atomic-writer').defaultIoHooks
  const h = await setup(t, { io: { async rename(from, to) { if (path.basename(to) === 'settings.v1.json') throw Error('fixture main rename failure'); await io.rename(from, to) } } })
  const result = await h.preview([source('legacy.a', { themeMode: 'dark' })])
  assert.equal((await h.apply(result.preview, { themeMode: 'legacy.a' })).code, 'io-error')
  assert.equal((await h.store.read()).document.revision, 0)
  assert.equal(fs.existsSync(path.join(h.directory, 'settings.v1.json')), false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.directory, 'settings.v1.backup.json'), 'utf8')).values.themeMode, 'light')
  assert.deepEqual(fs.readdirSync(h.directory), ['settings.v1.backup.json'])
})
test('an explicit review does not erase historical conflict records that were not shown', async t => {
  const h = await setup(t)
  await h.store.patch({ expectedRevision: 0, changes: { themeMode: 'light' } })
  await h.store.importLegacy({ expectedRevision: 1, sources: [source('previous', { themeMode: 'dark' })] })
  const result = await h.preview([source('new-source', { ttsVolume: .3 })])
  assert.equal(result.preview.existingConflictCount, 1)
  const applied = await h.apply(result.preview, { ttsVolume: 'new-source' })
  assert.equal(applied.document.conflicts.length, 1)
  assert.equal(applied.document.conflicts[0].sourceId, 'previous')
})
test('a late earlier preview cannot replace the token for a newer preview', async () => {
  const load = createLoader(), doc = load('main/settings-store/defaults').createDefaultDocument()
  let resolveFirst, calls = 0
  const controller = load('main/settings-ipc/import-preview').createSettingsImportController({ isAllowedSender: () => true,
    getStore: () => ({ read: () => ++calls === 1 ? new Promise(resolve => { resolveFirst = resolve }) : Promise.resolve({ status: 'ready', document: doc }), importLegacy: async () => ({ ok: true }) }),
  })
  const event = { sender: {}, senderFrame: {} }
  const first = controller.preview(event, [source('older', { themeMode: 'dark' })])
  const newer = await controller.preview(event, [source('newer', { themeMode: 'dark' })])
  resolveFirst({ status: 'ready', document: doc })
  assert.equal((await first).error, 'preview-expired')
  assert.equal((await controller.apply(event, { token: newer.preview.token, selections: { themeMode: 'newer' } })).ok, true)
})
