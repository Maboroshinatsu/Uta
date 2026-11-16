const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./support/settings-loader.cjs')()
const thinking = load('renderer/services/live2d/dafish-body-led-thinking')
const common = load('renderer/services/live2d/dafish-happy-performance')

function parameters() {
  return [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput',
    'Movement1', 'Movement2', 'Movement3', 'Param56', 'Param57', 'key12',
    'ParamBrowLY', 'ParamBrowRY',
    'ParamMouthForm', 'ParamMouthOpenY', 'ParamEyeLOpen', 'ParamEyeROpen',
    'ParamEyeBallX', 'ParamEyeBallY',
  ].map(id => ({
    id,
    min: id.startsWith('Movement') || id.startsWith('key') ? 0 : -30,
    max: id.startsWith('Movement') || id.startsWith('key') ? 1 : 30,
    default: 0,
  }))
}

test('thinking motion builds with monocle, upward inquiring gaze, and eureka moment', () => {
  const motion = thinking.buildDafishBodyLedThinkingMotion(parameters())
  assert.ok(motion)
  assert.equal(motion.Meta.Duration, 5.6)
  assert.equal(motion.Meta.Loop, true)

  const tracks = new Map(motion.Curves.map(c => [c.Id, common.compileMotionTrack(c.Segments)]))

  // 1. Monocle accessory active
  assert.ok(tracks.get('key12').sample(1.5) > 0.99, 'monocle accessory active')

  // 2. Head up and tilted
  assert.ok(tracks.get('AngleY').sample(1.5) > 5.0, 'head chin up in thought')
  assert.ok(tracks.get('AngleZ').sample(1.5) < -6.0, 'head tilted thoughtfully')

  // 3. Upward gaze wandering
  assert.ok(tracks.get('ParamEyeBallY').sample(1.5) > 0.40, 'looking up thoughtfully')

  // 4. Eureka moment (eyes return to center and smile)
  assert.ok(Math.abs(tracks.get('ParamEyeBallY').sample(3.3)) < 0.1, 'gaze returns to user')
  assert.ok(tracks.get('ParamMouthForm').sample(3.5) > 0.60, 'confident eureka smile')

  // 5. Return to neutral seam
  for (const c of motion.Curves) {
    assert.equal(c.Segments[1], c.Segments.at(-1), `${c.Id} loop seam matches`)
    assert.ok(c.Segments.every(Number.isFinite), `${c.Id} all values finite`)
  }
})

test('installDafishBodyLedThinkingMotion registers motion group on model', () => {
  const manager = { definitions: {}, motionGroups: {}, state: {}, createMotion: data => ({ data }) }
  const model = { internalModel: { motionManager: manager } }
  const installed = thinking.installDafishBodyLedThinkingMotion(model, parameters())
  assert.ok(installed)
  assert.ok(manager.definitions[thinking.DAFISH_BODY_LED_THINKING_MOTION])

  const preset = thinking.createDafishBodyLedThinkingPreset()
  assert.equal(preset.id, 'dafish_body_led_thinking')
  assert.equal(preset.motion.group, thinking.DAFISH_BODY_LED_THINKING_MOTION)
})
