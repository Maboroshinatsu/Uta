'use strict'
// Behavior tests for the real Core inspection adapter. No source-string matching.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test, before, after } = require('node:test')
const fixtureSupport = require('./support/model-inspection-fixture.cjs')

function loadTs(relativePath, extraRequire = {}, extraGlobals = {}) {
  const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    require: (id) => {
      if (Object.prototype.hasOwnProperty.call(extraRequire, id)) return extraRequire[id]
      throw new Error(`unexpected require: ${id}`)
    },
    ...extraGlobals,
  })
  return mod.exports
}

const PROFILE_FILE = '../src/renderer/services/performance/profile/index.ts'
const INSPECTION_FILE = '../src/renderer/services/performance/inspection/index.ts'
const profileModule = loadTs(PROFILE_FILE)
const {
  inspectCoreModel,
  MAX_CORE_PARAMETERS,
  MAX_METADATA_RESOURCES,
  MAX_METADATA_JSON_BYTES,
} = loadTs(INSPECTION_FILE, { '../profile/index': profileModule })

const plain = (value) => JSON.parse(JSON.stringify(value))

for (const [name, metadata] of [
  ['expressions', { expressions: new Array(1) }],
  ['motions', { motions: new Array(1) }],
  ['CDI parameters', { cdi: { Parameters: new Array(1) } }],
  ['physics settings', { physics: { PhysicsSettings: new Array(1) } }],
  ['physics outputs', { physics: { PhysicsSettings: [{ Output: new Array(1) }] } }],
  ['expression parameters', { expressions: [{ name: 'x', json: { Parameters: new Array(1) } }] }],
  ['motion curves', { motions: [{ group: 'x', index: 0, json: { Curves: new Array(1) } }] }],
]) {
  test(`sparse ${name} is rejected instead of silently discarded`, () => {
    failure(inspectCoreModel(rawCore(), request({ metadata })), 'invalid-metadata')
  })
}

function param(id, extra = {}) {
  return { id, min: -1, max: 1, defaultValue: 0, ...extra }
}

function syntheticCore(parameters) {
  return {
    parameters: {
      count: parameters.length,
      ids: parameters.map((entry) => entry.id),
      minimumValues: parameters.map((entry) => entry.min),
      maximumValues: parameters.map((entry) => entry.max),
      defaultValues: parameters.map((entry) => entry.defaultValue),
    },
  }
}

function rawCore(overrides = {}) {
  return {
    parameters: {
      count: 1,
      ids: ['A'],
      minimumValues: [0],
      maximumValues: [1],
      defaultValues: [0],
      ...overrides,
    },
  }
}

function request({ metadata = {}, overrides = [], modelSignature = 'synthetic:inspection' } = {}) {
  return {
    modelSignature,
    metadata: { cdi: null, physics: null, expressions: [], motions: [], ...metadata },
    overrides,
  }
}

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(plain(result.issues ?? [])))
  return result.input
}

function failure(result, code, issuePath) {
  assert.equal(result.ok, false, 'expected a structured failure')
  assert.ok(Array.isArray(result.issues) && result.issues.length > 0)
  const issues = plain(result.issues)
  if (code !== undefined) {
    assert.ok(issues.some((entry) => entry.code === code), `expected ${code}, got ${JSON.stringify(issues)}`)
  }
  if (issuePath !== undefined) {
    assert.ok(
      issues.some((entry) => entry.code === code && entry.path === issuePath),
      `expected ${code} at ${issuePath}, got ${JSON.stringify(issues)}`,
    )
  }
  return issues
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key])
    Object.freeze(value)
  }
  return value
}

// ---------------------------------------------------------------------------
// Core conversion

test('converts a valid synthetic core and metadata into the frozen input shape', () => {
  const input = ok(inspectCoreModel(syntheticCore([
    param('ParamAngleX', { min: -30, max: 30, defaultValue: 0 }),
    param('FaceTurn', { min: -10, max: 20, defaultValue: 3 }),
  ]), request({
    metadata: {
      cdi: { Parameters: [{ Id: 'FaceTurn', Name: '头部左右' }], Extra: { ignored: true } },
      physics: { PhysicsSettings: [{ Output: [{ Destination: { Target: 'Parameter', Id: 'ParamAngleX' } }] }] },
      expressions: [{ name: 'smile', json: { Parameters: [{ Id: 'ParamAngleX', Value: 0.5, Blend: 'Multiply' }], FadeInTime: 0.2 } }],
      motions: [{ group: 'Idle', index: 0, json: { Meta: { Duration: 2.1, Loop: true }, Curves: [
        { Target: 'Parameter', Id: 'ParamAngleX' },
        { Target: 'Model', Id: 'Opacity' },
        { Target: 'Parameter', Id: 'ParamAngleX' },
      ] } }],
    },
    overrides: [{ channel: 'headX', parameterId: 'FaceTurn', direction: 'reversed', confirmed: true }],
  })))

  assert.equal(input.schemaVersion, 1)
  assert.equal(input.modelSignature, 'synthetic:inspection')
  assert.deepEqual(plain(input.parameters), [
    { id: 'ParamAngleX', min: -30, max: 30, defaultValue: 0, physicsOutput: true },
    { id: 'FaceTurn', min: -10, max: 20, defaultValue: 3, physicsOutput: false, label: '头部左右' },
  ])
  assert.deepEqual(plain(input.expressions), [
    { name: 'smile', parameters: [{ id: 'ParamAngleX', value: 0.5, blend: 'Multiply' }] },
  ])
  assert.deepEqual(plain(input.motions), [
    {
      group: 'Idle', index: 0, parameterIds: ['ParamAngleX'], durationMs: 2100, loop: true,
      curveTargets: {
        Parameter: { curveCount: 2, targetIds: ['ParamAngleX'] },
        Model: { curveCount: 1, targetIds: ['Opacity'] },
        PartOpacity: { curveCount: 0, targetIds: [] },
      },
    },
  ])
  assert.deepEqual(plain(input.overrides), [
    { channel: 'headX', parameterId: 'FaceTurn', direction: 'reversed', confirmed: true },
  ])
})

