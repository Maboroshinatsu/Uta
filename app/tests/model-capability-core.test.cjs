'use strict'
// Behavior tests for the pure first-wave model capability profile builder.
// Business assertions only: no source-string matching.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

function loadTs(relativePath, extraGlobals = {}) {
  const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require, ...extraGlobals })
  return mod.exports
}

const PROFILE_FILE = '../src/renderer/services/performance/profile/index.ts'
const {
  buildModelCapabilityProfile,
  SEMANTIC_CHANNEL_ORDER,
  STANDARD_PARAMETER_IDS,
} = loadTs(PROFILE_FILE)
const { standardModel, minimalModel, privateModel } = loadTs('./fixtures/first-wave-v1.ts')

const CHANNELS = [
  'headX', 'headY', 'headZ',
  'bodyX', 'bodyY', 'bodyZ',
  'gazeX', 'gazeY',
  'eyeOpenLeft', 'eyeOpenRight',
  'mouthOpen', 'mouthForm',
  'browLeft', 'browRight',
  'breath',
]

const plain = (value) => JSON.parse(JSON.stringify(value))

function model(overrides = {}) {
  return {
    schemaVersion: 1,
    modelSignature: 'synthetic:test',
    parameters: [],
    expressions: [],
    motions: [],
    overrides: [],
    ...overrides,
  }
}

function param(id, extra = {}) {
  return { id, min: -1, max: 1, defaultValue: 0, physicsOutput: false, ...extra }
}

function ok(input) {
  const result = buildModelCapabilityProfile(input)
  assert.equal(result.ok, true, JSON.stringify(plain(result.issues ?? [])))
  return result.profile
}

function failure(input) {
  const result = buildModelCapabilityProfile(input)
  assert.equal(result.ok, false, 'expected a structured failure, not a success')
  assert.ok(Array.isArray(result.issues) && result.issues.length > 0, 'failure must carry issues')
  return plain(result.issues)
}

function capability(profile, channel) {
  const found = profile.capabilities.find((entry) => entry.channel === channel)
  assert.ok(found, `missing capability for ${channel}`)
  return plain(found)
}

function mapping(profile, channel) {
  const found = profile.mappings.find((entry) => entry.channel === channel)
  return found === undefined ? undefined : plain(found)
}

function assertChannelCoverage(profile) {
  assert.deepEqual(Array.from(profile.capabilities, (entry) => entry.channel), CHANNELS)
  const mappedChannels = Array.from(profile.mappings, (entry) => entry.channel)
  assert.deepEqual(mappedChannels, mappedChannels.slice().sort((a, b) => CHANNELS.indexOf(a) - CHANNELS.indexOf(b)))
}

function assertUnsupported(profile, channels) {
  for (const channel of channels) {
    assert.deepEqual(capability(profile, channel), {
      channel, status: 'unsupported', parameterIds: [], reason: 'missing-parameter',
    })
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key])
    Object.freeze(value)
  }
  return value
}

test('semantic channel order matches the frozen 15-channel order', () => {
  assert.deepEqual([...SEMANTIC_CHANNEL_ORDER], CHANNELS)
})

test('standard fixture maps only healthy standard IDs and preserves native resources', () => {
  const profile = ok(standardModel)
  assertChannelCoverage(profile)
  assert.equal(profile.modelSignature, 'synthetic:standard-v1')
  assert.deepEqual(
    plain(profile.capabilities).filter((entry) => entry.status === 'available').map((entry) => entry.channel),
    ['headX', 'eyeOpenLeft', 'eyeOpenRight', 'mouthOpen'],
  )
  for (const channel of ['headX', 'eyeOpenLeft', 'eyeOpenRight', 'mouthOpen']) {
    assert.deepEqual(mapping(profile, channel), {
      channel,
      parameterId: STANDARD_PARAMETER_IDS[channel],
      direction: 'normal',
      source: 'standard-id',
      confidence: 1,
      confirmed: true,
    })
    assert.deepEqual(capability(profile, channel), {
      channel, status: 'available', parameterIds: [STANDARD_PARAMETER_IDS[channel]], reason: 'mapped',
    })
  }
  assertUnsupported(profile, CHANNELS.filter((channel) => !['headX', 'eyeOpenLeft', 'eyeOpenRight', 'mouthOpen'].includes(channel)))
  assert.deepEqual(plain(profile.parameters), plain(standardModel.parameters))
  assert.deepEqual(plain(profile.expressions), plain(standardModel.expressions))
  assert.deepEqual(plain(profile.motions), plain(standardModel.motions))
  assert.deepEqual(plain(profile.warnings), [])
})

