'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const Vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const load = createLoader()
const { PUBLIC_SETTINGS_DEFAULTS } = load('shared/settings-contracts')
const { availablePresetTargets, buildDataTransfer, parseDataTransfer, mergeDataTransferPresets } = load('renderer/services/data-transfer')
const sanitize = value => ({ ...value })
const preset = (id, label, source = 'user') => ({ id, label, source, steps: [] })
const local = JSON.stringify({ 'uta://models/a': [preset('seed', '默认', 'builtin'), preset('user-1', '开心')] })

test('backup excludes built-in presets and retains all public settings', () => {
  const text = buildDataTransfer(PUBLIC_SETTINGS_DEFAULTS, local, sanitize)
  const bundle = parseDataTransfer(text, sanitize)
  assert.equal(bundle.presets['uta://models/a'].length, 1)
  assert.equal(bundle.presets['uta://models/a'][0].id, 'user-1')
  assert.equal(bundle.settings.themeMode, PUBLIC_SETTINGS_DEFAULTS.themeMode)
  assert.equal(text.includes('apiKey'), false)
})

test('display names survive backup while older bundles default to host names', () => {
  const bundle = JSON.parse(buildDataTransfer({ ...PUBLIC_SETTINGS_DEFAULTS, chatDisplayName: '小鱼' }, local, sanitize))
  assert.equal(parseDataTransfer(JSON.stringify(bundle), sanitize).settings.chatDisplayName, '小鱼')
  delete bundle.settings.chatDisplayName
  assert.equal(parseDataTransfer(JSON.stringify(bundle), sanitize).settings.chatDisplayName, '')
  delete bundle.settings.themeMode
  assert.equal(parseDataTransfer(JSON.stringify(bundle), sanitize), null)
})

test('future versions, unknown fields, invalid settings and damaged current storage are rejected', () => {
  const base = JSON.parse(buildDataTransfer(PUBLIC_SETTINGS_DEFAULTS, local, sanitize))
  assert.equal(parseDataTransfer(JSON.stringify({ ...base, version: 3 }), sanitize), null)
  assert.equal(parseDataTransfer(JSON.stringify({ ...base, apiKey: 'secret' }), sanitize), null)
  assert.equal(parseDataTransfer(JSON.stringify({ ...base, settings: { ...base.settings, themeMode: 'bad' } }), sanitize), null)
  assert.equal(buildDataTransfer(PUBLIC_SETTINGS_DEFAULTS, '{broken', sanitize), null)
  assert.equal(availablePresetTargets('{broken', sanitize), null)
})

test('migration requires an initialized target and preserves existing IDs and names', () => {
  const incoming = { 'source': [preset('user-1', '冲突 ID'), preset('user-2', '开心'), preset('user-3', '挥手')] }
  assert.equal(mergeDataTransferPresets(local, incoming, { source: 'uta://models/b' }, new Set(['uta://models/b']), sanitize), null)
  const merged = mergeDataTransferPresets(local, incoming, { source: 'uta://models/a' }, new Set(['uta://models/a']), sanitize)
  assert.equal(merged.imported, 1)
  assert.equal(merged.skipped, 2)
  const result = JSON.parse(merged.text)['uta://models/a']
  assert.equal(result.length, 3)
  assert.equal(result[1].label, '开心')
  assert.equal(result[2].label, '挥手')
})

test('migration preserves unrecognized fields on existing presets and other model buckets', () => {
  const original = JSON.stringify({
    'uta://models/a': [{ ...preset('old', '原动作'), extraFromFuture: { value: 3 } }],
    'uta://models/b': [{ ...preset('other', '其他'), extraFromFuture: true }],
  })
  const merged = mergeDataTransferPresets(original, { source: [preset('new', '新动作')] },
    { source: 'uta://models/a' }, new Set(['uta://models/a']), sanitize)
  const result = JSON.parse(merged.text)
  assert.equal(result['uta://models/a'][0].extraFromFuture.value, 3)
  assert.equal(result['uta://models/b'][0].extraFromFuture, true)
  assert.equal(result['uta://models/a'][1].id, 'new')
})

test('unselected source buckets are skipped and unknown target paths are rejected', () => {
  const incoming = { source: [preset('one', '一个')] }
  assert.equal(mergeDataTransferPresets(local, incoming, {}, new Set(), sanitize).skipped, 1)
  assert.equal(mergeDataTransferPresets(local, incoming, { source: 'unknown' }, new Set(['uta://models/a']), sanitize), null)
})

test('versioned backups include content-bound calibration and still read version 1', () => {
  const signature = 'uta-live2d-assets-v1:' + 'a'.repeat(64)
  const calibrations = { [signature]: [{ channel: 'headX', parameterId: 'Custom', direction: 'normal', strength: 0.5 }] }
  const backup = buildDataTransfer(PUBLIC_SETTINGS_DEFAULTS, local, sanitize, calibrations)
  assert.equal(parseDataTransfer(backup, sanitize).calibrations[signature][0].parameterId, 'Custom')
  const old = JSON.parse(backup); old.version = 1; delete old.calibrations
  assert.equal(Object.keys(parseDataTransfer(JSON.stringify(old), sanitize).calibrations).length, 0)
  assert.equal(buildDataTransfer(PUBLIC_SETTINGS_DEFAULTS, local, sanitize, { broken: [] }), null)
})