test('accepts typed arrays and zero parameters', () => {
  const typed = inspectCoreModel({
    parameters: {
      count: 1,
      ids: ['ParamMouthOpenY'],
      minimumValues: new Float32Array([0]),
      maximumValues: new Float32Array([1]),
      defaultValues: new Float32Array([0]),
    },
  }, request())
  assert.deepEqual(plain(ok(typed).parameters), [
    { id: 'ParamMouthOpenY', min: 0, max: 1, defaultValue: 0, physicsOutput: false },
  ])

  const empty = inspectCoreModel({
    parameters: { count: 0, ids: [], minimumValues: [], maximumValues: [], defaultValues: [] },
  }, request())
  const emptyInput = ok(empty)
  assert.deepEqual(plain(emptyInput.parameters), [])
  const profile = profileModule.buildModelCapabilityProfile(emptyInput)
  assert.equal(profile.ok, true)
  assert.deepEqual(plain(profile.profile.capabilities).map((entry) => entry.status), Array(15).fill('unsupported'))
})

test('accepts the 4096 parameter boundary and rejects larger counts', () => {
  const parameters = Array.from({ length: MAX_CORE_PARAMETERS }, (_, index) => param(`P${index}`))
  assert.equal(ok(inspectCoreModel(syntheticCore(parameters), request())).parameters.length, MAX_CORE_PARAMETERS)
  failure(inspectCoreModel(rawCore({ count: MAX_CORE_PARAMETERS + 1 }), request()), 'invalid-core', 'core.parameters.count')
})

const coreCases = [
  ['core is null', null, 'core'],
  ['core is an array', [], 'core'],
  ['core is a string', 'model', 'core'],
  ['parameters is missing', {}, 'core.parameters'],
  ['parameters is an array', { parameters: [] }, 'core.parameters'],
  ['count is negative', () => rawCore({ count: -1 }), 'core.parameters.count'],
  ['count is fractional', () => rawCore({ count: 1.5 }), 'core.parameters.count'],
  ['count is a string', () => rawCore({ count: '1' }), 'core.parameters.count'],
  ['ids length mismatch', () => rawCore({ ids: ['A', 'B'] }), 'core.parameters.ids'],
  ['minimum length mismatch', () => rawCore({ minimumValues: [] }), 'core.parameters.minimumValues'],
  ['maximum length mismatch', () => rawCore({ maximumValues: [] }), 'core.parameters.maximumValues'],
  ['default length mismatch', () => rawCore({ defaultValues: [] }), 'core.parameters.defaultValues'],
  ['ids is a string', () => rawCore({ ids: 'A' }), 'core.parameters.ids'],
  ['empty id', () => rawCore({ ids: ['   '] }), 'core.parameters[0].id'],
  ['non-string id', () => rawCore({ ids: [42] }), 'core.parameters[0].id'],
  ['duplicate id', () => rawCore({ count: 2, ids: ['A', 'A'], minimumValues: [0, 0], maximumValues: [1, 1], defaultValues: [0, 0] }), 'core.parameters[1].id'],
  ['NaN minimum', () => rawCore({ minimumValues: [Number.NaN] }), 'core.parameters[0].min'],
  ['infinite maximum', () => rawCore({ maximumValues: [Number.POSITIVE_INFINITY] }), 'core.parameters[0].max'],
  ['NaN default', () => rawCore({ defaultValues: [Number.NaN] }), 'core.parameters[0].defaultValue'],
  ['min greater than max', () => rawCore({ minimumValues: [2], maximumValues: [1], defaultValues: [1.5] }), 'core.parameters[0].min'],
  ['default below minimum', () => rawCore({ defaultValues: [-2] }), 'core.parameters[0].defaultValue'],
  ['default above maximum', () => rawCore({ defaultValues: [2] }), 'core.parameters[0].defaultValue'],
]
for (const [name, core, issuePath] of coreCases) {
  test(`core rejection: ${name}`, () => {
    const value = typeof core === 'function' ? core() : core
    failure(inspectCoreModel(value, request()), 'invalid-core', issuePath)
  })
}

