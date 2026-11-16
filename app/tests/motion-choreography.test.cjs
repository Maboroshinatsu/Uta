'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./support/settings-loader.cjs')()
const { compileMotionChoreography, parseMotionRequest } = load('shared/motion-choreography')
const { createMotionChoreography } = load('renderer/services/motion-choreography')
const { parsePresetImport } = load('renderer/services/preset-transfer')

const parameters = [
  { id: 'Head', label: '头部', min: -30, max: 30, default: 0 },
  { id: 'Smile', label: '微笑', min: 0, max: 1, default: 0 },
]
const track = (parameterId, ...points) => ({ parameterId, keyframes: points.map(([atMs, value]) => ({ atMs, value })) })
const plan = { version: 1, tracks: [track('Head', [400, 16], [800, 0]), track('Smile', [200, 0.5], [600, 0])] }

test('long native clips stay in discovery while the choreography duration limit remains explicit', () => {
  const clips = [{ group: '', index: 0, label: 'Long idle', durationMs: 18567 }]
  const run = createMotionChoreography({ getHost: () => 'codex', getModel: () => ({ name: 'Model', revision: 'a', parameters, nativeMotions: clips }),
    isEditing: () => false, play() { throw Error('validation must not play') }, stop: () => false })
  const result = run({ operation: 'capabilities', hostId: 'codex', sessionId: 's' })
  assert.equal(result.nativeMotions.length, 1)
  assert.equal(result.limits.maxDurationMs, 12000)
  const validation = compileMotionChoreography({ version: 1, tracks: [], nativeMotion: { group: '', index: 0 } }, parameters, [], clips)
  assert.equal(validation.ok, false)
  assert.match(validation.error, /native-motion-too-long/)
})

test('concurrent tracks compile against one clock without inventing parameters', () => {
  const result = compileMotionChoreography(plan, parameters)
  assert.equal(result.ok, true)
  assert.equal(result.durationMs, 800)
  assert.deepEqual(JSON.parse(JSON.stringify(result.steps.map(step => [step.durationMs, step.parameters]))), [
    [200, { Head: 8, Smile: 0.5 }], [200, { Head: 16, Smile: 0.25 }],
    [200, { Head: 8, Smile: 0 }], [200, { Head: 0, Smile: 0 }],
  ])
  for (const tracks of [
    [track('PhysicsOutput', [200, 1])],
    [track('Head', [200, 31])],
    [track('Head', [200, 3]), track('Head', [300, 4])],
    [track('Head', [400, 3], [200, 4])],
    [track('Head', [20, 4])],
  ]) assert.equal(compileMotionChoreography({ version: 1, tracks }, parameters).ok, false)
})

test('validation is inert and playback receipts belong to the submitting session and model', () => {
  let revision = 'model-a', editing = false, running, settle
  const run = createMotionChoreography({
    getHost: () => 'codex', getModel: () => ({ name: 'Model', revision, parameters }), isEditing: () => editing,
    play(preset, done) { settle?.('interrupted'); running = preset; settle = done; return true },
    stop(id) { if (running?.id !== id) return false; running = null; settle('interrupted'); return true },
  })
  const owner = { hostId: 'codex', sessionId: 'chat-a' }
  const request = { ...owner, revision, plan, jobId: 'motion-abcdefghijk' }
  assert.equal(run({ ...request, operation: 'validate' }).status, 'validated')
  assert.equal(running, undefined)
  editing = true
  assert.equal(run({ ...request, operation: 'play' }).error, 'workshop-busy')
  editing = false
  assert.equal(run({ ...request, operation: 'play' }).status, 'playing')
  const read = { ...owner, operation: 'status', jobId: request.jobId }
  assert.equal(run({ ...read, sessionId: 'chat-b' }).error, 'motion-job-not-found')
  assert.equal(run({ ...read, hostId: 'opencode' }).error, 'host-not-bound')
  settle('completed')
  assert.equal(run(read).status, 'completed')
  assert.equal(run({ ...request, operation: 'play' }).status, 'completed')
  revision = 'model-b'
  assert.match(run({ ...request, operation: 'play' }).error, /model-changed/)
  const second = { ...request, revision, operation: 'play', jobId: 'motion-abcdefghijkl' }
  assert.equal(run(second).status, 'playing')
  assert.equal(run({ ...second, operation: 'stop' }).status, 'interrupted')
  assert.equal(running, null)
})