function panelHarness(options = {}) {
  let raw = local, revision = 1, backupOk = true
  const calls = []
  const incoming = JSON.stringify(options.incoming || {
    kind: 'uta-data-transfer', version: 1, settings: { ...PUBLIC_SETTINGS_DEFAULTS, themeMode: 'dark' },
    presets: { 'uta://models/a': [preset('new', '挥手')] },
  })
  const api = {
    importSettingsTransfer: async () => ({ ok: true, text: incoming }),
    backupSettingsTransfer: async text => { calls.push(['backup', text]); return { ok: backupOk } },
    readModelCalibrations: async () => ({ ok: true, models: {} }),
    mergeModelCalibrations: async payload => { calls.push(['calibration', structuredClone(payload)]); return { ok: true, imported: 1, skipped: 0 } },
  }
  const storage = { getItem: () => raw, setItem: (_key, value) => { calls.push(['preset', value]); raw = value } }
  const settings = {
    getCurrentSettings: () => ({ ...PUBLIC_SETTINGS_DEFAULTS }),
    getCurrentRevision: () => revision,
    patch: async changes => { calls.push(['patch', changes]); return { ok: true } },
  }
  const file = path.resolve(__dirname, '../src/renderer/settings-window/SettingsTransferPanel.vue')
  const code = ts.transpileModule(compileScript(parse(fs.readFileSync(file, 'utf8'), { filename: file }).descriptor, { id: 'transfer-test' }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const imports = {
    '../../shared/settings-contracts': load('shared/settings-contracts'),
    '../stores/deskpet': { sanitizePresetObject: sanitize, useDeskpetStore: () => ({ reloadPersistedUiState() {} }) },
    '../services/settings-client': { settingsClient: settings },
    '../services/preset-persistence': load('renderer/services/preset-persistence'),
    '../services/data-transfer': load('renderer/services/data-transfer'),
    '../services/live2d/model-discovery': { listAvailableModels: async () => [{ url: 'uta://models/a', name: 'A' }] },
    '../services/unsaved-drafts': { hasUnsavedDraft: Vue.ref(false) },
    './legacy-preferences': load('renderer/settings-window/legacy-preferences'),
  }
  const mod = { exports: {} }
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports, require: id => id === 'vue' ? Vue : imports[id],
    window: { utaAPI: api }, localStorage: storage, console,
  }, { filename: file })
  const scope = Vue.effectScope()
  const state = scope.run(() => mod.exports.default.setup({ disabled: false }, { expose() {}, emit() {} }))
  return { state, calls, stop: () => scope.stop(), setBackupOk: v => { backupOk = v }, setRaw: v => { raw = v }, getRaw: () => raw, setRevision: v => { revision = v } }
}

test('actual transfer panel backs up before applying selected settings and additive presets', async () => {
  const h = panelHarness()
  try {
    await h.state.chooseData()
    h.state.selectedSettings.value.themeMode = true
    await h.state.applyData()
    assert.deepEqual(h.calls.map(call => call[0]), ['backup', 'patch', 'preset'])
    assert.equal(h.calls[1][1].themeMode, 'dark')
    assert.equal(JSON.parse(h.getRaw())['uta://models/a'].some(p => p.id === 'new'), true)
  } finally { h.stop() }
})

test('actual transfer panel refuses mutation when backup fails or preview becomes stale', async () => {
  for (const failure of ['backup', 'revision', 'storage']) {
    const h = panelHarness()
    try {
      await h.state.chooseData()
      h.state.selectedSettings.value.themeMode = true
      if (failure === 'backup') h.setBackupOk(false)
      if (failure === 'revision') h.setRevision(2)
      if (failure === 'storage') h.setRaw('{}')
      await h.state.applyData()
      assert.equal(h.calls.some(call => call[0] === 'patch' || call[0] === 'preset'), false)
    } finally { h.stop() }
  }
})

test('actual transfer panel backs up before importing explicitly selected calibration', async () => {
  const signature = 'uta-live2d-assets-v1:' + 'b'.repeat(64)
  const h = panelHarness({ incoming: { kind: 'uta-data-transfer', version: 2, settings: PUBLIC_SETTINGS_DEFAULTS,
    presets: {}, calibrations: { [signature]: [{ channel: 'headX', parameterId: 'Head', direction: 'reversed', strength: 0.5 }] } } })
  try {
    await h.state.chooseData()
    h.state.selectedCalibrations.value = true
    await h.state.applyData()
    assert.deepEqual(h.calls.map(call => call[0]), ['backup', 'calibration'])
    assert.equal(h.calls[1][1].models[signature][0].direction, 'reversed')
    assert.match(h.state.message.value, /新增 1 份校准/)
    assert.match(h.state.message.value, /重新加载桌宠窗口或重新选择模型后生效/)
  } finally { h.stop() }
})
