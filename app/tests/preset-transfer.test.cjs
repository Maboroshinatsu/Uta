'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const createLoader = require('./support/settings-loader.cjs')

const { buildPresetExport, parsePresetImport, isUserPreset, PRESET_TRANSFER_VERSION, PRESET_TRANSFER_KIND } =
  createLoader()('renderer/services/preset-transfer')

const sanitize = input => ({
  id: String(input?.id ?? ''),
  label: String(input?.label ?? ''),
  description: '',
  emotion: 'neutral',
  controls: [],
  parameters: {},
  steps: Array.isArray(input?.steps) ? input.steps : [],
  finishMode: 'revert',
  ...(input?.motion ? { motion: input.motion } : {}),
})

const preset = (id, label) => ({
  id,
  label,
  emotion: 'neutral',
  controls: [],
  parameters: {},
  steps: [{ label: '步骤 1', durationMs: 600, holdMs: 0, controls: [], parameters: {} }],
  finishMode: 'revert',
})

test('built-in presets are not mistaken for user presets', () => {
  assert.equal(isUserPreset({ ...preset('happy_1', '开心·A'), custom: true }), false)
  assert.equal(isUserPreset({ ...preset('happy_1', '开心·A'), custom: true, source: 'user' }), true)
  assert.equal(isUserPreset({ ...preset('preset_legacy', '旧版自定义'), custom: true }), true)
})

test('export is versioned, model-scoped and marks every preset as user-owned', () => {
  const text = buildPresetExport('models/a.model3.json', 'models/a.model3.json', [preset('p1', '开心·挥手')])
  const data = JSON.parse(text)
  assert.equal(data.schemaVersion, PRESET_TRANSFER_VERSION)
  assert.equal(data.kind, PRESET_TRANSFER_KIND)
  assert.equal(data.modelKey, 'models/a.model3.json')
  assert.equal(data.modelFile, 'a.model3.json')
  assert.equal(data.presets.length, 1)
  assert.equal(data.presets[0].custom, true)
  assert.ok(data.exportedAt)
})

test('native motion survives export and import, and missing model motion is rejected', () => {
  const native = { ...preset('p-motion', '动作库·IDLE'), group: '动作库', finishMode: 'hold', motion: { group: 'IDLE', index: 0 } }
  const text = buildPresetExport('model-a', 'model-a', [native])
  assert.deepEqual(JSON.parse(text).presets[0].motion, native.motion)
  const available = parsePresetImport(text, 'model-a', sanitize, (group, index) => group === 'IDLE' && index === 0)
  assert.equal(available.ok, true)
  assert.deepEqual(available.presets[0].motion, native.motion)
  const missing = parsePresetImport(text, 'model-a', sanitize, () => false)
  assert.equal(missing.ok, false)
  assert.equal(missing.error, 'missing-motion')
})

test('a valid file for the current model imports every preset', () => {
  const text = buildPresetExport('models/a.model3.json', 'models/a.model3.json', [
    preset('p1', '开心·挥手'),
    preset('p2', '专注·写字'),
  ])
  const result = parsePresetImport(text, 'models/a.model3.json', sanitize)
  assert.equal(result.ok, true)
  assert.deepEqual([...result.presets].map(item => item.id), ['p1', 'p2'])
  assert.equal(result.presets.every(item => item.custom === true), true)
  assert.equal(result.presets.every(item => item.source === 'user'), true)
})

test('a file from another model is rejected whole so presets never mix', () => {
  const text = buildPresetExport('models/a.model3.json', 'models/a.model3.json', [preset('p1', 'A')])
  const result = parsePresetImport(text, 'models/b.model3.json', sanitize)
  assert.equal(result.ok, false)
  assert.equal(result.error, 'model-mismatch')
})

test('the same model file in a renamed folder still imports', () => {
  const text = buildPresetExport('models/旧文件夹/c_0120.model3.json', 'models/旧文件夹/c_0120.model3.json', [preset('p1', '开心·A')], undefined, 'rig-a')
  const result = parsePresetImport(text, 'models/新文件夹/c_0120.model3.json', sanitize, undefined, 'rig-a')
  assert.equal(result.ok, true)
  assert.equal(result.presets[0].label, '开心·A')
  assert.equal(parsePresetImport(text, 'models/旧文件夹/c_0120.model3.json', sanitize, undefined, 'rig-b').error, 'model-mismatch')
})

