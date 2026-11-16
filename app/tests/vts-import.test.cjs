'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/main/vts-import.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const mod = { exports: {} }
vm.runInNewContext(code, { module: mod, exports: mod.exports, require: () => ({}) })
const { planVtsImport } = mod.exports

test('VTS sidecars become expressions/motions and a focus mapping', () => {
  const plan = JSON.parse(JSON.stringify(planVtsImport({
    sidecars: [
      '大肥鱼.vtube.json',
      'Exp3/脸红.exp3.json',
      'Exp3/爱心眼.exp3.json',
      'Animation/IDLE.motion3.json',
      'Animation/狗尾草切换出来.motion3.json',
    ],
    vtsConfig: {
      Hotkeys: [
        { Name: '脸红', Action: 'ToggleExpression', File: '脸红.exp3.json' },
        { Name: '爱心眼', Action: 'ToggleExpression', File: '爱心眼.exp3.json' },
        { Name: '狗尾草打开', Action: 'TriggerAnimation', File: '狗尾草切换出来.motion3.json' },
      ],
      ParameterSettings: [
        { Input: 'FaceAngleX', OutputLive2D: 'AngleX', OutputRangeLower: -30, OutputRangeUpper: 30 },
        { Input: 'FaceAngleY', OutputLive2D: 'AngleY', OutputRangeLower: -20, OutputRangeUpper: 20 },
        { Input: 'FaceAngleZ', OutputLive2D: 'AngleZ', OutputRangeLower: -30, OutputRangeUpper: 30 },
        { Input: 'EyeRightX', OutputLive2D: 'ParamEyeBallX', OutputRangeLower: 1, OutputRangeUpper: -1 },
        { Input: 'EyeRightY', OutputLive2D: 'ParamEyeBallY', OutputRangeLower: -1, OutputRangeUpper: 1 },
        { Input: 'FaceAngleX', OutputLive2D: 'PositionX', OutputRangeLower: -30, OutputRangeUpper: 30 },
        { Input: 'FaceAngleY', OutputLive2D: 'PositionY', OutputRangeLower: -30, OutputRangeUpper: 30 },
        { Input: 'FaceAngleZ', OutputLive2D: 'PositionZ', OutputRangeLower: -30, OutputRangeUpper: 30 },
        { Input: 'MouthOpen', OutputLive2D: 'ParamMouthOpenY' },
      ],
    },
  })))

  assert.deepEqual(plan.expressions, [
    { Name: '脸红', File: 'Exp3/脸红.exp3.json' },
    { Name: '爱心眼', File: 'Exp3/爱心眼.exp3.json' },
  ])
  assert.equal(plan.motions['狗尾草打开'][0].File, 'Animation/狗尾草切换出来.motion3.json')
  assert.equal(plan.motions.IDLE[0].File, 'Animation/IDLE.motion3.json')
  assert.deepEqual(plan.idleMotions, ['IDLE'])
  assert.equal(plan.focus.headXParam, 'AngleX')
  assert.equal(plan.focus.headScale, 30)
  assert.equal(plan.focus.eyeXParam, 'ParamEyeBallX')
  assert.equal(plan.focus.invertEyeX, true)
  assert.equal(plan.focus.bodyXParam, 'PositionX')
  assert.equal(plan.focus.bodyZParam, 'PositionZ')
  assert.equal(plan.focus.bodyScale, 30)
  assert.deepEqual(plan.lipSync, { mouthOpenParam: 'ParamMouthOpenY', gain: 1 })
  assert.ok(plan.vtsMappings)
  assert.equal(plan.vtsMappings.length, 9)
  assert.equal(plan.vtsMappings[0].input, 'FaceAngleX')
  assert.equal(plan.vtsMappings[0].output, 'AngleX')
  assert.equal(plan.vtsMappings[0].min, -30)
  assert.equal(plan.vtsMappings[0].max, 30)
})

test('existing model expressions/motions keep their names', () => {
  const plan = JSON.parse(JSON.stringify(planVtsImport({
    sidecars: ['Exp3/脸红.exp3.json', 'Animation/Tap.motion3.json'],
    vtsConfig: { Hotkeys: [{ Name: '脸红', Action: 'ToggleExpression', File: '脸红.exp3.json' }] },
    existingExpressionFiles: ['Exp3/脸红.exp3.json'],
    existingExpressionNames: ['脸红'],
    existingMotionGroups: ['Tap'],
    existingMotionFiles: ['Animation/Tap.motion3.json'],
  })))
  assert.equal(plan.expressions.length, 0)
  assert.deepEqual(plan.motions, {})
})

