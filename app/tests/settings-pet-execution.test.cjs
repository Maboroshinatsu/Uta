'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Vue = require('vue')
const Pinia = require('pinia')
const createLoader = require('./support/settings-loader.cjs')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function tick() { for (let i = 0; i < 10; i++) { await Promise.resolve(); await Vue.nextTick() } }

function setup(t, executorOptions = {}) {
  const storage = new Map(), listeners = new Map()
  const window = { location: { search: '' }, matchMedia: () => ({ matches: false }),
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), utaAPI: {} }
  const load = createLoader({ vue: Vue, pinia: Pinia }, {
    window, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
    document: { documentElement: { setAttribute() {}, style: { setProperty() {}, removeProperty() {} } } },
  })
  const pinia = Pinia.createPinia()
  const store = load('renderer/stores/deskpet').useDeskpetStore(pinia)
  store.modelUrl = 'model-a'
  store.modelLoaded = true
  store.live2dModel = { identity: 'model-a' }
  let calls = 0, releases = 0
  store.registerStepPreviewHandler(() => { calls++; return true })
  store.registerPresetTriggerHandler(() => { calls++; return true })
  store.registerSliderSyncHandler(() => { calls++; return true })
  const execute = load('renderer/settings-window/pet-executor').createPetSettingsExecutor({
    store, getModelKind: () => 'live2d', switchModel: async url => { store.modelUrl = url },
    releaseWorkshop: () => { releases++; store.presetEditingLocked = false; store.endPresetPreview() },
    ...executorOptions,
  })
  let id = 0
  const command = (value, session = 1, model) => execute({ id: String(++id), session, command: value, model })
  t.after(() => { store.$dispose(); pinia._e.stop() })
  return { load, pinia, store, window, listeners, command, calls: () => calls, releases: () => releases }
}
const step = () => ({ durationMs: 240, controls: [], parameters: { ParamAngleX: 10 } })

test('static emotion commands execute in the pet, validate support and reject a stale model binding', async t => {
  const h = setup(t, { getModelKind: () => 'image-set' })
  h.store.live2dModel = null
  h.store.modelEmotions = ['neutral', 'happy']
  const snap = (await h.command({ type: 'snapshot' })).data
  assert.equal((await h.command({ type: 'set-emotion', emotion: 'happy' })).ok, true)
  assert.equal(h.store.currentEmotion, 'happy')
  const pulse = h.store.emotionPulse
  assert.equal((await h.command({ type: 'set-emotion', emotion: 'unsupported' })).ok, false)
  assert.equal(h.store.emotionPulse, pulse)
  h.store.modelUrl = 'changed-static-model'
  assert.equal((await h.command({ type: 'set-emotion', emotion: 'neutral' }, 1,
    { modelUrl: snap.modelUrl, modelGeneration: snap.modelGeneration, petEpoch: 1 })).error, 'model-changed')
  assert.equal(h.store.currentEmotion, 'happy')
})

test('real executor rejects an unloaded model and malformed step before calling model handlers', async t => {
  const h = setup(t)
  h.store.modelLoaded = false
  assert.equal((await h.command({ type: 'preview-step', step: step(), gaze: true })).error, 'model-not-ready')
  h.store.modelLoaded = true
  assert.equal((await h.command({ type: 'preview-step', step: { parameters: { x: NaN }, controls: [] }, gaze: true })).error, 'invalid-step')
  assert.equal(h.calls(), 0)
  assert.equal((await h.command({ type: 'preview-step', step: step(), gaze: true })).ok, true)
  assert.equal(h.calls(), 1)
})

test('real executor mirrors the settings pin into the pet hold slot without a model', async t => {
  const h = setup(t)
  h.store.modelLoaded = false
  h.store.live2dModel = null
  assert.equal((await h.command({ type: 'set-hold-preset', presetId: 'thinking-1' })).ok, true)
  assert.equal(h.store.activeHoldPresetId, 'thinking-1')
  assert.equal((await h.command({ type: 'snapshot' })).data.activeHoldPresetId, 'thinking-1')
  assert.equal((await h.command({ type: 'set-hold-preset', presetId: '' })).ok, true)
  assert.equal(h.store.activeHoldPresetId, '')
})