test('default preset compilation returns a model-bound import without starting playback', () => {
  const url = 'uta://models/local/RetrynowMiku.model3.json'
  const slot = { id: 'neutral', label: '日常待机', group: '日常待机', emotion: 'neutral', finishMode: 'hold' }
  const run = createMotionChoreography({
    getHost: () => 'antigravity', isEditing: () => true,
    getModel: () => ({ name: 'RetrynowMiku', revision: 'retry-a', signature: 'rig-a', parameters, url, presetSlots: [slot] }),
    play: () => { throw Error('compile must not play') }, stop: () => false,
  })
  const owner = { hostId: 'antigravity', sessionId: 'session-a' }
  const capabilities = run({ ...owner, operation: 'capabilities' })
  assert.equal(capabilities.presetSlots[0].id, 'neutral')
  const raw = { ...owner, operation: 'compile_preset', revision: 'retry-a', slotId: 'neutral', finishMode: 'loop', plan }
  const result = run(parseMotionRequest(raw))
  assert.equal(result.status, 'compiled')
  const draft = JSON.stringify(result.draft)
  const imported = parsePresetImport(draft, 'uta://models/other/RetrynowMiku.model3.json', value => value, undefined, 'rig-a')
  assert.equal(imported.ok, true)
  assert.equal(imported.presets[0].id, slot.id)
  assert.equal(imported.presets[0].group, slot.group)
  assert.equal(imported.presets[0].finishMode, 'loop')
  assert.equal(parsePresetImport(draft, 'uta://models/other/miku.model3.json', value => value).error, 'model-mismatch')
  assert.equal(run(parseMotionRequest({ ...raw, slotId: 'made-up-slot' })).ok, false)
  assert.equal(run(parseMotionRequest({ ...raw, revision: 'wrong-revision' })).ok, false)
  assert.match(run(parseMotionRequest({ ...raw, plan: { version: 1, tracks: [track('Head', [400, 16], [800, 3])] } })).error, /loop-must-return/)
  assert.equal(parseMotionRequest({ ...raw, finishMode: 'whatever' }), undefined)
})

test('native clips and temporary model controls compile into an existing preset sequence', () => {
  const controls = [{ id: 'prop:1', baseId: 'prop', label: '手持道具', category: 'pose_prop', parameters: ['Prop'], parts: ['PartProp'] }]
  const clip = { group: 'Wave', index: 1, durationMs: 800, writes: { parameters: ['Head'], parts: [] } }
  const mixed = { version: 1, tracks: [], nativeMotion: { group: 'Wave', index: 1 }, durationMs: 1000,
    controlKeyframes: [{ atMs: 0, controls: ['prop:1'] }, { atMs: 800, controls: [] }] }
  const compiled = compileMotionChoreography(mixed, parameters, controls, [clip])
  assert.equal(compiled.ok, true)
  assert.equal(compiled.motion.group, 'Wave')
  assert.deepEqual(JSON.parse(JSON.stringify(compiled.steps)), [
    { durationMs: 800, holdMs: 0, controls: ['prop:1'], parameters: {} },
    { durationMs: 200, holdMs: 0, controls: [], parameters: {} },
  ])
  assert.match(compileMotionChoreography({ ...mixed, tracks: [track('Head', [400, 10])] }, parameters, controls, [clip]).error, /native-motion-conflict/)
  assert.match(compileMotionChoreography(mixed, parameters, controls, [{ ...clip, writes: undefined }]).error, /ownership-unknown/)
  assert.match(compileMotionChoreography({ ...mixed, nativeMotion: { group: 'Wave', index: 2 } }, parameters, controls, [clip]).error, /unavailable/)
  assert.match(compileMotionChoreography({ ...mixed, controlKeyframes: [{ atMs: 0, controls: ['prop'] }] }, parameters, controls, [clip]).error, /control-unavailable/)
  const unnamed = { group: '', index: 1, label: 'idle2', durationMs: 1133 }
  const nativeOnly = compileMotionChoreography({ version: 1, tracks: [], nativeMotion: { group: '', index: 1 } }, parameters, [], [unnamed])
  assert.equal(nativeOnly.ok, true)
  assert.equal(nativeOnly.title, 'idle2')
  assert.equal(nativeOnly.motion.group, '')

  let playing, markStarted, finish
  const run = createMotionChoreography({
    getHost: () => 'codex', isEditing: () => false,
    getModel: () => ({ name: 'Model', revision: 'a', url: 'uta://models/a/pet.model3.json', parameters, controls, nativeMotions: [clip],
      presetSlots: [{ id: 'wave', label: '挥手', group: '挥手', emotion: 'neutral', finishMode: 'revert' }] }),
    play(preset, onEnd, onStarted) { playing = preset; finish = onEnd; markStarted = onStarted; return true }, stop: () => false,
  })
  const base = { hostId: 'codex', sessionId: 'chat-a', revision: 'a', plan: mixed }
  const jobId = 'job-native-123456'
  assert.equal(run({ ...base, operation: 'play', jobId }).status, 'starting')
  markStarted()
  assert.equal(run({ ...base, operation: 'status', jobId }).status, 'playing')
  finish('failed')
  assert.equal(run({ ...base, operation: 'status', jobId }).reason, 'native-motion-playback-failed')
  assert.equal(playing.motion.index, 1)
  assert.equal(playing.steps[0].controls[0], 'prop:1')
  const draft = run({ ...base, operation: 'compile_preset', slotId: 'wave' }).draft
  assert.equal(draft.presets[0].motion.group, 'Wave')
  assert.equal(draft.presets[0].steps[0].controls[0], 'prop:1')
})
