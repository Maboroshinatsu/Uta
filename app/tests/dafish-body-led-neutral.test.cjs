const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./support/settings-loader.cjs')()
const neutral = load('renderer/services/live2d/dafish-body-led-neutral')
const common = load('renderer/services/live2d/dafish-happy-performance')

function parameters() {
  return [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ',
    'Movement1', 'Movement2', 'Movement3', 'Param56', 'Param57',
    'ParamBrowLY', 'ParamBrowRY', 'ParamMouthForm', 'ParamMouthOpenY',
    'ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeBallX', 'ParamEyeBallY',
  ].map(id => ({
    id,
    min: id.startsWith('Movement') ? 0 : -30,
    max: id.startsWith('Movement') ? 1 : 30,
    default: 0,
  }))
}

test('neutral motion builds with gentle breathing cycles and double physiological blinks', () => {
  const motion = neutral.buildDafishBodyLedNeutralMotion(parameters())
  assert.ok(motion)
  assert.equal(motion.Meta.Duration, 6.0)
  assert.equal(motion.Meta.Loop, true)

  const tracks = new Map(motion.Curves.map(c => [c.Id, common.compileMotionTrack(c.Segments)]))

  // 1. Gentle vertical breathing cycles
  assert.ok(tracks.get('PositionY').sample(1.5) > 1.0, 'inhale 1')
  assert.ok(tracks.get('PositionY').sample(3.0) < -0.8, 'exhale 1')
  assert.ok(tracks.get('PositionY').sample(4.5) > 1.0, 'inhale 2')

  // 2. Double 140ms blinks
  assert.ok(tracks.get('ParamEyeLOpen').sample(1.82) < 0.15, 'blink 1')
  assert.ok(tracks.get('ParamEyeLOpen').sample(2.5) > 0.90, 'open eye')
  assert.ok(tracks.get('ParamEyeLOpen').sample(4.52) < 0.15, 'blink 2')

  // 3. Loop seam
  for (const c of motion.Curves) {
    assert.equal(c.Segments[1], c.Segments.at(-1), `${c.Id} loop seam matches`)
    assert.ok(c.Segments.every(Number.isFinite), `${c.Id} all values finite`)
  }
})

test('installDafishBodyLedNeutralMotion registers motion group on model', () => {
  const manager = { definitions: {}, motionGroups: {}, state: {}, createMotion: data => ({ data }) }
  const model = { internalModel: { motionManager: manager } }
  const installed = neutral.installDafishBodyLedNeutralMotion(model, parameters())
  assert.ok(installed)
  assert.ok(manager.definitions[neutral.DAFISH_BODY_LED_NEUTRAL_MOTION])

  const preset = neutral.createDafishBodyLedNeutralPreset()
  assert.equal(preset.id, 'neutral')
  assert.equal(preset.motion.group, neutral.DAFISH_BODY_LED_NEUTRAL_MOTION)
})