test('minimal fixture stays fully unsupported without inventing mappings', () => {
  const profile = ok(minimalModel)
  assertChannelCoverage(profile)
  assert.deepEqual(plain(profile.capabilities).map((entry) => entry.status), Array(15).fill('unsupported'))
  assert.deepEqual(plain(profile.mappings), [])
  assert.deepEqual(plain(profile.parameters), [])
  assert.deepEqual(plain(profile.warnings), [])
})

test('private fixture honors a confirmed reversed override', () => {
  const profile = ok(privateModel)
  assertChannelCoverage(profile)
  assert.equal(profile.mappings.length, 1)
  assert.deepEqual(mapping(profile, 'headX'), {
    channel: 'headX',
    parameterId: 'FaceTurn',
    direction: 'reversed',
    source: 'manual',
    confidence: 1,
    confirmed: true,
  })
  assert.deepEqual(capability(profile, 'headX'), {
    channel: 'headX', status: 'available', parameterIds: ['FaceTurn'], reason: 'mapped',
  })
  assertUnsupported(profile, CHANNELS.filter((channel) => channel !== 'headX'))
})

test('a full standard parameter set makes every channel available', () => {
  const parameters = CHANNELS.map((channel) => param(STANDARD_PARAMETER_IDS[channel]))
  const profile = ok(model({ parameters, modelSignature: 'synthetic:all-standard' }))
  assertChannelCoverage(profile)
  assert.deepEqual(plain(profile.capabilities).map((entry) => entry.status), Array(15).fill('available'))
  for (const channel of CHANNELS) {
    assert.deepEqual(mapping(profile, channel), {
      channel,
      parameterId: STANDARD_PARAMETER_IDS[channel],
      direction: 'normal',
      source: 'standard-id',
      confidence: 1,
      confirmed: true,
    })
  }
})

test('a single exact label alias is a non-confirmed needs-calibration guess', () => {
  const profile = ok(model({
    parameters: [param('FaceTurn', { label: ' Head  X ', min: -10, max: 20, defaultValue: 3 })],
  }))
  assert.deepEqual(mapping(profile, 'headX'), {
    channel: 'headX',
    parameterId: 'FaceTurn',
    direction: 'normal',
    source: 'label-guess',
    confidence: 0.5,
    confirmed: false,
  })
  assert.deepEqual(capability(profile, 'headX'), {
    channel: 'headX', status: 'needs-calibration', parameterIds: ['FaceTurn'], reason: 'ambiguous',
  })
  assertUnsupported(profile, CHANNELS.filter((channel) => channel !== 'headX'))
})

test('ambiguous label candidates are not guessed', () => {
  const profile = ok(model({
    parameters: [
      param('TurnA', { label: '头部左右' }),
      param('TurnB', { label: 'Head X' }),
    ],
  }))
  assert.equal(mapping(profile, 'headX'), undefined)
  assert.deepEqual(capability(profile, 'headX'), {
    channel: 'headX', status: 'needs-calibration', parameterIds: ['TurnA', 'TurnB'], reason: 'ambiguous',
  })
})

test('fuzzy or partial labels are never guessed', () => {
  const profile = ok(model({ parameters: [param('Turn', { label: '头部' })] }))
  assert.equal(mapping(profile, 'headX'), undefined)
  assert.deepEqual(capability(profile, 'headX'), {
    channel: 'headX', status: 'unsupported', parameterIds: [], reason: 'missing-parameter',
  })
})

test('physics-output standard parameters are not auto-mapped', () => {
  const profile = ok(model({ parameters: [param('ParamAngleX', { physicsOutput: true })] }))
  assert.equal(mapping(profile, 'headX'), undefined)
  assert.deepEqual(capability(profile, 'headX'), {
    channel: 'headX', status: 'needs-calibration', parameterIds: ['ParamAngleX'], reason: 'physics-output',
  })
})

