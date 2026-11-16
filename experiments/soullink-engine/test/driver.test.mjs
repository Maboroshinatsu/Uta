import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import {
  createFullCapabilityProfile,
  createIntent,
  createNativeAnimationOptions,
  createPartialCapabilityProfile,
  parameter,
} from '../fixtures/capability-profiles.mjs'
import {
  IMPLEMENTATION_NOTES,
  buildSoullinkProfile,
  createCounters,
  createUtaSoullinkSession,
  filterEngineParameters,
} from '../src/driver.mjs'
import {
  assertFiniteParameters,
  assertNoPhysics,
  assertWhitelist,
  assertWithinRanges,
} from '../src/assertions.mjs'
import { PUBLIC_BUNDLE } from '../scripts/lib/paths.mjs'

const api = await import(pathToFileURL(PUBLIC_BUNDLE).href)

const fastEmotion = {
  emotionHoldSeconds: 1,
  decayRate: 0.32,
  targetApproachRate: 2.2,
  ambientDriftStrength: 0,
}

test('confirmed reversed mappings are explicitly excluded rather than driven backwards', () => {
  const input = createFullCapabilityProfile()
  for (const item of input.mappings) if (['headX', 'mouthForm'].includes(item.channel)) item.direction = 'reversed'
  const { diagnostics, whitelist } = buildSoullinkProfile(api, input)
  assert.equal(whitelist.has('ParamAngleX'), false)
  assert.equal(whitelist.has('ParamMouthForm'), false)
  assert.ok(whitelist.has('ParamAngleY'))
  for (const channel of ['headX', 'mouthForm']) {
    assert.equal(diagnostics.skippedChannels.find(item => item.channel === channel).reason, 'unsupported-direction')
    assert.equal(diagnostics.mappedChannels.includes(channel), false)
  }
})

test('a model with only reversed mappings fails with actionable bridge diagnostics', () => {
  const input = createFullCapabilityProfile()
  for (const item of input.mappings) item.direction = 'reversed'
  assert.throws(() => buildSoullinkProfile(api, input), error =>
    error.name === 'BridgeError' && error.diagnostics.skippedChannels.every(item => item.reason === 'unsupported-direction'))
})