test('a throwing Core getter becomes invalid-core instead of escaping', () => {
  const throwing = { parameters: { get count() { throw new Error('count getter') } } }
  const issues = failure(inspectCoreModel(throwing, request()), 'invalid-core', 'core')
  assert.equal(issues[0].path, 'core')
  assert.doesNotMatch(issues[0].message, /count getter/)

  const indexThrowing = {
    parameters: {
      count: 1,
      ids: { length: 1, get 0() { throw new Error('id getter') } },
      minimumValues: [0],
      maximumValues: [1],
      defaultValues: [0],
    },
  }
  failure(inspectCoreModel(indexThrowing, request()), 'invalid-core', 'core')
})

test('Core is only read, never written or mutated', () => {
  const target = syntheticCore([param('ParamAngleX')])
  const guarded = new Proxy(target, {
    set() { throw new Error('Core write attempted') },
    get(object, property, receiver) {
      if (property === 'update' || property === 'release') throw new Error(`Core lifecycle call: ${String(property)}`)
      return Reflect.get(object, property, receiver)
    },
  })
  ok(inspectCoreModel(guarded, request()))
  assert.deepEqual(plain(target), plain(syntheticCore([param('ParamAngleX')])))
})

// ---------------------------------------------------------------------------
// Metadata rejection

const metadataCases = [
  ['request is an array', () => [], 'request'],
  ['request unknown field', () => ({ ...request(), extra: true }), 'request.extra'],
  ['metadata is null', () => ({ ...request(), metadata: null }), 'metadata'],
  ['metadata is an array', () => ({ ...request(), metadata: [] }), 'metadata'],
  ['metadata unknown field', () => request({ metadata: { extra: true } }), 'metadata.extra'],
  ['cdi is undefined', () => request({ metadata: { cdi: undefined } }), 'metadata.cdi'],
  ['physics is undefined', () => request({ metadata: { physics: undefined } }), 'metadata.physics'],
  ['cdi is an array', () => request({ metadata: { cdi: [] } }), 'metadata.cdi'],
  ['cdi Parameters missing', () => request({ metadata: { cdi: {} } }), 'metadata.cdi.Parameters'],
  ['cdi duplicate id', () => request({ metadata: { cdi: { Parameters: [
    { Id: 'A', Name: 'a' }, { Id: 'A', Name: 'b' },
  ] } } }), 'metadata.cdi.Parameters[1].Id'],
  ['cdi missing name', () => request({ metadata: { cdi: { Parameters: [{ Id: 'A' }] } } }), 'metadata.cdi.Parameters[0].Name'],
  ['cdi non-string name', () => request({ metadata: { cdi: { Parameters: [{ Id: 'A', Name: 7 }] } } }), 'metadata.cdi.Parameters[0].Name'],
  ['physics PhysicsSettings missing', () => request({ metadata: { physics: {} } }), 'metadata.physics.PhysicsSettings'],
  ['physics Output missing', () => request({ metadata: { physics: { PhysicsSettings: [{}] } } }), 'metadata.physics.PhysicsSettings[0].Output'],
  ['physics Destination null', () => request({ metadata: { physics: { PhysicsSettings: [{ Output: [{ Destination: null }] }] } } }), 'metadata.physics.PhysicsSettings[0].Output[0].Destination'],
  ['physics Destination string', () => request({ metadata: { physics: { PhysicsSettings: [{ Output: [{ Destination: 'Parameter' }] }] } } }), 'metadata.physics.PhysicsSettings[0].Output[0].Destination'],
  ['physics destination missing Target', () => request({ metadata: { physics: { PhysicsSettings: [{ Output: [{ Destination: { Id: 'A' } }] }] } } }), 'metadata.physics.PhysicsSettings[0].Output[0].Destination.Target'],
  ['physics destination missing Id', () => request({ metadata: { physics: { PhysicsSettings: [{ Output: [{ Destination: { Target: 'Parameter' } }] }] } } }), 'metadata.physics.PhysicsSettings[0].Output[0].Destination.Id'],
  ['expressions is not an array', () => request({ metadata: { expressions: {} } }), 'metadata.expressions'],
  ['motions is not an array', () => request({ metadata: { motions: {} } }), 'metadata.motions'],
  ['expression unknown wrapper field', () => request({ metadata: { expressions: [{ name: 'e', json: { Parameters: [] }, extra: 1 }] } }), 'metadata.expressions[0].extra'],
  ['expression empty name', () => request({ metadata: { expressions: [{ name: '  ', json: { Parameters: [] } }] } }), 'metadata.expressions[0].name'],
  ['expression duplicate name', () => request({ metadata: { expressions: [
    { name: 'e', json: { Parameters: [] } }, { name: 'e', json: { Parameters: [] } },
  ] } }), 'metadata.expressions[1].name'],
  ['expression json is null', () => request({ metadata: { expressions: [{ name: 'e', json: null }] } }), 'metadata.expressions[0].json'],
  ['expression Parameters missing', () => request({ metadata: { expressions: [{ name: 'e', json: {} }] } }), 'metadata.expressions[0].json.Parameters'],
  ['expression parameter is not an object', () => request({ metadata: { expressions: [{ name: 'e', json: { Parameters: ['A'] } }] } }), 'metadata.expressions[0].json.Parameters[0]'],
  ['expression empty Id', () => request({ metadata: { expressions: [{ name: 'e', json: { Parameters: [{ Id: ' ', Value: 1, Blend: 'Add' }] } }] } }), 'metadata.expressions[0].json.Parameters[0].Id'],
  ['expression NaN Value', () => request({ metadata: { expressions: [{ name: 'e', json: { Parameters: [{ Id: 'A', Value: Number.NaN, Blend: 'Add' }] } }] } }), 'metadata.expressions[0].json.Parameters[0].Value'],
  ['expression invalid Blend', () => request({ metadata: { expressions: [{ name: 'e', json: { Parameters: [{ Id: 'A', Value: 1, Blend: 'Additive' }] } }] } }), 'metadata.expressions[0].json.Parameters[0].Blend'],
  ['motion unknown wrapper field', () => request({ metadata: { motions: [{ group: 'Idle', index: 0, json: { Curves: [] }, extra: 1 }] } }), 'metadata.motions[0].extra'],
  ['motion empty group', () => request({ metadata: { motions: [{ group: ' ', index: 0, json: { Curves: [] } }] } }), 'metadata.motions[0].group'],
  ['motion negative index', () => request({ metadata: { motions: [{ group: 'Idle', index: -1, json: { Curves: [] } }] } }), 'metadata.motions[0].index'],
  ['motion fractional index', () => request({ metadata: { motions: [{ group: 'Idle', index: 0.5, json: { Curves: [] } }] } }), 'metadata.motions[0].index'],
  ['motion duplicate group and index', () => request({ metadata: { motions: [
    { group: 'Idle', index: 0, json: { Curves: [] } }, { group: 'Idle', index: 0, json: { Curves: [] } },
  ] } }), 'metadata.motions[1]'],
  ['motion json is null', () => request({ metadata: { motions: [{ group: 'Idle', index: 0, json: null }] } }), 'metadata.motions[0].json'],
  ['motion Meta is not an object', () => request({ metadata: { motions: [{ group: 'Idle', index: 0, json: { Meta: [], Curves: [] } }] } }), 'metadata.motions[0].json.Meta'],
  ['motion negative Duration', () => request({ metadata: { motions: [{ group: 'Idle', index: 0, json: { Meta: { Duration: -1 }, Curves: [] } }] } }), 'metadata.motions[0].json.Meta.Duration'],
  ['motion non-boolean Loop', () => request({ metadata: { motions: [{ group: 'Idle', index: 0, json: { Meta: { Loop: 1 }, Curves: [] } }] } }), 'metadata.motions[0].json.Meta.Loop'],
  ['motion Curves missing', () => request({ metadata: { motions: [{ group: 'Idle', index: 0, json: {} }] } }), 'metadata.motions[0].json.Curves'],
  ['motion curve is not an object', () => request({ metadata: { motions: [{ group: 'Idle', index: 0, json: { Curves: ['A'] } }] } }), 'metadata.motions[0].json.Curves[0]'],
  ['motion unknown target', () => request({ metadata: { motions: [{ group: 'Idle', index: 0, json: { Curves: [{ Target: 'Foo', Id: 'A' }] } }] } }), 'metadata.motions[0].json.Curves[0].Target'],
  ['motion Parameter curve empty Id', () => request({ metadata: { motions: [{ group: 'Idle', index: 0, json: { Curves: [{ Target: 'Parameter', Id: ' ' }] } }] } }), 'metadata.motions[0].json.Curves[0].Id'],
  ['motion Model curve missing Id', () => request({ metadata: { motions: [{ group: 'Idle', index: 0, json: { Curves: [{ Target: 'Model' }] } }] } }), 'metadata.motions[0].json.Curves[0].Id'],
]
for (const [name, buildRequest, issuePath] of metadataCases) {
  test(`metadata rejection: ${name}`, () => {
    failure(inspectCoreModel(syntheticCore([param('A')]), buildRequest()), 'invalid-metadata', issuePath)
  })
}

