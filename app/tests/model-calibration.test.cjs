'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const Vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const load = require('./support/settings-loader.cjs')()
const { createModelCalibration } = load('main/model-calibration')
const signature = 'uta-live2d-assets-v1:' + 'a'.repeat(64)
const entry = { channel: 'headX', parameterId: 'CustomHead', direction: 'reversed', strength: 0.4 }
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-calibration-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
test('calibration is bound to exact model content and isolated by profile', t => {
  const a = tempDir(t), b = tempDir(t), store = createModelCalibration(a)
  assert.equal(store.write(signature, [entry], []), true)
  assert.equal(store.get(signature)[0].parameterId, 'CustomHead')
  assert.equal(store.get('uta-live2d-assets-v1:' + 'b'.repeat(64)).length, 0)
  assert.equal(createModelCalibration(b).get(signature).length, 0)
  assert.equal(store.write(signature, [], []), false, 'stale review cannot remove a newer calibration')
  assert.equal(store.get(signature).length, 1)
})
test('invalid, duplicate, corrupt and future data never overwrite existing calibration', t => {
  const dir = tempDir(t), store = createModelCalibration(dir), file = path.join(dir, 'model-calibration.v1.json')
  assert.equal(store.write(signature, [entry], []), true)
  const original = fs.readFileSync(file, 'utf8')
  assert.equal(store.write(signature, [entry, { ...entry, channel: 'headY' }]), false)
  assert.equal(store.write(signature, [{ ...entry, strength: 1.1 }]), false)
  assert.equal(fs.readFileSync(file, 'utf8'), original)
  for (const raw of ['{broken', JSON.stringify({ version: 2, models: {} })]) {
    fs.writeFileSync(file, raw)
    assert.equal(store.get(signature), null)
    assert.equal(store.write(signature, [entry]), false)
    assert.equal(fs.readFileSync(file, 'utf8'), raw)
  }
})

test('migration only adds unseen model signatures and rejects a stale preview', t => {
  const dir = tempDir(t), store = createModelCalibration(dir)
  const another = 'uta-live2d-assets-v1:' + 'b'.repeat(64)
  assert.equal(store.write(signature, [entry], []), true)
  const expected = JSON.parse(JSON.stringify(store.read().models))
  const result = store.merge({ [signature]: [{ ...entry, strength: 0 }], [another]: [entry] }, expected)
  assert.equal(result.ok, true)
  assert.equal(result.imported, 1)
  assert.equal(result.skipped, 1)
  assert.equal(store.get(signature)[0].strength, 0.4)
  assert.equal(store.get(another).length, 1)
  assert.equal(store.merge({ [another]: [] }, expected).ok, false)
  const cyclic = {}; cyclic.self = cyclic
  assert.equal(store.merge({}, cyclic).ok, false)
})

test('actual calibration panel previews before saving cloneable data', async () => {
  const view = {
    signature, calibration: [],
    parameters: [{ id: 'CustomHead', min: -1, max: 1, defaultValue: 0, physicsOutput: false }],
    mappings: [],
  }
  const calls = []
  const store = Vue.reactive({
    modelUrl: 'uta://models/a', modelLoaded: true, presetEditingLocked: false,
    requestModelAction: async command => { calls.push(command.type); return command.type === 'inspect-performance' ? { ok: true, data: view } : { ok: true } },
  })
  const file = path.resolve(__dirname, '../src/renderer/settings-window/ModelCalibrationPanel.vue')
  const code = ts.transpileModule(compileScript(parse(fs.readFileSync(file, 'utf8'), { filename: file }).descriptor, { id: 'calibration-panel-test' }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  let saved = null
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports, console,
    require: id => id === 'vue' ? { ...Vue, onUnmounted() {} } : id === '../stores/deskpet' ? { useDeskpetStore: () => store } : {},
    window: { utaAPI: { saveModelCalibration: async payload => { saved = structuredClone(payload); return { ok: true } } } },
  }, { filename: file })
  const scope = Vue.effectScope()
  const state = scope.run(() => mod.exports.default.setup({}, { expose() {}, emit() {} }))
  try {
    await state.inspect()
    state.parameterId.value = 'CustomHead'
    state.direction.value = 'reversed'
    state.save()
    assert.equal(saved, null)
    await state.preview()
    state.save()
    await Promise.resolve(); await Vue.nextTick(); await Promise.resolve()
    assert.deepEqual(calls, ['inspect-performance', 'preview-calibration'])
    assert.equal(saved.entries[0].parameterId, 'CustomHead')
    assert.equal(saved.entries[0].direction, 'reversed')
    assert.equal(saved.expected.length, 0)
    assert.match(state.message.value, /已保存/)
  } finally { scope.stop() }
})
