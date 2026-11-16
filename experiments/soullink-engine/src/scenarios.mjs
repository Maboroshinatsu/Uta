import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import {
  createFullCapabilityProfile,
  createIntent,
  createNativeAnimationOptions,
  createPartialCapabilityProfile,
} from '../fixtures/capability-profiles.mjs'
import {
  assertFiniteParameters,
  assertNoPhysics,
  assertWhitelist,
  assertWithinRanges,
  ensure,
  summarizeSeries,
} from './assertions.mjs'
import { IMPLEMENTATION_NOTES, createUtaSoullinkSession } from './driver.mjs'
import { PUBLIC_BUNDLE } from '../scripts/lib/paths.mjs'

export const DEFAULT_SEED = 20261023
export const FAST_EMOTION = {
  emotionHoldSeconds: 1,
  decayRate: 0.32,
  targetApproachRate: 2.2,
  ambientDriftStrength: 0,
}

export async function loadPublicApi() {
  return import(pathToFileURL(PUBLIC_BUNDLE).href)
}

function checkFrame(result, session, scenarioId, frameIndex) {
  ensure(result.status === 'ok' || result.status === 'releasing' || result.status === 'released', `${scenarioId}: unexpected status ${result.status} at frame ${frameIndex}`)
  assertFiniteParameters(result.params, `${scenarioId}.frame${frameIndex}`)
  assertWhitelist(result.params, session.bridge.whitelist, `${scenarioId}.frame${frameIndex}`)
  assertNoPhysics(result.params, session.bridge.whitelist, `${scenarioId}.frame${frameIndex}`)
  assertWithinRanges(result.params, session.bridge.whitelist, `${scenarioId}.frame${frameIndex}`)
}

function simulate(session, scenarioId, options = {}) {
  const frames = options.frames ?? 300
  const dt = options.dt ?? 1 / 60
  let time = options.startTime ?? 0
  const samples = []
  for (let frame = 0; frame < frames; frame += 1) {
    const result = session.update(time, dt)
    checkFrame(result, session, scenarioId, frame)
    samples.push({
      time,
      status: result.status,
      params: { ...result.params },
      releaseRatio: result.release?.ratio ?? null,
      vad: result.snapshot === undefined ? null : { ...result.snapshot.vad.current },
      facs: result.snapshot === undefined
        ? null
        : {
            mouthOpen: result.snapshot.facs.mouthOpen,
            mouthSmile: result.snapshot.facs.mouthSmile,
            mouthFrown: result.snapshot.facs.mouthFrown,
            eyeOpen: result.snapshot.facs.eyeOpen,
          },
      action: result.action,
    })
    time += dt
  }
  return { samples, endTime: time }
}

function extreme(samples, selector) {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const sample of samples) {
    const value = selector(sample)
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}

function newSession(api, capabilityProfile, options = {}) {
  return createUtaSoullinkSession(api, capabilityProfile, {
    seed: options.seed ?? DEFAULT_SEED,
    emotionPersonality: options.emotionPersonality ?? FAST_EMOTION,
    releaseSeconds: options.releaseSeconds,
    ...(options.extra ?? {}),
  })
}

function traceEmotion(api, capabilityProfile, emotion, seed) {
  const session = newSession(api, capabilityProfile, { seed })
  try {
    session.trigger(createIntent(emotion, 0.9), 0)
    const { samples } = simulate(session, `determinism-${emotion}`, { frames: 300, dt: 1 / 60 })
    return samples.map((sample) => ({
      time: sample.time,
      params: sample.params,
      vad: sample.vad,
    }))
  } finally {
    session.dispose()
  }
}

