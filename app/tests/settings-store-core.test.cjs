'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test, describe, beforeEach, afterEach } = require('node:test')

function loadTs(filePath, cache = new Map()) {
  let resolvedPath = path.resolve(__dirname, filePath)
  if (!fs.existsSync(resolvedPath)) {
    if (fs.existsSync(resolvedPath + '.ts')) {
      resolvedPath += '.ts'
    } else if (fs.existsSync(path.join(resolvedPath, 'index.ts'))) {
      resolvedPath = path.join(resolvedPath, 'index.ts')
    }
  }

  if (cache.has(resolvedPath)) {
    return cache.get(resolvedPath)
  }

  const source = fs.readFileSync(resolvedPath, 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText

  const mod = { exports: {} }
  cache.set(resolvedPath, mod.exports)

  const customRequire = (id) => {
    if (id.startsWith('.')) {
      const target = path.resolve(path.dirname(resolvedPath), id)
      return loadTs(target, cache)
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
  })

  return mod.exports
}

const {
  validateSingleField,
  validateChanges,
  validateDocument,
  isSettingsKey,
  SETTINGS_KEYS,
} = loadTs('../src/main/settings-store/validator.ts')

const {
  createDefaultDocument,
  cloneDocument,
} = loadTs('../src/main/settings-store/defaults.ts')

const {
  createSettingsStore,
} = loadTs('../src/main/settings-store/index.ts')

describe('Settings Validator & Defaults', () => {
  test('public settings keys are recognized and bounded', () => {
    assert.equal(SETTINGS_KEYS.length, 13)
    assert.equal(isSettingsKey('chatDisplayName'), true)
    assert.equal(isSettingsKey('themeMode'), true)
    assert.equal(isSettingsKey('ttsVolume'), true)
    assert.equal(isSettingsKey('apiKey'), false)
    assert.equal(isSettingsKey('directory'), false)
  })

  test('validates single field boundaries strictly without clamping', () => {
    assert.equal(validateSingleField('ttsVolume', 0.8).ok, true)
    assert.equal(validateSingleField('ttsVolume', 0).ok, true)
    assert.equal(validateSingleField('ttsVolume', 1).ok, true)
    assert.equal(validateSingleField('ttsVolume', 80).ok, false)
    assert.equal(validateSingleField('ttsVolume', -0.1).ok, false)
    assert.equal(validateSingleField('ttsVolume', 1.05).ok, false)
    assert.equal(validateSingleField('ttsVolume', NaN).ok, false)
    assert.equal(validateSingleField('ttsVolume', Infinity).ok, false)

    assert.equal(validateSingleField('ttsRate', 1).ok, true)
    assert.equal(validateSingleField('ttsRate', 0.5).ok, true)
    assert.equal(validateSingleField('ttsRate', 2.0).ok, true)
    assert.equal(validateSingleField('ttsRate', 0.4).ok, false)
    assert.equal(validateSingleField('ttsRate', 2.1).ok, false)

    const hexRes = validateSingleField('accentColor', '#AABB00')
    assert.equal(hexRes.ok, true)
    if (hexRes.ok) {
      assert.equal(hexRes.value, '#aabb00')
    }
    assert.equal(validateSingleField('accentColor', 'blue').ok, false)

    assert.equal(validateSingleField('themeMode', 'dark').ok, true)
    assert.equal(validateSingleField('themeMode', 'blue').ok, false)
    assert.equal(validateSingleField('ttsProvider', 'cloud').ok, true)
    assert.equal(validateSingleField('ttsProvider', 'openai').ok, false)

    assert.equal(validateSingleField('ttsEnabled', true).ok, true)
    assert.equal(validateSingleField('ttsEnabled', 'true').ok, false)
  })

  test('validates patch changes: rejects unknown fields, empty changes and prototype poisoning', () => {
    const p1 = validateChanges({ ttsVolume: 0.5, themeMode: 'dark', accentColor: '#0071E3' })
    assert.equal(p1.ok, true)
    if (p1.ok) {
      assert.equal(p1.value.accentColor, '#0071e3')
      assert.equal(p1.value.ttsVolume, 0.5)
      assert.equal(p1.value.themeMode, 'dark')
    }

    assert.equal(validateChanges({}).ok, false)
    assert.equal(validateChanges({ apiKey: 'secret' }).ok, false)
    assert.equal(validateChanges(null).ok, false)
    assert.equal(validateChanges([]).ok, false)

    const poisoned = JSON.parse('{"__proto__":{"polluted":true},"ttsVolume":0.5}')
    assert.equal(validateChanges(poisoned).ok, false)
  })

  test('createDefaultDocument generates safe un-claimed document with revision 0', () => {
    const doc = createDefaultDocument()
    assert.equal(doc.schemaVersion, 1)
    assert.equal(doc.revision, 0)
    assert.equal(doc.claimedKeys.length, 0)
    assert.equal(doc.imports.length, 0)
    assert.equal(doc.conflicts.length, 0)
    assert.equal(doc.values.ttsVolume, 0.8)
    assert.equal(doc.values.themeMode, 'light')

    const cloned = cloneDocument(doc)
    cloned.values.ttsVolume = 0.2
    cloned.claimedKeys.push('ttsVolume')
    assert.equal(doc.values.ttsVolume, 0.8)
    assert.equal(doc.claimedKeys.length, 0)
  })

  test('validateDocument enforces complete settings and schema checks', () => {
    const defaultDoc = createDefaultDocument()
    const validRes = validateDocument(defaultDoc)
    assert.equal(validRes.ok, true)

    const incomplete = { ...defaultDoc, values: { ...defaultDoc.values } }
    delete incomplete.values.themeMode
    assert.equal(validateDocument(incomplete).ok, false)

    const futureDoc = { ...defaultDoc, schemaVersion: 2 }
    const futureRes = validateDocument(futureDoc)
    assert.equal(futureRes.ok, false)
    assert.equal(futureRes.isFutureSchema, true)

    const negRevDoc = { ...defaultDoc, revision: -1 }
    assert.equal(validateDocument(negRevDoc).ok, false)
  })

  test('old v1 settings gain an unclaimed display name without accepting other missing fields', () => {
    const old = createDefaultDocument()
    old.values.themeMode = 'dark'
    delete old.values.chatDisplayName
    const result = validateDocument(old)
    assert.equal(result.ok, true)
    assert.equal(result.value.values.chatDisplayName, '')
    assert.equal(result.value.values.themeMode, 'dark')
    assert.equal(result.value.claimedKeys.includes('chatDisplayName'), false)
    old.claimedKeys.push('chatDisplayName')
    assert.equal(validateDocument(old).ok, false, 'a lost claimed name must not be reset')
    assert.equal(validateSingleField('chatDisplayName', '  小鱼  ').value, '  小鱼  ')
    for (const invalid of [null, true, 'a'.repeat(41), 'a\nb', 'a\0b']) {
      assert.equal(validateSingleField('chatDisplayName', invalid).ok, false)
    }
  })
})

describe('SettingsStore Core Behavior & Durability', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-settings-test-'))
  })

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch {}
    }
  })

  test('directory validation: rejects relative and non-existent paths, prevents duplicate opens', async () => {
    await assert.rejects(
      async () => createSettingsStore('relative/dir'),
      /Directory must be an absolute path/
    )

    await assert.rejects(
      async () => createSettingsStore(path.join(tmpDir, 'does-not-exist')),
      /Directory does not exist/
    )

    const store1 = await createSettingsStore(tmpDir)
    await assert.rejects(
      async () => createSettingsStore(tmpDir),
      /Settings store already open for directory/
    )

    await store1.close()

    // Can reopen after close
    const store2 = await createSettingsStore(tmpDir)
    assert.ok(store2)
    await store2.close()
  })

  test('first read does NOT write to disk, returns default revision 0', async () => {
    const store = await createSettingsStore(tmpDir)
    const state = await store.read()
    assert.equal(state.status, 'ready')
    if (state.status === 'ready') {
      assert.equal(state.document.revision, 0)
      assert.equal(state.document.values.themeMode, 'light')
      assert.equal(state.document.values.ttsVolume, 0.8)
      assert.equal(state.document.claimedKeys.length, 0)
    }

    // Verify disk has no settings file
    const mainFile = path.join(tmpDir, 'settings.v1.json')
    assert.equal(fs.existsSync(mainFile), false)

    await store.close()
  })

  test('patch updates values, increments revision, updates claimedKeys and writes atomically', async () => {
    const store = await createSettingsStore(tmpDir)

    const res = await store.patch({
      expectedRevision: 0,
      changes: { ttsVolume: 0.6, themeMode: 'dark' }
    })

    assert.equal(res.ok, true)
    if (res.ok) {
      assert.equal(res.changed, true)
      assert.equal(res.document.revision, 1)
      assert.equal(res.document.values.ttsVolume, 0.6)
      assert.equal(res.document.values.themeMode, 'dark')
      assert.equal(res.document.claimedKeys.length, 2)
      assert.equal(res.document.claimedKeys[0], 'themeMode')
      assert.equal(res.document.claimedKeys[1], 'ttsVolume')
    }

    // File on disk exists and contains revision 1
    const mainFile = path.join(tmpDir, 'settings.v1.json')
    assert.equal(fs.existsSync(mainFile), true)
    const onDisk = JSON.parse(fs.readFileSync(mainFile, 'utf8'))
    assert.equal(onDisk.revision, 1)
    assert.equal(onDisk.values.ttsVolume, 0.6)

    // Second write creates backup of revision 1!
    const res2 = await store.patch({
      expectedRevision: 1,
      changes: { accentColor: '#123456' }
    })
    assert.equal(res2.ok, true)
    if (res2.ok) {
      assert.equal(res2.document.revision, 2)
    }

    const backupFile = path.join(tmpDir, 'settings.v1.backup.json')
    assert.equal(fs.existsSync(backupFile), true)
    const backupOnDisk = JSON.parse(fs.readFileSync(backupFile, 'utf8'))
    assert.equal(backupOnDisk.revision, 1)
    assert.equal(backupOnDisk.values.ttsVolume, 0.6)

    await store.close()
  })

  test('revision conflict rejects concurrent or stale patches without disk writes', async () => {
    const store = await createSettingsStore(tmpDir)

    // Stale expectedRevision
    const staleRes = await store.patch({
      expectedRevision: 5,
      changes: { ttsVolume: 0.2 }
    })
    assert.equal(staleRes.ok, false)
    if (!staleRes.ok) {
      assert.equal(staleRes.code, 'revision-conflict')
      assert.equal(staleRes.currentRevision, 0)
    }

    // Concurrent patches both with expectedRevision 0: only first succeeds
    const [p1, p2] = await Promise.all([
      store.patch({ expectedRevision: 0, changes: { ttsVolume: 0.4 } }),
      store.patch({ expectedRevision: 0, changes: { ttsVolume: 0.5 } })
    ])

    assert.equal(p1.ok, true)
    assert.equal(p2.ok, false)
    if (!p2.ok) {
      assert.equal(p2.code, 'revision-conflict')
      assert.equal(p2.currentRevision, 1)
    }

    await store.close()
  })

  test('no-op patch does not bump revision, does not write to disk, does not notify', async () => {
    const store = await createSettingsStore(tmpDir)

    // Claim ttsVolume first
    await store.patch({ expectedRevision: 0, changes: { ttsVolume: 0.8 } })

    let notifications = 0
    store.subscribe(() => {
      notifications++
    })

    // Now patch with exact same value already claimed
    const noopRes = await store.patch({
      expectedRevision: 1,
      changes: { ttsVolume: 0.8 }
    })

    assert.equal(noopRes.ok, true)
    if (noopRes.ok) {
      assert.equal(noopRes.changed, false)
      assert.equal(noopRes.document.revision, 1)
    }

    // Wait microtasks
    await new Promise((r) => setImmediate(r))
    assert.equal(notifications, 0)

    await store.close()
  })

  test('listener error does not affect other listeners and async read inside listener does not deadlock', async () => {
    const store = await createSettingsStore(tmpDir)

    let l1Called = false
    let l2Called = false
    let readInListenerWorked = false

    store.subscribe(() => {
      l1Called = true
      throw new Error('Listener crash test')
    })

    store.subscribe((doc) => {
      l2Called = true
      // Async re-entrant read
      store.read().then((st) => {
        if (st.status === 'ready' && st.document.revision === doc.revision) {
          readInListenerWorked = true
        }
      })
    })

    await store.patch({
      expectedRevision: 0,
      changes: { gazeFollowEnabled: false }
    })

    // Wait for microtasks and async read to complete
    await new Promise((r) => setTimeout(r, 50))

    assert.equal(l1Called, true)
    assert.equal(l2Called, true)
    assert.equal(readInListenerWorked, true)

    await store.close()
  })

  test('I/O fault injection: failure during write preserves in-memory state and cleans up temp files', async () => {
    let failWrite = false
    const store = await createSettingsStore(tmpDir, {
      io: {
        async writeFile(p, d, enc) {
          if (failWrite && p.includes('.tmp.')) {
            throw new Error('Simulated disk write failure')
          }
          const fsPromises = require('node:fs/promises')
          const handle = await fsPromises.open(p, 'w')
          try {
            await handle.writeFile(d, { encoding: enc })
            await handle.sync()
          } finally {
            await handle.close()
          }
        }
      }
    })

    // Normal first patch
    await store.patch({ expectedRevision: 0, changes: { ttsVolume: 0.5 } })

    // Inject failure
    failWrite = true
    const failRes = await store.patch({ expectedRevision: 1, changes: { ttsVolume: 0.1 } })

    assert.equal(failRes.ok, false)
    if (!failRes.ok) {
      assert.equal(failRes.code, 'io-error')
      assert.equal(failRes.currentRevision, 1)
    }

    // In-memory state remains at revision 1
    const st = await store.read()
    assert.equal(st.status, 'ready')
    if (st.status === 'ready') {
      assert.equal(st.document.revision, 1)
      assert.equal(st.document.values.ttsVolume, 0.5)
    }

    // Check no temp files left in directory
    const files = fs.readdirSync(tmpDir)
    const tmpFiles = files.filter((f) => f.includes('.tmp.'))
    assert.equal(tmpFiles.length, 0)

    await store.close()
  })

  test('corruption and future schema handling: returns blocked state, preserves original bytes', async () => {
    const mainFile = path.join(tmpDir, 'settings.v1.json')
    const badJson = '{"corrupted": true, not valid json'
    fs.writeFileSync(mainFile, badJson, 'utf8')

    const store = await createSettingsStore(tmpDir)
    const st = await store.read()
    assert.equal(st.status, 'blocked')
    if (st.status === 'blocked') {
      assert.equal(st.reason, 'corrupt')
      assert.equal(st.backupAvailable, false)
    }

    // Attempting to patch blocked store fails with store-blocked
    const patchRes = await store.patch({ expectedRevision: 0, changes: { ttsVolume: 0.5 } })
    assert.equal(patchRes.ok, false)
    if (!patchRes.ok) {
      assert.equal(patchRes.code, 'store-blocked')
    }

    // Original corrupt file remains intact
    assert.equal(fs.readFileSync(mainFile, 'utf8'), badJson)

    await store.close()
  })

  test('missing main with existing backup is blocked and does NOT overwrite with defaults', async () => {
    const backupFile = path.join(tmpDir, 'settings.v1.backup.json')
    const validDoc = createDefaultDocument()
    validDoc.revision = 3
    fs.writeFileSync(backupFile, JSON.stringify(validDoc, null, 2), 'utf8')

    const store = await createSettingsStore(tmpDir)
    const st = await store.read()
    assert.equal(st.status, 'blocked')
    if (st.status === 'blocked') {
      assert.equal(st.reason, 'corrupt')
      assert.equal(st.backupAvailable, true)
    }

    // Main file was NOT created
    assert.equal(fs.existsSync(path.join(tmpDir, 'settings.v1.json')), false)

    await store.close()
  })
})
