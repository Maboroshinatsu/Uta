/**
 * Uta-owned bridge for the Soullink public engine.
 *
 * The driver never imports "@soullink-emotion/engine/internal". It receives the
 * built public bundle as an object so the experiment can prove the public
 * surface is sufficient. Everything in `utaWrapper` below is Uta-owned
 * isolation behavior, not a claim about native engine features.
 */
export const DRIVER_VERSION = 1

export const IMPLEMENTATION_NOTES = Object.freeze({
  engineNative: [
    'VAD/FACS emotion gradients and decay',
    'idle breathing, blink, gaze, micro motion and seeded idle actions',
    'procedural and measured lip-sync',
    'native animation directive resolution from profile maps',
    'per-parameter exponential smoothing',
  ],
  utaWrapper: [
    'capability-profile to ModelProfile bridge',
    'whitelist/physics/finite/range output filter',
    'session generation and stale-update rejection',
    'cancel release tail toward model defaults',
    'action handle generation checks',
  ],
  engineGaps: [
    'mouthOpen is forced to 0 whenever voice playback is inactive, including manual FACS and surprise expressions',
    'no native cancel or generation API; only reset() exists',
    'no per-channel ownership/lease or release callbacks',
    'native animation directives report a resource change, not playback completion or cancellation',
    'public API requires a full ModelProfile and exposes no profile adapter for incremental mapping',
    'this experimental bridge only supports normal mappings; confirmed reversed mappings are explicitly excluded until a calibrated transform is implemented',
  ],
})

export class BridgeError extends Error {
  constructor(message, diagnostics) {
    super(message)
    this.name = 'BridgeError'
    this.diagnostics = diagnostics
  }
}

const DIRECTIONAL_CHANNELS = ['headX', 'headY', 'headZ', 'gazeX', 'gazeY', 'bodyX', 'bodyY', 'bodyZ']

export function createCounters() {
  return {
    droppedOutsideWhitelist: 0,
    droppedPhysics: 0,
    droppedNonFinite: 0,
    clamped: 0,
    emitted: 0,
  }
}

function addCounters(target, addition) {
  target.droppedOutsideWhitelist += addition.droppedOutsideWhitelist
  target.droppedPhysics += addition.droppedPhysics
  target.droppedNonFinite += addition.droppedNonFinite
  target.clamped += addition.clamped
  target.emitted += addition.emitted
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
}

function cloneRule(rule) {
  return {
    ...rule,
    ...(rule.targets === undefined ? {} : { targets: [...rule.targets] }),
    ...(rule.outputRange === undefined ? {} : { outputRange: [...rule.outputRange] }),
  }
}

function cloneMap(value) {
  if (value === undefined) return undefined
  const result = {}
  for (const [key, binding] of Object.entries(value)) {
    result[key] = typeof binding === 'object' && binding !== null ? { ...binding } : binding
  }
  return result
}

