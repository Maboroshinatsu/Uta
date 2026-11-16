'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const createLoader = require('./support/settings-loader.cjs')
const plainLoad = createLoader()
const { selectAmbientPerformanceState } = plainLoad('renderer/services/performance/ambient-state')

function setup(t) {
  let now = 0
  const load = createLoader({
    '@pixi/app': { Application: class {} }, '@pixi/extensions': { extensions: { add() {} } },
    '@pixi/ticker': { Ticker: class {}, TickerPlugin: {} },
    'pixi-live2d-display/cubism4': { Live2DModel: { registerTicker() {} }, MotionPriority: {} },
  }, { performance: { now: () => now }, window: {} })
  const runtime = load('renderer/services/performance/model-runtime')
  const values = {
    ParamAngleX: 0, ParamAngleY: 0, ParamAngleZ: 0, ParamEyeLOpen: 1, ParamEyeROpen: 1,
    ParamEyeBallX: 0, ParamEyeBallY: 0, ParamBrowLY: 0, ParamBrowRY: 0,
    ParamMouthForm: -0.5, ParamMouthOpenY: 0, ParamHat: 1,
  }
  const ids = Object.keys(values)
  const parameters = {
    count: ids.length, ids,
    minimumValues: [-30, -30, -30, 0, 0, -1, -1, -1, -1, -2, 0, 0],
    maximumValues: [30, 30, 30, 1.5, 1.2, 1, 1, 1, 1, 1, 1, 1],
    defaultValues: [0, 0, 0, 1, 1, 0, 0, 0, 0, -0.5, 0, 0],
  }
  const events = new Map(), writes = []
  const core = {
    _model: { parameters }, _savedParameters: [0, 0, 0, 1, 1, 0, 0, 0, 0, -0.5, 0, 1],
    getParameterValueById: id => values[id],
    getParameterDefaultValueById: id => parameters.defaultValues[ids.indexOf(id)],
    setParameterValueById: (id, value) => { values[id] = value; writes.push([id, value]) }, update() {},
  }
  const model = { internalModel: { coreModel: core, on: (name, fn) => events.set(name, fn), updateNaturalMovements() {} }, destroy() {} }
  const assets = { modelSignature: 'ambient-test-signature', metadata: { cdi: null, physics: null, expressions: [], motions: [] } }
  runtime.prepareModelPerformance(model, assets)
  t.after(() => runtime.stopModelPerformance(model))
  return { runtime, model, values, writes, core, events, assets, load, now: value => { now = value } }
}

function baseline(h) {
  for (const id of Object.keys(h.values)) {
    if (id === 'ParamHat') continue
    if (id === 'ParamEyeLOpen' || id === 'ParamEyeROpen') h.values[id] = 1
    else if (id === 'ParamMouthForm') h.values[id] = -0.5
    else h.values[id] = 0
  }
}

function frame(h, now) {
  baseline(h)
  h.runtime.applyAmbientHead(h.model, now)
  h.runtime.applyAmbientPost(h.model, now)
}

test('stage state selection follows real host states and every pause gate', () => {
  const base = {
    idleActionsEnabled: true, focusActive: false, reducedMotion: false, documentVisible: true, modelLoaded: true, hasModel: true,
    presetEditingLocked: false, presetPreviewActive: false, holdPresetPinned: false, approvalPending: false,
    ttsSpeaking: false, isSpeaking: false, agentWorkingState: 'idle',
  }
  assert.equal(selectAmbientPerformanceState(base), 'idle')
  assert.equal(selectAmbientPerformanceState({ ...base, focusActive: true }), null)
  assert.equal(selectAmbientPerformanceState({ ...base, focusActive: true, approvalPending: true }), 'waiting')
  assert.equal(selectAmbientPerformanceState({ ...base, focusActive: true, agentWorkingState: 'thinking' }), 'thinking')
  assert.equal(selectAmbientPerformanceState({ ...base, agentWorkingState: 'thinking' }), 'thinking')
  assert.equal(selectAmbientPerformanceState({ ...base, agentWorkingState: 'tool_running' }), 'working')
  assert.equal(selectAmbientPerformanceState({ ...base, agentWorkingState: 'streaming' }), 'speaking')
  assert.equal(selectAmbientPerformanceState({ ...base, ttsSpeaking: true }), 'speaking')
  assert.equal(selectAmbientPerformanceState({ ...base, isSpeaking: true }), 'speaking')
  assert.equal(selectAmbientPerformanceState({ ...base, approvalPending: true, ttsSpeaking: true }), 'waiting')
  assert.equal(selectAmbientPerformanceState({ ...base, agentWorkingState: 'error' }), 'error')
  assert.equal(selectAmbientPerformanceState({ ...base, agentWorkingState: 'completed' }), 'completed')
  for (const [state, expected] of [['thinking', 'thinking'], ['tool_running', 'working'], ['streaming', 'speaking']]) {
    assert.equal(selectAmbientPerformanceState({ ...base, idleActionsEnabled: false, agentWorkingState: state }), expected)
  }
  assert.equal(selectAmbientPerformanceState({ ...base, idleActionsEnabled: false, approvalPending: true }), 'waiting')
  for (const gate of ['idleActionsEnabled', 'documentVisible', 'modelLoaded', 'hasModel']) {
    assert.equal(selectAmbientPerformanceState({ ...base, [gate]: false }), null, `${gate} must pause ambient`)
  }
  assert.equal(selectAmbientPerformanceState({ ...base, reducedMotion: true }), null)
  assert.equal(selectAmbientPerformanceState({ ...base, presetEditingLocked: true }), null)
  assert.equal(selectAmbientPerformanceState({ ...base, presetPreviewActive: true }), null)
  assert.equal(selectAmbientPerformanceState({ ...base, holdPresetPinned: true }), null)
})

