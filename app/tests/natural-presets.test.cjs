'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const code = ts.transpileModule(
  fs.readFileSync(
    path.join(__dirname, '../src/renderer/services/live2d/natural-presets.ts'),
    'utf8',
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const generic = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../src/renderer/services/live2d/natural-presets.json'),
    'utf8',
  ),
)
const ds = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../src/renderer/services/live2d/natural-presets.ds.json'),
    'utf8',
  ),
)
const mod = { exports: {} }
vm.runInNewContext(code, {
  module: mod,
  exports: mod.exports,
  require: (id) => {
    if (id === './natural-presets.json') return { __esModule: true, default: generic }
    if (id === './natural-presets.ds.json') return { __esModule: true, default: ds }
    if (id === './dafish-body-led-neutral') return require('./support/settings-loader.cjs')()('renderer/services/live2d/dafish-body-led-neutral')
    if (id === './dafish-body-led-happy') return require('./support/settings-loader.cjs')()('renderer/services/live2d/dafish-body-led-happy')
    if (id === './dafish-body-led-curious') return require('./support/settings-loader.cjs')()('renderer/services/live2d/dafish-body-led-curious')
    if (id === './dafish-body-led-surprised') return require('./support/settings-loader.cjs')()('renderer/services/live2d/dafish-body-led-surprised')
    if (id === './dafish-body-led-sad') return require('./support/settings-loader.cjs')()('renderer/services/live2d/dafish-body-led-sad')
    if (id === './dafish-body-led-angry') return require('./support/settings-loader.cjs')()('renderer/services/live2d/dafish-body-led-angry')
    if (id === './dafish-body-led-shy') return require('./support/settings-loader.cjs')()('renderer/services/live2d/dafish-body-led-shy')
    if (id === './dafish-body-led-thinking') return require('./support/settings-loader.cjs')()('renderer/services/live2d/dafish-body-led-thinking')
    if (id === './dafish-well-actually') return require('./support/settings-loader.cjs')()('renderer/services/live2d/dafish-well-actually')
    return {}
  },
}, { console })
const {
  buildGenericNaturalPresets,
  buildDsNaturalPresets,
  buildDafishNaturalPresets,
  buildNaturalPresetsForModel,
  isDsMouseModel,
  isDafishModel,
} = mod.exports

function slider(id, min, max, defaultValue = 0) {
  return { id, label: id, group: 'face', min, max, step: 0.01, defaultValue, value: defaultValue }
}

function sliders(overrides = []) {
  return [
    slider('ParamAngleX', -30, 30), slider('ParamAngleY', -30, 30), slider('ParamAngleZ', -30, 30),
    slider('ParamEyeBallX', -1, 1), slider('ParamEyeBallY', -1, 1),
    slider('ParamBrowLY', -1, 1), slider('ParamBrowRY', -1, 1),
    slider('ParamBrowLAngle', -1, 1), slider('ParamBrowRAngle', -1, 1),
    slider('ParamBrowLForm', -1, 1), slider('ParamBrowRForm', -1, 1),
    slider('ParamMouthForm', -2, 1, -0.5), slider('ParamMouthOpenY', 0, 1),
    slider('ParamBodyAngleX', -10, 10), slider('ParamBodyAngleZ', -10, 10),
    slider('pointX', -30, 30), slider('pointY', -30, 30),
    ...overrides,
  ]
}

function controls(ids) {
  return ids.map((id) => ({ id, label: id, category: 'face_effect', parameters: {}, hiddenParts: [], shownParts: [] }))
}

const DS_CONTROLS = controls([
  '蛋包饭', '点菜按下', '开心兴奋', '星星眼', '脸红', '哭', '闭眼口水', '问号', '感叹号',
  '悲伤', '生气', '流汗', '爱心眼', '心跳',
])

test('generic pack uses only standard parameters and no model-specific controls', () => {
  const presets = buildGenericNaturalPresets(sliders())
  assert.ok(presets.length >= 18)
  for (const preset of presets) {
    assert.equal(preset.controls.length, 0)
    for (const step of preset.steps) {
      assert.equal(step.controls.length, 0)
      assert.ok(!('ParamCheek16' in step.parameters))
      assert.ok(!('ParamCheek22' in step.parameters))
      assert.ok(!('ParamCheek74' in step.parameters))
      assert.ok(!('ParamEyeLOpen' in step.parameters))
    }
  }
  assert.equal(presets.find((p) => p.id === 'neutral').steps.length, 1)
  assert.ok(presets.filter((p) => p.id !== 'neutral').every((p) => p.steps.length >= 2))
})