export function buildSoullinkProfile(api, capabilityProfile, options = {}) {
  for (const method of ['SoullinkRuntime', 'motionStylePresets', 'deriveParameterSmoothing', 'detectCapabilities']) {
    if (api[method] === undefined) throw new Error(`public engine API is missing ${method}`)
  }
  if (capabilityProfile === null || typeof capabilityProfile !== 'object') throw new Error('capability profile must be an object')
  assertString(capabilityProfile.modelSignature, 'capabilityProfile.modelSignature')
  if (!Array.isArray(capabilityProfile.parameters)) throw new Error('capabilityProfile.parameters must be an array')
  if (!Array.isArray(capabilityProfile.mappings)) throw new Error('capabilityProfile.mappings must be an array')
  if (!Array.isArray(capabilityProfile.capabilities)) throw new Error('capabilityProfile.capabilities must be an array')

  const byId = new Map()
  for (const parameter of capabilityProfile.parameters) {
    if (typeof parameter?.id !== 'string' || parameter.id === '') throw new Error('capability parameter has no id')
    if (!Number.isFinite(parameter.min) || !Number.isFinite(parameter.max) || !Number.isFinite(parameter.defaultValue)) {
      throw new Error(`capability parameter ${parameter.id} has invalid values`)
    }
    byId.set(parameter.id, parameter)
  }
  const mappings = new Map(capabilityProfile.mappings.map((entry) => [entry.channel, entry]))
  const capabilities = new Map(capabilityProfile.capabilities.map((entry) => [entry.channel, entry]))

  const diagnostics = {
    schemaVersion: 1,
    modelSignature: capabilityProfile.modelSignature,
    bridgeVersion: DRIVER_VERSION,
    mappedChannels: [],
    skippedChannels: [],
    mappedFacsKeys: [],
    targets: [],
    neutralParams: {},
    mouthForm: null,
    nativeAnimationMapped: Boolean(options.expressionMap || options.motionMap),
  }
  const parameterMap = {}
  const neutralParams = {}

  const skip = (channel, reason, parameterId) => {
    diagnostics.skippedChannels.push({ channel, reason, ...(parameterId === undefined ? {} : { parameterId }) })
  }
  const resolveChannel = (channel) => {
    const capability = capabilities.get(channel)
    if (capability === undefined) {
      skip(channel, 'capability-missing')
      return null
    }
    if (capability.status !== 'available') {
      skip(channel, capability.reason ?? capability.status, capability.parameterIds?.[0])
      return null
    }
    const mappingEntry = mappings.get(channel)
    if (mappingEntry === undefined) {
      skip(channel, 'mapping-missing')
      return null
    }
    if (mappingEntry.confirmed !== true) {
      skip(channel, 'unconfirmed', mappingEntry.parameterId)
      return null
    }
    // Never silently reinterpret a confirmed reversed rig as a normal one.
    if (mappingEntry.direction !== 'normal') {
      skip(channel, 'unsupported-direction', mappingEntry.parameterId)
      return null
    }
    const parameter = byId.get(mappingEntry.parameterId)
    if (parameter === undefined) {
      skip(channel, 'parameter-missing', mappingEntry.parameterId)
      return null
    }
    if (parameter.physicsOutput === true) {
      skip(channel, 'physics-output', parameter.id)
      return null
    }
    if (!(parameter.min < parameter.max)) {
      skip(channel, 'zero-range', parameter.id)
      return null
    }
    if (!(parameter.defaultValue >= parameter.min && parameter.defaultValue <= parameter.max)) {
      skip(channel, 'invalid-default', parameter.id)
      return null
    }
    return { capability, mapping: mappingEntry, parameter }
  }
  const rememberTarget = (parameter) => {
    neutralParams[parameter.id] = parameter.defaultValue
    if (!diagnostics.targets.includes(parameter.id)) diagnostics.targets.push(parameter.id)
  }
  const markMapped = (channel) => {
    if (!diagnostics.mappedChannels.includes(channel)) diagnostics.mappedChannels.push(channel)
  }
  const addRule = (facsKey, rule) => {
    parameterMap[facsKey] = rule
    if (!diagnostics.mappedFacsKeys.includes(facsKey)) diagnostics.mappedFacsKeys.push(facsKey)
  }
  const commonRange = (targets) => ({
    min: Math.max(...targets.map((parameter) => parameter.min)),
    max: Math.min(...targets.map((parameter) => parameter.max)),
  })

  for (const channel of DIRECTIONAL_CHANNELS) {
    const resolved = resolveChannel(channel)
    if (resolved === null) continue
    const { parameter } = resolved
    const scale = Math.min(parameter.max - parameter.defaultValue, parameter.defaultValue - parameter.min)
    if (!(scale > 0)) {
      skip(channel, 'no-symmetric-span', parameter.id)
      continue
    }
    addRule(channel, {
      target: parameter.id,
      mode: 'add',
      scale,
      min: parameter.min,
      max: parameter.max,
    })
    rememberTarget(parameter)
    markMapped(channel)
  }

  const mouthOpen = resolveChannel('mouthOpen')
  if (mouthOpen !== null) {
    const { parameter } = mouthOpen
    const scale = parameter.max - parameter.defaultValue
    if (scale > 0) {
      addRule('mouthOpen', { target: parameter.id, mode: 'add', scale, min: parameter.min, max: parameter.max })
      rememberTarget(parameter)
      markMapped('mouthOpen')
    } else {
      skip('mouthOpen', 'no-positive-span', parameter.id)
    }
  }

  const mouthForm = resolveChannel('mouthForm')
  if (mouthForm !== null) {
    const { parameter } = mouthForm
    const smileSpan = parameter.max - parameter.defaultValue
    const frownSpan = parameter.defaultValue - parameter.min
    if (smileSpan > 0) {
      addRule('mouthSmile', { target: parameter.id, mode: 'add', scale: smileSpan, min: parameter.min, max: parameter.max })
    }
    if (frownSpan > 0) {
      addRule('mouthFrown', { target: parameter.id, mode: 'subtract', scale: frownSpan, min: parameter.min, max: parameter.max })
    }
    rememberTarget(parameter)
    markMapped('mouthForm')
    diagnostics.mouthForm = {
      parameterId: parameter.id,
      min: parameter.min,
      max: parameter.max,
      defaultValue: parameter.defaultValue,
      smileSpan,
      frownSpan,
      defaultIsZero: parameter.defaultValue === 0,
      rangeCenter: (parameter.min + parameter.max) / 2,
      rangeCenteredOnZero: parameter.min === -parameter.max,
    }
  }

  const eyeTargets = []
  const leftEye = resolveChannel('eyeOpenLeft')
  if (leftEye !== null) {
    eyeTargets.push(leftEye.parameter)
    rememberTarget(leftEye.parameter)
    markMapped('eyeOpenLeft')
  }
  const rightEye = resolveChannel('eyeOpenRight')
  if (rightEye !== null) {
    eyeTargets.push(rightEye.parameter)
    rememberTarget(rightEye.parameter)
    markMapped('eyeOpenRight')
  }
  if (eyeTargets.length > 0) {
    const range = commonRange(eyeTargets)
    addRule('eyeOpen', { targets: eyeTargets.map((parameter) => parameter.id), scale: 1, min: range.min, max: range.max })
    const blinkL = eyeTargets.find((parameter) => parameter.id === leftEye?.parameter.id)
    const blinkR = eyeTargets.find((parameter) => parameter.id === rightEye?.parameter.id)
    if (blinkL) {
      addRule('eyeBlinkL', {
        target: blinkL.id,
        mode: 'subtract',
        scale: Math.max(0, blinkL.defaultValue - blinkL.min),
        min: blinkL.min,
        max: blinkL.max,
      })
    }
    if (blinkR) {
      addRule('eyeBlinkR', {
        target: blinkR.id,
        mode: 'subtract',
        scale: Math.max(0, blinkR.defaultValue - blinkR.min),
        min: blinkR.min,
        max: blinkR.max,
      })
    }
  }

  const browTargets = []
  const leftBrow = resolveChannel('browLeft')
  if (leftBrow !== null) {
    browTargets.push(leftBrow.parameter)
    rememberTarget(leftBrow.parameter)
    markMapped('browLeft')
  }
  const rightBrow = resolveChannel('browRight')
  if (rightBrow !== null) {
    browTargets.push(rightBrow.parameter)
    rememberTarget(rightBrow.parameter)
    markMapped('browRight')
  }
  if (browTargets.length > 0) {
    const range = commonRange(browTargets)
    const upScale = Math.min(...browTargets.map((parameter) => Math.min(1, parameter.max - parameter.defaultValue)))
    const downScale = Math.min(...browTargets.map((parameter) => Math.min(1, parameter.defaultValue - parameter.min)))
    const ids = browTargets.map((parameter) => parameter.id)
    addRule('browInnerUp', { targets: ids, mode: 'add', scale: upScale, min: range.min, max: range.max })
    addRule('browOuterUp', { targets: ids, mode: 'add', scale: upScale * 0.5, min: range.min, max: range.max })
    addRule('browDown', { targets: ids, mode: 'subtract', scale: downScale, min: range.min, max: range.max })
  }

  const breath = resolveChannel('breath')
  if (breath !== null) {
    const { parameter } = breath
    addRule('breath', {
      target: parameter.id,
      outputRange: [parameter.min, parameter.max],
      min: parameter.min,
      max: parameter.max,
    })
    rememberTarget(parameter)
    markMapped('breath')
  }

  if (Object.keys(parameterMap).length === 0) {
    throw new BridgeError('no confirmed channel could be bridged to the public engine profile', diagnostics)
  }

  const modelId = options.modelId ?? `uta-${capabilityProfile.modelSignature.slice(0, 16)}`
  const profile = {
    modelId,
    displayName: options.displayName ?? 'Uta bridged model',
    version: options.version ?? '1',
    modelPath: `uta-logical://model/${capabilityProfile.modelSignature}`,
    schemaVersion: 2,
    sourceSignature: { hash: capabilityProfile.modelSignature },
    parameterMap,
    customParams: {},
    idleConfig: {},
    neutralParams: { ...neutralParams },
    parameterSmoothing: {},
    nativeAnimations: options.nativeAnimations ? structuredClone(options.nativeAnimations) : undefined,
    expressionMap: cloneMap(options.expressionMap),
    motionMap: cloneMap(options.motionMap),
  }
  profile.capabilities = api.detectCapabilities(profile)
  profile.parameterSmoothing = api.deriveParameterSmoothing(profile)
  diagnostics.neutralParams = { ...neutralParams }
  const outputWhitelist = new Map(diagnostics.targets.map((id) => [id, byId.get(id)]))
  return {
    profile,
    diagnostics,
    whitelist: outputWhitelist,
    modelParameters: byId,
  }
}

