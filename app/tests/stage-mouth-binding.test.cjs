'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function transpile(relativePath) {
  return ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
}

function createHarness(tts = {}) {
  const clock = { now: 1000, nowFn() { return this.now } }
  const performance = { now: () => clock.nowFn() }
  const loadSupport = require('./support/settings-loader.cjs')({}, { performance })
  const modelRuntime = loadSupport('renderer/services/performance/model-runtime')
  const mouthMotion = loadSupport('renderer/services/mouth-motion')
  const window = { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} }
  const loaderModule = { exports: {} }
  const ticker = { shared: { maxFPS: 60 } }
  vm.runInNewContext(transpile('src/renderer/services/live2d/loader.ts'), {
    module: loaderModule,
    exports: loaderModule.exports,
    require: (id) => ({
      '@pixi/app': { Application: function Application() {} },
      '@pixi/extensions': { extensions: { add() {} } },
      '@pixi/ticker': { Ticker: ticker, TickerPlugin: {} },
      'pixi-live2d-display/cubism4': {
        Live2DModel: { registerTicker() {} },
        MotionPriority: { FORCE: 3, NORMAL: 2 },
      },
      '../performance/model-runtime': modelRuntime,
      './focus-mapping': loadSupport('renderer/services/live2d/focus-mapping'),
      './cubism-color': { installCubismDrawableColor() {} },
    })[id],
    window,
    console,
    performance,
    setTimeout,
    clearTimeout,
  })
  const loader = loaderModule.exports

  let nextFrameId = 1
  const frames = new Map()
  const frameHistory = []
  const requestAnimationFrame = (callback) => {
    const id = nextFrameId++
    frames.set(id, callback)
    frameHistory.push(id)
    return id
  }
  const cancelAnimationFrame = (id) => frames.delete(id)

  const store = {
    live2dModel: null,
    modelLoaded: true,
    modelZoom: 1,
    modelOffsetX: 0,
    modelOffsetY: 0,
    gazeFollowEnabled: false,
    hoverFadeEnabled: false,
    isSpeaking: false,
    pendingAnimation: null,
    pendingApprovals: [],
    presetPreviewActive: false,
    emotionAdapter: { lipSync: { mouthOpenParam: 'ParamMouthA', gain: 1 } },
    consumePendingAnimation() { this.pendingAnimation = null; return null },
    setModelOffset() {},
  }
  const chatStore = { messages: [] }
  const requireMap = {
    vue: {
      ref: (value) => ({ value }),
      computed: (get) => ({ get value() { return get() } }),
      watch: () => () => {},
    },
    '@/stores/deskpet': { useDeskpetStore: () => store },
    '@/stores/chat': { useChatStore: () => chatStore },
    '@/services/live2d/loader': loader,
    '@/services/live2d/model-discovery': {},
    '@/services/render-fps': { applyRenderFpsMode: async () => {}, setRenderActivity() {} },
    '@/services/live2d/emotion-adapter': {
      DEFAULT_LIP_SYNC: { mouthOpenParam: 'ParamMouthOpenY', gain: 1 },
      getAnimationTarget: () => null,
    },
    '@/services/mouth-motion': mouthMotion,
    './useMotionPriority': { MotionLayer: { Idle: 1, Reply: 2, Interaction: 3 } },
  }
  const loopModule = { exports: {} }
  vm.runInNewContext(transpile('src/renderer/composables/useStageRenderLoop.ts'), {
    module: loopModule,
    exports: loopModule.exports,
    require: (id) => requireMap[id] ?? {},
    window,
    performance,
    requestAnimationFrame,
    cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    console,
  })
  const loop = loopModule.exports.useStageRenderLoop({
    getModelKind: () => 'live2d',
    getStageShiftX: () => 0,
    getStaticStage: () => null,
    isOverlayOpen: () => false,
    isUiHovered: () => false,
    resetUiHover() {},
    isDragging: () => false,
    consumeDragOffsets: () => null,
    playMotionWithPriority: () => true,
    notifyIdleInteraction() {},
    isTtsSpeaking: tts.isSpeaking ?? (() => false),
    getTtsLevel: tts.getLevel ?? (() => 0),
  })

  function makeModel(defaults = {}) {
    const values = {}
    const writes = []
    let destroyed = false
    const coreModel = {
      setParameterValueById(id, value) {
        if (destroyed) throw new Error(`write to destroyed Core: ${id}`)
        values[id] = value
        writes.push({ id, value })
      },
      getParameterDefaultValueById(id) { return defaults[id] ?? 0 },
    }
    const model = {
      position: { x: 400, y: 300 },
      scale: { x: 1, y: 1 },
      width: 100,
      height: 100,
      focus() {},
      get destroyed() { return destroyed },
      destroy() { destroyed = true },
      get internalModel() {
        if (destroyed) throw new Error('read from destroyed Core')
        return { coreModel }
      },
    }
    return { model, values, writes, destroy: () => model.destroy() }
  }

  function frame(deltaMs = 16) {
    clock.now += deltaMs
    const pending = Array.from(frames.values())
    frames.clear()
    assert.ok(pending.length > 0, 'expected the real render-loop RAF callback to be pending')
    for (const callback of pending) callback(clock.now)
  }

  return {
    clock, store, chatStore, loader, loop, makeModel, frame,
    TextSpeechClock: mouthMotion.TextSpeechClock,
    smoothMouth: mouthMotion.smoothMouth,
  }
}

