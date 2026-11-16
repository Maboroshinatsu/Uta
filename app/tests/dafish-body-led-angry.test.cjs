const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./support/settings-loader.cjs')()
const angry = load('renderer/services/live2d/dafish-body-led-angry')
const common = load('renderer/services/live2d/dafish-happy-performance')

function parameters() {
  return [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput',
    'Movement1', 'Movement2', 'Movement3', 'Param56', 'Param57', 'key7', 'key9',
    'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLAngle', 'ParamBrowRAngle',
    'ParamMouthForm', 'ParamMouthOpenY', 'ParamEyeLOpen', 'ParamEyeROpen',
    'ParamEyeBallX', 'ParamEyeBallY',
  ].map(id => ({
    id,
    min: id.startsWith('Movement') || id.startsWith('key') ? 0 : -30,
    max: id.startsWith('Movement') || id.startsWith('key') ? 1 : 30,
    default: 0,
  }))
}

test('angry motion builds with strong forward lean, direct lock, blush and teeth', () => {
  const motion = angry.buildDafishBodyLedAngryMotion(parameters())
  assert.ok(motion)
  assert.equal(motion.Meta.Duration, 5.6)
  assert.equal(motion.Meta.Loop, true)

  const tracks = new Map(motion.Curves.map(c => [c.Id, common.compileMotionTrack(c.Segments)]))

  // 1. Forward-leaning posture without head tilt
  assert.ok(tracks.get('LeanInput').sample(1.5) < -20.0, 'strong forward lean')
  assert.ok(tracks.get('PositionZ').sample(1.5) > 10.0, 'approaching camera')
  assert.equal(Math.abs(tracks.get('AngleX').sample(1.5)), 0, 'head facing forward without turn')
  assert.equal(Math.abs(tracks.get('AngleZ').sample(1.5)), 0, 'head without sideways tilt')
  assert.equal(Math.abs(tracks.get('PositionX').sample(1.5)), 0, 'body centered')

  // 2. Blush active, rabbit teeth strictly 0
  assert.ok(tracks.get('key7').sample(1.5) > 0.80, 'flushed red cheeks')
  assert.equal(tracks.get('key9').sample(1.5), 0, 'no rabbit teeth in angry motion')

  // 3. Direct eye contact
  assert.equal(tracks.get('ParamEyeBallX').sample(1.5), 0, 'locking eyes with user')

  // 4. Return to neutral seam
  for (const c of motion.Curves) {
    assert.equal(c.Segments[1], c.Segments.at(-1), `${c.Id} loop seam matches`)
    assert.ok(c.Segments.every(Number.isFinite), `${c.Id} all values finite`)
  }
})

test('installDafishBodyLedAngryMotion registers motion group on model', () => {
  const manager = { definitions: {}, motionGroups: {}, state: {}, createMotion: data => ({ data }) }
  const model = { internalModel: { motionManager: manager } }
  const installed = angry.installDafishBodyLedAngryMotion(model, parameters())
  assert.ok(installed)
  assert.ok(manager.definitions[angry.DAFISH_BODY_LED_ANGRY_MOTION])

  const preset = angry.createDafishBodyLedAngryPreset()
  assert.equal(preset.id, 'dafish_body_led_angry')
  assert.equal(preset.motion.group, angry.DAFISH_BODY_LED_ANGRY_MOTION)
})