test('metadata resource count and JSON size limits are enforced', () => {
  const tooMany = Array.from({ length: MAX_METADATA_RESOURCES + 1 }, (_, index) => ({
    name: `e${index}`,
    json: { Parameters: [] },
  }))
  failure(inspectCoreModel(syntheticCore([param('A')]), request({ metadata: { expressions: tooMany } })), 'invalid-metadata', 'metadata')

  const huge = 'x'.repeat(MAX_METADATA_JSON_BYTES)
  failure(inspectCoreModel(syntheticCore([param('A')]), request({
    metadata: { expressions: [{ name: 'huge', json: { Parameters: [], Padding: huge } }] },
  })), 'invalid-metadata', 'metadata.expressions[0].json')
})

test('CDI labels are suggestions only and unknown CDI ids do not create parameters', () => {
  const input = ok(inspectCoreModel(syntheticCore([param('FaceTurn', { min: -10, max: 20 }) ]), request({
    metadata: { cdi: { Parameters: [
      { Id: 'FaceTurn', Name: '头部左右' },
      { Id: 'Ghost', Name: '幽灵' },
      { Id: 'NoName', Name: '   ' },
    ] } },
  })))
  assert.deepEqual(plain(input.parameters), [
    { id: 'FaceTurn', min: -10, max: 20, defaultValue: 0, physicsOutput: false, label: '头部左右' },
  ])
  const profile = profileModule.buildModelCapabilityProfile(input)
  assert.equal(profile.ok, true)
  const headX = plain(profile.profile.capabilities).find((entry) => entry.channel === 'headX')
  assert.deepEqual(headX, { channel: 'headX', status: 'needs-calibration', parameterIds: ['FaceTurn'], reason: 'ambiguous' })
  const mapping = plain(profile.profile.mappings).find((entry) => entry.channel === 'headX')
  assert.equal(mapping.source, 'label-guess')
  assert.equal(mapping.confirmed, false)
})