test('disabling gaze zeros tracking instead of targeting the full-body canvas center', () => {
  const h = createHarness()
  const sample = h.makeModel()
  const original = Object.getOwnPropertyDescriptor(sample.model, 'internalModel').get
  const focuses = []
  Object.defineProperty(sample.model, 'internalModel', {
    get() { return { ...original.call(this), focusController: { focus: (...args) => focuses.push(args) } } },
  })
  h.store.live2dModel = sample.model
  h.store.gazeFollowEnabled = false
  h.loop.startAnimationPoll()
  h.frame(16)
  assert.deepEqual(focuses, [[0, 0, true]])
  h.frame(16)
  assert.equal(focuses.length, 1, 'neutral tracking is not repeatedly rewritten')
  h.loop.stopAnimationPoll()
})

test('switching models during an old closing tail does not write the old tail or zero to the new model', () => {
  let ttsActive = true
  const h = createHarness({ isSpeaking: () => ttsActive, getLevel: () => 1 })
  const a = h.makeModel({ ParamMouthA: 0.2 })
  const b = h.makeModel({ ParamMouthB: 0.6 })
  h.store.live2dModel = a.model
  h.loop.startAnimationPoll()

  // Open A, then stop speech and let its normal smoothed closing tail begin.
  h.frame(60)
  const aPeak = a.values.ParamMouthA
  assert.ok(aPeak > 0.5, `expected A to open before switching, got ${aPeak}`)
  ttsActive = false
  h.frame(16)
  const aTail = a.values.ParamMouthA
  assert.ok(aTail > 0.001 && aTail < aPeak, 'A should be in its ordinary closing tail')

  // The real model lifecycle destroys A before the render loop observes B.
  a.destroy()
  h.store.live2dModel = b.model
  h.store.emotionAdapter = { lipSync: { mouthOpenParam: 'ParamMouthB', gain: 0.5 } }
  h.frame(16)

  assert.equal(b.values.ParamMouthB, undefined, 'idle B must keep its own default/expression')
  assert.equal(a.values.ParamMouthA, aTail, 'the destroyed A Core must not receive a tail write')
})

test('a still-live replaced model is released through setModelLipSync while the idle replacement stays untouched', () => {
  let ttsActive = true
  const h = createHarness({ isSpeaking: () => ttsActive, getLevel: () => 1 })
  const a = h.makeModel({ ParamMouthA: 0.25 })
  const b = h.makeModel({ ParamMouthB: 0.6 })
  h.store.live2dModel = a.model
  h.loop.startAnimationPoll()
  h.frame(60)
  assert.ok(a.values.ParamMouthA > 0.5)

  ttsActive = false
  h.store.live2dModel = b.model
  h.store.emotionAdapter = { lipSync: { mouthOpenParam: 'ParamMouthB', gain: 0.5 } }
  h.frame(16)

  assert.equal(a.values.ParamMouthA, 0.25, 'the old live model returns to its own default via the existing release API')
  assert.equal(b.values.ParamMouthB, undefined, 'idle B does not receive a synthetic zero or A tail')
})

test('an active audio level transfers to the new model binding without replaying or applying A gain', () => {
  let ttsLevel = 0.3
  let ttsActive = true
  let reads = 0
  const h = createHarness({
    isSpeaking: () => ttsActive,
    getLevel: () => { reads++; return ttsLevel },
  })
  const a = h.makeModel()
  const b = h.makeModel()
  h.store.live2dModel = a.model
  h.store.emotionAdapter = { lipSync: { mouthOpenParam: 'ParamMouthA', gain: 2 } }
  h.loop.startAnimationPoll()
  h.frame(60)

  const playerReadsBeforeSwitch = reads
  const oldMouthValue = a.values.ParamMouthA
  const oldWriteCount = a.writes.length
  a.destroy()
  h.store.live2dModel = b.model
  h.store.emotionAdapter = { lipSync: { mouthOpenParam: 'ParamMouthB', gain: 0.5 } }
  h.frame(16)

  assert.equal(reads, playerReadsBeforeSwitch + 1, 'switch must sample the existing audio player once')
  assert.ok(Math.abs(b.values.ParamMouthB - ttsLevel * 0.5) < 1e-9,
    'B must use the current normalized audio level and B gain, not A smoothing/gain')
  assert.equal(a.values.ParamMouthA, oldMouthValue)
  assert.equal(a.writes.length, oldWriteCount, 'destroyed A must not receive another Core write')
  ttsActive = false
})

