import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createFullCapabilityProfile,
  createPartialCapabilityProfile,
} from '../fixtures/capability-profiles.mjs'
import {
  loadPublicApi,
  runActionLifecycleScenario,
  runAllScenarios,
  runDeterminismScenario,
  runDtVariantsScenario,
  runEmotionGradientScenario,
  runMouthGateScenario,
  runProfileFilterScenario,
  runSpeechCancelScenario,
} from '../src/scenarios.mjs'
import { IMPLEMENTATION_NOTES } from '../src/driver.mjs'

const api = await loadPublicApi()
const fullProfile = createFullCapabilityProfile()
const partialProfile = createPartialCapabilityProfile()

test('emotion gradients rise, hold, decay and keep mouthForm in the real range', () => {
  const result = runEmotionGradientScenario(api, fullProfile)
  assert.equal(result.passed, true)
  assert.ok(result.facts.happy.valencePeak > 0.2)
  assert.ok(result.facts.sad.valencePeak < -0.2)
  assert.ok(result.facts.happy.mouthForm.max > -0.45)
  assert.ok(result.facts.sad.mouthForm.min < -0.55)
  for (const emotion of ['happy', 'sad']) {
    const facts = result.facts[emotion]
    assert.ok(Math.abs(facts.endValence) < Math.abs(facts.valencePeak), `${emotion} did not decay`)
    assert.ok(facts.mouthForm.min >= -2 && facts.mouthForm.max <= 1)
  }
})

test('voice-inactive mouth gate blocks surprise and manual mouth opening', () => {
  const result = runMouthGateScenario(api, fullProfile)
  assert.equal(result.passed, true)
  assert.equal(result.facts.voiceInactiveSurpriseMax, 0)
  assert.equal(result.facts.manualMouthOpenWhileInactive, 0)
  assert.ok(result.facts.voiceActiveMax > 0.05)
  assert.ok(result.facts.silentLast < 0.01)
  assert.ok(result.facts.endedLast < 1e-4)
  assert.equal(result.facts.gap, IMPLEMENTATION_NOTES.engineGaps[0])
})

test('speech silence, end and cancel expose the wrapper-owned release tail', () => {
  const result = runSpeechCancelScenario(api, fullProfile)
  assert.equal(result.passed, true)
  assert.ok(result.facts.speakingMax > 0.05)
  assert.ok(result.facts.pauseLast < 0.01)
  assert.ok(result.facts.endedLast < 1e-4)
  assert.equal(result.facts.releaseOwner, 'uta-wrapper-cancel-release')
  assert.equal(result.facts.finalStatus, 'released')
  assert.equal(result.facts.finalMouthOpen, 0)
  assert.equal(result.facts.wrapperOwned, true)
})

test('action replacement advances directives and cancel clears action ownership', () => {
  const result = runActionLifecycleScenario(api, fullProfile)
  assert.equal(result.passed, true)
  assert.ok(result.facts.secondToken > result.facts.firstToken)
  assert.equal(result.facts.replacementExpression, 'synthetic-sad.exp3')
  assert.equal(result.facts.oldActionStale, true)
  assert.equal(result.facts.cancelClearedAction, true)
})

test('dt=0 is stable and normal/100ms/large steps stay finite and in range', () => {
  const result = runDtVariantsScenario(api, fullProfile)
  assert.equal(result.passed, true)
  const zero = result.facts.variants.find((entry) => entry.dt === 0)
  assert.equal(zero.maxStep, 0)
  for (const variant of result.facts.variants) {
    assert.ok(variant.finalParamCount >= 12)
    assert.deepEqual(variant.statuses, ['ok'])
  }
  const large = result.facts.variants.find((entry) => entry.dt === 2.5)
  assert.ok(large.maxStep > 1, 'large dt should be allowed to catch up')
})

test('same seed and dt produce byte-identical traces', () => {
  const result = runDeterminismScenario(api, fullProfile)
  assert.equal(result.passed, true)
  assert.equal(result.facts.happy.deterministic, true)
  assert.equal(result.facts.sad.deterministic, true)
  assert.match(result.facts.happy.sha256, /^[0-9a-f]{64}$/)
})

test('partial profile never emits private or physics parameters and preserves -0.5 mouthForm', () => {
  const result = runProfileFilterScenario(api, partialProfile)
  assert.equal(result.passed, true)
  assert.ok(!result.facts.outputParameters.includes('ParamCheek38'))
  assert.ok(!result.facts.outputParameters.some((id) => id.startsWith('ParamBodyAngle')))
  assert.equal(result.facts.neutralMouthForm, -0.5)
  assert.ok(result.facts.mouthForm.max > -0.45)
  assert.equal(result.facts.counters.droppedOutsideWhitelist, 0)
  assert.equal(result.facts.counters.droppedPhysics, 0)
})

test('all synthetic scenarios pass together', () => {
  const results = runAllScenarios(api, { full: fullProfile, partial: partialProfile })
  const failures = results.filter((entry) => entry.passed !== true)
  assert.deepEqual(failures, [])
  assert.equal(results.length, 7)
})
