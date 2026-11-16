'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/services/live2d/focus-mapping.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const mod = { exports: {} }
vm.runInNewContext(code, { module: mod, exports: mod.exports, require: () => ({}) })
const { normalizeFocusMapping, focusMappingParamIds, resolveModelFocusMapping, automaticBlinkParameterIds } = mod.exports

test('unseen rig names resolve from unambiguous VTS and physics bindings without a model adapter', () => {
  const ids = ['RigTilt', 'Param13', 'ParamBodyAngleX', 'PupilHorizontal', 'PupilVertical', 'LidA', 'Accessory']
  const parameters = ids.map(id => ({ id, min: -30, max: 30, default: 0 }))
  const physics = { PhysicsSettings: [{
    Input: [{ Source: { Target: 'Parameter', Id: 'Param13' }, Type: 'Angle', Weight: 100 }],
    Output: [{ Destination: { Target: 'Parameter', Id: 'ParamBodyAngleX' }, Type: 'Angle', Weight: 100, Scale: 20 }],
  }] }
  const bindings = [
    { input: 'FaceAngleX', output: 'RigTilt' }, { input: 'FaceAngleX', output: 'Param13' },
    { input: 'EyeRightX', output: 'PupilHorizontal', lower: 1, upper: -1 },
    { input: 'EyeLeftX', output: 'PupilHorizontal', lower: 1, upper: -1 },
    { input: 'EyeRightY', output: 'PupilVertical' }, { input: 'EyeOpenLeft', output: 'LidA' },
  ]
  const mapping = resolveModelFocusMapping(parameters, physics, undefined, bindings)
  assert.equal(mapping.headXParam, 'RigTilt')
  assert.equal(mapping.bodyXParam, 'Param13', '不能把同一 FaceAngle 的身体输入再次当头部使用')
  assert.equal(mapping.eyeXParam, 'PupilHorizontal')
  assert.equal(mapping.eyeYParam, 'PupilVertical')
  assert.equal(mapping.invertEyeX, true)
  const modes = mod.exports.resolveParameterBlendModes(ids, mapping, bindings)
  assert.equal(modes.RigTilt, 'pose-offset')
  assert.equal(modes.Param13, 'pose-offset')
  assert.equal(modes.PupilHorizontal, 'gaze')
  assert.equal(modes.LidA, 'eye-open')
  assert.equal(modes.Accessory, 'absolute')
  assert.equal(Object.hasOwn(modes, 'MissingChannel'), false)
})

test('ambiguous custom bindings stay unresolved and channel modes stay scoped to one rig', () => {
  const parameters = ['First', 'Second'].map(id => ({ id, min: -30, max: 30, default: 0 }))
  const bindings = [{ input: 'FaceAngleX', output: 'First' }, { input: 'FaceAngleX', output: 'Second' },
    { input: 'EyeLeftX', output: 'First' }, { input: 'EyeRightX', output: 'Second' }]
  const mapping = resolveModelFocusMapping(parameters, null, undefined, bindings)
  assert.equal(mapping.headXParam, null)
  assert.equal(mapping.eyeXParam, null)
  const first = mod.exports.resolveParameterBlendModes(['First'], { bodyXParam: 'First' })
  const next = mod.exports.resolveParameterBlendModes(['First'], null)
  assert.equal(first.First, 'pose-offset')
  assert.equal(next.First, 'absolute', '切模后不能沿用上一模型的特殊含义')
})

test('one custom head input keeps its existing head-to-body physics coupling without duplicate body writes', () => {
  const parameters = ['RigTilt', 'ParamBodyAngleX'].map(id => ({ id, min: -30, max: 30, default: 0 }))
  const physics = { PhysicsSettings: [{
    Input: [{ Source: { Target: 'Parameter', Id: 'RigTilt' }, Type: 'Angle', Weight: 100 }],
    Output: [{ Destination: { Target: 'Parameter', Id: 'ParamBodyAngleX' }, Type: 'Angle', Weight: 100, Scale: 20 }],
  }] }
  const mapping = resolveModelFocusMapping(parameters, physics, undefined, [{ input: 'FaceAngleX', output: 'RigTilt' }])
  assert.equal(mapping.headXParam, 'RigTilt')
  assert.equal(mapping.bodyXParam, null)
  const separate = resolveModelFocusMapping([...parameters, { id: 'ParamAngleX', min: -30, max: 30, default: 0 }],
    physics, undefined, [{ input: 'FaceAngleX', output: 'RigTilt' }])
  assert.equal(separate.headXParam, 'ParamAngleX', '已有独立头部输入时，不能把已确认的身体输入误当头部')
  assert.equal(separate.bodyXParam, 'RigTilt')
})