test('changing mouth parameter on the same model releases the previous parameter before writing the new one', () => {
  const h = createHarness({ isSpeaking: () => true, getLevel: () => 1 })
  const a = h.makeModel({ ParamMouthA: 0.25, ParamMouthB: 0.1 })
  h.store.live2dModel = a.model
  h.loop.startAnimationPoll()
  h.frame(60)
  assert.ok(a.values.ParamMouthA > 0.5)

  a.writes.length = 0
  h.store.emotionAdapter = { lipSync: { mouthOpenParam: 'ParamMouthB', gain: 1 } }
  h.frame(16)

  assert.equal(a.values.ParamMouthA, 0.25, 'old parameter should be released to its current model default')
  assert.ok(a.values.ParamMouthB > 0.5, 'new parameter should immediately use the current speech input')
  assert.deepEqual(a.writes.map((write) => write.id), ['ParamMouthA', 'ParamMouthB'])
  h.frame(16)
  assert.deepEqual(a.writes.map((write) => write.id), ['ParamMouthA', 'ParamMouthB', 'ParamMouthB'],
    'subsequent frames must never keep writing the previous parameter')
})

test('streaming text keeps its existing speech clock across A to null to B and text growth', () => {
  const h = createHarness()
  const a = h.makeModel()
  const b = h.makeModel()
  const initialText = '正在说话'
  const grownText = '正在说话，并继续增长'
  h.store.live2dModel = a.model
  h.store.isSpeaking = true
  h.chatStore.messages = [{ role: 'assistant', type: 'text', text: initialText }]
  h.loop.startAnimationPoll()

  h.frame(16)
  const referenceClock = new h.TextSpeechClock()
  referenceClock.start(h.clock.now)
  referenceClock.level(initialText, h.clock.now)
  h.frame(80)
  referenceClock.level(initialText, h.clock.now)

  a.destroy()
  h.store.live2dModel = null
  h.chatStore.messages[0].text = grownText
  h.frame(80)
  referenceClock.level(grownText, h.clock.now)

  h.store.live2dModel = b.model
  h.store.emotionAdapter = { lipSync: { mouthOpenParam: 'ParamMouthB', gain: 0.7 } }
  h.frame(16)
  const expectedLevel = referenceClock.level(grownText, h.clock.now)

  assert.ok(expectedLevel > 0.1, `fixture should be mid-stream, got ${expectedLevel}`)
  assert.ok(Math.abs(b.values.ParamMouthB - expectedLevel * 0.7) < 1e-9,
    'B should use the current growing-text position, without restarting at the first character')
  assert.equal(a.values.ParamMouthOpenY, undefined, 'destroyed A must not be accessed to release its tail')
})

test('speech ending on one binding keeps its closing tail and releases to that model default', () => {
  let ttsActive = true
  const h = createHarness({ isSpeaking: () => ttsActive, getLevel: () => 1 })
  const a = h.makeModel({ ParamMouthA: 0.2 })
  h.store.live2dModel = a.model
  h.loop.startAnimationPoll()
  h.frame(60)
  assert.ok(a.values.ParamMouthA > 0.5)

  ttsActive = false
  h.frame(16)
  assert.ok(a.values.ParamMouthA > 0.001, 'normal end retains the smoothed closing tail')
  for (let i = 0; i < 80; i++) h.frame(16)

  assert.equal(a.values.ParamMouthA, 0.2, 'the existing lip-sync release path restores the model default')
})

test('a new binding clamps its current input as normalized level before applying model gain', () => {
  const h = createHarness({ isSpeaking: () => true, getLevel: () => 1.8 })
  const a = h.makeModel()
  h.store.live2dModel = a.model
  h.store.emotionAdapter = { lipSync: { mouthOpenParam: 'ParamMouthA', gain: 0.5 } }
  h.loop.startAnimationPoll()
  h.frame(16)

  assert.equal(a.values.ParamMouthA, 0.5, 'normalized level clamps to 1 before applying gain 0.5')
})

test('changing gain on the same model scales normalized smoothing rather than reusing raw parameter values', () => {
  let target = 0.4
  const h = createHarness({ isSpeaking: () => true, getLevel: () => target })
  const a = h.makeModel()
  h.store.live2dModel = a.model
  h.store.emotionAdapter = { lipSync: { mouthOpenParam: 'ParamMouthA', gain: 2 } }
  h.loop.startAnimationPoll()
  h.frame(60)
  const priorNormalizedLevel = a.values.ParamMouthA / 2

  target = 0.5
  h.store.emotionAdapter = { lipSync: { mouthOpenParam: 'ParamMouthA', gain: 0.5 } }
  h.frame(16)

  const currentNormalizedLevel = h.smoothMouth(priorNormalizedLevel, target, 16)
  assert.ok(Math.abs(a.values.ParamMouthA - currentNormalizedLevel * 0.5) < 1e-9,
    'gain is an output multiplier; smoothing remains in normalized input space')
})
