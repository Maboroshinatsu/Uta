export function parameter(id, min, max, defaultValue, options = {}) {
  return {
    id,
    min,
    max,
    defaultValue,
    physicsOutput: options.physicsOutput === true,
    ...(options.label === undefined ? {} : { label: options.label }),
  }
}

export function mapping(channel, parameterId, options = {}) {
  return {
    channel,
    parameterId,
    direction: options.direction ?? 'normal',
    source: options.source ?? 'standard-id',
    confidence: options.confidence ?? 1,
    confirmed: options.confirmed !== false,
  }
}

export function capability(channel, status, parameterIds, reason) {
  return { channel, status, parameterIds, reason }
}

function declaredProfile(parameters, mappings, extra = {}) {
  const capabilities = extra.capabilities ?? mappings.map((entry) => capability(entry.channel, 'available', [entry.parameterId], 'mapped'))
  return {
    schemaVersion: 1,
    modelSignature: extra.modelSignature ?? 'synthetic:uta-soullink-driver',
    parameters,
    mappings,
    capabilities,
    expressions: extra.expressions ?? [],
    motions: extra.motions ?? [],
    warnings: extra.warnings ?? [],
  }
}

export function createFullCapabilityProfile(options = {}) {
  const bodyPhysics = options.bodyPhysics === true
  const parameters = [
    parameter('ParamAngleX', -30, 30, 0),
    parameter('ParamAngleY', -30, 30, 0),
    parameter('ParamAngleZ', -30, 30, 0),
    parameter('ParamEyeBallX', -1, 1, 0),
    parameter('ParamEyeBallY', -1, 1, 0),
    parameter('ParamEyeLOpen', 0, 1, 1),
    parameter('ParamEyeROpen', 0, 1, 1),
    parameter('ParamMouthOpenY', 0, 1, 0),
    parameter('ParamMouthForm', -2, 1, -0.5),
    parameter('ParamBrowLY', -1, 1, 0),
    parameter('ParamBrowRY', -1, 1, 0),
    parameter('ParamBreath', 0, 1, 0),
    parameter('ParamBodyAngleX', -10, 10, 0, { physicsOutput: bodyPhysics }),
    parameter('ParamBodyAngleY', -10, 10, 0, { physicsOutput: bodyPhysics }),
    parameter('ParamBodyAngleZ', -10, 10, 0, { physicsOutput: bodyPhysics }),
    parameter('ParamCheek38', 0, 3, 0),
  ]
  const mappings = [
    mapping('headX', 'ParamAngleX'),
    mapping('headY', 'ParamAngleY'),
    mapping('headZ', 'ParamAngleZ'),
    mapping('gazeX', 'ParamEyeBallX'),
    mapping('gazeY', 'ParamEyeBallY'),
    mapping('eyeOpenLeft', 'ParamEyeLOpen'),
    mapping('eyeOpenRight', 'ParamEyeROpen'),
    mapping('mouthOpen', 'ParamMouthOpenY'),
    mapping('mouthForm', 'ParamMouthForm'),
    mapping('browLeft', 'ParamBrowLY'),
    mapping('browRight', 'ParamBrowRY'),
    mapping('breath', 'ParamBreath'),
    mapping('bodyX', 'ParamBodyAngleX'),
    mapping('bodyY', 'ParamBodyAngleY'),
    mapping('bodyZ', 'ParamBodyAngleZ'),
  ]
  const capabilities = mappings.map((entry) => {
    const target = parameters.find((item) => item.id === entry.parameterId)
    if (target?.physicsOutput) return capability(entry.channel, 'needs-calibration', [target.id], 'physics-output')
    return capability(entry.channel, 'available', [entry.parameterId], 'mapped')
  })
  return declaredProfile(parameters, mappings, { capabilities })
}

export function createPartialCapabilityProfile() {
  const parameters = [
    parameter('ParamAngleX', -30, 30, 0),
    parameter('ParamEyeLOpen', 0, 1, 1),
    parameter('ParamEyeROpen', 0, 1, 1),
    parameter('ParamMouthOpenY', 0, 1, 0),
    parameter('ParamMouthForm', -2, 1, -0.5),
    parameter('ParamBreath', 0, 1, 0),
    parameter('ParamBodyAngleX', -10, 10, 0, { physicsOutput: true }),
    parameter('ParamBodyAngleY', -10, 10, 0, { physicsOutput: true }),
    parameter('ParamBodyAngleZ', -10, 10, 0, { physicsOutput: true }),
    parameter('ParamCheek38', 0, 3, 0),
  ]
  const mappings = [
    mapping('headX', 'ParamAngleX'),
    mapping('eyeOpenLeft', 'ParamEyeLOpen'),
    mapping('eyeOpenRight', 'ParamEyeROpen'),
    mapping('mouthOpen', 'ParamMouthOpenY'),
    mapping('mouthForm', 'ParamMouthForm'),
    mapping('breath', 'ParamBreath'),
    mapping('bodyX', 'ParamBodyAngleX'),
    mapping('bodyY', 'ParamBodyAngleY'),
    mapping('bodyZ', 'ParamBodyAngleZ'),
  ]
  const capabilities = [
    capability('headX', 'available', ['ParamAngleX'], 'mapped'),
    capability('headY', 'unsupported', [], 'missing-parameter'),
    capability('headZ', 'unsupported', [], 'missing-parameter'),
    capability('gazeX', 'unsupported', [], 'missing-parameter'),
    capability('gazeY', 'unsupported', [], 'missing-parameter'),
    capability('eyeOpenLeft', 'available', ['ParamEyeLOpen'], 'mapped'),
    capability('eyeOpenRight', 'available', ['ParamEyeROpen'], 'mapped'),
    capability('mouthOpen', 'available', ['ParamMouthOpenY'], 'mapped'),
    capability('mouthForm', 'available', ['ParamMouthForm'], 'mapped'),
    capability('browLeft', 'unsupported', [], 'missing-parameter'),
    capability('browRight', 'unsupported', [], 'missing-parameter'),
    capability('breath', 'available', ['ParamBreath'], 'mapped'),
    capability('bodyX', 'needs-calibration', ['ParamBodyAngleX'], 'physics-output'),
    capability('bodyY', 'needs-calibration', ['ParamBodyAngleY'], 'physics-output'),
    capability('bodyZ', 'needs-calibration', ['ParamBodyAngleZ'], 'physics-output'),
  ]
  return declaredProfile(parameters, mappings, { capabilities, modelSignature: 'synthetic:uta-soullink-partial' })
}

export function createNativeAnimationOptions() {
  return {
    nativeAnimations: {
      expressions: [
        { name: 'synthetic-happy.exp3', file: 'logical/synthetic-happy.exp3', params: ['ParamMouthForm'] },
        { name: 'synthetic-sad.exp3', file: 'logical/synthetic-sad.exp3', params: ['ParamMouthForm'] },
      ],
      motions: [{ group: 'Idle', index: 0, file: 'logical/idle.motion3.json' }],
    },
    expressionMap: {
      happy: 'synthetic-happy.exp3',
      sad: { expression: 'synthetic-sad.exp3', minIntensity: 0.2 },
    },
    motionMap: {
      happy: { group: 'Idle', index: 0, priority: 'normal' },
    },
  }
}

export function createIntent(emotion, intensity = 0.8, variant) {
  return {
    emotion,
    ...(variant === undefined ? {} : { variant }),
    intensity,
    contextTags: [],
  }
}
