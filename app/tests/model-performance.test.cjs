'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createLoader = require('./support/settings-loader.cjs')

function setup(t, physics = null) {
  let now = 0
  const load = createLoader({
    '@pixi/app': { Application: class {} }, '@pixi/extensions': { extensions: { add() {} } },
    '@pixi/ticker': { Ticker: class {}, TickerPlugin: {} },
    'pixi-live2d-display/cubism4': { Live2DModel: { registerTicker() {} }, MotionPriority: {} },
  }, { performance: { now: () => now }, window: {} })
  const runtime = load('renderer/services/performance/model-runtime')
  const values = { ParamAngleX: 3, ParamMouthForm: -0.5, ParamHat: 1 }
  const parameters = { count: 3, ids: Object.keys(values), minimumValues: [-30, -2, 0], maximumValues: [30, 1, 1], defaultValues: [0, -0.5, 0] }
  const events = new Map(), writes = []
  const core = { _model: { parameters }, _savedParameters: [0, -0.5, 0],
    getParameterValueById: id => values[id], getParameterDefaultValueById: id => parameters.defaultValues[parameters.ids.indexOf(id)],
    setParameterValueById: (id, value) => { values[id] = value; writes.push([id, value]) }, update() {},
  }
  const model = { internalModel: { coreModel: core, on: (name, fn) => events.set(name, fn), updateNaturalMovements() {} }, destroy() {} }
  const assets = { modelSignature: 'test-content-signature', metadata: { cdi: null, physics, expressions: [], motions: [] } }
  runtime.prepareModelPerformance(model, assets)
  t.after(() => runtime.stopModelPerformance(model))
  return { runtime, model, values, writes, core, events, assets, load, now: value => { now = value } }
}

test('inspection reads live Core without writes; missing metadata disables trial safely', t => {
  const h = setup(t)
  assert.equal(h.runtime.inspectModelPerformance(h.model).parameterCount, 3)
  assert.equal(h.runtime.inspectModelPerformance(h.model).headPreviewAvailable, true)
  assert.equal(h.writes.length, 0)
  h.runtime.prepareModelPerformance(h.model, null)
  assert.equal(h.runtime.inspectModelPerformance(h.model).signature, null)
  assert.equal(h.runtime.startModelPerformance(h.model, 'mixer', () => {}), false)
})
test('physics outputs and a zero-sided range never open automatic head control', t => {
  const h = setup(t, { PhysicsSettings: [{ Output: [{ Destination: { Target: 'Parameter', Id: 'ParamAngleX' } }] }] })
  assert.equal(h.runtime.inspectModelPerformance(h.model).headPreviewAvailable, false)
  assert.equal(h.runtime.startModelPerformance(h.model, 'mixer', () => {}), false)
  h.core._model.parameters.minimumValues[0] = 0
  h.runtime.prepareModelPerformance(h.model, { ...h.assets, metadata: { ...h.assets.metadata, physics: null } })
  assert.equal(h.runtime.inspectModelPerformance(h.model).headPreviewAvailable, false)
})
test('asymmetric signed mapping retains the actual neutral anchor and clamps', t => {
  const { runtime } = setup(t)
  const parameter = { min: -2, max: 1, defaultValue: -0.5 }
  assert.equal(runtime.semanticToRaw(0, parameter), -0.5)
  assert.equal(runtime.semanticToRaw(-1, parameter), -2)
  assert.equal(runtime.semanticToRaw(2, parameter), 1)
  for (const value of [-1, -0.2, 0, 0.7, 1]) assert.ok(Math.abs(runtime.rawToSemantic(runtime.semanticToRaw(value, parameter), parameter) - value) < 1e-10)
})

test('confirmed nonstandard head mapping respects direction and strength', t => {
  const h = setup(t)
  h.core._model.parameters.defaultValues[2] = 0.5
  const run = (direction, strength) => {
    h.values.ParamHat = 0.5
    h.runtime.prepareModelPerformance(h.model, { ...h.assets, calibration: [{ channel: 'headX', parameterId: 'ParamHat', direction, strength }] })
    assert.equal(h.runtime.inspectModelPerformance(h.model).mappings.find(m => m.channel === 'headX').source, 'manual')
    assert.equal(h.runtime.startModelPerformance(h.model, 'mixer', () => {}, 0), true)
    h.runtime.applyModelPerformance(h.model, 500)
    const value = h.values.ParamHat
    h.runtime.stopModelPerformance(h.model)
    return value
  }
  const forward = run('normal', 1)
  const reversed = run('reversed', 1)
  const half = run('normal', 0.5)
  assert.ok(forward > 0.5)
  assert.ok(reversed < 0.5)
  assert.ok(half > 0.5 && half < forward)
})