test('bridge maps only confirmed non-physics channels and preserves asymmetric mouth form', () => {
  const { profile, diagnostics, whitelist, modelParameters } = buildSoullinkProfile(api, createFullCapabilityProfile())
  assert.equal(profile.schemaVersion, 2)
  assert.equal(profile.neutralParams.ParamMouthForm, -0.5)
  assert.equal(profile.neutralParams.ParamMouthOpenY, 0)
  assert.equal(profile.neutralParams.ParamEyeLOpen, 1)
  assert.equal(profile.neutralParams.ParamBreath, 0)
  assert.deepEqual(diagnostics.mouthForm, {
    parameterId: 'ParamMouthForm',
    min: -2,
    max: 1,
    defaultValue: -0.5,
    smileSpan: 1.5,
    frownSpan: 1.5,
    defaultIsZero: false,
    rangeCenter: -0.5,
    rangeCenteredOnZero: false,
  })
  assert.ok(profile.parameterMap.mouthSmile)
  assert.ok(profile.parameterMap.mouthFrown)
  assert.equal(profile.parameterMap.mouthSmile.mode, 'add')
  assert.equal(profile.parameterMap.mouthFrown.mode, 'subtract')
  assert.ok(whitelist.has('ParamMouthForm'))
  assert.ok(!whitelist.has('ParamCheek38'), 'private parameters must not become drivable targets')
  assert.ok(modelParameters.has('ParamCheek38'), 'private parameters remain known model facts but are not driven')
  assert.match(profile.modelPath, /^uta-logical:\/\/model\//)
  assert.ok(!profile.modelPath.includes(':\\'))
  assert.equal(profile.capabilities.mouthOpen, true)
  assert.equal(profile.capabilities.mouthSmile, true)
  assert.equal(profile.capabilities.eyeBlink, true)
  assert.ok(Object.keys(profile.parameterSmoothing).includes('ParamMouthOpenY'))
})

test('partial profile excludes physics outputs, missing channels and private parameters', () => {
  const { diagnostics, whitelist } = buildSoullinkProfile(api, createPartialCapabilityProfile())
  for (const channel of ['headX', 'eyeOpenLeft', 'eyeOpenRight', 'mouthOpen', 'mouthForm', 'breath']) {
    assert.ok(diagnostics.mappedChannels.includes(channel), `expected ${channel} to be mapped`)
  }
  const skipped = new Map(diagnostics.skippedChannels.map((entry) => [entry.channel, entry.reason]))
  assert.equal(skipped.get('bodyX'), 'physics-output')
  assert.equal(skipped.get('bodyY'), 'physics-output')
  assert.equal(skipped.get('bodyZ'), 'physics-output')
  assert.equal(skipped.get('browLeft'), 'missing-parameter')
  assert.equal(skipped.get('gazeX'), 'missing-parameter')
  assert.ok(!whitelist.has('ParamBodyAngleX'))
  assert.ok(!whitelist.has('ParamBodyAngleY'))
  assert.ok(!whitelist.has('ParamBodyAngleZ'))
  assert.ok(!whitelist.has('ParamCheek38'))
})

test('output filter drops outside-whitelist, physics and non-finite values and clamps ranges', () => {
  const whitelist = new Map([
    ['ParamAngleX', parameter('ParamAngleX', -30, 30, 0)],
    ['ParamAngleY', parameter('ParamAngleY', -30, 30, 0)],
    ['ParamMouthForm', parameter('ParamMouthForm', -2, 1, -0.5)],
    ['ParamBodyAngleX', parameter('ParamBodyAngleX', -10, 10, 0, { physicsOutput: true })],
  ])
  const counters = createCounters()
  const params = filterEngineParameters({
    ParamAngleX: 100,
    ParamAngleY: Number.NaN,
    ParamMouthForm: -0.5,
    ParamBodyAngleX: 4,
    ParamCheek38: 2,
    UnknownParam: 1,
    ParamMouthOpenY: 0.5,
  }, whitelist, counters)
  assert.deepEqual(params, { ParamAngleX: 30, ParamMouthForm: -0.5 })
  assert.equal(counters.droppedOutsideWhitelist, 3)
  assert.equal(counters.droppedPhysics, 1)
  assert.equal(counters.droppedNonFinite, 1)
  assert.equal(counters.clamped, 1)
  assert.equal(counters.emitted, 2)
})

test('session output stays finite, whitelisted, physics-safe and asymmetric', () => {
  const session = createUtaSoullinkSession(api, createPartialCapabilityProfile(), {
    seed: 20261023,
    emotionPersonality: fastEmotion,
  })
  try {
    session.trigger(createIntent('happy', 0.9), 0)
    let observedPositiveForm = false
    let observedNegativeForm = false
    for (let frame = 0; frame < 360; frame += 1) {
      const result = session.update(frame / 60, 1 / 60)
      assert.equal(result.status, 'ok')
      assertFiniteParameters(result.params)
      assertWhitelist(result.params, session.bridge.whitelist)
      assertNoPhysics(result.params, session.bridge.whitelist)
      assertWithinRanges(result.params, session.bridge.whitelist)
      if (result.params.ParamMouthForm > -0.45) observedPositiveForm = true
      if (result.params.ParamMouthForm < -0.55) observedNegativeForm = true
    }
    assert.equal(observedPositiveForm, true, 'happy should move mouthForm above the -0.5 default')
    session.trigger(createIntent('sad', 0.9), 6)
    for (let frame = 0; frame < 240; frame += 1) {
      const result = session.update(6 + frame / 60, 1 / 60)
      assertWithinRanges(result.params, session.bridge.whitelist)
      if (result.params.ParamMouthForm < -0.55) observedNegativeForm = true
    }
    assert.equal(observedNegativeForm, true, 'sad should move mouthForm below the -0.5 default')
    const diagnostics = session.getDiagnostics()
    assert.equal(diagnostics.neutralOutput.ParamMouthForm, -0.5)
    assert.equal(diagnostics.counters.droppedPhysics, 0)
    assert.equal(diagnostics.counters.droppedOutsideWhitelist, 0)
  } finally {
    session.dispose()
  }
})

test('cancel is a Uta wrapper release tail and never replays the old intent', () => {
  const session = createUtaSoullinkSession(api, createFullCapabilityProfile(), {
    seed: 4242,
    releaseSeconds: 0.2,
    emotionPersonality: fastEmotion,
  })
  try {
    session.trigger(createIntent('happy', 1), 0)
    for (let frame = 0; frame < 60; frame += 1) session.update(frame / 60, 1 / 60)
    const beforeCancel = session.update(1, 1 / 60)
    const cancel = session.cancel(1 + 1 / 60)
    assert.equal(cancel.status, 'cancelled')
    assert.equal(cancel.release.owner, 'uta-wrapper-cancel-release')
    assert.equal(cancel.release.engineCall, 'SoullinkRuntime.reset')
    let previousDistance = Number.POSITIVE_INFINITY
    let finalResult = null
    for (let frame = 0; frame < 20; frame += 1) {
      const result = session.update(1 + (frame + 2) / 60, 1 / 60)
      assert.ok(result.status === 'releasing' || result.status === 'released')
      assertFiniteParameters(result.params)
      assertWhitelist(result.params, session.bridge.whitelist)
      const distance = Object.entries(result.params).reduce(
        (total, [id, value]) => total + Math.abs(value - session.bridge.diagnostics.neutralParams[id]),
        0,
      )
      assert.ok(distance <= previousDistance + 1e-9, 'release tail must not move away from model defaults')
      previousDistance = distance
      finalResult = result
    }
    assert.equal(finalResult.status, 'released')
    for (const [id, neutral] of Object.entries(session.bridge.diagnostics.neutralParams)) {
      assert.ok(Math.abs(finalResult.params[id] - neutral) < 1e-9, `${id} did not settle on its model default`)
    }
    assert.equal(finalResult.action, null)
    assert.ok(beforeCancel.status === 'ok')
  } finally {
    session.dispose()
  }
})

test('generation rejects stale updates and stale triggers', () => {
  const session = createUtaSoullinkSession(api, createFullCapabilityProfile(), { seed: 77 })
  try {
    const first = session.generation
    session.trigger(createIntent('happy', 0.6), 0)
    session.update(0, 1 / 60)
    const next = session.beginGeneration()
    assert.equal(next, first + 1)
    const staleUpdate = session.update(1 / 60, 1 / 60, { generation: first })
    assert.equal(staleUpdate.status, 'stale')
    assert.deepEqual(staleUpdate.params, {})
    const staleTrigger = session.trigger(createIntent('sad', 0.6), 1, { generation: first })
    assert.equal(staleTrigger.status, 'stale')
    const currentTrigger = session.trigger(createIntent('happy', 0.6), 1, { generation: next })
    assert.equal(currentTrigger.status, 'accepted')
    const currentUpdate = session.update(1, 1 / 60, { generation: next })
    assert.equal(currentUpdate.status, 'ok')
    assert.ok(Object.keys(currentUpdate.params).length > 0)
  } finally {
    session.dispose()
  }
})

test('native action directives are replaced and old action handles become stale', () => {
  const session = createUtaSoullinkSession(api, createFullCapabilityProfile(), {
    seed: 99,
    ...createNativeAnimationOptions(),
  })
  try {
    const happy = session.trigger(createIntent('happy', 0.9), 0)
    assert.equal(happy.action.expression, 'synthetic-happy.exp3')
    assert.equal(happy.action.motion.group, 'Idle')
    assert.equal(session.isActionCurrent(happy.action), true)
    const sad = session.trigger(createIntent('sad', 0.9), 1)
    assert.equal(sad.action.expression, 'synthetic-sad.exp3')
    assert.ok(sad.action.token > happy.action.token)
    assert.equal(session.isActionCurrent(happy.action), false)
    assert.equal(session.isActionCurrent(sad.action), true)
    session.cancel(2)
    assert.equal(session.getAction(), null)
    assert.equal(session.isActionCurrent(sad.action), false)
    session.update(2.1, 1 / 60)
    assert.equal(session.getAction(), null)
  } finally {
    session.dispose()
  }
})

test('public engine itself has no cancel or generation surface', () => {
  const runtime = new api.SoullinkRuntime({
    profile: buildSoullinkProfile(api, createFullCapabilityProfile()).profile,
    motionStyle: { ...api.motionStylePresets.natural, seed: 1 },
  })
  assert.equal(typeof runtime.cancel, 'undefined')
  assert.equal(typeof runtime.beginGeneration, 'undefined')
  const snapshot = runtime.getSnapshot()
  assert.equal(snapshot.generation, undefined)
  assert.ok(IMPLEMENTATION_NOTES.engineGaps.includes('no native cancel or generation API; only reset() exists'))
})