test('idle micro-motion stays small, never fakes a blink, and never drives physics ears', t => {
  const h = setup(t)
  h.runtime.setAmbientPerformance(h.model, 'idle', 0)
  let minEye = 1, minHead = 0, maxHead = 0, mouthMax = -1
  let headDeltas = 0, lastHead = null
  for (let now = 0; now <= 13000; now += 16) {
    frame(h, now)
    minEye = Math.min(minEye, h.values.ParamEyeLOpen)
    minHead = Math.min(minHead, h.values.ParamAngleX)
    maxHead = Math.max(maxHead, h.values.ParamAngleX)
    mouthMax = Math.max(mouthMax, h.values.ParamMouthForm)
    if (lastHead !== null) headDeltas = Math.max(headDeltas, Math.abs(h.values.ParamAngleX - lastHead))
    lastHead = h.values.ParamAngleX
  }
  const written = new Set(h.writes.map(([id]) => id))
  assert.equal(written.has('ParamEyeLOpen'), false, 'native blink keeps exclusive eyelid ownership')
  assert.equal(written.has('ParamEyeROpen'), false)
  assert.equal(minEye, 1, 'ambient never invents a second blink')
  assert.equal(h.writes.some(([id]) => id === 'ParamMouthOpenY'), false, 'ambient never touches speech opening')
  assert.equal(h.writes.some(([id]) => /^Param10[2-9]$/.test(id)), false, 'physics ear outputs are never written')
  assert.ok(maxHead - minHead > 1, 'visible but small head sway')
  assert.ok(maxHead <= 30 && minHead >= -30)
  assert.ok(headDeltas < 1.5, 'per-frame head movement stays smooth')
  assert.ok(mouthMax > -0.4, 'idle keeps a soft mouth shape above the native neutral')
  const view = h.runtime.inspectModelPerformance(h.model)
  assert.equal(view.ambient.state, 'idle')
  assert.equal(view.ambient.demo, null)
  assert.equal(view.ambientAvailable, true)
  assert.match(view.source, /日常表现 · 待机/)
})