test('focus mapping leaves omitted channels to runtime and clamps adapter input', () => {
  assert.equal(normalizeFocusMapping(null), null)
  const mapping = JSON.parse(JSON.stringify(normalizeFocusMapping({
    headXParam: 'AngleX',
    headScale: 999,
    eyeScale: 0,
    invertEyeX: true,
    bodyZParam: null,
  })))
  assert.equal(mapping.headXParam, 'AngleX')
  assert.equal(mapping.headYParam, undefined)
  assert.equal(mapping.headScale, 180)
  assert.equal(mapping.eyeScale, 0.1)
  assert.equal(mapping.invertEyeX, true)
  assert.equal(mapping.bodyZParam, null)
  assert.deepEqual(
    [...focusMappingParamIds(mapping)],
    ['AngleX'],
  )
})

test('automatic focus routes same-axis body physics through its real input', () => {
  const parameter = id => ({ id, min: -6, max: 6, default: 0 })
  const link = (source, destination, reflect = false) => ({
    Input: [{ Source: { Target: 'Parameter', Id: source }, Type: 'Angle', Weight: 80, Reflect: false }],
    Output: [{ Destination: { Target: 'Parameter', Id: destination }, Type: 'Angle', Weight: 100, Scale: 20, Reflect: reflect }],
  })
  const parameters = ['AngleX', 'ParamAngleY', 'ParamEyeBallX', 'ParamBodyAngleX', 'ParamBodyAngleXinput',
    'ParamBodyAngleY', 'ParamBodyAngleZ', 'ParamBodyAngleZ2input'].map(parameter)
  const settings = [
    link('ParamBodyAngleXinput', 'ParamBodyAngleX', true),
    link('ParamAngleY', 'ParamBodyAngleY'),
    link('ParamBodyAngleZ2input', 'ParamBodyAngleZ'),
  ]
  const focus = resolveModelFocusMapping(parameters, { PhysicsSettings: settings })
  assert.equal(focus.headXParam, 'AngleX')
  assert.equal(focus.headZParam, null)
  assert.equal(focus.bodyXParam, 'ParamBodyAngleXinput')
  assert.equal(focus.bodyAxisGain.X, -6)
  assert.equal(focus.bodyYParam, null)
  assert.equal(focus.bodyZParam, 'ParamBodyAngleZ2input')

  const ambiguous = resolveModelFocusMapping(parameters, { PhysicsSettings: [...settings, settings[0]] })
  assert.equal(ambiguous.bodyXParam, null)
  const direct = resolveModelFocusMapping(parameters, null)
  assert.equal(direct.bodyXParam, 'ParamBodyAngleX')
  assert.equal(direct.bodyYParam, null)
})

test('a partial adapter retains its eyes and fills body inputs confirmed by the VTS sidecar', () => {
  const ids = ['ParamAngleX', 'ParamBodyAngleX', 'ParamBodyAngleXinput', 'Param14']
  const parameters = ids.map(id => ({ id, min: -10, max: 10, default: 0 }))
  const physics = { PhysicsSettings: [{
    Input: [
      { Source: { Target: 'Parameter', Id: 'ParamBodyAngleXinput' }, Type: 'Angle', Weight: 80 },
      { Source: { Target: 'Parameter', Id: 'Param14' }, Type: 'X', Weight: 15 },
    ],
    Output: [{ Destination: { Target: 'Parameter', Id: 'ParamBodyAngleX' }, Type: 'Angle', Weight: 100, Scale: 22, Reflect: true }],
  }] }
  const adapter = normalizeFocusMapping({ invertEyeX: true })
  const bindings = [{ input: 'FaceAngleX', output: 'ParamBodyAngleXinput' }]
  assert.equal(resolveModelFocusMapping(parameters, physics, adapter).bodyXParam, null)
  const focus = resolveModelFocusMapping(parameters, physics, adapter, bindings)
  assert.equal(focus.bodyXParam, 'ParamBodyAngleXinput')
  assert.equal(focus.bodyAxisGain.X, -10)
  assert.equal(focus.invertEyeX, true)
  const disabled = normalizeFocusMapping({ bodyXParam: null })
  assert.equal(resolveModelFocusMapping(parameters, physics, disabled, bindings).bodyXParam, null)
})