test('zero-range standard parameters cannot become continuous controls', () => {
  const profile = ok(model({ parameters: [param('ParamAngleX', { min: 0, max: 0, defaultValue: 0 })] }))
  assert.equal(mapping(profile, 'headX'), undefined)
  assert.deepEqual(capability(profile, 'headX'), {
    channel: 'headX', status: 'needs-calibration', parameterIds: ['ParamAngleX'], reason: 'ambiguous',
  })
})

test('a confirmed override on a physics output stays needs-calibration but keeps the manual mapping', () => {
  const profile = ok(model({
    parameters: [param('HairOutput', { physicsOutput: true })],
    overrides: [{ channel: 'headX', parameterId: 'HairOutput', direction: 'normal', confirmed: true }],
  }))
  assert.deepEqual(mapping(profile, 'headX'), {
    channel: 'headX',
    parameterId: 'HairOutput',
    direction: 'normal',
    source: 'manual',
    confidence: 1,
    confirmed: true,
  })
  assert.deepEqual(capability(profile, 'headX'), {
    channel: 'headX', status: 'needs-calibration', parameterIds: ['HairOutput'], reason: 'physics-output',
  })
})

test('a confirmed override on a zero-range parameter stays needs-calibration', () => {
  const profile = ok(model({
    parameters: [param('Frozen', { min: 0.25, max: 0.25, defaultValue: 0.25 })],
    overrides: [{ channel: 'gazeX', parameterId: 'Frozen', direction: 'normal', confirmed: true }],
  }))
  assert.deepEqual(mapping(profile, 'gazeX'), {
    channel: 'gazeX',
    parameterId: 'Frozen',
    direction: 'normal',
    source: 'manual',
    confidence: 1,
    confirmed: true,
  })
  assert.deepEqual(capability(profile, 'gazeX'), {
    channel: 'gazeX', status: 'needs-calibration', parameterIds: ['Frozen'], reason: 'ambiguous',
  })
})

test('an unconfirmed override is surfaced as unconfirmed when nothing else maps', () => {
  const profile = ok(model({
    parameters: [param('Turn')],
    overrides: [{ channel: 'headX', parameterId: 'Turn', direction: 'reversed', confirmed: false }],
  }))
  assert.deepEqual(mapping(profile, 'headX'), {
    channel: 'headX',
    parameterId: 'Turn',
    direction: 'reversed',
    source: 'manual',
    confidence: 1,
    confirmed: false,
  })
  assert.deepEqual(capability(profile, 'headX'), {
    channel: 'headX', status: 'needs-calibration', parameterIds: ['Turn'], reason: 'unconfirmed',
  })
})

test('an unconfirmed override does not displace a healthy standard mapping', () => {
  const profile = ok(model({
    parameters: [param('ParamAngleX'), param('Turn')],
    overrides: [{ channel: 'headX', parameterId: 'Turn', direction: 'reversed', confirmed: false }],
  }))
  assert.deepEqual(mapping(profile, 'headX'), {
    channel: 'headX',
    parameterId: 'ParamAngleX',
    direction: 'normal',
    source: 'standard-id',
    confidence: 1,
    confirmed: true,
  })
  assert.deepEqual(capability(profile, 'headX'), {
    channel: 'headX', status: 'available', parameterIds: ['ParamAngleX'], reason: 'mapped',
  })
})

test('non-object inputs fail structurally instead of throwing', () => {
  for (const bad of [null, [], 'model', 42, true]) {
    const issues = failure(bad)
    assert.equal(issues[0].code, 'invalid-schema')
    assert.equal(issues[0].path, '$')
  }
})

test('root schema, signature and container shapes are validated', () => {
  assert.ok(failure(model({ schemaVersion: 2 })).some((entry) => entry.code === 'invalid-schema'))
  assert.ok(failure(model({ extra: true })).some((entry) => entry.code === 'invalid-schema' && entry.path === 'extra'))
  assert.ok(failure(model({ modelSignature: '   ' })).some((entry) => entry.code === 'invalid-signature'))
  assert.ok(failure(model({ modelSignature: 7 })).some((entry) => entry.code === 'invalid-signature'))
  assert.ok(failure(model({ parameters: {} })).some((entry) => entry.code === 'invalid-parameter' && entry.path === 'parameters'))
  assert.ok(failure(model({ expressions: {} })).some((entry) => entry.code === 'invalid-resource' && entry.path === 'expressions'))
  assert.ok(failure(model({ motions: {} })).some((entry) => entry.code === 'invalid-resource' && entry.path === 'motions'))
  assert.ok(failure(model({ overrides: {} })).some((entry) => entry.code === 'invalid-override' && entry.path === 'overrides'))
})

