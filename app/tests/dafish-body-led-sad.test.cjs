const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./support/settings-loader.cjs')()
const sad = load('renderer/services/live2d/dafish-body-led-sad')
const common = load('renderer/services/live2d/dafish-happy-performance')

function parameters() {
  return [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput',
    'Movement1', 'Movement2', 'Movement3', 'Param59', 'Param60', 'Param61', 'Param62',
    'Param56', 'Param57', 'key2', 'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLAngle', 'ParamBrowRAngle',
    'ParamMouthForm', 'ParamMouthOpenY', 'ParamEyeLOpen', 'ParamEyeROpen',
    'ParamEyeBallX', 'ParamEyeBallY',
  ].map(id => ({
    id,
    min: id.startsWith('Movement') || id.startsWith('key') ? 0 : -30,
    max: id.startsWith('Movement') || id.startsWith('key') ? 1 : 30,
    default: 0,
  }))
}

test('sad motion builds with collapsed body, sobbing oscillations, and tear track', () => {
  const motion = sad.buildDafishBodyLedSadMotion(parameters())
  assert.ok(motion)
  assert.equal(motion.Meta.Duration, 6.0)
  assert.equal(motion.Meta.Loop, true)

  const tracks = new Map(motion.Curves.map(c => [c.Id, common.compileMotionTrack(c.Segments)]))

  // 1. Collapsed, slumped posture
  assert.ok(tracks.get('PositionY').sample(1.0) < -5.0, 'body sinking downward')
  assert.ok(tracks.get('AngleY').sample(1.0) < -6.5, 'head looking down in sorrow')
  assert.ok(tracks.get('PositionX').sample(1.0) < -5.5, 'body curling inward')

  // 2. Chest hand & tears active
  assert.ok(tracks.get('Movement2').sample(1.5) > 0.99, 'chest hand active')
  assert.ok(tracks.get('key2').sample(1.5) > 0.99, 'tears streaming down')

  // 3. Deeply downturned mouth & sobbing oscillations
  assert.ok(tracks.get('ParamMouthForm').sample(1.5) < -0.65, 'deeply downturned mouth')
  assert.ok(tracks.get('PositionY').sample(1.7) > -4.5, 'sobbing jerk 1')
  assert.ok(tracks.get('PositionY').sample(1.95) < -5.5, 'sobbing drop 1')

  // 4. Seam check
  for (const c of motion.Curves) {
    assert.equal(c.Segments[1], c.Segments.at(-1), `${c.Id} loop seam matches`)
    assert.ok(c.Segments.every(Number.isFinite), `${c.Id} all values finite`)
  }
})

test('installDafishBodyLedSadMotion registers motion group on model', () => {
  const manager = { definitions: {}, motionGroups: {}, state: {}, createMotion: data => ({ data }) }
  const model = { internalModel: { motionManager: manager } }
  const installed = sad.installDafishBodyLedSadMotion(model, parameters())
  assert.ok(installed)
  assert.ok(manager.definitions[sad.DAFISH_BODY_LED_SAD_MOTION])

  const preset = sad.createDafishBodyLedSadPreset()
  assert.equal(preset.id, 'dafish_body_led_sad')
  assert.equal(preset.motion.group, sad.DAFISH_BODY_LED_SAD_MOTION)
})