test('thinking and working use distinct restrained postures without taking over the mouth opening', t => {
  const h = setup(t)
  h.values.ParamMouthOpenY = 0.65
  h.runtime.setAmbientPerformance(h.model, 'thinking', 0)
  for (let now = 0; now <= 4000; now += 16) {
    h.values.ParamAngleX = 0; h.values.ParamEyeLOpen = 1; h.values.ParamEyeROpen = 1
    h.values.ParamMouthForm = -0.5; h.values.ParamMouthOpenY = 0.65
    h.runtime.applyAmbientHead(h.model, now)
    h.runtime.applyAmbientPost(h.model, now)
  }
  const thinkingEye = h.values.ParamEyeLOpen
  const thinkingMouth = h.values.ParamMouthForm
  const thinkingHead = h.values.ParamAngleX
  assert.ok(thinkingEye < 1, 'thinking narrows the eyes')
  assert.ok(thinkingMouth < -0.5, 'thinking uses a slightly flatter mouth')
  assert.ok(thinkingHead > 0.5, 'thinking holds a small side look')
  assert.equal(h.values.ParamMouthOpenY, 0.65)
  assert.equal(h.writes.some(([id]) => id === 'ParamMouthOpenY'), false)

  h.runtime.setAmbientPerformance(h.model, 'working', 5000)
  for (let now = 5000; now <= 9000; now += 16) {
    h.values.ParamAngleX = 0; h.values.ParamEyeLOpen = 1; h.values.ParamEyeROpen = 1
    h.values.ParamMouthForm = -0.5; h.values.ParamMouthOpenY = 0.65
    h.runtime.applyAmbientHead(h.model, now)
    h.runtime.applyAmbientPost(h.model, now)
  }
  assert.notEqual(h.values.ParamEyeLOpen, thinkingEye)
  assert.ok(h.values.ParamEyeLOpen > thinkingEye, 'working stays more open than thinking')
  assert.ok(h.values.ParamMouthForm > thinkingMouth, 'working uses a less downturned mouth')
  assert.ok(h.values.ParamAngleX < thinkingHead, 'working looks the other way')
  assert.equal(h.values.ParamMouthOpenY, 0.65)
})

test('speech level adds a phrase-start accent and a stronger smile without touching opening', t => {
  const h = setup(t)
  h.runtime.setAmbientPerformance(h.model, 'speaking', 0)
  for (let now = 0; now <= 1200; now += 16) {
    h.values.ParamAngleX = 0; h.values.ParamMouthForm = -0.5; h.values.ParamMouthOpenY = 0.6
    h.runtime.applyAmbientHead(h.model, now); h.runtime.applyAmbientPost(h.model, now)
  }
  h.runtime.setPerformanceSpeechLevel(h.model, 0.8, 1300)
  let maxAccent = 0, maxForm = -1
  for (let now = 1316; now <= 2200; now += 16) {
    h.values.ParamAngleX = 0; h.values.ParamMouthForm = -0.5; h.values.ParamMouthOpenY = 0.6
    h.runtime.applyAmbientHead(h.model, now); h.runtime.applyAmbientPost(h.model, now)
    maxAccent = Math.max(maxAccent, Math.abs(h.runtime.inspectModelPerformance(h.model).ambient.accent ?? 0))
    maxForm = Math.max(maxForm, h.values.ParamMouthForm)
  }
  assert.ok(maxAccent > 0.005, 'a phrase-start head accent is visible in diagnostics')
  assert.ok(maxForm > -0.25, 'louder speech strengthens the reply smile')
  assert.equal(h.values.ParamMouthOpenY, 0.6)
  assert.equal(h.writes.some(([id]) => id === 'ParamMouthOpenY'), false)
  h.runtime.setPerformanceSpeechLevel(h.model, 0, 3000)
  for (let now = 3016; now <= 4600; now += 16) {
    h.values.ParamAngleX = 0; h.values.ParamMouthForm = -0.5; h.values.ParamMouthOpenY = 0.6
    h.runtime.applyAmbientHead(h.model, now); h.runtime.applyAmbientPost(h.model, now)
  }
  const view = h.runtime.inspectModelPerformance(h.model)
  assert.ok(Math.abs(view.ambient.accent ?? 1) < 0.002, 'the accent decays after the phrase')
  assert.ok(h.values.ParamMouthForm < -0.2, 'the smile returns to the base reply shape')
})

test('a mouth form whose default sits at a range edge is never driven by ambient', t => {
  const h = setup(t)
  const p = h.core._model.parameters
  const index = p.ids.indexOf('ParamMouthForm')
  p.defaultValues[index] = 1
  h.values.ParamMouthForm = 1
  h.runtime.prepareModelPerformance(h.model, h.assets)
  h.runtime.setAmbientPerformance(h.model, 'idle', 0)
  for (let now = 0; now <= 2500; now += 16) {
    baseline(h)
    h.values.ParamMouthForm = 1
    h.runtime.applyAmbientHead(h.model, now); h.runtime.applyAmbientPost(h.model, now)
  }
  assert.equal(h.writes.some(([id]) => id === 'ParamMouthForm'), false)
  assert.equal(h.runtime.inspectModelPerformance(h.model).ambient.mouthSample, null)
  assert.equal(h.values.ParamMouthForm, 1, 'a form default at the range edge stays untouched')
})