test('manual mapping cannot take a physics output or another semantic channel', t => {
  const h = setup(t)
  const conflict = [{ channel: 'headX', parameterId: 'ParamMouthForm', direction: 'normal', strength: 1 }]
  h.runtime.prepareModelPerformance(h.model, { ...h.assets, calibration: conflict })
  assert.equal(h.runtime.inspectModelPerformance(h.model).mappings.find(m => m.channel === 'headX').parameterId, 'ParamAngleX')
  h.core._model.parameters.defaultValues[2] = 0.5
  const physics = { PhysicsSettings: [{ Output: [{ Destination: { Target: 'Parameter', Id: 'ParamHat' } }] }] }
  h.runtime.prepareModelPerformance(h.model, { ...h.assets, metadata: { ...h.assets.metadata, physics }, calibration: [{ channel: 'headX', parameterId: 'ParamHat', direction: 'normal', strength: 1 }] })
  assert.equal(h.runtime.inspectModelPerformance(h.model).mappings.find(m => m.channel === 'headX').parameterId, 'ParamAngleX')
})

test('calibration preview validates live model identity and moves one safe parameter briefly', async t => {
  const h = setup(t)
  const signature = 'uta-live2d-assets-v1:' + 'a'.repeat(64)
  h.core._model.parameters.defaultValues[2] = 0.5
  h.runtime.prepareModelPerformance(h.model, { ...h.assets, modelSignature: signature })
  let played = null
  const store = { live2dModel: h.model, modelUrl: 'test', modelLoaded: true, presetEditingLocked: false,
    beginPresetPreview() {}, endPresetPreview() {}, triggerPreset(preset) { played = preset; return true } }
  const execute = h.load('renderer/settings-window/pet-executor').createPetSettingsExecutor({
    store, getModelKind: () => 'live2d', switchModel: async () => {}, releaseWorkshop() {},
  })
  const cmd = (value) => execute({ id: 'preview', session: 1, command: value })
  const candidate = { type: 'preview-calibration', signature, channel: 'headX', parameterId: 'ParamHat', direction: 'reversed' }
  assert.equal((await cmd({ ...candidate, signature: 'wrong' })).ok, false)
  assert.equal((await cmd({ ...candidate, parameterId: 'ParamMouthForm' })).ok, false)
  assert.equal(played, null)
  assert.equal((await cmd(candidate)).ok, true)
  assert.equal(Object.keys(played.steps[0].parameters).length, 1)
  assert.ok(played.steps[0].parameters.ParamHat < 0.5)
  assert.equal(played.steps[1].parameters.ParamHat, 0.5)
  assert.equal(played.finishMode, 'revert')
})
test('trial writes only headX before physics, adds to native motion and stops without residual writes', t => {
  const h = setup(t)
  let ended = 0
  assert.equal(h.runtime.startModelPerformance(h.model, 'mixer', () => { ended++ }, 0), true)
  h.runtime.applyModelPerformance(h.model, 500)
  assert.ok(h.values.ParamAngleX > 3 && h.values.ParamAngleX <= 9)
  assert.deepEqual([...new Set(h.writes.map(([id]) => id))], ['ParamAngleX'])
  assert.equal(h.values.ParamMouthForm, -0.5)
  assert.equal(h.values.ParamHat, 1)
  assert.equal(h.runtime.performanceOwnsParameter(h.model, 'ParamAngleX'), true)
  assert.equal(h.runtime.performanceOwnsParameter(h.model, 'ParamHat'), false)
  h.runtime.stopModelPerformance(h.model)
  const count = h.writes.length
  h.runtime.applyModelPerformance(h.model, 900)
  assert.equal(h.writes.length, count)
  assert.equal(ended, 1)
  assert.equal(h.runtime.inspectModelPerformance(h.model).preview, null)
})
test('wall-clock gap and explicit stop both release immediately, with no late restart', t => {
  const h = setup(t)
  let ended = 0
  h.runtime.startModelPerformance(h.model, 'mixer', () => { ended++ }, 0)
  h.runtime.applyModelPerformance(h.model, 60000)
  assert.equal(ended, 1)
  assert.equal(h.writes.length, 0)
  h.runtime.stopModelPerformance(h.model)
  assert.equal(ended, 1)
})
test('legacy comparison owns no new parameter writes and model replacement releases its owner', t => {
  const h = setup(t)
  let ended = 0
  h.runtime.startModelPerformance(h.model, 'legacy', () => { ended++ }, 0)
  h.runtime.applyModelPerformance(h.model, 500)
  assert.equal(h.writes.length, 0)
  assert.equal(h.runtime.performanceOwnsParameter(h.model, 'ParamAngleX'), false)
  h.runtime.prepareModelPerformance(h.model, h.assets)
  assert.equal(ended, 1)
  assert.equal(h.runtime.inspectModelPerformance(h.model).preview, null)
})
test('real command executor rejects active workshop, starts trial, and releases it on document cleanup', async t => {
  const h = setup(t)
  const store = { live2dModel: h.model, modelUrl: 'test', modelLoaded: true, presetEditingLocked: true, presetPreviewActive: false,
    beginPresetPreview() { this.presetPreviewActive = true },
  }
  const execute = h.load('renderer/settings-window/pet-executor').createPetSettingsExecutor({ store, getModelKind: () => 'live2d', switchModel: async () => {},
    releaseWorkshop() { store.presetEditingLocked = false; store.presetPreviewActive = false },
  })
  const command = (value, session = 1) => execute({ id: 'test', session, command: value })
  assert.equal((await command({ type: 'preview-head', mode: 'mixer' })).error, 'workshop-busy')
  store.presetEditingLocked = false
  assert.equal((await command({ type: 'preview-head', mode: 'mixer' })).ok, true)
  assert.equal(store.presetEditingLocked, true)
  assert.equal(store.presetPreviewActive, true)
  assert.equal((await command({ type: 'inspect-performance' })).data.preview, 'mixer')
  await command({ type: 'release-workshop' })
  assert.equal(store.presetEditingLocked, false)
  assert.equal(h.runtime.inspectModelPerformance(h.model).preview, null)
  assert.equal((await command({ type: 'preview-head', mode: 'mixer' })).error, 'session-closed')
})
test('invalid Core write releases preview rather than breaking future SDK frames', t => {
  const h = setup(t)
  let ended = 0
  h.runtime.startModelPerformance(h.model, 'mixer', () => { ended++ }, 0)
  h.core.setParameterValueById = () => { throw Error('disposed') }
  assert.doesNotThrow(() => h.runtime.applyModelPerformance(h.model, 500))
  assert.equal(ended, 1)
})
test('legacy command starts its preset before acquiring the workshop lock', async t => {
  const h = setup(t)
  let played = 0
  const store = { live2dModel: h.model, modelUrl: 'test', modelLoaded: true, presetEditingLocked: false,
    modelCapabilities: { parameters: [{ id: 'ParamAngleX', min: -30, max: 30, default: 0 }] },
    beginPresetPreview() {}, triggerPreset(preset) { assert.equal(this.presetEditingLocked, false); assert.equal(preset.steps.length, 3); played++; return true },
  }
  const execute = h.load('renderer/settings-window/pet-executor').createPetSettingsExecutor({ store, getModelKind: () => 'live2d', switchModel: async () => {}, releaseWorkshop() { store.presetEditingLocked = false } })
  assert.equal((await execute({ id: 'legacy', session: 1, command: { type: 'preview-head', mode: 'legacy' } })).ok, true)
  assert.equal(played, 1)
  assert.equal(store.presetEditingLocked, true)
})
test('production loader suspends old head stack only during trial, preserving clothes and SDK native head', t => {
  const h = setup(t)
  const loader = h.load('renderer/services/live2d/loader')
  loader.setControlParameters(h.model, { ParamAngleX: 12, ParamHat: 1 })
  h.runtime.startModelPerformance(h.model, 'mixer', () => {}, 0)
  h.now(500); h.values.ParamAngleX = 3; h.writes.length = 0
  h.model.internalModel.updateNaturalMovements(16, 500)
  h.events.get('beforeModelUpdate')()
  assert.ok(h.values.ParamAngleX < 9, 'old +12 head offset must not also be applied')
  assert.equal(h.values.ParamHat, 1)
  assert.equal(h.writes.filter(([id]) => id === 'ParamAngleX').length, 1)
  h.runtime.stopModelPerformance(h.model)
  h.values.ParamAngleX = 3; h.now(600)
  h.model.internalModel.updateNaturalMovements(16, 600)
  assert.equal(h.values.ParamAngleX, 15, 'original additive head stack resumes')
})