export function runEmotionGradientScenario(api, capabilityProfile = createFullCapabilityProfile()) {
  const results = {}
  for (const emotion of ['happy', 'sad']) {
    const session = newSession(api, capabilityProfile)
    try {
      session.trigger(createIntent(emotion, 0.9), 0)
      const { samples } = simulate(session, `emotion-${emotion}`, { frames: 600, dt: 1 / 60 })
      const valence = extreme(samples, (sample) => sample.vad.valence)
      const holdValence = samples[180].vad.valence
      const endValence = samples[samples.length - 1].vad.valence
      const mouthForm = extreme(samples, (sample) => sample.params.ParamMouthForm)
      const peak = emotion === 'happy' ? valence.max : valence.min
      if (emotion === 'happy') {
        ensure(valence.max > 0.2, `happy gradient did not raise valence enough: ${valence.max}`)
        ensure(holdValence > 0.15, `happy hold lost valence too early: ${holdValence}`)
        ensure(mouthForm.max > -0.45, `happy did not lift mouthForm above the -0.5 default: ${mouthForm.max}`)
      } else {
        ensure(valence.min < -0.2, `sad gradient did not lower valence enough: ${valence.min}`)
        ensure(holdValence < -0.15, `sad hold lost valence too early: ${holdValence}`)
        ensure(mouthForm.min < -0.55, `sad did not lower mouthForm below the -0.5 default: ${mouthForm.min}`)
      }
      ensure(Math.abs(endValence) < Math.abs(peak), `${emotion} did not decay from peak: peak=${peak}, end=${endValence}`)
      ensure(mouthForm.min >= -2 && mouthForm.max <= 1, `${emotion} mouthForm left [-2, 1]`)
      results[emotion] = {
        valencePeak: peak,
        holdValence,
        endValence,
        mouthForm,
        frames: samples.length,
        samples: samples.filter((_, index) => index % 60 === 0).map((sample) => ({
          time: Number(sample.time.toFixed(3)),
          valence: Number(sample.vad.valence.toFixed(4)),
          mouthForm: Number(sample.params.ParamMouthForm.toFixed(4)),
        })),
      }
    } finally {
      session.dispose()
    }
  }
  return { id: 'emotion-gradients', passed: true, facts: results }
}

export function runMouthGateScenario(api, capabilityProfile = createFullCapabilityProfile()) {
  const session = newSession(api, capabilityProfile, { seed: 20261024 })
  try {
    session.trigger(createIntent('surprised', 1), 0)
    const inactive = simulate(session, 'mouth-gate-inactive', { frames: 120, dt: 1 / 60 })
    const inactiveMax = extreme(inactive.samples, (sample) => sample.params.ParamMouthOpenY).max
    ensure(inactiveMax === 0, `surprise opened mouth without voice playback: ${inactiveMax}`)

    session.setManualFACS({ mouthOpen: 0.9 })
    const manual = simulate(session, 'mouth-gate-manual', { frames: 10, dt: 1 / 60, startTime: 2 })
    const manualMax = extreme(manual.samples, (sample) => sample.params.ParamMouthOpenY).max
    ensure(manualMax === 0, `manual mouthOpen bypassed the engine mouth gate: ${manualMax}`)

    session.setVoice(true, { level: 0.8, peak: 0.9 })
    const active = simulate(session, 'mouth-gate-active', { frames: 90, dt: 1 / 60, startTime: 2.2 })
    const activeMax = extreme(active.samples, (sample) => sample.params.ParamMouthOpenY).max
    ensure(activeMax > 0.05, `voice playback did not open the mouth: ${activeMax}`)

    session.setVoice(true, { level: 0, peak: 0 })
    const silent = simulate(session, 'mouth-gate-silent', { frames: 60, dt: 1 / 60, startTime: 3.7 })
    const silentLast = silent.samples[silent.samples.length - 1].params.ParamMouthOpenY
    ensure(silentLast < 0.01, `silent speech did not close the mouth: ${silentLast}`)

    session.setVoice(false)
    const ended = simulate(session, 'mouth-gate-ended', { frames: 30, dt: 1 / 60, startTime: 4.7 })
    const endedLast = ended.samples[ended.samples.length - 1].params.ParamMouthOpenY
    ensure(endedLast < 1e-4, `voice end did not close the mouth: ${endedLast}`)

    return {
      id: 'mouth-gate',
      passed: true,
      facts: {
        voiceInactiveSurpriseMax: inactiveMax,
        manualMouthOpenWhileInactive: manualMax,
        voiceActiveMax: activeMax,
        silentLast,
        endedLast,
        gap: IMPLEMENTATION_NOTES.engineGaps[0],
        interpretation: 'The gate is engine-native; the wrapper does not override it and does not claim surprise mouth-open support.',
      },
    }
  } finally {
    session.dispose()
  }
}

