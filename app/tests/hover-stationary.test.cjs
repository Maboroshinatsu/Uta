const { test } = require('node:test')
const assert = require('node:assert/strict')
const Vue = require('vue')
const createLoader = require('./support/settings-loader.cjs')

function harness() {
  let now = 1000, seq = 0, ink = true
  const timers = new Map()
  const setTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id }
  const clearTimeout = id => timers.delete(id)
  const advance = ms => {
    const until = now + ms
    for (;;) {
      const next = [...timers].filter(([,t]) => t.at <= until).sort((a,b) => a[1].at-b[1].at)[0]
      if (!next) break
      now = next[1].at; timers.delete(next[0]); next[1].fn()
    }
    now = until
  }
  const store = Vue.reactive({ modelLoaded: true, live2dModel: {}, modelZoom: 1, hoverFadeEnabled: true, pendingApprovals: [] })
  const load = createLoader({
    '@/stores/deskpet': { useDeskpetStore: () => store }, '@/stores/chat': { useChatStore: () => ({ messages: [] }) },
    '@/services/live2d/loader': { RESOLUTION: 1, isCssPointOverModelInk: (_, x) => ink && x >= 100 && x <= 200 },
    '@/services/live2d/model-discovery': {}, '@/services/live2d/emotion-adapter': {},
    '@/services/render-fps': {}, '@/services/mouth-motion': {}, './useMotionPriority': {},
  }, { window: { innerWidth: 500, innerHeight: 500 }, performance: { now: () => now }, setTimeout, clearTimeout })
  const loop = load('renderer/composables/useStageRenderLoop').useStageRenderLoop({
    getModelKind: () => 'live2d', getStageShiftX: () => 0, getStaticStage: () => null,
    isOverlayOpen: () => false, isUiHovered: () => false, isDragging: () => false, resetUiHover() {},
  })
  return { loop, advance, timers, moveInk: () => { ink = false } }
}

test('one cursor sample settles enter and exit even if the cursor remains still', () => {
  const h = harness()
  h.loop.handleGlobalCursor(150, 150)
  h.advance(99); assert.equal(h.loop.isModelHovered.value, false)
  h.advance(1); assert.equal(h.loop.shouldFadeModel.value, true)
  h.loop.handleGlobalCursor(50, 150)
  h.advance(449); assert.equal(h.loop.isModelHovered.value, true)
  h.advance(1); assert.equal(h.loop.shouldFadeModel.value, false)
  h.loop.dispose()
  assert.equal(h.timers.size, 0)
})

test('settling rechecks moving model ink and leaving or disposing cancels pending hover', () => {
  const h = harness()
  h.loop.handleGlobalCursor(150, 150)
  h.moveInk(); h.advance(100)
  assert.equal(h.loop.isModelHovered.value, false)
  h.loop.handleGlobalCursor(-1, 10)
  h.advance(1000)
  assert.equal(h.loop.isModelHovered.value, false)
  h.loop.dispose()
  assert.equal(h.timers.size, 0)
})
