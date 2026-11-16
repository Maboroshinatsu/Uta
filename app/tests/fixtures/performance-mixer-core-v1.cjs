'use strict'
// Synthetic mixer fixtures. No model assets, Cubism Core or real AppData are read.
// The DS profile is only the published structure summary used as an asymmetric
// semantic boundary; it is not a real Core replay and contains no raw output path.

const CHANNELS = [
  'headX', 'headY', 'headZ',
  'bodyX', 'bodyY', 'bodyZ',
  'gazeX', 'gazeY',
  'eyeOpenLeft', 'eyeOpenRight',
  'mouthOpen', 'mouthForm',
  'browLeft', 'browRight',
  'breath',
]

function capability(channel, status, reason, parameterIds = []) {
  return { channel, status, parameterIds, reason }
}

function makeProfile({
  available = CHANNELS,
  overrides = {},
  omit = [],
  signature = 'synthetic:mixer-core-v1',
  parameters = [],
  mappings = [],
} = {}) {
  const capabilities = CHANNELS
    .filter((channel) => !omit.includes(channel))
    .map((channel) => overrides[channel] ?? capability(
      channel,
      available.includes(channel) ? 'available' : 'unsupported',
      available.includes(channel) ? 'mapped' : 'missing-parameter',
    ))
  return {
    schemaVersion: 1,
    modelSignature: signature,
    parameters,
    mappings,
    capabilities,
    expressions: [],
    motions: [],
    warnings: [],
  }
}

const allAvailableProfile = makeProfile()

const dsSummaryProfile = makeProfile({
  available: ['headX', 'eyeOpenLeft', 'eyeOpenRight', 'mouthOpen', 'mouthForm'],
  signature: 'synthetic:ds-control-structure-summary-v1',
  parameters: [
    { id: 'ParamAngleX', min: -30, max: 30, defaultValue: 0, physicsOutput: false },
    { id: 'ParamEyeLOpen', min: 0, max: 1, defaultValue: 1, physicsOutput: false },
    { id: 'ParamEyeROpen', min: 0, max: 1, defaultValue: 1, physicsOutput: false },
    { id: 'ParamMouthOpenY', min: 0, max: 1, defaultValue: 0, physicsOutput: false },
    { id: 'ParamMouthForm', min: -2, max: 1, defaultValue: -0.5, physicsOutput: false },
  ],
  mappings: [
    {
      channel: 'mouthOpen',
      parameterId: 'ParamMouthOpenY',
      direction: 'normal',
      source: 'standard-id',
      confidence: 1,
      confirmed: true,
    },
    {
      channel: 'mouthForm',
      parameterId: 'ParamMouthForm',
      direction: 'normal',
      source: 'standard-id',
      confidence: 1,
      confirmed: true,
    },
  ],
})

const degradedProfile = makeProfile({
  available: ['headX'],
  overrides: {
    mouthForm: capability('mouthForm', 'needs-calibration', 'unconfirmed'),
    mouthOpen: capability('mouthOpen', 'unsupported', 'missing-parameter'),
    eyeOpenLeft: capability('eyeOpenLeft', 'needs-calibration', 'physics-output'),
    eyeOpenRight: capability('eyeOpenRight', 'available', 'physics-output'),
  },
  omit: ['breath'],
})

function tick(overrides = {}) {
  return {
    version: 1,
    sampledAtMonotonicMs: 0,
    modelEpoch: 1,
    bindingGeneration: 1,
    base: {},
    contributions: [],
    intents: [],
    profile: allAvailableProfile,
    releases: [],
    ...overrides,
  }
}

function contribution(overrides = {}) {
  return {
    version: 1,
    contributionId: 'contribution-1',
    ownerId: 'owner-1',
    generation: 1,
    modelEpoch: 1,
    bindingGeneration: 1,
    intentId: 'intent-1',
    mode: 'replace',
    phase: 'pre-physics',
    values: {},
    priorityByChannel: {},
    strength: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    ttlMs: null,
    ...overrides,
  }
}

function release(overrides = {}) {
  return {
    ownerId: 'owner-1',
    generation: 1,
    modelEpoch: 1,
    bindingGeneration: 1,
    reason: 'cancelled',
    ...overrides,
  }
}

function stateIntent(state = 'speaking', overrides = {}) {
  return {
    version: 1,
    intentId: `intent:state:${state}`,
    source: 'host',
    sessionId: 'session-1',
    bindingGeneration: 1,
    modelEpoch: 1,
    issuedAtUnixMs: 0,
    ttlMs: 1000,
    intensity: 1,
    seed: 1,
    kind: 'state',
    payload: { state },
    ...overrides,
  }
}

function emotionIntent(overrides = {}) {
  return {
    version: 1,
    intentId: 'intent:emotion',
    source: 'host',
    sessionId: 'session-1',
    bindingGeneration: 1,
    modelEpoch: 1,
    issuedAtUnixMs: 0,
    ttlMs: 1000,
    intensity: 1,
    seed: 2,
    kind: 'emotion',
    payload: { valence: 0.5, arousal: 0.5, dominance: 0 },
    ...overrides,
  }
}

module.exports = {
  CHANNELS,
  allAvailableProfile,
  dsSummaryProfile,
  degradedProfile,
  makeProfile,
  capability,
  tick,
  contribution,
  release,
  stateIntent,
  emotionIntent,
}