export function runSpeechCancelScenario(api, capabilityProfile = createFullCapabilityProfile()) {
  const session = newSession(api, capabilityProfile, { seed: 20261025, releaseSeconds: 0.2 })
  try {
    session.trigger(createIntent('happy', 0.8), 0)
    session.setVoice(true, { level: 0.5, peak: 0.6 })
    const speaking = simulate(session, 'speech-speaking', { frames: 60, dt: 1 / 60 })
    const speakingMax = extreme(speaking.samples, (sample) => sample.params.ParamMouthOpenY).max
    ensure(speakingMax > 0.05, `speaking did not open the mouth: ${speakingMax}`)

    session.setVoice(true, { level: 0, peak: 0 })
    const pause = simulate(session, 'speech-pause', { frames: 60, dt: 1 / 60, startTime: 1 })
    const pauseLast = pause.samples[pause.samples.length - 1].params.ParamMouthOpenY
    ensure(pauseLast < 0.01, `speech pause did not close the mouth: ${pauseLast}`)

    session.setVoice(false)
    const ended = simulate(session, 'speech-ended', { frames: 30, dt: 1 / 60, startTime: 2 })
    const endedLast = ended.samples[ended.samples.length - 1].params.ParamMouthOpenY
    ensure(endedLast < 1e-4, `speech end did not close the mouth: ${endedLast}`)

    session.setVoice(true, { level: 0.5, peak: 0.6 })
    simulate(session, 'speech-restart', { frames: 30, dt: 1 / 60, startTime: 2.5 })
    const cancelAt = 3
    const cancel = session.cancel(cancelAt)
    ensure(cancel.status === 'cancelled', 'cancel did not report cancelled')
    const tail = simulate(session, 'speech-cancel-tail', { frames: 20, dt: 1 / 60, startTime: cancelAt + 1 / 60 })
    let previousDistance = Number.POSITIVE_INFINITY
    for (const sample of tail.samples) {
      const distance = Object.entries(sample.params).reduce(
        (total, [id, value]) => total + Math.abs(value - session.bridge.diagnostics.neutralParams[id]),
        0,
      )
      ensure(distance <= previousDistance + 1e-9, 'cancel tail moved away from model defaults')
      previousDistance = distance
    }
    const final = tail.samples[tail.samples.length - 1]
    ensure(final.status === 'released', `cancel tail did not finish: ${final.status}`)
    ensure(final.params.ParamMouthOpenY === 0, 'cancel tail left the mouth open')
    ensure(session.getAction() === null, 'cancel tail kept the old action')

    return {
      id: 'speech-cancel',
      passed: true,
      facts: {
        speakingMax,
        pauseLast,
        endedLast,
        releaseOwner: cancel.release.owner,
        releaseDurationSeconds: cancel.release.durationSeconds,
        finalStatus: final.status,
        finalMouthOpen: final.params.ParamMouthOpenY,
        wrapperOwned: true,
      },
    }
  } finally {
    session.dispose()
  }
}