test('waiting stays nearly still and only narrows the eyes', t => {
  const h = setup(t)
  h.runtime.setAmbientPerformance(h.model, 'waiting', 0)
  for (let now = 0; now <= 2500; now += 16) frame(h, now)
  assert.ok(h.values.ParamEyeLOpen < 1, 'waiting uses a slight attentive narrowing')
  assert.ok(h.values.ParamEyeROpen < 1)
  assert.ok(h.values.ParamAngleX > 0.5, 'waiting holds a small attentive side look')
  assert.ok(Math.abs(h.values.ParamAngleX) < 5, 'waiting remains restrained')
  assert.ok(h.values.ParamMouthForm > -0.5)
  assert.equal(h.runtime.inspectModelPerformance(h.model).ambient.accent ?? 0, 0)
})

test('speaking adds a soft mouth form while real speech keeps exclusive opening ownership', t => {
  const h = setup(t)
  h.runtime.setAmbientPerformance(h.model, 'speaking', 0)
  for (let now = 0; now <= 3000; now += 16) {
    h.values.ParamMouthForm = -0.5
    h.values.ParamMouthOpenY = 0.6
    h.runtime.applyAmbientPost(h.model, now)
  }
  assert.ok(h.values.ParamMouthForm > -0.4, 'reply gets a restrained smile')
  assert.equal(h.values.ParamMouthOpenY, 0.6)
  assert.equal(h.writes.some(([id]) => id === 'ParamMouthOpenY'), false)
})

test('ambient adds on top of a preset base instead of replacing it and does not claim exclusive ownership', t => {
  const h = setup(t)
  h.runtime.setAmbientPerformance(h.model, 'thinking', 0)
  for (let now = 0; now <= 1200; now += 16) {
    h.values.ParamAngleX = 5
    h.runtime.applyAmbientHead(h.model, now)
  }
  assert.ok(h.values.ParamAngleX > 5, 'preset head value is preserved and offset')
  assert.ok(h.values.ParamAngleX < 10)
  assert.equal(h.runtime.performanceOwnsParameter(h.model, 'ParamAngleX'), false)
})

test('null state stops writing immediately; state changes settle instead of jumping', t => {
  const h = setup(t)
  h.runtime.setAmbientPerformance(h.model, 'idle', 0)
  for (let now = 0; now <= 2000; now += 16) frame(h, now)
  const idleHead = h.values.ParamAngleX
  h.runtime.setAmbientPerformance(h.model, 'thinking', 2016)
  frame(h, 2032)
  const firstThinkingHead = h.values.ParamAngleX
  assert.ok(firstThinkingHead - idleHead < 2.5, 'state change is smoothed, not a hard jump')
  h.runtime.setAmbientPerformance(h.model, null, 2200)
  const before = h.writes.length
  frame(h, 2216)
  assert.equal(h.writes.length, before, 'off writes nothing and lets native controls restore')
})

test('short previews suspend ambient and release it back to the real state', t => {
  const h = setup(t)
  h.runtime.setAmbientPerformance(h.model, 'idle', 0)
  for (let now = 0; now <= 560; now += 16) frame(h, now)
  assert.ok(h.writes.length > 0)
  let ended = 0
  assert.equal(h.runtime.startModelPerformance(h.model, 'mixer', () => { ended++ }, 600), true)
  h.writes.length = 0
  h.values.ParamAngleX = 0
  h.runtime.applyAmbientHead(h.model, 1000)
  h.runtime.applyAmbientPost(h.model, 1000)
  assert.equal(h.writes.length, 0, 'ambient yields while the explicit preview owns the model')
  h.runtime.applyModelPerformance(h.model, 1000)
  assert.ok(h.writes.some(([id]) => id === 'ParamAngleX'))
  h.runtime.stopModelPerformance(h.model)
  h.writes.length = 0
  for (let now = 1200; now <= 1500; now += 16) {
    h.values.ParamAngleX = 0
    h.runtime.applyAmbientHead(h.model, now)
  }
  assert.ok(h.writes.some(([id]) => id === 'ParamAngleX'), 'ambient resumes smoothly after the preview')
  assert.equal(ended, 1)
})

test('settings demo overrides the real state, expires once, and reports its source', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = setup(t)
  let releases = 0
  h.runtime.setAmbientPerformance(h.model, 'idle', 0)
  assert.equal(h.runtime.startAmbientDemo(h.model, 'thinking', () => { releases++ }, 100), true)
  let view = h.runtime.inspectModelPerformance(h.model)
  assert.equal(view.ambient.demo, 'thinking')
  assert.equal(view.ambient.state, 'idle')
  assert.match(view.source, /日常演示 · 思考/)
  frame(h, 600)
  assert.ok(view.ambientAvailable)
  t.mock.timers.tick(4000)
  assert.equal(releases, 1)
  view = h.runtime.inspectModelPerformance(h.model)
  assert.equal(view.ambient.demo, null)
  assert.equal(view.ambient.state, 'idle')
  t.mock.timers.tick(4000)
  assert.equal(releases, 1, 'a demo releases exactly once')
})