test('physics Destination supports both a single object and an array', () => {
  const input = ok(inspectCoreModel(syntheticCore([
    param('ParamAngleX', { min: -30, max: 30 }),
    param('ParamAngleY', { min: -30, max: 30 }),
    param('ParamAngleZ', { min: -30, max: 30 }),
  ]), request({
    metadata: { physics: { PhysicsSettings: [
      { Output: [{ Destination: { Target: 'Parameter', Id: 'ParamAngleX' } }] },
      { Output: [{ Destination: [
        { Target: 'Parameter', Id: 'ParamAngleY' },
        { Target: 'Model', Id: 'Opacity' },
        { Target: 'Parameter', Id: 'ParamAngleZ' },
      ] }] },
    ] } },
  })))
  assert.deepEqual(plain(input.parameters).map((entry) => [entry.id, entry.physicsOutput]), [
    ['ParamAngleX', true],
    ['ParamAngleY', true],
    ['ParamAngleZ', true],
  ])
})

test('physics output ids that do not exist in Core are ignored, not fabricated', () => {
  const input = ok(inspectCoreModel(syntheticCore([param('A')]), request({
    metadata: { physics: { PhysicsSettings: [{ Output: [{ Destination: { Target: 'Parameter', Id: 'Ghost' } }] }] } },
  })))
  assert.deepEqual(plain(input.parameters), [param('A', { physicsOutput: false })])
})

test('native expression blends are preserved and empty parameter lists are valid', () => {
  const input = ok(inspectCoreModel(syntheticCore([param('A')]), request({
    metadata: { expressions: [
      { name: 'mixed', json: { Parameters: [
        { Id: 'A', Value: 0.25, Blend: 'Add' },
        { Id: 'A', Value: 0.5, Blend: 'Multiply' },
        { Id: 'A', Value: 0.75, Blend: 'Overwrite' },
      ] } },
      { name: 'empty', json: { Parameters: [] } },
    ] },
  })))
  assert.deepEqual(plain(input.expressions), [
    { name: 'mixed', parameters: [
      { id: 'A', value: 0.25, blend: 'Add' },
      { id: 'A', value: 0.5, blend: 'Multiply' },
      { id: 'A', value: 0.75, blend: 'Overwrite' },
    ] },
    { name: 'empty', parameters: [] },
  ])
})

test('motion facts preserve target namespaces, counts, ids, duration and loop declaration', () => {
  const input = ok(inspectCoreModel(syntheticCore([param('A')]), request({
    metadata: { motions: [{ group: 'Idle', index: 0, json: { Meta: { Duration: 1.2345, Loop: false }, Curves: [
      { Target: 'Parameter', Id: 'A' },
      { Target: 'Model', Id: 'Opacity' },
      { Target: 'PartOpacity', Id: 'PartArmA' },
      { Target: 'Parameter', Id: 'A' },
      { Target: 'PartOpacity', Id: 'PartArmA' },
    ] } }] },
  })))
  assert.deepEqual(plain(input.motions), [{
    group: 'Idle', index: 0, parameterIds: ['A'], durationMs: 1235, loop: false,
    curveTargets: {
      Parameter: { curveCount: 2, targetIds: ['A'] },
      Model: { curveCount: 1, targetIds: ['Opacity'] },
      PartOpacity: { curveCount: 2, targetIds: ['PartArmA'] },
    },
  }])
})

test('unknown resource parameter ids are warnings through the profile builder, not metadata errors', () => {
  const input = ok(inspectCoreModel(syntheticCore([param('A')]), request({
    metadata: {
      expressions: [{ name: 'smile', json: { Parameters: [{ Id: 'Ghost', Value: 1, Blend: 'Add' }] } }],
      motions: [{ group: 'Idle', index: 0, json: { Curves: [{ Target: 'Parameter', Id: 'Ghost2' }] } }],
    },
  })))
  const profile = profileModule.buildModelCapabilityProfile(input)
  assert.equal(profile.ok, true)
  assert.deepEqual(plain(profile.profile.warnings), [
    { code: 'unknown-expression-parameter', resource: 'smile', parameterId: 'Ghost' },
    { code: 'unknown-motion-parameter', resource: 'Idle#0', parameterId: 'Ghost2' },
  ])
})

// ---------------------------------------------------------------------------
// Profile builder integration and error mapping