const parameterCases = [
  ['duplicate parameter ids', [param('A'), param('A')], 'duplicate-parameter', 'parameters[1].id'],
  ['NaN minimum', [param('A', { min: Number.NaN })], 'invalid-parameter', 'parameters[0].min'],
  ['infinite maximum', [param('A', { max: Number.POSITIVE_INFINITY })], 'invalid-parameter', 'parameters[0].max'],
  ['min greater than max', [param('A', { min: 2, max: 1, defaultValue: 1.5 })], 'invalid-parameter', 'parameters[0].min'],
  ['default outside range', [param('A', { defaultValue: 2 })], 'invalid-parameter', 'parameters[0].defaultValue'],
  ['unknown parameter field', [{ ...param('A'), extra: 1 }], 'invalid-parameter', 'parameters[0].extra'],
  ['non-boolean physicsOutput', [{ ...param('A'), physicsOutput: 'yes' }], 'invalid-parameter', 'parameters[0].physicsOutput'],
  ['blank parameter id', [param('   ')], 'invalid-parameter', 'parameters[0].id'],
  ['non-object parameter', ['ParamAngleX'], 'invalid-parameter', 'parameters[0]'],
]
for (const [name, parameters, code, issuePath] of parameterCases) {
  test(`parameter rejection: ${name}`, () => {
    const issues = failure(model({ parameters }))
    assert.ok(
      issues.some((entry) => entry.code === code && entry.path === issuePath),
      `expected ${code} at ${issuePath}, got ${JSON.stringify(issues)}`,
    )
  })
}

const overrideCases = [
  ['unknown target', [{ channel: 'headX', parameterId: 'Ghost', direction: 'normal', confirmed: true }], 'unknown-override-target'],
  ['invalid channel', [{ channel: 'tail', parameterId: 'A', direction: 'normal', confirmed: true }], 'invalid-override'],
  ['invalid direction', [{ channel: 'headX', parameterId: 'A', direction: 'sideways', confirmed: true }], 'invalid-override'],
  ['duplicate channel', [
    { channel: 'headX', parameterId: 'A', direction: 'normal', confirmed: true },
    { channel: 'headX', parameterId: 'A', direction: 'reversed', confirmed: false },
  ], 'invalid-override'],
  ['unknown field', [{ channel: 'headX', parameterId: 'A', direction: 'normal', confirmed: true, weight: 1 }], 'invalid-override'],
  ['non-boolean confirmed', [{ channel: 'headX', parameterId: 'A', direction: 'normal', confirmed: 1 }], 'invalid-override'],
  ['non-object override', ['headX'], 'invalid-override'],
]
for (const [name, overrides, code] of overrideCases) {
  test(`override rejection: ${name}`, () => {
    const issues = failure(model({ parameters: [param('A')], overrides }))
    assert.ok(issues.some((entry) => entry.code === code), `expected ${code}, got ${JSON.stringify(issues)}`)
  })
}

const expressionCases = [
  ['blank name', [{ name: '  ', parameters: [] }], 'expressions[0].name'],
  ['duplicate names', [
    { name: 'smile', parameters: [] },
    { name: 'smile', parameters: [] },
  ], 'expressions[1].name'],
  ['unknown expression field', [{ name: 'smile', parameters: [], extra: 1 }], 'expressions[0].extra'],
  ['invalid blend mode', [{ name: 'smile', parameters: [{ id: 'A', value: 1, blend: 'Additive' }] }], 'expressions[0].parameters[0].blend'],
  ['non-finite value', [{ name: 'smile', parameters: [{ id: 'A', value: Number.POSITIVE_INFINITY, blend: 'Add' }] }], 'expressions[0].parameters[0].value'],
  ['unknown parameter field', [{ name: 'smile', parameters: [{ id: 'A', value: 1, blend: 'Add', extra: 1 }] }], 'expressions[0].parameters[0].extra'],
  ['non-object parameter', [{ name: 'smile', parameters: ['A'] }], 'expressions[0].parameters[0]'],
  ['non-array parameters', [{ name: 'smile', parameters: {} }], 'expressions[0].parameters'],
]
for (const [name, expressions, issuePath] of expressionCases) {
  test(`expression rejection: ${name}`, () => {
    const issues = failure(model({ parameters: [param('A')], expressions }))
    assert.ok(
      issues.some((entry) => entry.code === 'invalid-resource' && entry.path === issuePath),
      `expected invalid-resource at ${issuePath}, got ${JSON.stringify(issues)}`,
    )
  })
}