function traceFixture(t) {
  const h = setup(t)
  let reads = 0
  h.core.getParameterValueById = id => { reads++; return h.values[id] }
  const native = h.model.internalModel
  native.motionManager = { update() { h.values.ParamAngleX = 3; return true }, expressionManager: { update() {} } }
  native.eyeBlink = { updateParameters() {} }
  native.updateFocus = function () { assert.equal(this, native); return 'focus-result' }
  native.physics = { evaluate() { h.values.ParamAngleX = 17 } }
  native.pose = { updateParameters() {} }
  h.core.saveParameters = () => {}
  h.core.loadParameters = () => { h.values.ParamAngleX = 3 }
  native.update = function (dt, now) {
    assert.equal(this, native)
    const moved = this.motionManager.update(h.core, now)
    h.core.saveParameters()
    this.motionManager.expressionManager.update(h.core, now)
    if (!moved) this.eyeBlink.updateParameters(h.core, dt)
    this.updateFocus()
    this.updateNaturalMovements(dt, now)
    this.physics.evaluate(h.core, dt)
    this.pose.updateParameters(h.core, dt)
    h.core.update()
    h.core.loadParameters()
    return dt
  }
  return { ...h, trace: h.load('renderer/services/performance/sdk-trace'), native, reads: () => reads }
}

