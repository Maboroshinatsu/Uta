const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./support/settings-loader.cjs')()
const wellActually = load('renderer/services/live2d/dafish-well-actually')
const common = load('renderer/services/live2d/dafish-happy-performance')

function parameters() {
  return [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput',
    'Movement1', 'Movement2', 'Movement3', 'Param36', 'Param39', 'Param40', 'Param41', 'Param42', 'Param43',
    'Param56', 'Param57', 'key9', 'key11', 'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLAngle', 'ParamBrowRAngle',
    'ParamMouthForm', 'ParamMouthOpenY', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeBallX', 'ParamEyeBallY',
  ].map(id => ({
    id,
    min: id.startsWith('Movement') || id.startsWith('key') ? 0 : -30,
    max: id.startsWith('Movement') || id.startsWith('key') ? 1 : 30,
    default: 0,
  }))
}

test('well actually motion builds with valid duration and 60 FPS curves', () => {
  const motion = wellActually.buildDafishWellActuallyMotion(parameters())
  assert.ok(motion)
  assert.equal(motion.Meta.Duration, 5.6)
  assert.equal(motion.Meta.Loop, true)

  const tracks = new Map(motion.Curves.map(c => [c.Id, common.compileMotionTrack(c.Segments)]))

  // 1. Meme accessories active at climax
  assert.equal(tracks.get('Movement1').sample(2.0), 0, 'dogtail grass is hidden')
  assert.equal(tracks.get('Movement2').sample(2.0), 0, 'chest hand is hidden')
  assert.ok(tracks.get('Movement3').sample(2.0) > 0.99, 'finger gesture is visible')
  assert.ok(tracks.get('key11').sample(2.0) > 0.99, 'glasses are visible')
  assert.ok(tracks.get('key9').sample(2.0) > 0.99, 'buck teeth are visible')

  // 2. Clear body displacement (body-led per skill guidelines)
  assert.ok(tracks.get('PositionZ').sample(1.6) > 12.0, 'torso/pelvis twist is prominent')
  assert.ok(tracks.get('PositionX').sample(1.6) < -8.0, 'lateral weight shift is clear')
  assert.ok(tracks.get('LeanInput').sample(1.6) < -15.0, 'forward lean towards user')

  // 3. Rhythmic beats in mouth and finger
  assert.ok(tracks.get('ParamMouthOpenY').sample(1.4) > 0.20, 'speaking open 1')
  assert.ok(tracks.get('ParamMouthOpenY').sample(1.75) < 0.12, 'speaking dip 1')
  assert.ok(tracks.get('ParamMouthOpenY').sample(2.4) > 0.20, 'speaking open 2')

  // 4. Clean seam and release
  assert.equal(tracks.get('Movement3').sample(5.0), 0, 'finger released')
  assert.equal(tracks.get('key11').sample(5.0), 0, 'glasses released')
  assert.equal(tracks.get('key9').sample(5.0), 0, 'buck teeth released')
  for (const c of motion.Curves) {
    assert.equal(c.Segments[1], c.Segments.at(-1), `${c.Id} loop seam matches`)
    assert.ok(c.Segments.every(Number.isFinite), `${c.Id} all values finite`)
  }
})

test('installDafishWellActuallyMotion registers motion group on model', () => {
  const manager = { definitions: {}, motionGroups: {}, state: {}, createMotion: data => ({ data }) }
  const model = { internalModel: { motionManager: manager } }
  const installed = wellActually.installDafishWellActuallyMotion(model, parameters())
  assert.ok(installed)
  assert.ok(manager.definitions[wellActually.DAFISH_WELL_ACTUALLY_MOTION])

  const preset = wellActually.createDafishWellActuallyPreset()
  assert.equal(preset.id, 'well_actually')
  assert.equal(preset.label, 'well actually......')
  assert.equal(preset.motion.group, wellActually.DAFISH_WELL_ACTUALLY_MOTION)
  assert.equal(preset.steps.length, 4)
  assert.deepEqual([...preset.steps[0].controls], ['竖食指', '黑框眼镜', '大牙'])
  assert.deepEqual([...preset.steps[1].controls], ['竖食指', '黑框眼镜', '大牙'])
  assert.deepEqual([...preset.steps[2].controls], [])
  assert.deepEqual([...preset.steps[3].controls], [])

  const dafishAdapter = require('../src/renderer/services/live2d/builtin-adapters/dafish.json')
  assert.equal(dafishAdapter.controls['黑框眼镜'].category, 'pose_prop')
  assert.equal(dafishAdapter.controls['单片眼镜'].category, 'pose_prop')
})
