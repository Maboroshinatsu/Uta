'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

function loadTs(file, cache = new Map()) {
  file = path.resolve(file)
  if (!file.endsWith('.ts')) file = fs.existsSync(file + '.ts') ? file + '.ts' : path.join(file, 'index.ts')
  if (cache.has(file)) return cache.get(file)
  const mod = { exports: {} }
  cache.set(file, mod.exports)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, { module: mod, exports: mod.exports, Buffer, queueMicrotask, console,
    require: id => id.startsWith('.') ? loadTs(path.resolve(path.dirname(file), id), cache) : require(id),
  })
  return mod.exports
}
const sourceRoot = path.resolve(__dirname, '../src/main/settings-store')
const { createSettingsStore } = loadTs(path.join(sourceRoot, 'index.ts'))
const { createDefaultDocument } = loadTs(path.join(sourceRoot, 'defaults.ts'))
const { validateDocument } = loadTs(path.join(sourceRoot, 'validator.ts'))
const { defaultIoHooks } = loadTs(path.join(sourceRoot, 'atomic-writer.ts'))
const plain = value => JSON.parse(JSON.stringify(value))
const mainFile = dir => path.join(dir, 'settings.v1.json')
const backupFile = dir => path.join(dir, 'settings.v1.backup.json')
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-review-'))
  const stores = []
  t.after(async () => { for (const store of stores) await store.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  return { dir, async open(options) { const store = await createSettingsStore(dir, options); stores.push(store); return store } }
}

test('unreadable main or backup metadata blocks instead of starting from defaults', async t => {
  for (const filename of ['settings.v1.json', 'settings.v1.backup.json']) {
    const c = setup(t)
    const store = await c.open({ io: { async stat(file) {
      if (path.basename(file) === filename) throw Object.assign(new Error('fixture access denied'), { code: 'EACCES' })
      return defaultIoHooks.stat(file)
    } } })
    assert.deepEqual(plain(await store.read()), { status: 'blocked', reason: 'io-error', backupAvailable: false })
    assert.equal((await store.patch({ expectedRevision: 0, changes: { ttsVolume: 0.2 } })).code, 'store-blocked')
    assert.equal(fs.existsSync(mainFile(c.dir)), false)
  }
})
test('a directory at the main settings filename is corrupt, never a first launch', async t => {
  const c = setup(t)
  fs.mkdirSync(mainFile(c.dir))
  const store = await c.open()
  assert.equal((await store.read()).status, 'blocked')
})
test('Windows case aliases and filesystem aliases cannot open a second writer', async t => {
  const c = setup(t)
  await c.open()
  if (process.platform === 'win32') await assert.rejects(createSettingsStore(c.dir.toUpperCase()), /already open/)
  const alias = path.join(c.dir, 'alias')
  fs.symlinkSync(c.dir, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(createSettingsStore(alias), /already open/)
})
test('patch and import reject unknown envelope/source keys, getters, symbols and invalid revisions', async t => {
  const c = setup(t), store = await c.open()
  for (const extra of [{ directory: 'fixture' }, { padding: 'x'.repeat(1024 * 1024) }, { [Symbol('x')]: true }]) {
    assert.equal((await store.patch({ expectedRevision: 0, changes: { ttsVolume: 0.4 }, ...extra })).code, 'invalid-request')
    assert.equal((await store.importLegacy({ expectedRevision: 0, sources: [{ sourceId: 'old.a', values: { ttsVolume: 0.4 } }], ...extra })).code, 'invalid-request')
  }
  assert.equal((await store.importLegacy({ expectedRevision: 0, sources: [{ sourceId: 'old.a', values: { ttsVolume: 0.4 }, extra: true }] })).code, 'invalid-request')
  assert.equal((await store.patch({ expectedRevision: -1, changes: { ttsVolume: 0.4 } })).code, 'invalid-request')
  let getterCalled = false
  const changes = Object.defineProperty({}, 'ttsVolume', { enumerable: true, get() { getterCalled = true; throw Error('must not run') } })
  assert.equal((await store.patch({ expectedRevision: 0, changes })).code, 'invalid-request')
  assert.equal(getterCalled, false)
  assert.equal((await store.read()).document.revision, 0)
})
test('queued mutations snapshot caller data before it can change', async t => {
  const c = setup(t), store = await c.open()
  const patch = { expectedRevision: 0, changes: { ttsVolume: 0.3 } }
  const pending = store.patch(patch)
  patch.changes.ttsVolume = 0.9
  assert.equal((await pending).document.values.ttsVolume, 0.3)
  const request = { expectedRevision: 1, sources: [{ sourceId: 'old.a', values: { themeMode: 'dark' } }] }
  const imported = store.importLegacy(request)
  request.sources[0].values.themeMode = 'light'
  assert.equal((await imported).document.values.themeMode, 'dark')
})
test('an unsubscribe during notification cancels an already queued callback', async t => {
  const c = setup(t), store = await c.open()
  let calls = 0, cancel
  store.subscribe(() => cancel())
  cancel = store.subscribe(() => { calls++ })
  await store.patch({ expectedRevision: 0, changes: { ttsVolume: 0.5 } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 0)
})
test('document rejects unknown metadata, duplicate receipts and orphan/duplicate conflicts', () => {
  const initial = plain(createDefaultDocument())
  assert.equal(validateDocument({ ...initial, secret: 'fixture' }).ok, false)
  const receipt = { sourceId: 'old.a', digest: 'a'.repeat(64) }
  assert.equal(validateDocument({ ...initial, imports: [receipt, receipt] }).ok, false)
  assert.equal(validateDocument({ ...initial, imports: [{ ...receipt, extra: true }] }).ok, false)
  const conflict = { key: 'ttsVolume', sourceId: 'old.a', sourceDigest: receipt.digest, current: 0.8, incoming: 0.4 }
  assert.equal(validateDocument({ ...initial, conflicts: [conflict] }).ok, false)
  const valid = { ...initial, claimedKeys: ['ttsVolume'], imports: [receipt], conflicts: [conflict] }
  assert.equal(validateDocument(valid).ok, true)
  assert.equal(validateDocument({ ...valid, conflicts: [conflict, conflict] }).ok, false)
})
test('exclusive creation refuses existing temporary files without truncation', async t => {
  const c = setup(t), filename = path.join(c.dir, 'existing.tmp')
  fs.writeFileSync(filename, 'keep')
  await assert.rejects(defaultIoHooks.writeFile(filename, 'replace', 'utf8'), { code: 'EEXIST' })
  assert.equal(fs.readFileSync(filename, 'utf8'), 'keep')
})
for (const stage of ['main-write', 'backup-write', 'backup-rename', 'main-rename', 'main-stat']) {
  test(`failure at ${stage} preserves committed bytes, memory and events`, async t => {
    const c = setup(t)
    let failing = false
    const failure = () => { throw Object.assign(new Error('fixture IO failure'), { code: 'EACCES' }) }
    const store = await c.open({ io: {
      async stat(p) { if (failing && stage === 'main-stat' && path.basename(p) === 'settings.v1.json') failure(); return defaultIoHooks.stat(p) },
      async writeFile(p, text, encoding) {
        if (failing && ((stage === 'main-write' && path.basename(p).startsWith('settings.v1.json.tmp.')) || (stage === 'backup-write' && p.includes('backup.json.tmp.')))) failure()
        return defaultIoHooks.writeFile(p, text, encoding)
      },
      async rename(from, to) {
        if (failing && ((stage === 'backup-rename' && path.basename(to) === 'settings.v1.backup.json') || (stage === 'main-rename' && path.basename(to) === 'settings.v1.json'))) failure()
        return fsp.rename(from, to)
      },
    } })
    await store.patch({ expectedRevision: 0, changes: { ttsVolume: 0.3 } })
    const before = fs.readFileSync(mainFile(c.dir), 'utf8')
    let events = 0; store.subscribe(() => { events++ }); failing = true
    assert.equal((await store.patch({ expectedRevision: 1, changes: { ttsVolume: 0.6 } })).code, 'io-error')
    assert.equal(fs.readFileSync(mainFile(c.dir), 'utf8'), before)
    assert.equal((await store.read()).document.revision, 1)
    assert.equal(events, 0)
    assert.equal(fs.readdirSync(c.dir).filter(name => name.includes('.tmp.')).length, 0)
  })
}
test('temporary collision never deletes the unrelated existing file', async t => {
  const c = setup(t)
  let collision
  const store = await c.open({ io: { async writeFile(p, data, enc) {
    collision = p; fs.writeFileSync(p, 'keep collision')
    return defaultIoHooks.writeFile(p, data, enc)
  } } })
  assert.equal((await store.patch({ expectedRevision: 0, changes: { ttsVolume: 0.5 } })).code, 'io-error')
  assert.equal(fs.readFileSync(collision, 'utf8'), 'keep collision')
})
test('future schema and invalid backup remain blocked without recovery writes', async t => {
  const c = setup(t)
  fs.writeFileSync(mainFile(c.dir), '{"schemaVersion":2}')
  fs.writeFileSync(backupFile(c.dir), 'broken')
  const store = await c.open()
  assert.deepEqual(plain(await store.read()), { status: 'blocked', reason: 'future-schema', backupAvailable: false })
  assert.equal((await store.patch({ expectedRevision: 0, changes: { ttsVolume: 0.5 } })).code, 'store-blocked')
  assert.equal(fs.readFileSync(mainFile(c.dir), 'utf8'), '{"schemaVersion":2}')
})
test('independent profiles, close queue and reopening retain only committed values', async t => {
  const a = setup(t), b = setup(t)
  const first = await a.open(), second = await b.open()
  const pending = first.patch({ expectedRevision: 0, changes: { ttsVolume: 0.2 } })
  const closed = first.close()
  const rejected = first.patch({ expectedRevision: 1, changes: { ttsVolume: 0.9 } })
  assert.equal((await pending).ok, true); await closed
  assert.equal((await rejected).code, 'closed')
  assert.equal((await first.read()).document.values.ttsVolume, 0.2)
  assert.equal((await second.read()).document.values.ttsVolume, 0.8)
  const reopened = await a.open()
  assert.equal((await reopened.read()).document.values.ttsVolume, 0.2)
})

test('a normal patch refuses to downgrade a file changed after startup', async t => {
  const c = setup(t), store = await c.open()
  const initial = plain((await store.read()).document)
  const revision = initial.revision

  fs.writeFileSync(mainFile(c.dir), JSON.stringify({ schemaVersion: 2 }))
  assert.equal(
    (await store.patch({ expectedRevision: revision, changes: { ttsVolume: 0.2 } })).code,
    'store-blocked',
  )
  assert.equal(JSON.parse(fs.readFileSync(mainFile(c.dir), 'utf8')).schemaVersion, 2)

  const external = {
    ...initial,
    revision: revision + 1,
    values: { ...initial.values, ttsVolume: 0.7 },
  }
  fs.writeFileSync(mainFile(c.dir), JSON.stringify(external))
  assert.equal(
    (await store.patch({ expectedRevision: revision, changes: { ttsVolume: 0.3 } })).code,
    'revision-conflict',
  )
  assert.equal(JSON.parse(fs.readFileSync(mainFile(c.dir), 'utf8')).values.ttsVolume, 0.7)
})

test('revision exhaustion rejects changes but permits true patch/import no-ops', async t => {
  const c = setup(t), document = plain(createDefaultDocument())
  const values = { ttsVolume: 0.8 }
  const digest = require('node:crypto').createHash('sha256').update(JSON.stringify(values)).digest('hex')
  Object.assign(document, { revision: Number.MAX_SAFE_INTEGER, claimedKeys: ['ttsVolume'], imports: [{ sourceId: 'old.a', digest }] })
  fs.writeFileSync(mainFile(c.dir), JSON.stringify(document))
  const before = fs.readFileSync(mainFile(c.dir), 'utf8'), store = await c.open()
  const same = await store.patch({ expectedRevision: document.revision, changes: values })
  assert.equal(same.ok, true); assert.equal(same.changed, false)
  const imported = await store.importLegacy({ expectedRevision: document.revision, sources: [{ sourceId: 'old.a', values }] })
  assert.equal(imported.ok, true); assert.equal(imported.changed, false)
  assert.equal((await store.patch({ expectedRevision: document.revision, changes: { ttsVolume: 0.1 } })).code, 'limit-reached')
  assert.equal(fs.readFileSync(mainFile(c.dir), 'utf8'), before)
})

test('128 conflict capacity aborts the entire import without committing a receipt or field', async t => {
  const c = setup(t), store = await c.open()
  await store.patch({ expectedRevision: 0, changes: plain(createDefaultDocument()).values })
  const alternate = { themeMode: 'dark', accentColor: '#123456', hoverFadeEnabled: true,
    gazeFollowEnabled: false, idleActionsEnabled: false, orbAction: 'toggle_theme',
    ttsEnabled: true, ttsProvider: 'system', ttsRate: 1.5, ttsVolume: 0.3, ttsSpeakNarration: true, ttsSpeakReplies: false }
  for (let index = 0; index < 10; index++) {
    assert.equal((await store.importLegacy({ expectedRevision: index + 1, sources: [{ sourceId: `old.${index}`, values: alternate }] })).ok, true)
  }
  assert.equal((await store.read()).document.conflicts.length, 120)
  const before = fs.readFileSync(mainFile(c.dir), 'utf8')
  const result = await store.importLegacy({ expectedRevision: 11, sources: [{ sourceId: 'old.overflow', values: alternate }] })
  assert.equal(result.code, 'limit-reached')
  assert.equal(fs.readFileSync(mainFile(c.dir), 'utf8'), before)
  assert.equal((await store.read()).document.imports.length, 10)
})

test('a symlinked settings file is blocked instead of following the link', async t => {
  const c = setup(t)
  const target = path.join(c.dir, 'outside.json')
  fs.writeFileSync(target, '{}')
  try {
    fs.symlinkSync(target, mainFile(c.dir), 'file')
  } catch (err) {
    if (err.code === 'EPERM') return t.skip('symlink creation not permitted')
    throw err
  }
  const store = await c.open()
  const state = await store.read()
  assert.equal(state.status, 'blocked')
  assert.equal(state.reason, 'corrupt')
  assert.equal(fs.readFileSync(target, 'utf8'), '{}')
})

test('symlink-shaped settings metadata is blocked without needing OS symlink rights', async t => {
  const c = setup(t)
  const store = await c.open({ io: {
    async stat(file) {
      if (path.basename(file) === 'settings.v1.json') {
        return { size: 64, isFile: () => false, isSymbolicLink: () => true }
      }
      return defaultIoHooks.stat(file)
    },
  } })
  const state = await store.read()
  assert.equal(state.status, 'blocked')
  assert.equal(state.reason, 'corrupt')
})
