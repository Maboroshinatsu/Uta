'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const Vue = require('vue')
const gate = createLoader()('renderer/services/model-load-gate')

test('switching to an image set waits for the StaticStage mount receipt', async () => {
  const old = { id: 'old', alpha: 1, position: { x: 0, y: 0 } }
  const app = {
    stage: { children: [old] },
    ticker: { deltaMS: 16, add() {}, remove() {}, start() {}, stop() {} },
  }
  const store = Vue.reactive({
    pixiApp: app,
    live2dModel: old,
    modelUrl: 'old.model3.json',
    modelLoaded: true,
    modelZoom: 1,
    modelOffsetX: 0,
    modelOffsetY: 0,
    modelControls: [],
    modelSliders: [],
    modelEmotions: [],
    emotionAdapter: null,
    statePresets: [],
    ensureModelPresetsSeeded() {},
    registerModelSwitcher() {},
    emotionPulse: 0,
  })
  const loader = createLoader(
    {
      vue: { ...Vue, watch: () => () => {} },
      '@/stores/deskpet': { useDeskpetStore: () => store },
      '@/services/live2d/loader': {
        createLive2DModel: async url => ({ id: url, alpha: 1, position: { x: 0, y: 0 } }),
        attachLive2DModel(model, application) { application.stage.children.push(model) },
        describeModel: () => ({ motionGroups: {}, parameters: [], parts: [] }),
        resizeModel() {},
        setBaseParameters() {},
        getMotionGroups: () => [],
        getPerformanceOwnedParameterIds: () => [],
        discardLive2DModel() {},
        unloadLive2DModel(model, application) {
          application.stage.children = application.stage.children.filter(entry => entry !== model)
        },
      },
      '@/services/imageset/loader': { loadImageSet: async () => ({ name: 'static', images: { normal: 'a.png' }, default: 'normal' }) },
      '@/services/live2d/model-discovery': {
        kindOfModelUrl: url => url.endsWith('deskpet-images.json') ? 'image-set' : 'live2d',
        setStoredModelPath() {},
        clearModelCache() {},
      },
      '@/services/live2d/emotion-adapter': {
        loadEmotionAdapter: async () => ({ emotions: {}, idleMotions: [], loaded: false }),
        resolveModelControlsAndBase: () => ({ controls: [], baseParameters: {}, hiddenParts: [] }),
        resolveModelSliders: () => [],
        DESKPET_EMOTIONS: [],
        resolvePresetGroup: () => '日常待机',
      },
      '@/services/live2d/adapter-validator': {},
      './useMotionPriority': { MotionLayer: {} },
      './useIdleScheduler': { pickIdleGroups: () => [] },
      '@/services/performance/model-runtime': {
        prepareModelPerformance() {},
        setPerformanceOwnershipProvider() {},
        stopModelPerformance() {},
      },
      '@/services/model-load-gate': gate,
    },
    { window: { innerWidth: 600, innerHeight: 800, matchMedia: () => ({ matches: true }), utaAPI: {} } },
  )
  const deps = new Proxy({
    getStageContainer: () => ({}),
    getBaseHiddenParts: () => [],
    sendModelControls() {},
  }, { get: (target, key) => target[key] ?? (() => {}) })
  const lifecycle = loader('renderer/composables/useStageModelLifecycle').useStageModelLifecycle(deps)
  const url = 'C:/models/sample/deskpet-images.json'
  let settled = false
  const switching = lifecycle.switchModel(url).then(() => { settled = true })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(store.modelUrl, url)
  assert.equal(settled, false, 'the switch must wait for the static stage to report')

  gate.settleStaticModelLoad(url, true)
  await switching
  assert.equal(settled, true)
  assert.equal(store.modelUrl, url)
})
