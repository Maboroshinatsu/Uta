'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

const root = path.join(__dirname, '..')
const catalogSource = fs.readFileSync(
  path.join(root, 'src/renderer/services/live2d/builtin-adapters/index.ts'),
  'utf8',
)
const builtin = JSON.parse(fs.readFileSync(
  path.join(root, 'src/renderer/services/live2d/builtin-adapters/dafish.json'),
  'utf8',
))
const authored = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/adapters/dafish/deskpet-adapter.json'),
  'utf8',
))

const code = ts.transpileModule(catalogSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const mod = { exports: {} }
vm.runInNewContext(code, {
  module: mod,
  exports: mod.exports,
  require: id => id.endsWith('dafish.json') ? builtin : {},
}, { filename: 'builtin-adapters.ts' })
const { DAFISH_MODEL_SIGNATURE, findBuiltinAdapter, listBuiltinAdapters } = mod.exports

test('the built-in Dafish adapter stays identical to the authored template', () => {
  assert.deepEqual(builtin, authored)
})

test('only the exact restored model signature receives the built-in adapter', () => {
  assert.equal(DAFISH_MODEL_SIGNATURE, 'uta-live2d-assets-v1:b72fb6bc0c74e119b0f11db582d90e6736bc3471226b10085e48c4dbb0583fe8')
  assert.equal(findBuiltinAdapter(DAFISH_MODEL_SIGNATURE)?.name, '大肥鱼')
  assert.equal(findBuiltinAdapter('uta-live2d-assets-v1:other'), null)
  assert.equal(findBuiltinAdapter(null), null)
})

test('an available mismatching signature wins over names; legacy hints must match exactly', () => {
  assert.equal(findBuiltinAdapter(null, '大肥鱼')?.name, '大肥鱼')
  assert.equal(findBuiltinAdapter('uta-live2d-assets-v1:modified-hash', '大肥鱼'), null)
  assert.equal(findBuiltinAdapter('different-model', 'DeepSeek-Other-Character'), null)
  assert.equal(findBuiltinAdapter(null, 'DeepSeek-Other-Character'), null)
  assert.equal(findBuiltinAdapter(null, 'my-dafish-copy'), null)
  assert.equal(findBuiltinAdapter(null, 'imported-character-072c7e1cdc')?.name, '大肥鱼')
  assert.equal(findBuiltinAdapter(null, 'dafish')?.name, '大肥鱼')
  assert.equal(findBuiltinAdapter(null, 'DeepSeek娘')?.name, '大肥鱼')
  assert.equal(findBuiltinAdapter(null, 'c_0120')?.name, '大肥鱼')
  assert.equal(findBuiltinAdapter(null, 'unknown-model'), null)
})

test('the built-in catalog exposes the verified Dafish static bindings', () => {
  const entry = findBuiltinAdapter(DAFISH_MODEL_SIGNATURE)
  assert.deepEqual(entry.adapter.hiddenDrawables, [])
  assert.equal(Object.keys(entry.adapter.controls).length, 21)
  assert.equal(Object.keys(entry.adapter.emotions).length, 9)
  assert.equal(Object.keys(entry.adapter.animations).length, 3)
  assert.deepEqual(entry.adapter.idleMotions, ['IDLE'])
  assert.equal(listBuiltinAdapters().length, 1)
})

test('only an exact built-in revision can override generated focus, while authored focus wins', async () => {
  const local = {
    emotions: { happy: { parameters: { key4: 1 } } },
    controls: { glasses: { parameters: { key11: 1 } } },
    generatedFocus: { bodyZParam: 'PositionZ' },
  }
  const load = require('./support/settings-loader.cjs')({}, {
    window: { location: { href: 'file:///index.html' } },
    fetch: async () => ({ ok: true, text: async () => JSON.stringify(local) }),
  })
  const { loadEmotionAdapter } = load('renderer/services/live2d/emotion-adapter')
  const url = 'uta://models/imported-character-072c7e1cdc/model.model3.json'
  assert.equal((await loadEmotionAdapter(url, DAFISH_MODEL_SIGNATURE)).focus.bodyZParam, null)
  assert.equal((await loadEmotionAdapter(url, 'other-revision')).focus.bodyZParam, 'PositionZ')
  assert.equal((await loadEmotionAdapter(url)).focus.bodyZParam, 'PositionZ')
  local.focus = { bodyZParam: 'UserLean' }
  assert.equal((await loadEmotionAdapter(url, DAFISH_MODEL_SIGNATURE)).focus.bodyZParam, 'UserLean')
})