test('profile builder failures are mapped to invalid-profile with the original path', () => {
  const issues = failure(inspectCoreModel(syntheticCore([param('Turn')]), request({
    modelSignature: '   ',
  })), 'invalid-profile', 'modelSignature')
  assert.match(issues[0].message, /invalid-signature/)
})

test('override errors are mapped to invalid-profile', () => {
  const unknownTarget = failure(inspectCoreModel(syntheticCore([param('Turn')]), request({
    overrides: [{ channel: 'headX', parameterId: 'Ghost', direction: 'normal', confirmed: true }],
  })), 'invalid-profile', 'overrides[0].parameterId')
  assert.match(unknownTarget[0].message, /unknown-override-target/)

  const badChannel = failure(inspectCoreModel(syntheticCore([param('Turn')]), request({
    overrides: [{ channel: 'tail', parameterId: 'Turn', direction: 'normal', confirmed: true }],
  })), 'invalid-profile', 'overrides[0].channel')
  assert.match(badChannel[0].message, /invalid-override/)

  const badDirection = failure(inspectCoreModel(syntheticCore([param('Turn')]), request({
    overrides: [{ channel: 'headX', parameterId: 'Turn', direction: 'sideways', confirmed: true }],
  })), 'invalid-profile', 'overrides[0].direction')

  const duplicate = failure(inspectCoreModel(syntheticCore([param('Turn')]), request({
    overrides: [
      { channel: 'headX', parameterId: 'Turn', direction: 'normal', confirmed: true },
      { channel: 'headX', parameterId: 'Turn', direction: 'reversed', confirmed: false },
    ],
  })), 'invalid-profile', 'overrides[1].channel')
  assert.match(duplicate[0].message, /invalid-override/)
})

test('a confirmed override reaches the profile builder and keeps its direction', () => {
  const input = ok(inspectCoreModel(syntheticCore([param('Turn', { min: -10, max: 20 })]), request({
    overrides: [{ channel: 'headX', parameterId: 'Turn', direction: 'reversed', confirmed: true }],
  })))
  const profile = profileModule.buildModelCapabilityProfile(input)
  assert.equal(profile.ok, true)
  const mapping = plain(profile.profile.mappings).find((entry) => entry.channel === 'headX')
  assert.deepEqual(mapping, {
    channel: 'headX', parameterId: 'Turn', direction: 'reversed', source: 'manual', confidence: 1, confirmed: true,
  })
  assert.deepEqual(
    plain(profile.profile.capabilities).find((entry) => entry.channel === 'headX'),
    { channel: 'headX', status: 'available', parameterIds: ['Turn'], reason: 'mapped' },
  )
})

test('a physics-output standard parameter degrades through the profile builder', () => {
  const input = ok(inspectCoreModel(syntheticCore([param('ParamAngleX', { min: -30, max: 30 })]), request({
    metadata: { physics: { PhysicsSettings: [{ Output: [{ Destination: { Target: 'Parameter', Id: 'ParamAngleX' } }] }] } },
  })))
  const profile = profileModule.buildModelCapabilityProfile(input)
  assert.equal(profile.ok, true)
  assert.deepEqual(
    plain(profile.profile.capabilities).find((entry) => entry.channel === 'headX'),
    { channel: 'headX', status: 'needs-calibration', parameterIds: ['ParamAngleX'], reason: 'physics-output' },
  )
  assert.equal(plain(profile.profile.mappings).find((entry) => entry.channel === 'headX'), undefined)
})

// ---------------------------------------------------------------------------
// Immutability and determinism

test('deep-frozen Core and request still convert', () => {
  const core = deepFreeze(syntheticCore([param('ParamAngleX'), param('FaceTurn')]))
  const req = deepFreeze(request({
    metadata: {
      cdi: { Parameters: [{ Id: 'FaceTurn', Name: '头部左右' }] },
      physics: { PhysicsSettings: [{ Output: [{ Destination: { Target: 'Parameter', Id: 'ParamAngleX' } }] }] },
      expressions: [{ name: 'smile', json: { Parameters: [{ Id: 'ParamAngleX', Value: 0.5, Blend: 'Add' }] } }],
      motions: [{ group: 'Idle', index: 0, json: { Curves: [{ Target: 'Parameter', Id: 'ParamAngleX' }] } }],
    },
    overrides: [{ channel: 'headX', parameterId: 'FaceTurn', direction: 'normal', confirmed: true }],
  }))
  assert.ok(Object.isFrozen(core.parameters.ids))
  assert.ok(Object.isFrozen(req.metadata.expressions[0].json.Parameters[0]))
  ok(inspectCoreModel(core, req))
})

