'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

const source = fs.readFileSync(
  path.join(__dirname, '../src/renderer/services/performance/capability-diagnostics.ts'),
  'utf8',
)
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
const defaultFocus = {
  headXParam: 'ParamAngleX', headYParam: 'ParamAngleX', headZParam: null, headScale: 30,
  eyeXParam: 'ParamAngleX', eyeYParam: 'ParamAngleX', eyeScale: 1,
  invertEyeX: false, invertEyeY: false,
  bodyXParam: null, bodyYParam: null, bodyZParam: null, bodyScale: 10,
}
vm.runInNewContext(code, {
  module: mod,
  exports: mod.exports,
  require: id => id.endsWith('/focus-mapping')
    ? { DEFAULT_FOCUS_MAPPING: defaultFocus }
    : id.endsWith('/emotion-adapter')
      ? { DEFAULT_LIP_SYNC: { mouthOpenParam: 'ParamMouthOpenY', gain: 1 } }
      : {},
})
const { buildModelCapabilityFacts, STANDARD_ANIMATION_SEMANTICS } = mod.exports

function motion(group, index, parameterIds = []) {
  return {
    group, index, parameterIds, durationMs: 2100, loop: true,
    curveTargets: {
      Parameter: { curveCount: parameterIds.length, targetIds: [...parameterIds] },
      Model: { curveCount: 0, targetIds: [] },
      PartOpacity: { curveCount: 2, targetIds: ['PartArmL', 'PartArmR'] },
    },
  }
}

function profile(motions = []) {
  return {
    schemaVersion: 1,
    modelSignature: 'test:model',
    parameters: [
      { id: 'ParamAngleX', min: -30, max: 30, defaultValue: 0, physicsOutput: false },
      { id: 'ParamMouthOpenY', min: 0, max: 1, defaultValue: 0, physicsOutput: false },
      { id: 'ParamMouthForm', min: -1, max: 1, defaultValue: 0, physicsOutput: false },
    ],
    mappings: [], capabilities: [], expressions: [], motions, warnings: [],
  }
}

function adapter(overrides = {}) {
  return {
    version: 1, modelId: 'test', idleMotions: [], lipSync: { mouthOpenParam: 'ParamMouthOpenY', gain: 1 },
    baseParameters: {}, hiddenParts: [], hiddenDrawables: [], emotions: {}, animations: {}, controls: {},
    loaded: true, ...overrides,
  }
}

function capabilities(overrides = {}) {
  return {
    modelUrl: './model.model3.json',
    motionGroups: { Tap: 2 },
    expressions: [],
    parameters: profile().parameters,
    parts: [{ id: 'PartArmA', name: 'Arm A' }],
    poseGroups: [['PartArmA']],
    baseParameters: {},
    controls: [],
    ...overrides,
  }
}

test('Hiyori-style shared Tap resource requires separate review for happy, wave and cheer', () => {
  const facts = buildModelCapabilityFacts(profile([motion('Tap', 1, ['ParamAngleX'])]), adapter({
    emotions: { happy: { motion: { group: 'Tap', index: 1 } } },
    animations: {
      wave: { motion: { group: 'Tap', index: 1 } },
      cheer: { motion: { group: 'Tap', index: 1 } },
    },
  }))
  const reviews = facts.diagnostics.filter(entry => entry.code === 'motion-semantic-needs-review')
  assert.deepEqual(Array.from(reviews, entry => entry.semantic), [
    'emotion:happy', 'animation:wave', 'animation:cheer',
  ])
  const shared = facts.diagnostics.find(entry => entry.code === 'shared-motion-resource')
  assert.equal(shared.resource, 'Tap#1')
  assert.deepEqual(Array.from(shared.relatedSemantics), [
    'emotion:happy', 'animation:wave', 'animation:cheer',
  ])
  assert.equal(facts.motions[0].durationMs, 2100)
  assert.equal(facts.motions[0].loop, true)
  assert.equal(facts.motions[0].curveTargets.PartOpacity.curveCount, 2)
})