function eyeFixture(t) {
  const h = setup(t), p = h.core._model.parameters
  p.ids.push('ParamEyeLOpen', 'ParamEyeROpen'); p.count += 2
  p.minimumValues.push(0, 0); p.maximumValues.push(1.5, 1.2); p.defaultValues.push(1, 1)
  h.values.ParamEyeLOpen = 1; h.values.ParamEyeROpen = 1
  h.runtime.prepareModelPerformance(h.model, h.assets)
  return h
}

function mouthFixture(t) {
  const h = setup(t), p = h.core._model.parameters
  p.ids.push('ParamMouthOpenY'); p.count++
  p.minimumValues.push(0); p.maximumValues.push(1); p.defaultValues.push(0)
  h.values.ParamMouthOpenY = 0
  h.runtime.prepareModelPerformance(h.model, h.assets)
  return h
}

test('mouth preview opens without speech and maps DS asymmetric mouth shape through its true neutral', t => {
  const h = mouthFixture(t), saved = [...h.core._savedParameters]
  assert.equal(h.runtime.inspectModelPerformance(h.model).mouthPreviewAvailable, true)
  assert.equal(h.runtime.startMouthPerformance(h.model, () => {}, 0), true)
  h.runtime.applyMouthPerformance(h.model, 1000)
  assert.ok(Math.abs(h.values.ParamMouthForm - 0.175) < 1e-8, '-0.5 + 0.45 * (1 - -0.5), not a symmetric raw value')
  assert.ok(Math.abs(h.values.ParamMouthOpenY - 0.45) < 1e-8)
  assert.deepEqual([...new Set(h.writes.map(([id]) => id))], ['ParamMouthForm','ParamMouthOpenY'])
  assert.equal(h.values.ParamAngleX, 3); assert.equal(h.values.ParamHat, 1)
  assert.deepEqual(h.core._savedParameters, saved)
  h.values.ParamMouthForm = -0.5; h.values.ParamMouthOpenY = 0.1
  h.runtime.applyMouthPerformance(h.model, 3800)
  assert.equal(h.values.ParamMouthForm, -0.5)
  assert.ok(Math.abs(h.values.ParamMouthOpenY - 0.1) < 1e-8)
})

test('production lip sync owns opening during sound, silent syllables and closing tail while mouth shape remains independent', t => {
  const h = mouthFixture(t), loader = h.load('renderer/services/live2d/loader')
  loader.setControlParameters(h.model, { ParamMouthForm: -1.3, ParamMouthOpenY: 0.8, ParamHat: 1 })
  h.runtime.startMouthPerformance(h.model, () => {}, 0)
  h.now(1000)
  for (const [value,active] of [[0.65,true],[0,true],[0.04,false]]) {
    loader.setModelLipSync(h.model, 'ParamMouthOpenY', value, active)
    assert.equal(h.runtime.inspectModelPerformance(h.model).speechActive, true)
    assert.equal(h.runtime.performanceOwnsParameter(h.model, 'ParamMouthOpenY'), false)
    assert.equal(h.runtime.performanceOwnsParameter(h.model, 'ParamMouthForm'), true)
    h.values.ParamMouthForm = -0.5; h.values.ParamMouthOpenY = 0.9
    h.model.internalModel.updateNaturalMovements(16, 1000)
    h.values.ParamMouthOpenY = 0.9 // physics may attempt to overwrite before the final hook
    h.events.get('beforeModelUpdate')()
    assert.equal(h.values.ParamMouthOpenY, value)
    assert.ok(Math.abs(h.values.ParamMouthForm - 0.175) < 1e-8)
    assert.deepEqual(JSON.parse(JSON.stringify(h.runtime.inspectModelPerformance(h.model).mouthSamples)).map(s=>s.parameterId), ['ParamMouthForm'])
  }
  loader.setModelLipSync(h.model, 'ParamMouthOpenY', 0, false)
  assert.equal(h.runtime.inspectModelPerformance(h.model).speechActive, false)
  h.values.ParamMouthForm = -0.5; h.values.ParamMouthOpenY = 0
  h.events.get('beforeModelUpdate')()
  assert.ok(Math.abs(h.values.ParamMouthOpenY - 0.45) < 1e-8)
})

