'use strict'
// 舞台拆分后的纯函数：hover 去抖、悬停淡出偏好、包围盒命中与模型显示名。
// 只加载纯函数导出，Vue / Pinia / Pixi 依赖全部用空替身拦截。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadTs(relativePath, requireMap = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    require: (id) => requireMap[id] ?? {},
    console,
    performance,
    setTimeout: () => 0,
    clearTimeout: () => {},
  })
  return mod.exports
}

const renderLoop = loadTs('src/renderer/composables/useStageRenderLoop.ts', {
  vue: {},
  '@/stores/deskpet': {},
  '@/stores/chat': {},
  '@/services/live2d/loader': {},
  '@/services/live2d/model-discovery': {},
  '@/services/render-fps': {},
  '@/services/live2d/emotion-adapter': {},
  '@/services/mouth-motion': {},
  './useMotionPriority': { MotionLayer: { Idle: 1, Reply: 2, Interaction: 3 } },
})

const lifecycle = loadTs('src/renderer/composables/useStageModelLifecycle.ts', {
  vue: {},
  '@/stores/deskpet': {},
  '@/services/live2d/loader': {},
  '@/services/imageset/loader': {},
  '@/services/live2d/model-discovery': {},
  '@/services/live2d/emotion-adapter': {},
  '@/services/live2d/adapter-validator': {},
  './useMotionPriority': { MotionLayer: { Idle: 1, Reply: 2, Interaction: 3 } },
  './useIdleScheduler': { pickIdleGroups: () => [] },
})

const plain = (value) => JSON.parse(JSON.stringify(value))

test('model drag only reports a completed moved gesture and cleans listeners', () => {
  const { createLoader } = { createLoader: require('./support/settings-loader.cjs') }
  const docHandlers = new Map(), winHandlers = new Map()
  const surface = handlers => ({
    addEventListener: (type, fn) => handlers.set(type, fn),
    removeEventListener: (type, fn) => { if (handlers.get(type) === fn) handlers.delete(type) },
  })
  const document = surface(docHandlers), window = surface(winHandlers)
  const { useModelDrag } = createLoader({ vue: { ref: value => ({ value }), onScopeDispose: () => {} } }, { document, window })('renderer/composables/useModelDrag')
  let calls = 0
  const drag = useModelDrag(() => { calls++ })
  drag.onModelMouseDown({ clientX: 0, clientY: 0, target: {} })
  docHandlers.get('mouseup')({ type: 'mouseup' })
  assert.equal(calls, 0)
  drag.onModelMouseDown({ clientX: 0, clientY: 0, target: {} })
  docHandlers.get('mousemove')({ clientX: 8, clientY: 0, buttons: 1 })
  docHandlers.get('mouseup')({ type: 'mouseup' })
  assert.equal(calls, 1)
  assert.equal(drag.isTapGesture(), false)
  assert.equal(docHandlers.size, 0)
  assert.equal(winHandlers.size, 0)
  drag.onModelMouseDown({ clientX: 0, clientY: 0, target: {} })
  docHandlers.get('mousemove')({ clientX: 8, clientY: 0, buttons: 1 })
  winHandlers.get('blur')({ type: 'blur' })
  assert.equal(calls, 1)
})

test('hover settle uses 100ms enter and 450ms exit thresholds', () => {
  let state = renderLoop.resolveModelHoverSettle(
    { hovered: false, pending: null, pendingAt: 0 },
    true,
    1000,
  )
  assert.deepEqual(plain(state), { hovered: false, pending: true, pendingAt: 1000 })

  state = renderLoop.resolveModelHoverSettle(state, true, 1099)
  assert.equal(state.hovered, false)
  assert.equal(state.pending, true)

  state = renderLoop.resolveModelHoverSettle(state, true, 1100)
  assert.deepEqual(plain(state), { hovered: true, pending: null, pendingAt: 1000 })

  let exit = renderLoop.resolveModelHoverSettle(
    { hovered: true, pending: null, pendingAt: 0 },
    false,
    2000,
  )
  assert.deepEqual(plain(exit), { hovered: true, pending: false, pendingAt: 2000 })

  exit = renderLoop.resolveModelHoverSettle(exit, false, 2449)
  assert.equal(exit.hovered, true)

  exit = renderLoop.resolveModelHoverSettle(exit, false, 2450)
  assert.deepEqual(plain(exit), { hovered: false, pending: null, pendingAt: 2000 })
})

