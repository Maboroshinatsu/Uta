import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadPublicApi,
  runEmotionGradientScenario,
  runMouthGateScenario,
  runProfileFilterScenario,
} from '../src/scenarios.mjs'
import { loadRealCapabilityProfile, summarizeCapabilityProfile } from '../src/real-profile.mjs'

const real = await loadRealCapabilityProfile()
const skip = real.available ? false : `real DS fixture unavailable: ${real.reason}`

test('real DS Core read matches the frozen report and releases the model', { skip }, () => {
  assert.equal(real.coreReport.matches, true)
  assert.equal(real.coreReport.count, 247)
  assert.equal(real.coreReport.parts, 92)
  assert.equal(real.coreReport.drawables, 269)
  assert.equal(real.coreReleased, true)
  assert.equal(real.manifest.contentSignature, '8f6042a7ff5060b5f4f84684d49f3a4fd48e81270616124467baf0a8815341c9')
  assert.equal(real.integrity.files, 59)
  assert.equal(real.integrity.totalBytes, 4141300)
  assert.deepEqual(real.integrity.missingRefs, [])
  assert.deepEqual(real.integrity.extraManifestFiles, [])
})

test('real bridge maps 12 confirmed channels and skips body physics outputs', { skip }, () => {
  const summary = summarizeCapabilityProfile(real.capabilityProfile)
  assert.equal(summary.parameterCount, 247)
  assert.equal(summary.expressionCount, 44)
  assert.equal(summary.motionCount, 8)
  assert.deepEqual(summary.availableChannels.sort(), [
    'breath',
    'browLeft',
    'browRight',
    'eyeOpenLeft',
    'eyeOpenRight',
    'gazeX',
    'gazeY',
    'headX',
    'headY',
    'headZ',
    'mouthForm',
    'mouthOpen',
  ])
  assert.deepEqual(summary.needsCalibration.map((entry) => entry.reason), [
    'physics-output',
    'physics-output',
    'physics-output',
  ])
  assert.deepEqual(summary.mouthForm, { min: -2, max: 1, defaultValue: -0.5 })
  assert.deepEqual(summary.mouthOpen, { min: 0, max: 1, defaultValue: 0 })
})

test('real profile runs gradients without physics/private output', { skip }, async () => {
  const api = await loadPublicApi()
  const result = runEmotionGradientScenario(api, real.capabilityProfile)
  assert.equal(result.passed, true)
  const filtered = runProfileFilterScenario(api, real.capabilityProfile)
  assert.equal(filtered.passed, true)
  assert.equal(filtered.facts.allowedParameters.length, 12)
  assert.ok(!filtered.facts.allowedParameters.some((id) => id.startsWith('ParamBodyAngle')))
  assert.equal(filtered.facts.neutralMouthForm, -0.5)
  assert.deepEqual(filtered.facts.counters, {
    droppedOutsideWhitelist: 0,
    droppedPhysics: 0,
    droppedNonFinite: 0,
    clamped: 0,
    emitted: 2880,
  })
})

test('real profile keeps the engine-native voice-inactive mouth gate', { skip }, async () => {
  const api = await loadPublicApi()
  const result = runMouthGateScenario(api, real.capabilityProfile)
  assert.equal(result.passed, true)
  assert.equal(result.facts.voiceInactiveSurpriseMax, 0)
  assert.equal(result.facts.manualMouthOpenWhileInactive, 0)
  assert.ok(result.facts.voiceActiveMax > 0.05)
})