test('stopping a mouth trial preserves live speech; a subsequent trial begun during speech also yields opening', t => {
  const h = mouthFixture(t), loader = h.load('renderer/services/live2d/loader')
  loader.setModelLipSync(h.model, 'ParamMouthOpenY', 0.3, true)
  h.runtime.startMouthPerformance(h.model, () => {}, 0)
  h.runtime.applyMouthPerformance(h.model, 1000)
  assert.equal(h.values.ParamMouthOpenY, 0.3)
  h.runtime.stopModelPerformance(h.model)
  assert.equal(h.runtime.inspectModelPerformance(h.model).speechActive, true)
  h.runtime.prepareModelPerformance(h.model, h.assets)
  assert.equal(h.runtime.inspectModelPerformance(h.model).speechActive, true)
  h.runtime.startMouthPerformance(h.model, () => {}, 0)
  h.writes.length = 0; h.runtime.applyMouthPerformance(h.model, 1000)
  assert.deepEqual(h.writes.map(([id])=>id), ['ParamMouthForm'])
  h.runtime.stopModelPerformance(h.model)
  loader.setModelLipSync(h.model, 'ParamMouthOpenY', 0, false)
  assert.equal(h.runtime.inspectModelPerformance(h.model).speechActive, false)
})

test('old mouth layers are suspended only for owned channels and resume after trial release', t => {
  const h = mouthFixture(t), loader = h.load('renderer/services/live2d/loader')
  loader.setControlParameters(h.model, { ParamMouthForm: -1, ParamMouthOpenY: 0.2 })
  h.runtime.startMouthPerformance(h.model, () => {}, 0)
  h.now(1000); h.values.ParamMouthForm=-0.5; h.values.ParamMouthOpenY=0
  h.model.internalModel.updateNaturalMovements(16, 1000)
  assert.equal(h.values.ParamMouthForm,-0.5); assert.equal(h.values.ParamMouthOpenY,0)
  h.events.get('beforeModelUpdate')()
  assert.ok(h.values.ParamMouthForm>-0.5); assert.ok(h.values.ParamMouthOpenY>0)
  h.runtime.stopModelPerformance(h.model)
  h.now(1100); h.values.ParamMouthForm=-0.5; h.values.ParamMouthOpenY=0
  h.model.internalModel.updateNaturalMovements(16, 1100)
  assert.equal(h.values.ParamMouthForm,-1); assert.equal(h.values.ParamMouthOpenY,0.2)
})

test('mouth preview rejects missing, physics-driven or uncertain ranges and cancels on invalid Core values', t => {
  const h = mouthFixture(t)
  const physics = { PhysicsSettings: [{ Output: [{ Destination: { Target: 'Parameter', Id: 'ParamMouthForm' } }] }] }
  h.runtime.prepareModelPerformance(h.model, { ...h.assets, metadata: { ...h.assets.metadata, physics } })
  assert.equal(h.runtime.startMouthPerformance(h.model,()=>{},0),false)
  h.core._model.parameters.defaultValues[3]=0.2
  h.runtime.prepareModelPerformance(h.model,h.assets)
  assert.equal(h.runtime.startMouthPerformance(h.model,()=>{},0),false)
  h.core._model.parameters.defaultValues[3]=0
  h.core._model.parameters.defaultValues[1]=-2
  h.runtime.prepareModelPerformance(h.model,h.assets)
  assert.equal(h.runtime.startMouthPerformance(h.model,()=>{},0),false)
  h.core._model.parameters.defaultValues[1]=1
  h.runtime.prepareModelPerformance(h.model,h.assets)
  assert.equal(h.runtime.startMouthPerformance(h.model,()=>{},0),false)
  h.core._model.parameters.defaultValues[1]=-0.5
  h.core._model.parameters.ids[3]='MissingMouth'
  h.runtime.prepareModelPerformance(h.model,h.assets)
  assert.equal(h.runtime.startMouthPerformance(h.model,()=>{},0),false)
  h.core._model.parameters.ids[3]='ParamMouthOpenY'
  h.runtime.prepareModelPerformance(h.model,h.assets)
  let released=0;h.runtime.startMouthPerformance(h.model,()=>{released++},0)
  h.values.ParamMouthOpenY=NaN
  assert.doesNotThrow(()=>h.runtime.applyMouthPerformance(h.model,1000))
  assert.equal(released,1);assert.equal(h.writes.length,0)
})