test('url-encoded model folder names compare after decoding', () => {
  const encoded = 'models/%E5%A4%A7%E8%82%A5%E9%B1%BC/c_0120.model3.json'
  const text = buildPresetExport(encoded, encoded, [preset('p1', '开心·A')])
  const result = parsePresetImport(text, 'models/大肥鱼/c_0120.model3.json', sanitize)
  assert.equal(result.ok, true)
})

test('a different model file is still rejected even when the folder matches', () => {
  const text = buildPresetExport('models/x/c_0120.model3.json', 'models/x/c_0120.model3.json', [preset('p1', 'A')])
  const result = parsePresetImport(text, 'models/x/c_0121.model3.json', sanitize)
  assert.equal(result.ok, false)
  assert.equal(result.error, 'model-mismatch')
})

test('legacy envelopes require the same complete model key even when two files have the same name', () => {
  const base = {
    schemaVersion: PRESET_TRANSFER_VERSION,
    kind: PRESET_TRANSFER_KIND,
    modelKey: 'models/old-folder/c_0120.model3.json',
    presets: [preset('p1', 'A')],
  }
  const result = parsePresetImport(JSON.stringify(base), 'models/new-folder/c_0120.model3.json', sanitize)
  assert.equal(result.error, 'model-mismatch')
  assert.equal(parsePresetImport(JSON.stringify(base), base.modelKey, sanitize).ok, true)
})

test('unsupported versions, wrong kinds and empty files are rejected', () => {
  const base = { schemaVersion: PRESET_TRANSFER_VERSION, kind: PRESET_TRANSFER_KIND, modelKey: 'm', presets: [preset('p1', 'A')] }
  assert.equal(parsePresetImport(JSON.stringify({ ...base, schemaVersion: 2 }), 'm', sanitize).error, 'invalid-envelope')
  assert.equal(parsePresetImport(JSON.stringify({ ...base, kind: 'other' }), 'm', sanitize).error, 'invalid-envelope')
  assert.equal(parsePresetImport(JSON.stringify({ ...base, presets: [] }), 'm', sanitize).error, 'empty')
  assert.equal(parsePresetImport('not json', 'm', sanitize).error, 'invalid-json')
  assert.equal(parsePresetImport('', 'm', sanitize).error, 'too-large')
})

test('malformed presets and duplicate ids reject the whole file', () => {
  const base = { schemaVersion: PRESET_TRANSFER_VERSION, kind: PRESET_TRANSFER_KIND, modelKey: 'm' }
  const missingLabel = [{ ...preset('p1', ''), label: '' }]
  const bad = parsePresetImport(JSON.stringify({ ...base, presets: missingLabel }), 'm', sanitize)
  assert.equal(bad.ok, false)
  assert.equal(bad.error, 'invalid-preset')

  const duplicate = [preset('p1', 'A'), preset('p1', 'B')]
  const dup = parsePresetImport(JSON.stringify({ ...base, presets: duplicate }), 'm', sanitize)
  assert.equal(dup.ok, false)
  assert.equal(dup.error, 'duplicate-id')

  const tooMany = Array.from({ length: 501 }, (_, i) => preset(`p${i}`, `P${i}`))
  assert.equal(parsePresetImport(JSON.stringify({ ...base, presets: tooMany }), 'm', sanitize).error, 'invalid-envelope')
})

test('step motion survives export and import, and missing step motion is rejected', () => {
  const stepMotionPreset = {
    ...preset('p-step-motion', '手势闭环'),
    steps: [
      { label: '起手', durationMs: 1100, holdMs: 0, controls: [], parameters: {}, motion: { group: '抚胸手打开', index: 0 } },
      { label: '收手', durationMs: 1050, holdMs: 0, controls: [], parameters: {}, motion: { group: '抚胸手关闭', index: 0 } },
    ]
  }
  const text = buildPresetExport('model-a', 'model-a', [stepMotionPreset])
  const available = parsePresetImport(text, 'model-a', sanitize, (group) => ['抚胸手打开', '抚胸手关闭'].includes(group))
  assert.equal(available.ok, true)
  assert.equal(available.presets[0].steps[0].motion.group, '抚胸手打开')
  const missing = parsePresetImport(text, 'model-a', sanitize, (group) => group === '抚胸手打开')
  assert.equal(missing.ok, false)
  assert.equal(missing.error, 'missing-motion')
})