test('output never shares mutable arrays with Core or metadata, and input mutation cannot leak in', () => {
  const core = syntheticCore([param('ParamAngleX')])
  const req = request({
    metadata: {
      cdi: { Parameters: [{ Id: 'ParamAngleX', Name: '头部' }] },
      physics: { PhysicsSettings: [{ Output: [{ Destination: { Target: 'Parameter', Id: 'ParamAngleX' } }] }] },
      expressions: [{ name: 'smile', json: { Parameters: [{ Id: 'ParamAngleX', Value: 0.5, Blend: 'Add' }] } }],
      motions: [{ group: 'Idle', index: 0, json: { Curves: [{ Target: 'Parameter', Id: 'ParamAngleX' }] } }],
    },
    overrides: [{ channel: 'headX', parameterId: 'ParamAngleX', direction: 'normal', confirmed: true }],
  })
  const input = ok(inspectCoreModel(core, req))
  input.parameters[0].min = 999
  input.parameters[0].label = 'mutated'
  input.expressions[0].name = 'mutated'
  input.expressions[0].parameters[0].value = 999
  input.motions[0].parameterIds.push('Ghost')
  input.overrides[0].confirmed = false

  assert.equal(core.parameters.minimumValues[0], -1)
  assert.equal(req.metadata.cdi.Parameters[0].Name, '头部')
  assert.equal(req.metadata.expressions[0].json.Parameters[0].Value, 0.5)
  assert.deepEqual(req.metadata.motions[0].json.Curves.map((curve) => curve.Id), ['ParamAngleX'])
  assert.equal(req.overrides[0].confirmed, true)

  const secondCore = syntheticCore([param('ParamAngleX')])
  const secondReq = structuredClone(req)
  const secondInput = ok(inspectCoreModel(secondCore, secondReq))
  secondReq.metadata.expressions[0].json.Parameters[0].Value = 999
  secondReq.metadata.cdi.Parameters[0].Name = 'mutated'
  assert.equal(secondInput.expressions[0].parameters[0].value, 0.5)
  assert.equal(secondInput.parameters[0].label, '头部')
})

test('identical inputs produce deterministic independent outputs', () => {
  const core = syntheticCore([param('ParamAngleX'), param('FaceTurn')])
  const req = request({ metadata: { cdi: { Parameters: [{ Id: 'FaceTurn', Name: '头部左右' }] } } })
  const first = ok(inspectCoreModel(core, req))
  const second = ok(inspectCoreModel(core, req))
  assert.deepEqual(plain(first), plain(second))
  assert.notEqual(first.parameters, second.parameters)
  first.parameters.push(param('Ghost'))
  first.expressions.push({ name: 'x', parameters: [] })
  assert.equal(second.parameters.length, 2)
  assert.equal(second.expressions.length, 0)
})

test('the adapter never reads the wall clock or a random source', () => {
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
  const isolated = loadTs(INSPECTION_FILE, { '../profile/index': profileModule }, { Date: GuardedDate, Math: guardedMath })
  const result = isolated.inspectCoreModel(syntheticCore([param('ParamAngleX')]), request())
  assert.equal(result.ok, true)
  assert.equal(result.input.parameters.length, 1)
})

// ---------------------------------------------------------------------------
// Real DS sample

const realFixtureAvailable = fixtureSupport.fixtureAvailable()
const realSkip = realFixtureAvailable ? false : 'task-local .uta-task/model-input is not available'
let realFixture = null

before(async () => {
  if (realFixtureAvailable) realFixture = await fixtureSupport.loadRealFixture()
})

after(() => {
  realFixture?.release()
})

test('real DS sample: manifest, signature and attribution are intact', { skip: realSkip }, () => {
  const fixture = realFixture
  assert.deepEqual(fixture.integrity, {
    files: 59,
    totalBytes: 4141300,
    signature: fixture.manifest.contentSignature,
    signatureOk: true,
    missingRefs: [],
    extraManifestFiles: [],
  })
  assert.equal(fixture.manifest.license, 'CC-BY-NC-SA-4.0')
  assert.match(fixture.manifest.licenseUrl, /creativecommons\.org\/licenses\/by-nc-sa\/4\.0/)
  assert.equal(fixture.manifest.declaredExpressions, 44)
  assert.equal(fixture.manifest.declaredMotionGroups, 8)
  assert.equal(fixture.manifest.declaredMotionCount, 8)
  assert.deepEqual(fixture.manifest.lipSyncGroup, [])
  assert.deepEqual(fixture.lipSyncGroup, [])
  assert.match(fixture.notice.text, /溟月/)
  assert.match(fixture.notice.text, /氵六青/)
  assert.match(fixture.notice.text, /CC BY-NC-SA 4\.0/)
  assert.match(fixture.notice.hash, /^[0-9a-f]{64}$/)
  assert.equal(fixture.request.modelSignature, fixture.manifest.contentSignature)
})

test('real DS sample: bounded readiness and independent Core report match', { skip: realSkip }, () => {
  const fixture = realFixture
  assert.equal(fixture.coreReport.matches, true)
  assert.deepEqual(fixture.coreReport.mismatches, [])
  assert.equal(fixture.coreReport.count, 247)
  assert.equal(fixture.coreReport.reportCount, 247)
  assert.equal(fixture.coreReport.parts, 92)
  assert.equal(fixture.coreReport.drawables, 269)
  assert.equal(fixture.coreReport.version, fixture.coreReport.reportVersion)
  assert.ok(fixture.readiness.mocAttempts >= 1)
  assert.ok(fixture.readiness.modelAttempts >= 1)
  assert.ok(fixture.readiness.mocMs < fixture.readiness.readyTimeoutMs)
  assert.ok(fixture.readiness.modelMs < fixture.readiness.readyTimeoutMs)
})