test('mouth preview long-gap expiry releases once and a stale tick cannot restart it', t => {
  const h=mouthFixture(t);let released=0
  h.runtime.startMouthPerformance(h.model,()=>{released++},0)
  h.runtime.applyMouthPerformance(h.model,60000)
  h.runtime.applyMouthPerformance(h.model,1000)
  assert.equal(released,1);assert.equal(h.writes.length,0)
  assert.equal(h.runtime.inspectModelPerformance(h.model).previewKind,null)
})

test('actual mouth command preserves model/session binding and workshop exclusivity', async t => {
  const h=mouthFixture(t),store={live2dModel:h.model,modelUrl:'mouth-model',modelLoaded:true,presetEditingLocked:false,presetPreviewActive:false,
    beginPresetPreview(){this.presetPreviewActive=true}}
  const execute=h.load('renderer/settings-window/pet-executor').createPetSettingsExecutor({store,getModelKind:()=> 'live2d',switchModel:async()=>{},
    releaseWorkshop(){store.presetEditingLocked=false;store.presetPreviewActive=false}})
  const send=(command,model)=>execute({id:'mouth-test',session:1,command,model})
  assert.equal((await send({type:'preview-mouth'},{modelUrl:'old-model',modelGeneration:0})).error,'model-changed')
  assert.equal((await send({type:'preview-mouth'})).ok,true)
  assert.equal(store.presetEditingLocked,true)
  assert.equal((await send({type:'preview-eyes'})).error,'workshop-busy')
  await send({type:'release-workshop'})
  assert.equal(store.presetPreviewActive,false)
  assert.equal((await send({type:'preview-mouth'})).error,'session-closed')
})

test('eye post-physics multiplication retains native wide/open/closed values and never writes other neutral channels', t => {
  const h = eyeFixture(t), saved = [...h.core._savedParameters]
  assert.equal(h.runtime.inspectModelPerformance(h.model).eyePreviewAvailable, true)
  assert.equal(h.runtime.startEyePerformance(h.model, () => {}, 0), true)
  h.values.ParamEyeLOpen = 1.4; h.values.ParamEyeROpen = 0
  h.writes.length = 0
  h.runtime.applyEyePerformance(h.model, 0)
  assert.ok(Math.abs(h.values.ParamEyeLOpen - 1.4) < 1e-8)
  assert.equal(h.values.ParamEyeROpen, 0, 'a native closed eye must never be forced open')
  h.values.ParamEyeLOpen = 1.4; h.values.ParamEyeROpen = 0.8
  h.runtime.applyEyePerformance(h.model, 1000)
  assert.equal(h.values.ParamEyeLOpen, 0); assert.equal(h.values.ParamEyeROpen, 0)
  h.values.ParamEyeLOpen = 1.4; h.values.ParamEyeROpen = 0.8
  h.runtime.applyEyePerformance(h.model, 3000)
  assert.ok(Math.abs(h.values.ParamEyeLOpen - 0.7) < 1e-8)
  assert.ok(Math.abs(h.values.ParamEyeROpen - 0.4) < 1e-8)
  assert.deepEqual([...new Set(h.writes.map(([id]) => id))], ['ParamEyeLOpen','ParamEyeROpen'])
  assert.deepEqual(h.core._savedParameters, saved)
  assert.equal(h.values.ParamHat, 1); assert.equal(h.values.ParamAngleX, 3)
})

test('production loader holds eye closure after native blink/physics reopening and resumes the old eye stack on release', t => {
  const h = eyeFixture(t), loader = h.load('renderer/services/live2d/loader')
  loader.setControlParameters(h.model, { ParamEyeLOpen: 0.4, ParamEyeROpen: 0.5, ParamHat: 1 })
  h.runtime.startEyePerformance(h.model, () => {}, 0)
  assert.equal(h.runtime.performanceOwnsParameter(h.model, 'ParamEyeLOpen'), true)
  assert.equal(h.runtime.performanceOwnsParameter(h.model, 'ParamAngleX'), false)
  h.now(1000); h.values.ParamEyeLOpen = 1; h.values.ParamEyeROpen = 1
  h.model.internalModel.updateNaturalMovements(16, 1000)
  assert.equal(h.values.ParamEyeLOpen, 1, 'old eye stack must not run during trial')
  // A native blink/physics writer reopens after natural movements, before the existing final hook.
  h.values.ParamEyeLOpen = 1.2; h.values.ParamEyeROpen = 1.1
  h.events.get('beforeModelUpdate')()
  assert.equal(h.values.ParamEyeLOpen, 0); assert.equal(h.values.ParamEyeROpen, 0)
  h.runtime.stopModelPerformance(h.model)
  assert.equal(h.runtime.performanceOwnsParameter(h.model, 'ParamEyeLOpen'), false)
  h.now(1100); h.values.ParamEyeLOpen = 1; h.values.ParamEyeROpen = 1
  h.model.internalModel.updateNaturalMovements(16, 1100)
  assert.equal(h.values.ParamEyeLOpen, 0.4); assert.equal(h.values.ParamEyeROpen, 0.5)
})