test('cleanup releases lock and loop-preview flags; late work from that session stays rejected', async t => {
  const h = setup(t)
  await h.command({ type: 'set-edit-lock', locked: true })
  h.store.beginPresetPreview()
  await h.command({ type: 'release-workshop' })
  assert.equal(h.store.presetEditingLocked, false)
  assert.equal(h.store.presetPreviewActive, false)
  assert.equal((await h.command({ type: 'set-edit-lock', locked: true })).error, 'session-closed')
  assert.equal(h.store.presetEditingLocked, false)
})

test('old cleanup cannot unlock a newer editor; cleanup arriving before its commands fences older owners', async t => {
  const h = setup(t)
  await h.command({ type: 'set-edit-lock', locked: true }, 2)
  await h.command({ type: 'release-workshop' }, 1)
  assert.equal(h.store.presetEditingLocked, true)
  await h.command({ type: 'release-workshop' }, 3)
  assert.equal(h.store.presetEditingLocked, false)
  assert.equal((await h.command({ type: 'set-edit-lock', locked: true }, 2)).error, 'session-closed')
})

test('a model change rejects an old snapshot binding without executing its preview', async t => {
  const h = setup(t)
  const snapshot = (await h.command({ type: 'snapshot' })).data
  h.store.live2dModel = { identity: 'replacement' }
  assert.equal((await h.command({ type: 'preview-step', step: step(), gaze: true }, 1,
    { modelUrl: snapshot.modelUrl, modelGeneration: snapshot.modelGeneration, petEpoch: 1 })).error, 'model-changed')
  assert.equal(h.calls(), 0)
})

test('preset preview is marked on the actual pet and a rejected trigger does not leave its preview flag', async t => {
  const h = setup(t)
  const preset = { id: 'preview', label: '预览', preview: true, controls: [], parameters: {} }
  assert.equal((await h.command({ type: 'trigger-preset', preset })).ok, true)
  assert.equal(h.store.presetPreviewActive, true)
  h.store.registerPresetTriggerHandler(() => false)
  assert.equal((await h.command({ type: 'trigger-preset', preset })).error, 'action-rejected')
  assert.equal(h.store.presetPreviewActive, false)
})

test('real settings store remains running until the actual bridge response and preserves failure', async t => {
  const h = setup(t)
  const response = deferred()
  h.store.registerModelCommandHandler(() => response.promise)
  const pending = h.store.requestModelAction({ type: 'preview-step', step: step(), gaze: true })
  assert.equal(h.store.modelActionStatus, 'running')
  response.resolve({ ok: false, error: 'pet-unavailable' }); await pending
  assert.equal(h.store.modelActionStatus, 'error')
  assert.ok(h.store.modelActionMessage.includes('桌宠窗口不可用'))
})

test('settings bridge waits for lock acknowledgement, captures edits at enqueue, and hydrates without a second model', async t => {
  const h = setup(t)
  h.store.live2dModel = null
  const locked = deferred(), reply = deferred(), sent = []
  h.window.utaAPI.runPetSettingsCommand = (command, model) => {
    sent.push({ command, model })
    if (command.type === 'snapshot') return Promise.resolve({ ok: true, data: {
      modelUrl: 'model-a', modelLoaded: true, modelGeneration: 1, petEpoch: 1,
      modelControls: [], modelSliders: [], modelEmotions: [],
    } })
    if (command.type === 'set-edit-lock') return locked.promise
    if (command.type === 'release-workshop') return Promise.resolve({ ok: true })
    return reply.promise
  }
  const dispose = h.load('renderer/settings-window/pet-bridge').connectSettingsWindowToPet(h.pinia)
  t.after(dispose)
  await tick()
  assert.equal(h.store.modelLoaded, true)
  assert.equal(h.store.live2dModel, null)
  const original = step()
  const action = h.store.requestModelAction({ type: 'preview-step', step: original, gaze: true })
  original.parameters.ParamAngleX = 99
  await tick()
  assert.equal(sent.some(entry => entry.command.type === 'preview-step'), false)
  assert.equal(h.store.modelActionStatus, 'running')
  locked.resolve({ ok: true }); await tick()
  const dispatched = sent.find(entry => entry.command.type === 'preview-step')
  assert.equal(dispatched.command.step.parameters.ParamAngleX, 10)
  assert.equal(dispatched.model.modelGeneration, 1)
  reply.resolve({ ok: false, error: 'action-rejected' }); await action
  assert.equal(h.store.modelActionStatus, 'error')
})