const motionCases = [
  ['blank group', [{ group: '  ', index: 0, parameterIds: [] }], 'motions[0].group'],
  ['negative index', [{ group: 'Idle', index: -1, parameterIds: [] }], 'motions[0].index'],
  ['fractional index', [{ group: 'Idle', index: 0.5, parameterIds: [] }], 'motions[0].index'],
  ['duplicate group and index', [
    { group: 'Idle', index: 0, parameterIds: [] },
    { group: 'Idle', index: 0, parameterIds: [] },
  ], 'motions[1]'],
  ['non-array parameterIds', [{ group: 'Idle', index: 0, parameterIds: 'A' }], 'motions[0].parameterIds'],
  ['blank parameter id', [{ group: 'Idle', index: 0, parameterIds: ['  '] }], 'motions[0].parameterIds[0]'],
  ['unknown motion field', [{ group: 'Idle', index: 0, parameterIds: [], extra: 1 }], 'motions[0].extra'],
  ['non-object motion', ['Idle'], 'motions[0]'],
]
for (const [name, motions, issuePath] of motionCases) {
  test(`motion rejection: ${name}`, () => {
    const issues = failure(model({ motions }))
    assert.ok(
      issues.some((entry) => entry.code === 'invalid-resource' && entry.path === issuePath),
      `expected invalid-resource at ${issuePath}, got ${JSON.stringify(issues)}`,
    )
  })
}

test('native expression blends and values are preserved exactly', () => {
  const expressions = [{
    name: 'mixed',
    parameters: [
      { id: 'A', value: 0.25, blend: 'Add' },
      { id: 'A', value: 0.5, blend: 'Multiply' },
      { id: 'A', value: 0.75, blend: 'Overwrite' },
    ],
  }]
  const profile = ok(model({ parameters: [param('A')], expressions }))
  assert.deepEqual(plain(profile.expressions), expressions)
})

test('motion directories keep group, index and parameter ids exactly', () => {
  const motions = [{ group: 'Idle', index: 3, parameterIds: ['A', 'A'] }]
  const profile = ok(model({ parameters: [param('A')], motions }))
  assert.deepEqual(plain(profile.motions), motions)
})

test('enriched motion facts remain separated and survive profile validation', () => {
  const motion = {
    group: 'Tap', index: 1, parameterIds: ['ParamAngleX'], durationMs: 2100, loop: true,
    curveTargets: {
      Parameter: { curveCount: 33, targetIds: ['ParamAngleX'] },
      Model: { curveCount: 0, targetIds: [] },
      PartOpacity: { curveCount: 2, targetIds: ['PartArmL', 'PartArmR'] },
    },
  }
  const profile = ok(model({ parameters: [param('ParamAngleX')], motions: [motion] }))
  assert.deepEqual(plain(profile.motions), [motion])
})

test('malformed enriched motion facts are rejected by the profile boundary', () => {
  const issues = failure(model({ motions: [{
    group: 'Tap', index: 1, parameterIds: [], durationMs: -1, loop: 'yes',
    curveTargets: {
      Parameter: { curveCount: -1, targetIds: [] },
      Model: { curveCount: 0, targetIds: [] },
      PartOpacity: { curveCount: 1, targetIds: [''] },
    },
  }] }))
  const paths = new Set(issues.map(issue => issue.path))
  assert.ok(paths.has('motions[0].durationMs'))
  assert.ok(paths.has('motions[0].loop'))
  assert.ok(paths.has('motions[0].curveTargets.Parameter.curveCount'))
  assert.ok(paths.has('motions[0].curveTargets.PartOpacity.targetIds[0]'))
})