test('eye preview fails closed with a missing eye, physics output or a non-opening default', t => {
  const h = eyeFixture(t)
  h.runtime.prepareModelPerformance(h.model, { ...h.assets, metadata: { ...h.assets.metadata,
    physics: { PhysicsSettings: [{ Output: [{ Destination: { Target: 'Parameter', Id: 'ParamEyeROpen' } }] }] } } })
  assert.equal(h.runtime.inspectModelPerformance(h.model).eyePreviewAvailable, false)
  assert.equal(h.runtime.startEyePerformance(h.model, () => {}), false)
  h.core._model.parameters.ids[4] = 'UnknownEye'
  h.runtime.prepareModelPerformance(h.model, h.assets)
  assert.equal(h.runtime.startEyePerformance(h.model, () => {}), false)
  h.core._model.parameters.ids[4] = 'ParamEyeROpen'; h.core._model.parameters.defaultValues[4] = 0
  h.runtime.prepareModelPerformance(h.model, h.assets)
  assert.equal(h.runtime.startEyePerformance(h.model, () => {}), false)
  assert.equal(h.writes.length, 0)
})

test('eye preview releases on a long frame gap or invalid native value and never restarts after release', t => {
  const h = eyeFixture(t); let releases = 0
  h.runtime.startEyePerformance(h.model, () => { releases++ }, 0)
  h.runtime.applyEyePerformance(h.model, 60000)
  assert.equal(releases, 1); assert.equal(h.writes.length, 0)
  h.runtime.startEyePerformance(h.model, () => { releases++ }, 0)
  h.values.ParamEyeLOpen = NaN
  assert.doesNotThrow(() => h.runtime.applyEyePerformance(h.model, 1000))
  assert.equal(releases, 2); assert.equal(h.writes.length, 0)
  h.values.ParamEyeLOpen = 1; h.runtime.applyEyePerformance(h.model, 1200)
  assert.equal(h.writes.length, 0)
})

test('real eye command uses workshop ownership and refuses late commands from a released session', async t => {
  const h = eyeFixture(t), store = { live2dModel: h.model, modelUrl: 'eye-model', modelLoaded: true,
    presetEditingLocked: false, presetPreviewActive: false, beginPresetPreview() { this.presetPreviewActive = true } }
  const execute = h.load('renderer/settings-window/pet-executor').createPetSettingsExecutor({ store, getModelKind: () => 'live2d', switchModel: async () => {},
    releaseWorkshop() { store.presetEditingLocked = false; store.presetPreviewActive = false } })
  const send = command => execute({ id: 'eye-test', session: 1, command })
  assert.equal((await send({ type: 'preview-eyes' })).ok, true)
  assert.equal(store.presetEditingLocked, true)
  assert.equal(h.runtime.inspectModelPerformance(h.model).previewKind, 'eyes')
  assert.equal((await send({ type: 'preview-head', mode: 'mixer' })).error, 'workshop-busy')
  await send({ type: 'release-workshop' })
  assert.equal(store.presetEditingLocked, false); assert.equal(store.presetPreviewActive, false)
  assert.equal((await send({ type: 'preview-eyes' })).error, 'session-closed')
})

test('trace reports actual phase order and the physics result separately from the mixer write', t => {
  const h = traceFixture(t)
  const loader = h.load('renderer/services/live2d/loader')
  loader.setControlParameters(h.model, { ParamHat: 1 })
  h.runtime.startModelPerformance(h.model, 'mixer', () => {}, 0)
  h.now(500); h.native.update(16, 500)
  const view = h.runtime.inspectModelPerformance(h.model)
  assert.ok(view.sample.applied < 9)
  assert.equal(view.sample.rendered, 17)
  const trace = JSON.parse(JSON.stringify(view.trace))
  assert.deepEqual(trace.latestFrame.map(s => s.stage), ['before-motion','after-motion','saved-motion','after-expression',
    'after-focus','after-natural-and-uta','after-physics','after-pose','before-core-update','after-core-update','restored-motion'])
  assert.equal(trace.latestFrame.find(s => s.stage === 'before-core-update').value, 17)
  assert.equal(trace.latestFrame.at(-1).value, 3)
  assert.equal(trace.observedStages.includes('after-blink'), false, 'a skipped blink must not appear as executed')
})