test('settings bridge follows a model switch made by the quick panel before the next command', async t => {
  const h = setup(t)
  let snapshot = {
    modelUrl: 'model-a', modelLoaded: true, modelGeneration: 1, petEpoch: 1,
    modelControls: [], modelSliders: [], modelEmotions: [],
  }
  h.window.utaAPI.runPetSettingsCommand = command =>
    command.type === 'snapshot'
      ? Promise.resolve({ ok: true, data: snapshot })
      : Promise.resolve({ ok: true })
  const { MODEL_PATH_KEY } = h.load('renderer/services/live2d/model-discovery')
  const dispose = h.load('renderer/settings-window/pet-bridge').connectSettingsWindowToPet(h.pinia)
  t.after(dispose)
  await tick()
  assert.equal(h.store.modelUrl, 'model-a')

  snapshot = { ...snapshot, modelUrl: 'model-b', modelGeneration: 1, petEpoch: 1 }
  h.listeners.get('storage')({ key: MODEL_PATH_KEY, newValue: 'model-b' })
  await new Promise(resolve => setTimeout(resolve, 200))
  await tick()
  assert.equal(h.store.modelUrl, 'model-b')
})

test('settings bridge updates on pet model notification without a storage event or user action', async t => {
  const h = setup(t)
  let listener
  h.window.utaAPI.settingsWindow = { onModelChanged: callback => {
    listener = callback
    return () => { listener = undefined }
  } }
  let snapshot = {
    modelUrl: 'model-a', modelLoaded: true, modelGeneration: 1, petEpoch: 1,
    modelCapabilities: { parameters: [{ id: 'ParamAngleX' }] }, modelSliders: [{ id: 'ParamAngleX' }],
  }
  h.window.utaAPI.runPetSettingsCommand = async () => ({ ok: true, data: snapshot })
  const dispose = h.load('renderer/settings-window/pet-bridge').connectSettingsWindowToPet(h.pinia)
  t.after(dispose)
  await tick()
  assert.equal(h.store.modelUrl, 'model-a')
  assert.equal(h.store.modelSliders.length, 1)

  snapshot = { ...snapshot, modelUrl: 'model-b', modelGeneration: 2, modelCapabilities: null, modelSliders: [] }
  listener()
  await tick()
  assert.equal(h.store.modelUrl, 'model-b')
  assert.equal(h.store.modelCapabilities, null)
  assert.equal(h.store.modelSliders.length, 0)
  dispose()
  assert.equal(listener, undefined)
})

test('settings bridge refreshes and retries a model-bound command once after a model switch', async t => {
  const h = setup(t)
  let snapshot = {
    modelUrl: 'model-a', modelLoaded: true, modelGeneration: 1, petEpoch: 1,
    modelControls: [], modelSliders: [], modelEmotions: [],
  }
  const sent = []
  let triggerAttempts = 0
  h.window.utaAPI.runPetSettingsCommand = (command, model) => {
    sent.push({ type: command.type, model })
    if (command.type === 'snapshot') return Promise.resolve({ ok: true, data: snapshot })
    if (command.type === 'set-edit-lock') return Promise.resolve({ ok: true })
    if (command.type === 'trigger-preset') {
      triggerAttempts++
      return Promise.resolve(triggerAttempts === 1
        ? { ok: false, error: 'model-changed' }
        : { ok: true })
    }
    return Promise.resolve({ ok: true })
  }
  const dispose = h.load('renderer/settings-window/pet-bridge').connectSettingsWindowToPet(h.pinia)
  t.after(dispose)
  await tick()

  snapshot = { ...snapshot, modelGeneration: 2 }
  const result = await h.store.requestModelAction({
    type: 'trigger-preset',
    preset: { id: 'daily', label: '日常待机', controls: [], parameters: {} },
  })

  assert.equal(result.ok, true)
  assert.equal(h.store.modelActionStatus, 'success')
  assert.equal(triggerAttempts, 2)
  const triggers = sent.filter(entry => entry.type === 'trigger-preset')
  assert.equal(triggers.length, 2)
  assert.equal(triggers[0].model.modelGeneration, 1)
  assert.equal(triggers[1].model.modelGeneration, 2)
})