test('hover settle clears pending when target returns to current state', () => {
  const state = renderLoop.resolveModelHoverSettle(
    { hovered: false, pending: true, pendingAt: 500 },
    false,
    600,
  )
  assert.deepEqual(plain(state), { hovered: false, pending: null, pendingAt: 500 })
})

test('hover settle honors immediate mode for non-live2d fallback', () => {
  const state = renderLoop.resolveModelHoverSettle(
    { hovered: false, pending: null, pendingAt: 0 },
    true,
    100,
    true,
  )
  assert.deepEqual(plain(state), { hovered: true, pending: null, pendingAt: 0 })
})

test('hover fade preference yields to overlays, UI hover and dragging', () => {
  const base = {
    hoverFadeEnabled: true,
    overlayOpen: false,
    uiHovered: false,
    dragging: false,
    modelHovered: true,
  }
  assert.equal(renderLoop.shouldFadeModelNow(base), true)
  assert.equal(renderLoop.shouldFadeModelNow({ ...base, hoverFadeEnabled: false }), false)
  assert.equal(renderLoop.shouldFadeModelNow({ ...base, overlayOpen: true }), false)
  assert.equal(renderLoop.shouldFadeModelNow({ ...base, uiHovered: true }), false)
  assert.equal(renderLoop.shouldFadeModelNow({ ...base, dragging: true }), false)
  assert.equal(renderLoop.shouldFadeModelNow({ ...base, modelHovered: false }), false)
})

test('model box hit test includes all four edges', () => {
  const box = { minX: 10, maxX: 20, minY: 30, maxY: 40 }
  assert.equal(renderLoop.isPointInModelBox(10, 30, box), true)
  assert.equal(renderLoop.isPointInModelBox(20, 40, box), true)
  assert.equal(renderLoop.isPointInModelBox(9.99, 30, box), false)
  assert.equal(renderLoop.isPointInModelBox(20.01, 40, box), false)
})

test('render activity keeps high fps for the whole TTS playback', () => {
  const idle = {
    dragging: false,
    overlayOpen: false,
    streamingReply: false,
    ttsSpeaking: false,
    pendingAnimation: false,
    pendingApprovals: 0,
    boost: false,
  }
  assert.equal(renderLoop.computeRenderActive(idle), false)
  assert.equal(renderLoop.computeRenderActive({ ...idle, ttsSpeaking: true }), true)
  assert.equal(renderLoop.computeRenderActive({ ...idle, streamingReply: true }), true)
  assert.equal(renderLoop.computeRenderActive({ ...idle, boost: true }), true)
  assert.equal(renderLoop.computeRenderActive({ ...idle, pendingApprovals: 1 }), true)
})

test('model display name prefers adapter name, then model id, then file/folder', () => {
  const resolve = lifecycle.resolveModelDisplayNameFrom
  assert.equal(resolve({ name: '  小鲸鱼  ' }, 'models/whale.model3.json'), '小鲸鱼')
  assert.equal(resolve({ name: '   ', modelId: 'empty' }, 'models/whale/whale.model3.json'), 'whale')
  assert.equal(resolve({ modelId: 'custom-id' }, 'models/whale/whale.model3.json'), 'custom-id')
  assert.equal(resolve(null, 'models/whale/whale.model3.json'), 'whale')
  assert.equal(resolve(null, 'models/sample_static/deskpet-images.json'), 'sample_static')
  assert.equal(resolve(null, ''), 'Uta')
})

test('cursor movement only lifts the frame rate near the pet window', () => {
  const near = renderLoop.isCursorNearWindow
  assert.equal(near(100, 100, 600, 800), true)
  assert.equal(near(-40, 100, 600, 800), true)
  assert.equal(near(-80, 100, 600, 800), false)
  assert.equal(near(640, 840, 600, 800), true)
  assert.equal(near(700, 100, 600, 800), false)
  assert.equal(near(300, 900, 600, 800), false)
})