test('stopped trace reads no Core parameters, retains a bounded final frame, and resets for the next trial/model', t => {
  const h = traceFixture(t)
  h.trace.startModelTrace(h.model, 'ParamAngleX', 'legacy', () => {})
  for (let i = 0; i < 10000; i++) h.native.update(16, i)
  const trace = h.trace.inspectModelTrace(h.model)
  assert.equal(trace.frames, 10000)
  assert.ok(trace.latestFrame.length <= 16)
  assert.ok(trace.observedStages.length <= 12)
  trace.latestFrame[0].value = 999
  assert.notEqual(h.trace.inspectModelTrace(h.model).latestFrame[0].value, 999, 'readers receive detached snapshots')
  h.trace.stopModelTrace(h.model)
  const before = h.reads()
  for (let i = 0; i < 100; i++) h.native.update(16, i)
  assert.equal(h.reads(), before)
  assert.equal(h.trace.inspectModelTrace(h.model).frames, 10000)
  h.trace.startModelTrace(h.model, 'ParamAngleX', 'mixer', () => {})
  h.native.update(16, 0)
  assert.equal(h.trace.inspectModelTrace(h.model).frames, 1)
  h.runtime.prepareModelPerformance(h.model, h.assets)
  assert.equal(h.trace.inspectModelTrace(h.model), null)
})

test('trace preserves SDK this, arguments, return values and native exceptions without inventing missing stages', t => {
  const h = traceFixture(t)
  delete h.native.physics
  h.native.update = function (dt, now) {
    assert.equal(this, h.native); assert.equal(dt, 16); assert.equal(now, 42)
    return this.updateFocus()
  }
  h.trace.startModelTrace(h.model, 'ParamAngleX', 'legacy', () => {})
  assert.equal(h.native.update(16, 42), 'focus-result')
  assert.deepEqual(JSON.parse(JSON.stringify(h.trace.inspectModelTrace(h.model).observedStages)), ['after-focus'])
  h.core.getParameterValueById = () => { throw Error('diagnostic read failed') }
  assert.equal(h.native.update(16, 42), 'focus-result')
  const other = traceFixture(t), originalError = Error('native failure')
  other.native.update = () => { throw originalError }
  other.trace.startModelTrace(other.model, 'ParamAngleX', 'legacy', () => {})
  assert.throws(() => other.native.update(16, 42), error => error === originalError)
  assert.equal(other.trace.inspectModelTrace(other.model).frames, 0)
})

function assetFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-performance-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (name, value) => fs.writeFileSync(path.join(root, name), typeof value === 'string' ? value : JSON.stringify(value))
  write('model.moc3', 'moc'); write('texture.png', 'texture'); write('physics.json', { PhysicsSettings: [] })
  const manifest = { FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'], Physics: 'physics.json' } }
  write('model.model3.json', manifest)
  const read = createLoader()('main/model-performance-assets').readModelPerformanceAssets
  return { root, write, manifest, read: () => read(path.join(root, 'model.model3.json')) }
}
test('content identity includes declared bytes, ignores personal sidecars and detects changes', t => {
  const h = assetFixture(t)
  const first = h.read()
  assert.ok(first.modelSignature.startsWith('uta-live2d-assets-v1:'))
  h.write('deskpet-presets.json', { private: true })
  assert.equal(h.read().modelSignature, first.modelSignature)
  h.write('texture.png', 'changed')
  assert.notEqual(h.read().modelSignature, first.modelSignature)
  h.write('physics.json', '{broken')
  assert.equal(h.read(), null)
})
test('declared resource traversal, missing files, and oversized JSON fail closed', t => {
  const h = assetFixture(t)
  h.manifest.FileReferences.Moc = '../outside.moc3'
  h.write('model.model3.json', h.manifest)
  assert.equal(h.read(), null)
  h.manifest.FileReferences.Moc = 'missing.moc3'
  h.write('model.model3.json', h.manifest)
  assert.equal(h.read(), null)
  h.manifest.FileReferences.Moc = 'model.moc3'
  h.write('model.model3.json', h.manifest)
  h.write('physics.json', ' '.repeat(8 * 1024 * 1024 + 1))
  assert.equal(h.read(), null)
})
