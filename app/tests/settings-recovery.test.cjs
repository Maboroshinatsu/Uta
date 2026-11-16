'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { EventEmitter } = require('node:events')
const createLoader = require('./support/settings-loader.cjs')
const plain = value => JSON.parse(JSON.stringify(value))
const next = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }

async function setup(t, options = {}) {
  let clock = 1000
  class ClockDate extends Date { static now() { return clock } }
  const root = path.resolve(os.tmpdir()), directory = fs.mkdtempSync(path.join(root, 'uta-settings-recovery-'))
  const load = createLoader({}, { Date: ClockDate })
  const document = load('main/settings-store/defaults').createDefaultDocument()
  document.revision = 7; document.values.themeMode = 'dark'; document.values.ttsVolume = .3
  document.claimedKeys = ['themeMode', 'ttsVolume']
  const backup = Buffer.from(JSON.stringify(document)), original = Buffer.from([0xff, 0x00, 0xe3, 0x81, 0x7b, 0x2a])
  const mainFile = path.join(directory, 'settings.v1.json'), backupFile = path.join(directory, 'settings.v1.backup.json')
  if (!options.missingMain) fs.writeFileSync(mainFile, options.future ? JSON.stringify({ ...document, schemaVersion: 999 }) : original)
  fs.writeFileSync(backupFile, options.invalidBackup ? '{}' : backup)
  const store = await load('main/settings-store').createSettingsStore(directory, options.storeOptions)
  t.after(async () => { await store.close(); if (!directory.startsWith(path.join(root, 'uta-settings-recovery-'))) throw Error('unowned cleanup'); fs.rmSync(directory, { recursive: true, force: true }) })
  return { store, load, directory, document, backup, original, mainFile, backupFile, clock: value => { clock = value } }
}
test('recovery preview is read-only and reports a validated backup while the store remains blocked', async t => {
  const h = await setup(t), before = fs.readdirSync(h.directory)
  assert.equal((await h.store.read()).status, 'blocked')
  const result = await h.store.previewRecovery()
  assert.equal(result.available, true); assert.equal(result.backupRevision, 7); assert.equal(result.themeMode, 'dark')
  assert.deepEqual(fs.readdirSync(h.directory), before)
  assert.deepEqual(fs.readFileSync(h.mainFile), h.original)
})
test('restore preserves non-UTF8 original bytes and the valid backup, then reopens the live store', async t => {
  const h = await setup(t), events = []
  h.store.subscribe(doc => events.push(doc))
  const preview = await h.store.previewRecovery(), result = await h.store.restoreBackup(preview.token)
  assert.equal(result.ok, true); assert.equal(result.retainedOriginal, true)
  assert.deepEqual(fs.readFileSync(h.backupFile), h.backup)
  assert.deepEqual(fs.readFileSync(h.mainFile), h.backup)
  const archives = fs.readdirSync(h.directory).filter(file => file.includes('.recovery-original.'))
  assert.equal(archives.length, 1); assert.deepEqual(fs.readFileSync(path.join(h.directory, archives[0])), h.original)
  assert.equal(fs.readdirSync(h.directory).some(file => file.includes('recovery-tmp')), false)
  assert.equal((await h.store.read()).document.values.themeMode, 'dark')
  await next(); assert.equal(events.at(-1).revision, 7)
})
test('a missing main file can be restored from backup without inventing defaults', async t => {
  const h = await setup(t, { missingMain: true })
  const preview = await h.store.previewRecovery(), result = await h.store.restoreBackup(preview.token)
  assert.deepEqual(plain(result), { ok: true, retainedOriginal: false })
  assert.equal((await h.store.read()).document.revision, 7)
  assert.deepEqual(fs.readdirSync(h.directory).sort(), ['settings.v1.backup.json', 'settings.v1.json'])
})
test('future-schema settings never offer a downgrade recovery or replace the original', async t => {
  const h = await setup(t, { future: true }), before = fs.readFileSync(h.mainFile)
  assert.deepEqual(plain(await h.store.previewRecovery()), { available: false, reason: 'future-schema' })
  assert.equal((await h.store.restoreBackup('unknown')).code, 'future-schema')
  assert.deepEqual(fs.readFileSync(h.mainFile), before)
})
test('a file upgraded externally after startup or after preview is never downgraded by the cached corrupt state', async t => {
  for (const beforePreview of [true, false]) {
    const h = await setup(t)
    const future = Buffer.from(JSON.stringify({ ...h.document, schemaVersion: 999 }))
    const preview = beforePreview ? null : await h.store.previewRecovery()
    fs.writeFileSync(h.mainFile, future)
    if (preview) assert.equal((await h.store.restoreBackup(preview.token)).code, 'future-schema')
    else assert.equal((await h.store.previewRecovery()).reason, 'future-schema')
    assert.deepEqual(fs.readFileSync(h.mainFile), future)
    assert.equal(fs.readdirSync(h.directory).length, 2)
    assert.equal(await h.store.retryRead(), false)
    assert.equal((await h.store.read()).reason, 'future-schema')
  }
})
test('invalid backup, expired preview and consumed token never write replacement settings', async t => {
  const invalid = await setup(t, { invalidBackup: true })
  assert.equal((await invalid.store.previewRecovery()).available, false)
  const h = await setup(t), preview = await h.store.previewRecovery()
  h.clock(121001)
  assert.equal((await h.store.restoreBackup(preview.token)).code, 'preview-expired')
  assert.deepEqual(fs.readFileSync(h.mainFile), h.original)
  const current = await h.store.previewRecovery(); assert.equal((await h.store.restoreBackup(current.token)).ok, true)
  assert.equal((await h.store.restoreBackup(current.token)).ok, false)
})
test('changing either file after preview refuses recovery without overwriting the newer bytes', async t => {
  for (const target of ['mainFile', 'backupFile']) {
    const h = await setup(t), preview = await h.store.previewRecovery()
    const changed = target === 'mainFile' ? Buffer.from('new corrupt content') : Buffer.from(JSON.stringify({ ...h.document, revision: 8 }))
    fs.writeFileSync(h[target], changed)
    assert.equal((await h.store.restoreBackup(preview.token)).code, 'changed')
    assert.deepEqual(fs.readFileSync(h[target]), changed)
    assert.equal(fs.readdirSync(h.directory).length, 2)
  }
})
test('failed replacement leaves original and backup intact and cleans its own scratch files', async t => {
  const h = await setup(t, { storeOptions: { recoveryIo: { rename: async () => { throw Error('fixture rename failure') } } } })
  const preview = await h.store.previewRecovery()
  assert.equal((await h.store.restoreBackup(preview.token)).code, 'unavailable')
  assert.deepEqual(fs.readFileSync(h.mainFile), h.original)
  assert.deepEqual(fs.readFileSync(h.backupFile), h.backup)
  assert.equal(fs.readdirSync(h.directory).length, 2)
  assert.equal((await h.store.read()).status, 'blocked')
})
test('a partial scratch write is cleaned without deleting the invalid original', async t => {
  const io = createLoader()('main/settings-store/recovery').recoveryIo
  const h = await setup(t, { storeOptions: { recoveryIo: { async writeExclusive(file, bytes) {
    await io.writeExclusive(file, bytes)
    if (file.includes('.recovery-tmp.')) throw Error('fixture fsync failure')
  } } } })
  const preview = await h.store.previewRecovery()
  assert.equal((await h.store.restoreBackup(preview.token)).code, 'unavailable')
  assert.equal(fs.readdirSync(h.directory).length, 2)
  assert.deepEqual(fs.readFileSync(h.mainFile), h.original)
})
test('a last-moment external backup change aborts before replacement and preserves the external edit', async t => {
  const io = createLoader()('main/settings-store/recovery').recoveryIo
  let h
  h = await setup(t, { storeOptions: { recoveryIo: { async writeExclusive(file, bytes) {
    await io.writeExclusive(file, bytes)
    if (file.includes('.recovery-tmp.')) fs.writeFileSync(h.backupFile, JSON.stringify({ ...h.document, revision: 9 }))
  } } } })
  const preview = await h.store.previewRecovery()
  assert.equal((await h.store.restoreBackup(preview.token)).code, 'changed')
  assert.deepEqual(fs.readFileSync(h.mainFile), h.original)
  assert.equal(JSON.parse(fs.readFileSync(h.backupFile, 'utf8')).revision, 9)
  assert.equal(fs.readdirSync(h.directory).length, 2)
})
test('retry adopts a manually repaired current file but never defaults a formerly blocked empty directory', async t => {
  const repaired = await setup(t)
  fs.writeFileSync(repaired.mainFile, repaired.backup)
  assert.equal(await repaired.store.retryRead(), true)
  assert.equal((await repaired.store.read()).document.revision, 7)
  const removed = await setup(t)
  fs.unlinkSync(removed.mainFile); fs.unlinkSync(removed.backupFile)
  assert.equal(await removed.store.retryRead(), false)
  assert.equal((await removed.store.read()).status, 'blocked')
  assert.deepEqual(fs.readdirSync(removed.directory), [])
})
test('file-symlink metadata is rejected before the recovery reader opens its target', async t => {
  const h = await setup(t)
  let opened = 0
  const io = createLoader({ 'node:fs/promises': {
    ...require('node:fs/promises'), lstat: async () => ({ isFile: () => true, isSymbolicLink: () => true, size: 20 }),
    open: async () => { opened++; throw Error('must not open symlink') },
  } })('main/settings-store/recovery').recoveryIo
  await assert.rejects(io.read(h.backupFile, 1024 * 1024), /unreadable-file/)
  assert.equal(opened, 0); assert.deepEqual(fs.readFileSync(h.backupFile), h.backup)
})
test('an actual directory junction at the backup filename cannot redirect recovery into another directory', async t => {
  const h = await setup(t), target = path.join(h.directory, 'junction-target')
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'saved.json'), h.backup)
  fs.unlinkSync(h.backupFile)
  fs.symlinkSync(target, h.backupFile, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal((await h.store.previewRecovery()).available, false)
  assert.deepEqual(fs.readFileSync(path.join(target, 'saved.json')), h.backup)
})
test('controller validates sender/frame ownership, invalidates reloads and only broadcasts a confirmed restore', async () => {
  const sender = new EventEmitter(), frame = {}, event = { sender, senderFrame: frame }
  let restored = 0, notifications = 0
  const controller = createLoader()('main/settings-ipc/recovery').createSettingsRecoveryController({
    isAllowedSender: e => e.sender === sender && e.senderFrame === frame,
    getStore: () => ({ previewRecovery: async () => ({ available: true, token: 'fixture-token' }), restoreBackup: async () => { restored++; return { ok: true, retainedOriginal: true } } }),
    recovered: () => { notifications++ },
  })
  assert.equal((await controller.preview({ sender: {}, senderFrame: frame })).available, false)
  await controller.preview(event)
  assert.equal((await controller.restore({ sender, senderFrame: {} }, 'fixture-token')).code, 'unauthorized')
  sender.emit('did-start-navigation', {}, 'page', false, true)
  assert.equal((await controller.restore(event, 'fixture-token')).code, 'preview-expired')
  assert.equal(restored, 0)
  await controller.preview(event)
  assert.equal((await controller.restore(event, 'fixture-token')).ok, true)
  assert.equal(restored, 1); assert.equal(notifications, 1)
})
test('real blocked screen requires a separate confirmation and allows native clean close', async () => {
  const nodes = new Map(), root = { innerHTML: '' }, states = [], replies = []
  let restored = 0, retries = 0, closeListener
  const node = id => {
    if (id === 'app') return root
    if (!nodes.has(id)) nodes.set(id, { hidden: true, addEventListener(name, fn) { this[name] = fn }, focus() {} })
    return nodes.get(id)
  }
  const load = createLoader({}, { document: { getElementById: node }, window: { location: { hash: '#settings', search: '' }, utaAPI: {
    settingsRecovery: { preview: async () => ({ available: true, token: 'fixture', backupRevision: 7, themeMode: 'dark', ttsEnabled: false }),
      restore: async () => { restored++; return { ok: true } } },
    settingsWindow: { ready: async () => true, onCloseRequested: fn => { closeListener = fn; return () => states.push('unsubscribed') }, respond: async (...args) => replies.push(args) },
  } } })
  const dispose = load('renderer/settings-window/recovery-screen').renderSettingsRecoveryScreen(() => { retries++ })
  await next(); assert.match(root.innerHTML, /设置暂时无法读取/)
  node('review-settings-backup').click(); await next()
  assert.equal(node('settings-backup-review').hidden, false); assert.equal(restored, 0)
  node('cancel-settings-recovery').click(); assert.equal(restored, 0)
  node('review-settings-backup').click(); await next()
  node('confirm-settings-recovery').click(); await next()
  assert.equal(restored, 1); assert.equal(retries, 1)
  closeListener({ id: 8 }); await next(); assert.deepEqual(replies, [[8, 'close']])
  dispose(); assert.deepEqual(states, ['unsubscribed'])
})