test('a model without a validated profile fails closed for ambient and demo', t => {
  const h = setup(t)
  h.runtime.prepareModelPerformance(h.model, null)
  h.runtime.setAmbientPerformance(h.model, 'idle', 0)
  frame(h, 500)
  assert.equal(h.writes.length, 0)
  assert.equal(h.runtime.startAmbientDemo(h.model, 'idle', () => {}), false)
  assert.equal(h.runtime.inspectModelPerformance(h.model).ambientAvailable, false)
  assert.equal(h.runtime.inspectModelPerformance(h.model).ambient.state, null)
})

test('preset-owned channels yield instead of double-writing and ease back in', t => {
  const h = setup(t)
  h.runtime.setAmbientPerformance(h.model, 'idle', 0)
  for (let now = 0; now <= 2000; now += 16) frame(h, now)
  h.runtime.setAmbientOwnedParameters(h.model, ['ParamAngleX', 'ParamMouthForm'])
  h.writes.length = 0
  for (let now = 2016; now <= 2500; now += 16) frame(h, now)
  assert.equal(h.writes.some(([id]) => id === 'ParamAngleX'), false, 'a preset-owned head must not be offset')
  assert.equal(h.writes.some(([id]) => id === 'ParamMouthForm'), false, 'a preset-owned mouth shape must not be offset')
  assert.equal(h.runtime.inspectModelPerformance(h.model).ambient.headSample, null)

  h.runtime.setAmbientOwnedParameters(h.model, [])
  h.writes.length = 0
  for (let now = 2516; now <= 3400; now += 16) frame(h, now)
  const headWrites = h.writes.filter(([id]) => id === 'ParamAngleX').map(([, value]) => value)
  assert.ok(headWrites.length > 0, 'ambient resumes after the preset releases the channel')
  assert.ok(Math.max(...headWrites.map(Math.abs)) < 6, 'resume eases in instead of jumping to full amplitude')
})

test('error and completed have distinct restrained poses', t => {
  const h = setup(t)
  h.runtime.setAmbientPerformance(h.model, 'error', 0)
  for (let now = 0; now <= 3000; now += 16) frame(h, now)
  const errorEye = h.values.ParamEyeLOpen
  const errorMouth = h.values.ParamMouthForm
  h.runtime.setAmbientPerformance(h.model, 'completed', 3000)
  for (let now = 3016; now <= 6000; now += 16) frame(h, now)
  assert.ok(h.values.ParamMouthForm > errorMouth, 'completed relaxes into a soft smile')
  assert.ok(h.values.ParamEyeLOpen >= errorEye, 'error squints more than completed')
  assert.ok(h.values.ParamMouthForm < 0.1, 'completed stays inside a restrained range')
})


test('real executor binds ambient demo to the workshop lock and session', async t => {
  const h = setup(t)
  const store = {
    live2dModel: h.model, modelUrl: 'ambient-model', modelLoaded: true,
    presetEditingLocked: false, presetPreviewActive: false,
    beginPresetPreview() { this.presetPreviewActive = true },
  }
  const execute = h.load('renderer/settings-window/pet-executor').createPetSettingsExecutor({
    store, getModelKind: () => 'live2d', switchModel: async () => {},
    releaseWorkshop() { store.presetEditingLocked = false; store.presetPreviewActive = false },
  })
  const send = command => execute({ id: 'ambient-test', session: 1, command })
  assert.equal((await send({ type: 'preview-ambient', state: 'thinking' })).ok, true)
  assert.equal(store.presetEditingLocked, true)
  assert.equal(h.runtime.inspectModelPerformance(h.model).ambient.demo, 'thinking')
  assert.equal((await send({ type: 'preview-ambient', state: 'working' })).error, 'workshop-busy')
  await send({ type: 'release-workshop' })
  assert.equal(store.presetEditingLocked, false)
  assert.equal(h.runtime.inspectModelPerformance(h.model).ambient.demo, null)
  assert.equal((await send({ type: 'preview-ambient', state: 'working' })).error, 'session-closed')
})
