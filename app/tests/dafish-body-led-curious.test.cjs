const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./support/settings-loader.cjs')()
const curious = load('renderer/services/live2d/dafish-body-led-curious')
const common = load('renderer/services/live2d/dafish-happy-performance')

function parameters() {
  return [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput',
    'Movement1', 'Movement2', 'Movement3', 'Param56', 'Param57',
    'ParamBrowLY', 'ParamBrowRY', 'ParamMouthForm', 'ParamMouthOpenY',
    'ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeBallX', 'ParamEyeBallY', 'EyeSmile',
  ].map(id => ({
    id,
    min: id.startsWith('Movement') ? 0 : -30,
    max: id.startsWith('Movement') ? 1 : 30,
    default: 0,
  }))
}

test('curious motion builds with valid duration, zero props, and body-led curves', () => {
  const motion = curious.buildDafishBodyLedCuriousMotion(parameters())
  assert.ok(motion)
  assert.equal(motion.Meta.Duration, 5.6)
  assert.equal(motion.Meta.Loop, true)

  const tracks = new Map(motion.Curves.map(c => [c.Id, common.compileMotionTrack(c.Segments)]))

  // 1. Zero props
  assert.equal(tracks.get('Movement1').sample(1.6), 0)
  assert.equal(tracks.get('Movement2').sample(1.6), 0)
  assert.equal(tracks.get('Movement3').sample(1.6), 0)

  // 2. Large forward lean & big head tilt
  assert.ok(tracks.get('LeanInput').sample(1.5) < -20.0, 'strong forward lean')
  assert.ok(tracks.get('AngleZ').sample(1.6) > 20.0, '22 degree big head tilt')

  // 3. Curious O-mouth (negative mouth form) and opening
  assert.ok(tracks.get('ParamMouthForm').sample(1.5) < -0.15, 'O-mouth shape')
  assert.ok(tracks.get('ParamMouthOpenY').sample(1.65) > 0.30, 'open O-mouth')

  // 4. Double bouncy steps (PositionY vertical oscillations)
  assert.ok(tracks.get('PositionY').sample(1.25) < -1.5, 'dip 1')
  assert.ok(tracks.get('PositionY').sample(1.65) > 3.0, 'bounce 1')
  assert.ok(tracks.get('PositionY').sample(2.35) < -1.0, 'dip 2')
  assert.ok(tracks.get('PositionY').sample(2.75) > 2.5, 'bounce 2')

  // 5. Smile on recognition
  assert.ok(tracks.get('ParamMouthForm').sample(3.6) > 0.50, 'pleased smile')

  // 6. Clean loop seam
  for (const c of motion.Curves) {
    assert.equal(c.Segments[1], c.Segments.at(-1), `${c.Id} loop seam matches`)
    assert.ok(c.Segments.every(Number.isFinite), `${c.Id} all values finite`)
  }
})

test('installDafishBodyLedCuriousMotion registers motion group on model', () => {
  const manager = { definitions: {}, motionGroups: {}, state: {}, createMotion: data => ({ data }) }
  const model = { internalModel: { motionManager: manager } }
  const installed = curious.installDafishBodyLedCuriousMotion(model, parameters())
  assert.ok(installed)
  assert.ok(manager.definitions[curious.DAFISH_BODY_LED_CURIOUS_MOTION])

  const preset = curious.createDafishBodyLedCuriousPreset()
  assert.equal(preset.id, 'dafish_body_led_curious')
  assert.equal(preset.motion.group, curious.DAFISH_BODY_LED_CURIOUS_MOTION)
})