test('Dafish-style adapter reports mouth contention and an unmapped wave while accepting a real IDLE resource', () => {
  const facts = buildModelCapabilityFacts(profile([motion('IDLE', 0)]), adapter({
    idleMotions: ['IDLE'],
    emotions: { happy: { parameters: { ParamMouthForm: 0.8, ParamMouthOpenY: 0.2 } } },
  }))
  assert.ok(facts.diagnostics.some(entry =>
    entry.code === 'speech-mouth-parameter-conflict' && entry.semantic === 'emotion:happy'))
  assert.ok(facts.diagnostics.some(entry =>
    entry.code === 'unmapped-animation-semantic' && entry.semantic === 'animation:wave'))
  assert.ok(!facts.diagnostics.some(entry =>
    entry.code === 'missing-motion-resource' && entry.semantic === 'idle:IDLE'))
  assert.equal(
    facts.diagnostics.filter(entry => entry.code === 'unmapped-animation-semantic').length,
    STANDARD_ANIMATION_SEMANTICS.length,
  )
})

test('missing idle resources and missing adapter parameters stay structural errors', () => {
  const facts = buildModelCapabilityFacts(profile(), adapter({
    idleMotions: ['IDLE'],
    emotions: { happy: { parameters: { Ghost: 1 } } },
    focus: {
      headXParam: 'GhostHead', headYParam: 'ParamAngleX', headZParam: null, headScale: 30,
      eyeXParam: 'ParamAngleX', eyeYParam: 'ParamAngleX', eyeScale: 1,
      invertEyeX: false, invertEyeY: false,
      bodyXParam: null, bodyYParam: null, bodyZParam: null, bodyScale: 10,
    },
  }))
  assert.ok(facts.diagnostics.some(entry =>
    entry.code === 'missing-motion-resource' && entry.path === 'idleMotions[0]'))
  assert.ok(facts.diagnostics.some(entry =>
    entry.code === 'missing-parameter' && entry.path === 'emotions.happy.parameters.Ghost'))
  assert.ok(facts.diagnostics.some(entry =>
    entry.code === 'missing-parameter' && entry.path === 'focus.headXParam'))
})

test('native motion and manual emotion parameters expose their overlap', () => {
  const facts = buildModelCapabilityFacts(profile([motion('Tap', 1, ['ParamAngleX'])]), adapter({
    emotions: { happy: { motion: { group: 'Tap', index: 1 }, parameters: { ParamAngleX: 10 } } },
  }))
  const conflict = facts.diagnostics.find(entry => entry.code === 'motion-parameter-overlap')
  assert.deepEqual(Array.from(conflict.parameterIds), ['ParamAngleX'])
})

test('exports are detached from profile and adapter inputs', () => {
  const sourceMotion = motion('Tap', 1, ['ParamAngleX'])
  const sourceAdapter = adapter({
    animations: { wave: { motion: { group: 'Tap', index: 1 } } },
    baseParameters: { ParamAngleX: 1 },
    hiddenParts: ['PartArmA'],
    hiddenDrawables: ['ArtMesh1'],
    controls: {
      hat: {
        parameters: { ParamAngleX: 1 },
        hiddenParts: ['PartArmA'],
        shownParts: ['PartArmA'],
      },
    },
  })
  const facts = buildModelCapabilityFacts(profile([sourceMotion]), sourceAdapter)
  facts.motions[0].curveTargets.Parameter.targetIds.push('Injected')
  facts.bindings.animations.wave.motion.group = 'Changed'
  facts.bindings.baseParameters.ParamAngleX = 2
  facts.bindings.hiddenParts.push('Injected')
  facts.bindings.hiddenDrawables.push('Injected')
  facts.bindings.controls.hat.parameters.ParamAngleX = 2
  facts.bindings.controls.hat.hiddenParts.push('Injected')
  facts.bindings.controls.hat.shownParts.push('Injected')
  assert.deepEqual(sourceMotion.curveTargets.Parameter.targetIds, ['ParamAngleX'])
  assert.equal(sourceAdapter.animations.wave.motion.group, 'Tap')
  assert.equal(sourceAdapter.baseParameters.ParamAngleX, 1)
  assert.deepEqual(sourceAdapter.hiddenParts, ['PartArmA'])
  assert.deepEqual(sourceAdapter.hiddenDrawables, ['ArtMesh1'])
  assert.equal(sourceAdapter.controls.hat.parameters.ParamAngleX, 1)
  assert.deepEqual(sourceAdapter.controls.hat.hiddenParts, ['PartArmA'])
  assert.deepEqual(sourceAdapter.controls.hat.shownParts, ['PartArmA'])
})