export function runActionLifecycleScenario(api, capabilityProfile = createFullCapabilityProfile()) {
  const session = newSession(api, capabilityProfile, {
    seed: 20261026,
    extra: createNativeAnimationOptions(),
  })
  try {
    const happy = session.trigger(createIntent('happy', 0.9), 0)
    ensure(happy.status === 'accepted', 'happy action was not accepted')
    ensure(happy.action?.expression === 'synthetic-happy.exp3', 'happy expression was not resolved')
    const firstToken = happy.action.token
    simulate(session, 'action-happy', { frames: 30, dt: 1 / 60 })
    ensure(session.isActionCurrent(happy.action), 'happy action handle became stale without a replacement')

    const sad = session.trigger(createIntent('sad', 0.9), 0.6)
    ensure(sad.action?.expression === 'synthetic-sad.exp3', 'sad expression did not replace happy')
    ensure(sad.action.token > firstToken, 'replacement directive token did not advance')
    ensure(!session.isActionCurrent(happy.action), 'old action handle is still current')
    ensure(session.isActionCurrent(sad.action), 'replacement action handle is not current')

    session.cancel(1)
    ensure(session.getAction() === null, 'cancel did not clear the action handle')
    ensure(!session.isActionCurrent(sad.action), 'cancelled action handle is still current')
    const tail = simulate(session, 'action-cancel', { frames: 20, dt: 1 / 60, startTime: 1 + 1 / 60 })
    ensure(tail.samples[tail.samples.length - 1].status === 'released', 'action cancel release did not finish')

    return {
      id: 'action-lifecycle',
      passed: true,
      facts: {
        firstToken,
        secondToken: sad.action.token,
        replacementExpression: sad.action.expression,
        oldActionStale: true,
        cancelClearedAction: true,
        engineGap: IMPLEMENTATION_NOTES.engineGaps[3],
      },
    }
  } finally {
    session.dispose()
  }
}

export function runDtVariantsScenario(api, capabilityProfile = createFullCapabilityProfile()) {
  const variants = [
    { dt: 0, frames: 30, maxStep: 0 },
    { dt: 1 / 60, frames: 60 },
    { dt: 0.1, frames: 60 },
    { dt: 2.5, frames: 40 },
  ]
  const results = []
  for (const variant of variants) {
    const session = newSession(api, capabilityProfile, { seed: 20261027 + Math.round(variant.dt * 1000) })
    try {
      session.trigger(createIntent('excited', 0.8), 0)
      const { samples } = simulate(session, `dt-${variant.dt}`, { frames: variant.frames, dt: variant.dt })
      let maxStep = 0
      for (let index = 1; index < samples.length; index += 1) {
        for (const [id, value] of Object.entries(samples[index].params)) {
          const previous = samples[index - 1].params[id]
          if (typeof previous === 'number') maxStep = Math.max(maxStep, Math.abs(value - previous))
        }
      }
      if (variant.dt === 0) {
        ensure(
          JSON.stringify(samples[0].params) === JSON.stringify(samples[samples.length - 1].params),
          'dt=0 changed parameters while time did not advance',
        )
        ensure(maxStep === 0, `dt=0 produced a parameter step: ${maxStep}`)
      }
      results.push({
        dt: variant.dt,
        frames: variant.frames,
        maxStep,
        finalParams: Object.keys(samples[samples.length - 1].params).length,
        statuses: [...new Set(samples.map((sample) => sample.status))],
        summary: summarizeSeries(samples),
      })
    } finally {
      session.dispose()
    }
  }
  return {
    id: 'dt-variants',
    passed: true,
    facts: {
      variants: results.map((entry) => ({
        dt: entry.dt,
        frames: entry.frames,
        maxStep: Number(entry.maxStep.toFixed(6)),
        finalParamCount: entry.finalParams,
        statuses: entry.statuses,
        parameterKeys: Object.keys(entry.summary.parameters),
      })),
      note: 'Exponential smoothing saturates instead of overshooting; this is not a frame-rate guarantee.',
    },
  }
}

