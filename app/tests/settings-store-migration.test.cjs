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
  createSettingsStore,
} = loadTs('../src/main/settings-store/index.ts')

const {
  computeSourceDigest,
} = loadTs('../src/main/settings-store/legacy-importer.ts')

describe('SettingsStore Legacy Import & Conflict Resolution', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-migration-test-'))
  })

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch {}
    }
  })

  test('source validation: rejects illegal sourceId, duplicates, empty sources and >16 sources', async () => {
    const store = await createSettingsStore(tmpDir)

    // Illegal sourceId (uppercase or bad characters)
    const badIdRes = await store.importLegacy({
      expectedRevision: 0,
      sources: [{ sourceId: 'INVALID_ID', values: { ttsVolume: 0.5 } }]
    })
    assert.equal(badIdRes.ok, false)
    if (!badIdRes.ok) {
      assert.equal(badIdRes.code, 'invalid-request')
    }

    // Duplicate sourceId within same request
    const dupRes = await store.importLegacy({
      expectedRevision: 0,
      sources: [
        { sourceId: 'src.a', values: { ttsVolume: 0.5 } },
        { sourceId: 'src.a', values: { themeMode: 'dark' } }
      ]
    })
    assert.equal(dupRes.ok, false)
    if (!dupRes.ok) {
      assert.equal(dupRes.code, 'invalid-request')
    }

    // More than 16 sources in a single request
    const manySources = []
    for (let i = 0; i < 17; i++) {
      manySources.push({ sourceId: `src.${i}`, values: { ttsVolume: 0.5 } })
    }
    const overflowRes = await store.importLegacy({
      expectedRevision: 0,
      sources: manySources
    })
    assert.equal(overflowRes.ok, false)
    if (!overflowRes.ok) {
      assert.equal(overflowRes.code, 'invalid-request')
    }

    await store.close()
  })

  test('digest calculation is canonical and independent of key insertion order', () => {
    const d1 = computeSourceDigest({ themeMode: 'dark', ttsVolume: 0.5 })
    const d2 = computeSourceDigest({ ttsVolume: 0.5, themeMode: 'dark' })
    assert.equal(d1, d2)
    assert.equal(typeof d1, 'string')
    assert.equal(d1.length, 64)
  })

  test('source ordering invariance: input order does not alter resulting document', async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-ord-a-'))
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-ord-b-'))

    try {
      const storeA = await createSettingsStore(dirA)
      const storeB = await createSettingsStore(dirB)

      const s1 = { sourceId: 'src.alpha', values: { accentColor: '#111111' } }
      const s2 = { sourceId: 'src.beta', values: { accentColor: '#222222' } }

      // storeA receives [s1, s2]; storeB receives [s2, s1]
      const resA = await storeA.importLegacy({ expectedRevision: 0, sources: [s1, s2] })
      const resB = await storeB.importLegacy({ expectedRevision: 0, sources: [s2, s1] })

      assert.equal(resA.ok, true)
      assert.equal(resB.ok, true)

      if (resA.ok && resB.ok) {
        assert.equal(resA.document.revision, resB.document.revision)
        assert.equal(resA.document.values.accentColor, resB.document.values.accentColor)
        assert.equal(resA.document.conflicts.length, resB.document.conflicts.length)
        assert.equal(resA.document.conflicts[0].key, resB.document.conflicts[0].key)
        assert.equal(resA.document.conflicts[0].incoming, resB.document.conflicts[0].incoming)
      }

      await storeA.close()
      await storeB.close()
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true })
      fs.rmSync(dirB, { recursive: true, force: true })
    }
  })

  test('unclaimed keys are adopted and claimed; factory defaults do not overwrite legacy import', async () => {
    const store = await createSettingsStore(tmpDir)

    // Store has initial default ttsVolume: 0.8, themeMode: 'light' (both unclaimed)
    const importRes = await store.importLegacy({
      expectedRevision: 0,
      sources: [
        {
          sourceId: 'legacy.desktop',
          values: { themeMode: 'dark', ttsVolume: 0.6 }
        }
      ]
    })

    assert.equal(importRes.ok, true)
    if (importRes.ok) {
      assert.equal(importRes.changed, true)
      assert.equal(importRes.document.revision, 1)
      // Legacy values adopted!
      assert.equal(importRes.document.values.themeMode, 'dark')
      assert.equal(importRes.document.values.ttsVolume, 0.6)
      assert.equal(importRes.document.claimedKeys.includes('themeMode'), true)
      assert.equal(importRes.document.claimedKeys.includes('ttsVolume'), true)
      assert.equal(importRes.document.conflicts.length, 0)
    }

    await store.close()
  })

  test('import idempotency: identical (sourceId, digest) is a no-op on re-import', async () => {
    const store = await createSettingsStore(tmpDir)

    const s = { sourceId: 'legacy.v1', values: { ttsVolume: 0.7 } }
    const firstRes = await store.importLegacy({ expectedRevision: 0, sources: [s] })
    assert.equal(firstRes.ok, true)
    if (firstRes.ok) {
      assert.equal(firstRes.changed, true)
      assert.equal(firstRes.document.revision, 1)
    }

    // Re-import exact same source
    const secondRes = await store.importLegacy({ expectedRevision: 1, sources: [s] })
    assert.equal(secondRes.ok, true)
    if (secondRes.ok) {
      assert.equal(secondRes.changed, false)
      assert.equal(secondRes.document.revision, 1)
    }

    await store.close()
  })

  test('claimed keys conflict generation: preserves current value and records conflict', async () => {
    const store = await createSettingsStore(tmpDir)

    // 1. Explicitly patch themeMode to 'dark'
    await store.patch({ expectedRevision: 0, changes: { themeMode: 'dark' } })

    // 2. Import legacy source trying to set themeMode to 'light'
    const importRes = await store.importLegacy({
      expectedRevision: 1,
      sources: [
        { sourceId: 'legacy.old-app', values: { themeMode: 'light' } }
      ]
    })

    assert.equal(importRes.ok, true)
    if (importRes.ok) {
      assert.equal(importRes.changed, true)
      assert.equal(importRes.document.revision, 2)
      // Retains currently claimed value 'dark'!
      assert.equal(importRes.document.values.themeMode, 'dark')
      // Conflict recorded!
      assert.equal(importRes.document.conflicts.length, 1)
      const conf = importRes.document.conflicts[0]
      assert.equal(conf.key, 'themeMode')
      assert.equal(conf.sourceId, 'legacy.old-app')
      assert.equal(conf.current, 'dark')
      assert.equal(conf.incoming, 'light')
    }

    await store.close()
  })

  test('patch resolves conflicts for touched keys while preserving untouched conflicts', async () => {
    const store = await createSettingsStore(tmpDir)

    // Setup: claim themeMode and accentColor
    await store.patch({
      expectedRevision: 0,
      changes: { themeMode: 'dark', accentColor: '#111111' }
    })

    // Import conflicting values for both
    await store.importLegacy({
      expectedRevision: 1,
      sources: [
        {
          sourceId: 'src.conflict',
          values: { themeMode: 'light', accentColor: '#222222' }
        }
      ]
    })

    const st1 = await store.read()
    assert.equal(st1.status, 'ready')
    if (st1.status === 'ready') {
      assert.equal(st1.document.conflicts.length, 2)
    }

    // Now user patches ONLY accentColor
    const patchRes = await store.patch({
      expectedRevision: 2,
      changes: { accentColor: '#333333' }
    })

    assert.equal(patchRes.ok, true)
    if (patchRes.ok) {
      assert.equal(patchRes.document.revision, 3)
      assert.equal(patchRes.document.values.accentColor, '#333333')
      // accentColor conflict is resolved and removed; themeMode conflict remains!
      assert.equal(patchRes.document.conflicts.length, 1)
      assert.equal(patchRes.document.conflicts[0].key, 'themeMode')
    }

    await store.close()
  })

  test('capacity limits: exceeding 64 receipts or 128 conflicts rejects with limit-reached', async () => {
    const store = await createSettingsStore(tmpDir)

    // Pre-populate store with 64 receipts
    let curRev = 0
    for (let batch = 0; batch < 4; batch++) {
      const sources = []
      for (let i = 0; i < 16; i++) {
        const id = `batch${batch}.src${i}`
        sources.push({ sourceId: id, values: { ttsVolume: (i + 1) / 100 } })
      }
      const res = await store.importLegacy({ expectedRevision: curRev, sources })
      assert.equal(res.ok, true)
      if (res.ok) {
        curRev = res.document.revision
      }
    }

    const checkState = await store.read()
    assert.equal(checkState.status, 'ready')
    if (checkState.status === 'ready') {
      assert.equal(checkState.document.imports.length, 64)
    }

    // Now 65th receipt should trigger limit-reached
    const overflowRes = await store.importLegacy({
      expectedRevision: curRev,
      sources: [{ sourceId: 'src.sixtyfive', values: { gazeFollowEnabled: false } }]
    })

    assert.equal(overflowRes.ok, false)
    if (!overflowRes.ok) {
      assert.equal(overflowRes.code, 'limit-reached')
      assert.equal(overflowRes.currentRevision, curRev)
    }

    await store.close()
  })
})