test('unregistered expressions, controls, base parameters, parts and pose groups are exported', () => {
  const facts = buildModelCapabilityFacts(profile(), adapter({
    emotions: { happy: { expression: '自定义表情' } },
    baseParameters: { ParamMouthForm: 0 },
    hiddenParts: ['PartArmA'],
    hiddenDrawables: ['ArtMesh1'],
    controls: {
      hat: {
        label: '帽子',
        parameters: { ParamAngleX: 1 },
        hiddenParts: ['PartArmA'],
        shownParts: ['PartArmA'],
      },
    },
  }), capabilities({
    unregisteredExpressions: ['自定义表情'],
    controls: [{
      id: 'hat', label: '帽子', category: 'outfit', parameters: { ParamAngleX: 1 },
      active: false, source: 'adapter', defaultActive: false,
      hiddenParts: ['PartArmA'], shownParts: ['PartArmA'],
    }],
  }))
  assert.ok(!facts.diagnostics.some(entry => entry.code === 'missing-expression-resource'))
  assert.deepEqual(JSON.parse(JSON.stringify(facts.unregisteredExpressions)), ['自定义表情'])
  assert.deepEqual(JSON.parse(JSON.stringify(facts.parts)), [{ id: 'PartArmA', name: 'Arm A' }])
  assert.deepEqual(JSON.parse(JSON.stringify(facts.poseGroups)), [['PartArmA']])
  assert.equal(facts.resolved.controls.length, 1)
  assert.deepEqual(Array.from(facts.resolved.controls[0].hiddenParts), ['PartArmA'])
  assert.deepEqual(Array.from(facts.bindings.hiddenDrawables), ['ArtMesh1'])
  assert.deepEqual(Array.from(facts.bindings.controls.hat.shownParts), ['PartArmA'])
  assert.equal(facts.modelUrl, './model.model3.json')
  assert.deepEqual(JSON.parse(JSON.stringify(facts.motionGroups)), { Tap: 2 })
})

test('unknown hidden and shown parts are structural errors when parts are available', () => {
  const facts = buildModelCapabilityFacts(profile(), adapter({
    hiddenParts: ['GhostPart'],
    controls: { hat: { hiddenParts: ['GhostHidden'], shownParts: ['GhostShown'] } },
  }), capabilities())
  const paths = new Set(
    facts.diagnostics
      .filter(entry => entry.code === 'missing-part')
      .map(entry => entry.path),
  )
  assert.ok(paths.has('hiddenParts[0]'))
  assert.ok(paths.has('controls.hat.hiddenParts[0]'))
  assert.ok(paths.has('controls.hat.shownParts[0]'))
})

test('missing default mouth parameter is a warning, custom is an error', () => {
  const noMouth = profile()
  noMouth.parameters = noMouth.parameters.filter(parameter => parameter.id !== 'ParamMouthOpenY')
  const defaultFacts = buildModelCapabilityFacts(noMouth, adapter())
  assert.ok(defaultFacts.diagnostics.some(entry =>
    entry.code === 'missing-parameter' && entry.path === 'lipSync.mouthOpenParam' && entry.severity === 'warning'))
  const customFacts = buildModelCapabilityFacts(noMouth, adapter({
    lipSync: { mouthOpenParam: 'CustomMouth', gain: 1 },
  }))
  assert.ok(customFacts.diagnostics.some(entry =>
    entry.code === 'missing-parameter' && entry.path === 'lipSync.mouthOpenParam' && entry.severity === 'error'))
})