test('real DS sample: parameters, labels and physics outputs match the snapshot exactly', { skip: realSkip }, () => {
  const fixture = realFixture
  const input = ok(inspectCoreModel(fixture.liveView, fixture.request))

  assert.equal(input.schemaVersion, 1)
  assert.equal(input.modelSignature, fixture.manifest.contentSignature)
  assert.equal(input.parameters.length, 247)
  assert.equal(input.parameters.filter((entry) => entry.physicsOutput).length, fixture.expected.physicsParameterIds.size)

  const coreIds = new Set(input.parameters.map((entry) => entry.id))
  for (const id of fixture.expected.physicsParameterIds) assert.ok(coreIds.has(id), `physics id ${id} is not in Core`)

  const expectedParameters = fixture.expected.parameters.map((entry) => {
    const label = fixture.expected.labels.get(entry.id)
    return {
      id: entry.id,
      min: entry.min,
      max: entry.max,
      defaultValue: entry.defaultValue,
      physicsOutput: fixture.expected.physicsParameterIds.has(entry.id),
      ...(label === undefined ? {} : { label }),
    }
  })
  assert.deepEqual(plain(input.parameters), plain(expectedParameters))
  assert.equal(input.parameters.filter((entry) => entry.label !== undefined).length, fixture.expected.labels.size)
  assert.equal(input.parameters.filter((entry) => entry.label !== undefined).length, 247)

  const mouthForm = input.parameters.find((entry) => entry.id === 'ParamMouthForm')
  const mouthOpen = input.parameters.find((entry) => entry.id === 'ParamMouthOpenY')
  assert.deepEqual(plain(mouthForm), { id: 'ParamMouthForm', min: -2, max: 1, defaultValue: -0.5, physicsOutput: false, label: fixture.expected.labels.get('ParamMouthForm') })
  assert.deepEqual(plain(mouthOpen), { id: 'ParamMouthOpenY', min: 0, max: 1, defaultValue: 0, physicsOutput: false, label: fixture.expected.labels.get('ParamMouthOpenY') })
})

test('real DS sample: all 44 expressions and 8 motions convert, with targets separated', { skip: realSkip }, () => {
  const fixture = realFixture
  const input = ok(inspectCoreModel(fixture.liveView, fixture.request))

  assert.deepEqual(plain(input.expressions), plain(fixture.expected.expressions))
  assert.deepEqual(plain(input.motions), plain(fixture.expected.motions))
  assert.equal(input.expressions.length, 44)
  assert.equal(input.motions.length, 8)
  assert.deepEqual(fixture.expected.blendCounts, { Add: 105, Multiply: 0, Overwrite: 0 })
  assert.deepEqual(fixture.expected.curveTargetCounts, { Parameter: 184 })
  assert.equal(fixture.counts.destinationShapes.object, 56)
  assert.equal(fixture.counts.destinationShapes.array, 0)
  assert.equal(fixture.counts.physicsDestinations, 56)
  assert.equal(fixture.counts.physicsSettings, 22)
  assert.equal(fixture.counts.cdiParameters, 247)
  assert.deepEqual(plain(input.overrides), [])
})

test('real DS sample: profile summary keeps mouth capabilities and degrades physics outputs', { skip: realSkip }, () => {
  const fixture = realFixture
  const input = ok(inspectCoreModel(fixture.liveView, fixture.request))
  const result = profileModule.buildModelCapabilityProfile(input)
  assert.equal(result.ok, true)
  const capabilities = plain(result.profile.capabilities)
  assert.equal(capabilities.length, 15)
  const byChannel = Object.fromEntries(capabilities.map((entry) => [entry.channel, entry]))

  assert.deepEqual(byChannel.mouthOpen, { channel: 'mouthOpen', status: 'available', parameterIds: ['ParamMouthOpenY'], reason: 'mapped' })
  assert.deepEqual(byChannel.mouthForm, { channel: 'mouthForm', status: 'available', parameterIds: ['ParamMouthForm'], reason: 'mapped' })

  for (const [channel, parameterId] of Object.entries(profileModule.STANDARD_PARAMETER_IDS)) {
    if (!input.parameters.some((entry) => entry.id === parameterId)) continue
    if (!fixture.expected.physicsParameterIds.has(parameterId)) continue
    assert.deepEqual(byChannel[channel], {
      channel,
      status: 'needs-calibration',
      parameterIds: [parameterId],
      reason: 'physics-output',
    })
  }

  const counts = {
    available: capabilities.filter((entry) => entry.status === 'available').length,
    needsCalibration: capabilities.filter((entry) => entry.status === 'needs-calibration').length,
    unsupported: capabilities.filter((entry) => entry.status === 'unsupported').length,
    mappings: result.profile.mappings.length,
    warnings: result.profile.warnings.length,
  }
  assert.ok(counts.available >= 2)
  assert.equal(counts.available + counts.needsCalibration + counts.unsupported, 15)
  assert.ok(counts.mappings <= 15)

  const coreIds = new Set(input.parameters.map((entry) => entry.id))
  for (const warning of result.profile.warnings) assert.ok(!coreIds.has(warning.parameterId))
})