test('pet executor exposes and switches the active host without requiring a model action', async t => {
  const hostState = { preference: 'standalone', activeHostId: 'fake', state: 'disconnected' }
  const h = setup(t, {
    host: {
      getPreference: () => hostState.preference,
      getActiveHostId: () => hostState.activeHostId,
      getConnectionState: () => hostState.state,
      isKnownPreference: preference => preference === 'standalone' || preference === 'codex',
      switchPreference: preference => {
        hostState.preference = preference
        hostState.activeHostId = preference === 'standalone' ? 'fake' : preference
        hostState.state = 'connecting'
        return true
      },
      reconnect: () => { hostState.state = 'connected'; return true },
    },
  })

  assert.equal((await h.command({ type: 'host-state' })).data.activeHostId, 'fake')
  const switched = await h.command({ type: 'switch-host', preference: 'codex' })
  assert.equal(switched.ok, true)
  assert.equal(switched.data.preference, 'codex')
  assert.equal(switched.data.activeHostId, 'codex')
  assert.equal(hostState.state, 'connecting')
  assert.equal((await h.command({ type: 'switch-host', preference: 'unknown' })).error, 'invalid-command')
  const reconnected = await h.command({ type: 'reconnect-host' })
  assert.equal(reconnected.ok, true)
  assert.equal(reconnected.data.state, 'connected')
})

test('settings bridge pagehide cancels queued sends, removes watchers and does not hydrate a disposed page', async t => {
  const h = setup(t)
  const hydration = deferred(), sent = []
  h.window.utaAPI.runPetSettingsCommand = command => {
    sent.push(command)
    return command.type === 'snapshot' ? hydration.promise : Promise.resolve({ ok: true })
  }
  const dispose = h.load('renderer/settings-window/pet-bridge').connectSettingsWindowToPet(h.pinia)
  const action = h.store.requestModelAction({ type: 'preview-step', step: step(), gaze: true })
  h.listeners.get('pagehide')()
  hydration.resolve({ ok: true, data: { modelUrl: 'late-model', modelLoaded: true, modelGeneration: 1, petEpoch: 1 } })
  await action; await tick()
  assert.equal(h.store.modelUrl, 'model-a')
  assert.equal(sent.some(command => command.type === 'preview-step'), false)
  assert.ok(sent.some(command => command.type === 'release-workshop'))
  assert.equal(h.listeners.has('pagehide'), false)
  dispose()
})

test('leaving workshop releases immediately and invalidates queued previews instead of waiting behind them', async t => {
  const h = setup(t)
  const pending = deferred(), sent = []
  h.window.utaAPI.runPetSettingsCommand = command => {
    sent.push(command)
    if (command.type === 'snapshot') return Promise.resolve({ ok: true, data: {
      modelUrl: 'model-a', modelLoaded: true, modelGeneration: 1, petEpoch: 1,
    } })
    if (command.type === 'preview-step') return pending.promise
    return Promise.resolve({ ok: true })
  }
  const dispose = h.load('renderer/settings-window/pet-bridge').connectSettingsWindowToPet(h.pinia)
  t.after(dispose); await tick()
  const first = h.store.requestModelAction({ type: 'preview-step', step: step(), gaze: true }); await tick()
  const second = h.store.requestModelAction({ type: 'preview-step', step: step(), gaze: true })
  await h.store.releaseModelWorkshop()
  assert.equal(sent.at(-1).type, 'release-workshop')
  assert.equal(h.store.modelActionStatus, 'idle')
  pending.resolve({ ok: false, error: 'session-closed' }); await first; await second
  assert.equal(sent.filter(command => command.type === 'preview-step').length, 1)
  assert.equal(h.store.modelActionStatus, 'idle')
})