export function filterEngineParameters(rawParameters, whitelist, counters = createCounters()) {
  const result = {}
  for (const [id, value] of Object.entries(rawParameters ?? {})) {
    const parameter = whitelist.get(id)
    if (parameter === undefined) {
      counters.droppedOutsideWhitelist += 1
      continue
    }
    if (parameter.physicsOutput === true) {
      counters.droppedPhysics += 1
      continue
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      counters.droppedNonFinite += 1
      continue
    }
    const clamped = Math.min(parameter.max, Math.max(parameter.min, value))
    if (clamped !== value) counters.clamped += 1
    result[id] = clamped
    counters.emitted += 1
  }
  return result
}

function interpolateParameters(from, to, ratio) {
  const result = {}
  for (const [id, value] of Object.entries(to)) {
    const start = typeof from[id] === 'number' && Number.isFinite(from[id]) ? from[id] : value
    result[id] = start + (value - start) * ratio
  }
  return result
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function createUtaSoullinkSession(api, capabilityProfile, options = {}) {
  const bridge = buildSoullinkProfile(api, capabilityProfile, options)
  const whitelist = bridge.whitelist
  const neutralOutput = { ...bridge.diagnostics.neutralParams }
  const analyzerLevel = { value: 0, peak: 0 }
  const analyzer = {
    getLevel: () => analyzerLevel.value,
    getPeak: () => analyzerLevel.peak,
    isAvailable: () => voiceActive,
    available: () => voiceActive,
    reset: () => {
      analyzerLevel.value = 0
      analyzerLevel.peak = 0
    },
  }
  const seed = Number.isSafeInteger(options.seed) ? options.seed : 20261023
  const releaseSeconds = Number.isFinite(options.releaseSeconds) && options.releaseSeconds >= 0
    ? options.releaseSeconds
    : 0.18

  let generation = 1
  let runtime = null
  let voiceActive = false
  let release = null
  let lastAction = null
  let lastParameters = { ...neutralOutput }
  let counters = createCounters()
  let disposed = false

  const styleName = options.motionStylePreset ?? 'natural'
  const createRuntime = () => {
    const preset = api.motionStylePresets[styleName] ?? api.motionStylePresets.natural
    return new api.SoullinkRuntime({
      profile: bridge.profile,
      personality: options.personality,
      emotionPersonality: options.emotionPersonality,
      motionStyle: { ...preset, ...(options.motionStyle ?? {}), seed },
      audioLevelAnalyzer: analyzer,
    })
  }

  const captureAction = () => {
    const directive = runtime.getSnapshot().nativeAnimation
    if (!directive) return null
    return {
      generation,
      token: directive.token,
      expression: directive.expression,
      motion: directive.motion === null ? null : { ...directive.motion },
      suppressParamIds: [...directive.suppressParamIds],
      owner: 'uta-wrapper-action-handle',
    }
  }

  const resetSessionState = () => {
    release = null
    lastAction = null
    lastParameters = { ...neutralOutput }
    counters = createCounters()
    voiceActive = false
    analyzerLevel.value = 0
    analyzerLevel.peak = 0
  }

  const ensureActive = () => {
    if (disposed) throw new Error('session is disposed')
  }
  const ensureGeneration = (requested) => requested === undefined || requested === generation

  runtime = createRuntime()

  const session = {
    driverVersion: DRIVER_VERSION,
    bridge,
    get generation() {
      return generation
    },
    get profile() {
      return bridge.profile
    },
    beginGeneration() {
      ensureActive()
      generation += 1
      runtime = createRuntime()
      resetSessionState()
      return generation
    },
    trigger(intent, timeSeconds, triggerOptions = {}) {
      ensureActive()
      if (!ensureGeneration(triggerOptions.generation)) {
        return { status: 'stale', generation, action: null, wrapperOwnedGeneration: true }
      }
      if (!Number.isFinite(timeSeconds)) throw new TypeError('timeSeconds must be finite')
      release = null
      const engineOptions = triggerOptions.seed === undefined ? {} : { seed: triggerOptions.seed }
      runtime.triggerIntent(intent, timeSeconds, engineOptions)
      lastAction = captureAction()
      return { status: 'accepted', generation, action: lastAction }
    },
    update(timeSeconds, deltaSeconds, updateOptions = {}) {
      ensureActive()
      if (!ensureGeneration(updateOptions.generation)) {
        return {
          status: 'stale',
          generation: updateOptions.generation,
          currentGeneration: generation,
          params: {},
          action: null,
          diagnostics: { ...createCounters(), staleUpdate: true },
        }
      }
      if (!Number.isFinite(timeSeconds) || !Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
        throw new TypeError('timeSeconds must be finite and deltaSeconds must be finite and non-negative')
      }
      if (release !== null) {
        release.elapsed += deltaSeconds
        const ratio = release.durationSeconds <= 0 ? 1 : Math.min(1, release.elapsed / release.durationSeconds)
        const eased = 1 - Math.pow(1 - ratio, 3)
        const params = interpolateParameters(release.from, neutralOutput, eased)
        lastParameters = params
        return {
          status: ratio >= 1 ? 'released' : 'releasing',
          generation,
          params,
          action: null,
          release: {
            ratio,
            eased,
            durationSeconds: release.durationSeconds,
            elapsedSeconds: release.elapsed,
            owner: 'uta-wrapper-cancel-release',
          },
          diagnostics: { ...counters, emitted: Object.keys(params).length },
        }
      }
      const snapshot = runtime.update(timeSeconds, deltaSeconds)
      const frameCounters = createCounters()
      const params = filterEngineParameters(snapshot.live2dParams, whitelist, frameCounters)
      addCounters(counters, frameCounters)
      lastParameters = params
      lastAction = captureAction()
      return {
        status: 'ok',
        generation,
        params,
        action: lastAction,
        snapshot,
        diagnostics: { ...frameCounters },
      }
    },
    cancel(timeSeconds, cancelOptions = {}) {
      ensureActive()
      if (!ensureGeneration(cancelOptions.generation)) {
        return { status: 'stale', generation, wrapperOwnedGeneration: true }
      }
      if (!Number.isFinite(timeSeconds)) throw new TypeError('timeSeconds must be finite')
      const duration = Number.isFinite(cancelOptions.releaseSeconds) && cancelOptions.releaseSeconds >= 0
        ? cancelOptions.releaseSeconds
        : releaseSeconds
      release = {
        from: { ...lastParameters },
        elapsed: 0,
        durationSeconds: duration,
      }
      runtime.setVoicePlaybackActive(false)
      voiceActive = false
      runtime.reset(timeSeconds)
      lastAction = null
      return {
        status: 'cancelled',
        generation,
        release: {
          durationSeconds: duration,
          owner: 'uta-wrapper-cancel-release',
          engineCall: 'SoullinkRuntime.reset',
        },
        wrapperOwnedGeneration: true,
      }
    },
    setVoice(active, level = {}) {
      ensureActive()
      voiceActive = active === true
      analyzerLevel.value = voiceActive ? clamp01(level.level ?? 0) : 0
      analyzerLevel.peak = voiceActive ? clamp01(level.peak ?? level.level ?? 0) : 0
      runtime.setVoicePlaybackActive(voiceActive)
      return { voiceActive, level: analyzerLevel.value, peak: analyzerLevel.peak }
    },
    setManualFACS(facs) {
      ensureActive()
      runtime.setManualFACS(facs)
    },
    setVADDecayRate(rate) {
      ensureActive()
      runtime.setVADDecayRate(rate)
    },
    applyVADTarget(target, amount) {
      ensureActive()
      runtime.applyVADTarget(target, amount)
    },
    getAction() {
      return lastAction === null ? null : { ...lastAction, motion: lastAction.motion === null ? null : { ...lastAction.motion } }
    },
    isActionCurrent(handle) {
      return handle !== null
        && handle !== undefined
        && handle.generation === generation
        && release === null
        && lastAction !== null
        && lastAction.token === handle.token
    },
    getSnapshot() {
      ensureActive()
      return runtime.getSnapshot()
    },
    getDiagnostics() {
      return {
        driverVersion: DRIVER_VERSION,
        generation,
        voiceActive,
        release: release === null
          ? null
          : { elapsedSeconds: release.elapsed, durationSeconds: release.durationSeconds, owner: 'uta-wrapper-cancel-release' },
        action: session.getAction(),
        counters: { ...counters },
        bridge: bridge.diagnostics,
        whitelistSize: whitelist.size,
        neutralOutput: { ...neutralOutput },
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      runtime.setVoicePlaybackActive(false)
      runtime.reset(0)
      release = null
      lastAction = null
    },
  }
  return session
}