export function runDeterminismScenario(api, capabilityProfile = createFullCapabilityProfile()) {
  const facts = {}
  for (const emotion of ['happy', 'sad']) {
    const first = traceEmotion(api, capabilityProfile, emotion, 5150)
    const second = traceEmotion(api, capabilityProfile, emotion, 5150)
    const firstJson = JSON.stringify(first)
    const secondJson = JSON.stringify(second)
    ensure(firstJson === secondJson, `${emotion} traces are not deterministic for the same seed/dt`)
    facts[emotion] = {
      samples: first.length,
      sha256: crypto.createHash('sha256').update(firstJson).digest('hex'),
      deterministic: true,
    }
  }
  return { id: 'determinism', passed: true, facts }
}

export function runProfileFilterScenario(api, capabilityProfile = createPartialCapabilityProfile()) {
  const session = newSession(api, capabilityProfile, { seed: 20261028 })
  try {
    session.trigger(createIntent('happy', 0.9), 0)
    const { samples } = simulate(session, 'profile-filter', { frames: 240, dt: 1 / 60 })
    const whitelist = session.bridge.whitelist
    const allowed = new Set(whitelist.keys())
    for (const sample of samples) {
      for (const id of Object.keys(sample.params)) {
        ensure(allowed.has(id), `output leaked an unapproved parameter: ${id}`)
        ensure(!id.startsWith('ParamBodyAngle'), `output drove a physics body parameter: ${id}`)
        ensure(id !== 'ParamCheek38', 'output drove a private parameter')
      }
    }
    const mouthForm = extreme(samples, (sample) => sample.params.ParamMouthForm)
    ensure(mouthForm.max > -0.45, 'happy did not lift mouthForm in the partial profile')
    ensure(mouthForm.min >= -2 && mouthForm.max <= 1, 'partial-profile mouthForm left the real range')
    const diagnostics = session.getDiagnostics()
    ensure(diagnostics.counters.droppedPhysics === 0, 'wrapper unexpectedly saw a physics parameter')
    ensure(diagnostics.counters.droppedOutsideWhitelist === 0, 'public engine emitted a private/unknown parameter')
    ensure(diagnostics.neutralOutput.ParamMouthForm === -0.5, 'mouthForm default was not preserved')
    return {
      id: 'profile-filter',
      passed: true,
      facts: {
        allowedParameters: [...allowed].sort(),
        outputParameters: [...new Set(samples.flatMap((sample) => Object.keys(sample.params)))].sort(),
        mouthForm,
        neutralMouthForm: diagnostics.neutralOutput.ParamMouthForm,
        skippedChannels: diagnostics.bridge.skippedChannels,
        counters: diagnostics.counters,
      },
    }
  } finally {
    session.dispose()
  }
}

export const SCENARIOS = [
  { id: 'emotion-gradients', profileKind: 'full', run: runEmotionGradientScenario },
  { id: 'mouth-gate', profileKind: 'full', run: runMouthGateScenario },
  { id: 'speech-cancel', profileKind: 'full', run: runSpeechCancelScenario },
  { id: 'action-lifecycle', profileKind: 'full', run: runActionLifecycleScenario },
  { id: 'dt-variants', profileKind: 'full', run: runDtVariantsScenario },
  { id: 'determinism', profileKind: 'full', run: runDeterminismScenario },
  { id: 'profile-filter', profileKind: 'partial', run: runProfileFilterScenario },
]

export function runAllScenarios(api, profiles = {}) {
  const fullProfile = profiles.full ?? createFullCapabilityProfile()
  const partialProfile = profiles.partial ?? createPartialCapabilityProfile()
  const results = []
  for (const scenario of SCENARIOS) {
    const startedAt = Date.now()
    try {
      const profile = scenario.profileKind === 'partial' ? partialProfile : fullProfile
      const result = scenario.run(api, profile)
      results.push({ ...result, profileKind: scenario.profileKind, durationMs: Date.now() - startedAt })
    } catch (error) {
      results.push({
        id: scenario.id,
        profileKind: scenario.profileKind,
        passed: false,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        durationMs: Date.now() - startedAt,
      })
    }
  }
  return results
}
