'use strict'
// DP-014: 情绪回退归属。只验证"谁负责调度回退"，不涉及音频。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/composables/useExpressionState.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const envelopeCode = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/services/performance/emotion-envelope.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const envelopeModule = { exports: {} }
vm.runInNewContext(envelopeCode, { module: envelopeModule, exports: envelopeModule.exports })

function harness() {
  const watchers = []
  const timers = []
  const cleared = []
  const expressions = []
  const requireMap = {
    vue: { watch: (_source, cb) => { watchers.push(cb) } },
    '@/stores/deskpet': {},
    '@/services/live2d/loader': {
      applyParameters() {},
      clearExpression() {},
      setExpression(_model, id) { expressions.push(id) },
    },
    '@/services/live2d/emotion-adapter': {
      getEmotionTarget: (_adapter, emotion) => emotion === 'neutral' ? null : { expression: emotion },
    },
    '@/services/performance/emotion-envelope': envelopeModule.exports,
  }
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (n) => requireMap[n],
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms }); return id },
    clearTimeout: (id) => { cleared.push(id) },
    Date,
  })
  return { use: module.exports.useExpressionState, watchers, timers, cleared, expressions }
}

function storeFor(extra) {
  return Object.assign({
    live2dModel: null, currentEmotion: 'neutral', emotionPulse: 0,
    defaultEmotion: 'neutral', emotionAdapter: null,
  }, extra)
}

test('image-set mode never schedules a revert timer (StaticStage owns it)', () => {
  const h = harness()
  h.use(storeFor({ live2dModel: null, currentEmotion: 'happy' }))
  assert.equal(h.watchers.length, 1)
  h.watchers[0](['happy'])
  assert.equal(h.timers.length, 0, '立绘包模式下不应由本控制器回退')
})

test('live2d mode schedules exactly one revert for a transient emotion', () => {
  const h = harness()
  h.use(storeFor({ live2dModel: {}, currentEmotion: 'happy' }))
  h.watchers[0](['happy'])
  assert.equal(h.timers.length, 1)
  assert.equal(h.timers[0].ms, 5200)
  assert.deepEqual(h.expressions, ['happy'])
})

test('repeated pulses refresh the window instead of stacking timers', () => {
  const h = harness()
  h.use(storeFor({ live2dModel: {}, currentEmotion: 'happy' }))
  h.watchers[0](['happy'])
  h.watchers[0](['happy'])
  assert.equal(h.timers.length, 2, '每次触发建一个新定时器')
  assert.equal(h.cleared.length, 1, '但旧的一定被清掉，不会叠加')
  assert.deepEqual(h.expressions, ['happy'], '同类意图冷却窗内不重复贴同一张脸')
  assert.ok(h.timers[1].ms > h.timers[0].ms, '保持时长随重复次数缓慢延长')
})

test('a different emotion still restarts immediately after a repeat', () => {
  const h = harness()
  h.use(storeFor({ live2dModel: {}, currentEmotion: 'happy' }))
  h.watchers[0](['happy'])
  h.watchers[0](['happy'])
  h.watchers[0](['sad'])
  assert.deepEqual(h.expressions, ['happy', 'sad'])
})

test('default and neutral emotions do not schedule a revert', () => {
  const h = harness()
  h.use(storeFor({ live2dModel: {}, currentEmotion: 'neutral', defaultEmotion: 'neutral' }))
  h.watchers[0](['neutral'])
  assert.equal(h.timers.length, 0)
  h.watchers[0](['idle'])
  assert.equal(h.timers.length, 0)
})

test('cleanup clears the pending revert timer', () => {
  const h = harness()
  const api = h.use(storeFor({ live2dModel: {}, currentEmotion: 'happy' }))
  h.watchers[0](['happy'])
  api.cleanup()
  assert.equal(h.cleared.length, 1)
})

test('revert waits while another visual layer is active', () => {
  const h = harness()
  const hold = { value: true }
  const store = storeFor({ live2dModel: {}, currentEmotion: 'happy' })
  h.use(store, { shouldHold: () => hold.value })
  h.watchers[0](['happy'])
  assert.equal(h.timers.length, 1)
  assert.equal(h.timers[0].ms, 5200)

  h.timers[0].fn()
  assert.equal(store.currentEmotion, 'happy')
  assert.equal(h.timers.length, 2)
  assert.equal(h.timers[1].ms, 400)

  hold.value = false
  h.timers[1].fn()
  assert.equal(store.currentEmotion, 'neutral')
})