test('planVtsImport automatically applies the full DaFish template for DaFish-derived models', () => {
  const plan = JSON.parse(JSON.stringify(planVtsImport({
    sidecars: [
      '大肥鱼.vtube.json',
      'Exp3/体型1.exp3.json',
      'Exp3/裙子切换.exp3.json',
      'Animation/狗尾草切换出来.motion3.json',
    ],
    vtsConfig: {
      Hotkeys: [
        { Name: '体型1', Action: 'ToggleExpression', File: '体型1.exp3.json' },
        { Name: '裙长切换', Action: 'ToggleExpression', File: '裙子切换.exp3.json' },
        { Name: '狗尾巴草打开', Action: 'TriggerAnimation', File: '狗尾草切换出来.motion3.json' },
      ],
    },
  })))

  assert.ok(plan.controls)
  assert.equal(Object.keys(plan.controls).length, 21)
  assert.ok(plan.controls['大小变'])
  assert.equal(plan.controls['大小变'].stages.length, 3)
  assert.ok(plan.controls['狗尾草'])
  assert.ok(plan.controls['抚胸'])
  assert.ok(plan.emotions)
  assert.equal(Object.keys(plan.emotions).length, 9)
  assert.ok(plan.animations)
  assert.equal(Object.keys(plan.animations).length, 3)
  assert.ok(plan.baseParameters)
  assert.equal(plan.baseParameters.Divider1, 0)
})

test('planVtsImport extracts controls from hotkeys for generic VTS models', () => {
  const plan = JSON.parse(JSON.stringify(planVtsImport({
    sidecars: ['custom.vtube.json', 'Exp3/cat_ears.exp3.json', 'Exp3/glasses.exp3.json'],
    vtsConfig: {
      Hotkeys: [
        { Name: '猫耳', Action: 'ToggleExpression', File: 'cat_ears.exp3.json' },
        { Name: '眼镜', Action: 'ToggleExpression', File: 'glasses.exp3.json' },
      ],
    },
  })))

  assert.ok(plan.controls)
  assert.equal(Object.keys(plan.controls).length, 2)
  assert.equal(plan.controls['猫耳'].label, '猫耳')
  assert.equal(plan.controls['眼镜'].category, 'outfit')
})

test('planVtsImport extracts standard ParamAngle and ParamBodyAngle focus parameters', () => {
  const plan = JSON.parse(JSON.stringify(planVtsImport({
    sidecars: ['model.vtube.json'],
    vtsConfig: {
      ParameterSettings: [
        { Input: 'FaceAngleX', OutputLive2D: 'ParamAngleX', OutputRangeLower: -30, OutputRangeUpper: 30 },
        { Input: 'FaceAngleY', OutputLive2D: 'ParamAngleY', OutputRangeLower: -30, OutputRangeUpper: 30 },
        { Input: 'FaceAngleZ', OutputLive2D: 'ParamAngleZ', OutputRangeLower: -30, OutputRangeUpper: 30 },
        { Input: 'EyeRightX', OutputLive2D: 'ParamEyeBallX', OutputRangeLower: -1, OutputRangeUpper: 1 },
        { Input: 'FaceAngleX', OutputLive2D: 'ParamBodyAngleX', OutputRangeLower: -10, OutputRangeUpper: 10 },
        { Input: 'FaceAngleY', OutputLive2D: 'ParamBodyAngleY', OutputRangeLower: -10, OutputRangeUpper: 10 },
        { Input: 'FaceAngleZ', OutputLive2D: 'ParamBodyAngleZ', OutputRangeLower: -10, OutputRangeUpper: 10 },
      ],
    },
  })))

  assert.equal(plan.focus.headXParam, 'ParamAngleX')
  assert.equal(plan.focus.headYParam, 'ParamAngleY')
  assert.equal(plan.focus.headZParam, 'ParamAngleZ')
  assert.equal(plan.focus.bodyXParam, 'ParamBodyAngleX')
  assert.equal(plan.focus.bodyYParam, 'ParamBodyAngleY')
  assert.equal(plan.focus.bodyZParam, 'ParamBodyAngleZ')
})
