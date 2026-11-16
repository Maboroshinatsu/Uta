'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const code = ts.transpileModule(
  fs.readFileSync(
    path.join(__dirname, '../src/renderer/services/live2d/continuous-presets.ts'),
    'utf8',
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText

const rawPresetData = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../src/renderer/services/live2d/continuous-presets.json'),
    'utf8',
  ),
)
const requireMap = {
  './continuous-presets.json': { __esModule: true, default: rawPresetData },
}
const mod = { exports: {} }
vm.runInNewContext(code, {
  module: mod,
  exports: mod.exports,
  require: (id) => requireMap[id] ?? {},
})
const { buildContinuousPresets } = mod.exports

function slider(id, min, max, defaultValue = 0) {
  return { id, label: id, group: 'face', min, max, step: 0.01, defaultValue, value: defaultValue }
}

function dsSliders(overrides = []) {
  const base = [
    slider('ParamAngleX', -30, 30),
    slider('ParamAngleY', -30, 30),
    slider('ParamAngleZ', -30, 30),
    slider('ParamEyeBallX', -1, 1),
    slider('ParamEyeBallY', -1, 1),
    slider('ParamEyeLOpen', 0, 1, 1),
    slider('ParamEyeROpen', 0, 1, 1),
    slider('ParamEyeLSmile', 0, 1),
    slider('ParamEyeRSmile', 0, 1),
    slider('ParamBrowLY', -1, 1),
    slider('ParamBrowRY', -1, 1),
    slider('ParamBrowLAngle', -1, 1),
    slider('ParamBrowRAngle', -1, 1),
    slider('ParamBrowLForm', -1, 1),
    slider('ParamBrowRForm', -1, 1),
    slider('ParamMouthForm', -2, 1, -0.5),
    slider('ParamMouthOpenY', 0, 1),
    slider('ParamCheek', 0, 1),
    slider('ParamBodyAngleX', -10, 10),
    slider('ParamBodyAngleZ', -10, 10),
  ]
  return [...base, ...overrides]
}

test('DS-compatible sliders get both continuous presets with full steps', () => {
  const presets = buildContinuousPresets(dsSliders())
  assert.equal(presets.map((preset) => preset.id).join(','), 'continuous_work,continuous_idle')
  const work = presets[0]
  const idle = presets[1]
  assert.equal(work.group, '工作')
  assert.equal(work.finishMode, 'loop')
  assert.equal(work.steps.length, 12)
  assert.ok(work.steps.every((step) => Object.keys(step.parameters).length >= 8))
  assert.deepEqual(work.parameters, work.steps.at(-1).parameters)
  assert.equal(idle.group, '空闲')
  assert.equal(idle.finishMode, 'revert')
  assert.equal(idle.steps.length, 7)
  assert.ok(idle.steps.every((step) => Object.keys(step.parameters).length >= 8))
  assert.deepEqual(idle.parameters, idle.steps.at(-1).parameters)
})

test('continuous presets clamp values to the model slider range', () => {
  const presets = buildContinuousPresets(
    dsSliders([slider('ParamEyeBallX', -0.2, 0.2)]),
  )
  const work = presets.find((preset) => preset.id === 'continuous_work')
  assert.ok(work)
  for (const step of work.steps) {
    if ('ParamEyeBallX' in step.parameters) {
      assert.ok(step.parameters.ParamEyeBallX >= -0.2)
      assert.ok(step.parameters.ParamEyeBallX <= 0.2)
    }
  }
})

test('models with an incompatible mouth range do not receive the pack', () => {
  const sliders = dsSliders([slider('ParamMouthForm', 0, 1, 1)])
  assert.equal(buildContinuousPresets(sliders).length, 0)
})

test('missing optional sliders are filtered without breaking the sequence', () => {
  const sliders = dsSliders().filter(
    (item) => item.id !== 'ParamEyeLSmile' && item.id !== 'ParamCheek',
  )
  const presets = buildContinuousPresets(sliders)
  assert.equal(presets.length, 2)
  for (const preset of presets) {
    for (const step of preset.steps) {
      assert.ok(!('ParamEyeLSmile' in step.parameters))
      assert.ok(!('ParamCheek' in step.parameters))
    }
  }
})
