const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./support/settings-loader.cjs')()
const shy = load('renderer/services/live2d/dafish-body-led-shy')
const common = load('renderer/services/live2d/dafish-happy-performance')

function parameters() {
  return [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput',
    'Movement1', 'Movement2', 'Movement3', 'Param59', 'Param60', 'Param61', 'Param62',
    'Param56', 'Param57', 'key7', 'ParamBrowLY', 'ParamBrowRY',
    'ParamMouthForm', 'ParamMouthOpenY', 'ParamEyeLOpen', 'ParamEyeROpen',
    'ParamEyeBallX', 'ParamEyeBallY', 'EyeSmile',
  ].map(id => ({
    id,
    min: id.startsWith('Movement') || id.startsWith('key') ? 0 : -30,
    max: id.startsWith('Movement') || id.startsWith('key') ? 1 : 30,
    default: 0,
  }))
}

test('shy motion builds with blush, chest hand, and bashful gaze peek', () => {
  const motion = shy.buildDafishBodyLedShyMotion(parameters())
  assert.ok(motion)
  assert.equal(motion.Meta.Duration, 5.6)
  assert.equal(motion.Meta.Loop, true)

  const tracks = new Map(motion.Curves.map(c => [c.Id, common.compileMotionTrack(c.Segments)]))

  // 1. Deep blush and chest hand
  assert.ok(tracks.get('key7').sample(1.5) > 0.85, 'deep blush active')
  assert.ok(tracks.get('Movement2').sample(1.5) > 0.99, 'chest hand active')

  // 2. Head down and tilted away
  assert.ok(tracks.get('AngleY').sample(1.5) < -4.0, 'head down')
  assert.ok(tracks.get('AngleZ').sample(1.5) > 6.0, 'head tilted shyly')

  // 3. Bashful gaze: looks down first, then peeks up
  assert.ok(tracks.get('ParamEyeBallY').sample(1.2) < -0.25, 'looks down initially')
  assert.ok(tracks.get('ParamEyeBallY').sample(2.4) > 0.15, 'peeks up at screen')
  assert.ok(tracks.get('ParamMouthForm').sample(2.4) > 0.60, 'sweet shy smile while peeking')

  // 4. Return to neutral seam
  for (const c of motion.Curves) {
    assert.equal(c.Segments[1], c.Segments.at(-1), `${c.Id} loop seam matches`)
    assert.ok(c.Segments.every(Number.isFinite), `${c.Id} all values finite`)
  }
})

test('installDafishBodyLedShyMotion registers motion group on model', () => {
  const manager = { definitions: {}, motionGroups: {}, state: {}, createMotion: data => ({ data }) }
  const model = { internalModel: { motionManager: manager } }
  const installed = shy.installDafishBodyLedShyMotion(model, parameters())
  assert.ok(installed)
  assert.ok(manager.definitions[shy.DAFISH_BODY_LED_SHY_MOTION])

  const preset = shy.createDafishBodyLedShyPreset()
  assert.equal(preset.id, 'dafish_body_led_shy')
  assert.equal(preset.motion.group, shy.DAFISH_BODY_LED_SHY_MOTION)
})