test('generated VTS focus cannot drive a physics output that an explicit adapter may name', () => {
  const parameters = ['ParamAngleX', 'ParamBodyAngleX'].map(id => ({ id, min: -30, max: 30, default: 0 }))
  const physics = { PhysicsSettings: [{
    Input: [{ Source: { Target: 'Parameter', Id: 'ParamAngleX' }, Type: 'Angle', Weight: 80 }],
    Output: [{ Destination: { Target: 'Parameter', Id: 'ParamBodyAngleX' }, Type: 'Angle', Weight: 100, Scale: 22 }],
  }] }
  const adapter = normalizeFocusMapping({ bodyXParam: 'ParamBodyAngleX' })
  assert.equal(resolveModelFocusMapping(parameters, physics, adapter, [], true).bodyXParam, null)
  assert.equal(resolveModelFocusMapping(parameters, physics, adapter).bodyXParam, 'ParamBodyAngleX')
})

test('automatic blink keeps eye bindings and skips a verified body physics input', () => {
  const ids = ['ParamEyeLOpen', 'ParamEyeROpen', 'Param14', 'CustomEye']
  const parameters = [...ids, 'ParamBodyAngleX'].map(id => ({ id, min: -10, max: 10, default: 0 }))
  const physics = { PhysicsSettings: [{
    Input: [{ Source: { Target: 'Parameter', Id: 'Param14' }, Type: 'X', Weight: 15 }],
    Output: [{ Destination: { Target: 'Parameter', Id: 'ParamBodyAngleX' }, Type: 'Angle', Weight: 100, Scale: 22 }],
  }] }
  assert.deepEqual([...automaticBlinkParameterIds(ids, parameters, physics, [])], ['ParamEyeLOpen', 'ParamEyeROpen', 'CustomEye'])
  const authorsEye = [{ input: 'EyeOpenLeft', output: 'Param14' }]
  assert.deepEqual([...automaticBlinkParameterIds(ids, parameters, physics, authorsEye)], ids)
  const custom = ['CustomEye', 'Param14']
  assert.deepEqual([...automaticBlinkParameterIds(custom, parameters, physics, [])], custom)
})

test('author bindings resolve body controls with shared physics and set per-axis gains', () => {
  const parameters = ['AngleX', 'ParamAngleX', 'ParamEyeBallX', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput',
    'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ'].map(id => ({ id, min: -30, max: 30, default: 0 }))
  const input = (id, Type = 'Angle') => ({ Source: { Target: 'Parameter', Id: id }, Type, Weight: 80 })
  const link = (axis, ...inputs) => ({
    Input: inputs,
    Output: [{ Destination: { Target: 'Parameter', Id: `ParamBodyAngle${axis}` }, Type: 'Angle', Weight: 100, Scale: 30 }],
  })
  const physics = { PhysicsSettings: [
    link('X', input('PositionX')), link('Y', input('PositionY'), input('LeanInput')),
    link('Z', input('PositionZ'), input('PositionX', 'X')),
  ] }
  const bindings = [
    { input: 'FaceAngleX', output: 'AngleX', lower: -30, upper: 30 },
    { input: 'FaceAngleX', output: 'PositionX', lower: -30, upper: 30 },
    { input: 'FaceAngleY', output: 'PositionY', lower: -22, upper: 22 },
    { input: 'FaceAngleZ', output: 'PositionZ', lower: -15, upper: 15 },
    { input: 'EyeRightX', output: 'ParamEyeBallX', lower: 1, upper: -1 },
  ]
  const focus = resolveModelFocusMapping(parameters, physics, undefined, bindings)
  assert.equal(focus.headXParam, 'AngleX')
  assert.deepEqual([focus.bodyXParam, focus.bodyYParam, focus.bodyZParam], ['PositionX', 'PositionY', 'PositionZ'])
  assert.deepEqual({ ...focus.bodyAxisGain }, { X: 30, Y: 22, Z: 15 })
  assert.equal(focus.invertEyeX, true)
  const explicit = normalizeFocusMapping({ invertEyeX: false, bodyZParam: null })
  const overridden = resolveModelFocusMapping(parameters, physics, explicit, bindings)
  assert.equal(overridden.headXParam, 'AngleX')
  assert.equal(overridden.bodyZParam, null)
  assert.equal(overridden.invertEyeX, false)
})