test('unknown native resource parameters become warnings without creating parameters', () => {
  const profile = ok(model({
    parameters: [param('A')],
    expressions: [{ name: 'smile', parameters: [{ id: 'Ghost', value: 1, blend: 'Add' }] }],
    motions: [
      { group: 'Idle', index: 0, parameterIds: ['Ghost', 'Ghost'] },
      { group: 'Wave', index: 2, parameterIds: ['A'] },
    ],
  }))
  assert.deepEqual(plain(profile.parameters), [param('A')])
  assert.deepEqual(plain(profile.warnings), [
    { code: 'unknown-expression-parameter', resource: 'smile', parameterId: 'Ghost' },
    { code: 'unknown-motion-parameter', resource: 'Idle#0', parameterId: 'Ghost' },
  ])
})

test('all malformed sections are reported together, not one at a time', () => {
  const issues = failure(model({
    modelSignature: '',
    parameters: [param('A'), param('A')],
    expressions: [{ name: 'smile', parameters: [{ id: 'A', value: 1, blend: 'Additive' }] }],
    overrides: [{ channel: 'headX', parameterId: 'Ghost', direction: 'normal', confirmed: true }],
  }))
  const codes = new Set(issues.map((entry) => entry.code))
  for (const code of ['invalid-signature', 'duplicate-parameter', 'invalid-resource', 'unknown-override-target']) {
    assert.ok(codes.has(code), `expected aggregated code ${code}, got ${JSON.stringify(issues)}`)
  }
})

test('deep-frozen input still builds successfully', () => {
  const frozenStandard = deepFreeze(structuredClone(standardModel))
  const frozenPrivate = deepFreeze(structuredClone(privateModel))
  assert.ok(Object.isFrozen(frozenStandard.parameters))
  assert.equal(ok(frozenStandard).parameters.length, 4)
  assert.equal(ok(frozenPrivate).capabilities.length, 15)
})

test('output never shares mutable arrays or objects with the input', () => {
  const input = structuredClone(standardModel)
  const profile = ok(input)
  profile.parameters[0].min = 999
  profile.expressions[0].name = 'mutated'
  profile.expressions[0].parameters[0].value = 999
  profile.motions[0].parameterIds.push('Ghost')
  profile.capabilities[0].parameterIds.push('Ghost')
  assert.equal(input.parameters[0].min, -30)
  assert.equal(input.expressions[0].name, 'smile')
  assert.equal(input.expressions[0].parameters[0].value, 0.8)
  assert.deepEqual(input.motions[0].parameterIds, ['ParamAngleX'])
  assert.deepEqual(input.parameters[0], param('ParamAngleX', { min: -30, max: 30, defaultValue: 0 }))

  const mutableInput = structuredClone(standardModel)
  const isolatedProfile = ok(mutableInput)
  mutableInput.parameters[0].min = 999
  mutableInput.expressions[0].parameters[0].value = 999
  assert.equal(isolatedProfile.parameters[0].min, -30)
  assert.equal(isolatedProfile.expressions[0].parameters[0].value, 0.8)
})

test('identical inputs produce deterministic, independent results', () => {
  const first = ok(standardModel)
  const second = ok(standardModel)
  assert.deepEqual(plain(first), plain(second))
  assert.notEqual(first.capabilities, second.capabilities)
  assert.notEqual(first.mappings, second.mappings)
  first.capabilities.push({ channel: 'headX', status: 'unsupported', parameterIds: [], reason: 'missing-parameter' })
  first.mappings.push({ channel: 'headY', parameterId: 'X', direction: 'normal', source: 'manual', confidence: 1, confirmed: true })
  assert.equal(second.capabilities.length, 15)
  assert.equal(second.mappings.length, 4)
})

test('the builder never reads the wall clock or a random source', () => {
  const guardedMath = new Proxy(Math, {
    get(target, property, receiver) {
      if (property === 'random') throw new Error('Math.random must not be used')
      return Reflect.get(target, property, receiver)
    },
  })
  class GuardedDate extends Date {
    static now() {
      throw new Error('Date.now must not be used')
    }
  }
  const isolated = loadTs(PROFILE_FILE, { Date: GuardedDate, Math: guardedMath })
  const result = isolated.buildModelCapabilityProfile(standardModel)
  assert.equal(result.ok, true)
  assert.equal(result.profile.capabilities.length, 15)
})