test('DS pack adds the strong effects where they fit and keeps them through the sequence', () => {
  const presets = buildDsNaturalPresets(sliders(), DS_CONTROLS)
  assert.equal(presets.length, 18)
  const byId = Object.fromEntries(presets.map((p) => [p.id, p]))
  assert.equal(byId.happy.controls.join(','), '开心兴奋')
  assert.equal(byId.happy_tilt.controls.join(','), '星星眼')
  assert.equal(byId.sad_glance.controls.join(','), '哭')
  assert.equal(byId.shy.controls.join(','), '脸红')
  assert.equal(byId.shy_peek.controls.join(','), '爱心眼')
  assert.equal(byId.curious.controls.join(','), '问号')
  assert.equal(byId.surprised.controls.join(','), '感叹号')
  assert.ok(byId.thinking.steps.every((step) => step.controls.length === 0))
  for (const preset of presets) {
    for (const step of preset.steps) {
      assert.ok(step.controls.every((id) => DS_CONTROLS.some((control) => control.id === id)))
    }
  }
})

test('DS detection is based on the point hand plus DS-only controls', () => {
  assert.equal(isDsMouseModel(sliders(), DS_CONTROLS), true)
  assert.equal(isDsMouseModel(sliders(), controls(['微笑'])), false)
  assert.equal(isDsMouseModel(sliders().filter((s) => s.id !== 'pointX'), DS_CONTROLS), false)
  assert.equal(buildNaturalPresetsForModel(sliders(), DS_CONTROLS)[0].controls.length, 0)
  assert.equal(
    buildNaturalPresetsForModel(sliders(), DS_CONTROLS).find((p) => p.id === 'happy').controls[0],
    '开心兴奋',
  )
  assert.equal(
    buildNaturalPresetsForModel(sliders(), controls(['微笑'])).find((p) => p.id === 'happy').controls.length,
    0,
  )
})

test('incompatible mouth ranges receive no natural pack', () => {
  const incompatible = sliders([slider('ParamMouthForm', 0, 1, 1)])
  assert.equal(buildGenericNaturalPresets(incompatible).length, 0)
  assert.equal(buildDsNaturalPresets(incompatible, DS_CONTROLS).length, 0)
})

const DAFISH_CONTROLS = controls(['大小变', '狗尾草', '抚胸', '竖食指', '长短裙', '爱心眼', '脸红', '屑屑眼', '落泪', '黑脸'])

test('DaFish detection is based on signature controls (大小变, 狗尾草, etc.)', () => {
  assert.equal(isDafishModel(sliders(), DAFISH_CONTROLS), true)
  assert.equal(isDafishModel(sliders(), controls(['微笑'])), false)
  assert.equal(isDafishModel(sliders(), DS_CONTROLS), false)
})

test('buildDafishNaturalPresets returns exclusively the 9 body-led continuous presets', () => {
  const presets = buildDafishNaturalPresets(sliders(), DAFISH_CONTROLS)
  assert.equal(presets.length, 9)
  const ids = presets.map((p) => p.id)
  assert.ok(ids.includes('neutral'))
  assert.ok(ids.includes('dafish_body_led_happy_v4'))
  assert.ok(ids.includes('dafish_body_led_curious'))
  assert.ok(ids.includes('dafish_body_led_surprised'))
  assert.ok(ids.includes('dafish_body_led_sad'))
  assert.ok(ids.includes('dafish_body_led_angry'))
  assert.ok(ids.includes('dafish_body_led_shy'))
  assert.ok(ids.includes('dafish_body_led_thinking'))
  assert.ok(ids.includes('well_actually'))
})

test('buildNaturalPresetsForModel automatically prioritizes DaFish presets for DaFish models', () => {
  const presets = buildNaturalPresetsForModel(sliders(), DAFISH_CONTROLS)
  assert.equal(presets.length, 9)
  assert.ok(presets.some((p) => p.id === 'neutral'))
  assert.ok(presets.some((p) => p.id === 'dafish_body_led_happy_v4'))
})

test('DaFish presets include body-led continuous motions for all groups', () => {
  const presets = buildDafishNaturalPresets(sliders(), DAFISH_CONTROLS)
  for (const preset of presets) {
    assert.ok(preset.motion && preset.motion.group, `preset ${preset.id} missing motion group`)
  }
})
