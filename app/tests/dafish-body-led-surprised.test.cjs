const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./support/settings-loader.cjs')()
const surprised = load('renderer/services/live2d/dafish-body-led-surprised')
const common = load('renderer/services/live2d/dafish-happy-performance')

function parameters() {
  return [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput',
    'Movement1', 'Movement2', 'Movement3', 'Param56', 'Param57',
    'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLAngle', 'ParamBrowRAngle',
    'ParamMouthForm', 'ParamMouthOpenY', 'ParamEyeLOpen', 'ParamEyeROpen',
    'ParamEyeBallX', 'ParamEyeBallY',
  ].map(id => ({
    id,
    min: id.startsWith('Movement') ? 0 : -30,
    max: id.startsWith('Movement') ? 1 : 30,
    default: 0,
  }))
}

test('surprised motion builds with tactical rear lean and wide open mouth', () => {
  const motion = surprised.buildDafishBodyLedSurprisedMotion(parameters())
  assert.ok(motion)
  assert.equal(motion.Meta.Duration, 5.4)
  assert.equal(motion.Meta.Loop, true)

  const tracks = new Map(motion.Curves.map(c => [c.Id, common.compileMotionTrack(c.Segments)]))

  // 1. Extreme tactical rear lean
  assert.ok(tracks.get('LeanInput').sample(0.6) > 23.0, 'tactical recline peak')
  assert.ok(tracks.get('PositionZ').sample(0.6) > 14.0, 'torso/pelvis recline')
  assert.ok(tracks.get('PositionY').sample(0.6) > 4.0, 'vertical lift from shock')

  // 2. Wide open shocked mouth
  assert.ok(tracks.get('ParamMouthOpenY').sample(0.6) > 0.60, 'wide open mouth')
  assert.ok(tracks.get('ParamMouthForm').sample(0.6) < -0.45, 'round surprised shape')

  // 3. Shaken breathing oscillations
  assert.ok(tracks.get('PositionY').sample(1.2) < 3.2, 'gasp dip 1')
  assert.ok(tracks.get('PositionY').sample(1.65) > 4.2, 'gasp lift 1')

  // 4. Return to neutral seam
  for (const c of motion.Curves) {
    assert.equal(c.Segments[1], c.Segments.at(-1), `${c.Id} loop seam matches`)
    assert.ok(c.Segments.every(Number.isFinite), `${c.Id} all values finite`)
  }
})

test('installDafishBodyLedSurprisedMotion registers motion group on model', () => {
  const manager = { definitions: {}, motionGroups: {}, state: {}, createMotion: data => ({ data }) }
  const model = { internalModel: { motionManager: manager } }
  const installed = surprised.installDafishBodyLedSurprisedMotion(model, parameters())
  assert.ok(installed)
  assert.ok(manager.definitions[surprised.DAFISH_BODY_LED_SURPRISED_MOTION])

  const preset = surprised.createDafishBodyLedSurprisedPreset()
  assert.equal(preset.id, 'dafish_body_led_surprised')
  assert.equal(preset.motion.group, surprised.DAFISH_BODY_LED_SURPRISED_MOTION)
})
