'use strict'
// 表情退出必须缓出，但不能把原生眨眼重新撑开。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const createLoader = require('./support/settings-loader.cjs')

function setup() {
  let now = 0
  const load = createLoader({
    '@pixi/app': { Application: class {} }, '@pixi/extensions': { extensions: { add() {} } },
    '@pixi/ticker': { Ticker: class {}, TickerPlugin: {} },
    'pixi-live2d-display/cubism4': { Live2DModel: { registerTicker() {} }, MotionPriority: {} },
  }, { performance: { now: () => now }, window: {} })
  const loader = load('renderer/services/live2d/loader')
  const values = { ParamMouthForm: 0.5, ParamEyeLOpen: 0 }
  const ids = Object.keys(values)
  const core = {
    _model: { parameters: { ids, count: 2, minimumValues: [-2, 0], maximumValues: [1, 1], defaultValues: [-0.5, 1] } },
    _savedParameters: [0.5, 0],
    getParameterValueById: id => values[id],
    getParameterDefaultValueById: id => (id === 'ParamEyeLOpen' ? 1 : -0.5),
    setParameterValueById: (id, value) => { values[id] = value },
    update() {},
  }
  const events = new Map()
  const currentExpression = { name: 'current', _parameters: [{ parameterId: 'ParamMouthForm' }, { parameterId: 'ParamEyeLOpen' }] }
  const manager = {
    currentExpression,
    expressions: [currentExpression],
    stopCalls: 0, restoredCalls: 0,
    stopAllExpressions() { manager.stopCalls++ },
    resetExpression() { this.currentExpression = { name: 'default', _parameters: [] } },
    getExpressionIndex(id) { return id === 'current' ? 0 : -1 },
    restoreExpression() { manager.restoredCalls++ },
  }
  const expressionCalls = []
  const model = {
    internalModel: {
      coreModel: core,
      on: (name, fn) => events.set(name, fn),
      motionManager: { expressionManager: manager },
    },
    expression(id) { expressionCalls.push(id); return Promise.resolve(true) },
  }
  loader.setBaseParameters(model, {})
  return {
    loader, model, values, core, manager, expressionCalls,
    advance: value => { now = value; events.get('beforeModelUpdate')?.() },
  }
}

test('clearing an expression fades additive parameters back to their base', () => {
  const h = setup()
  h.loader.clearExpression(h.model)
  h.advance(0)
  assert.ok(Math.abs(h.values.ParamMouthForm - 0.5) < 1e-6, 'fade starts from the expression value')
  h.advance(160)
  assert.ok(h.values.ParamMouthForm < 0.2 && h.values.ParamMouthForm > -0.3, 'mid-fade is between the two states')
  h.advance(340)
  assert.ok(Math.abs(h.values.ParamMouthForm - -0.5) < 1e-6, 'fade returns to the native base')
})

test('fading an expression never reopens a closed/blinking eyelid', () => {
  const h = setup()
  h.loader.clearExpression(h.model)
  for (const now of [0, 160, 340]) {
    h.values.ParamEyeLOpen = 0
    h.advance(now)
    assert.equal(h.values.ParamEyeLOpen, 0, 'native blink keeps the eye closed during the fade')
  }
})

test('reapplying the current expression restarts it instead of clearing the face first', () => {
  const h = setup()
  h.loader.setExpression(h.model, 'current')
  assert.equal(h.manager.restoredCalls, 1)
  assert.equal(h.manager.stopCalls, 0)
  assert.deepEqual(h.expressionCalls, [])
  assert.equal(h.values.ParamMouthForm, 0.5)
})

test('switching expressions delegates to the SDK cross-fade without pre-clearing parameters', () => {
  const h = setup()
  h.loader.setExpression(h.model, 'next')
  assert.deepEqual(h.expressionCalls, ['next'])
  assert.equal(h.manager.stopCalls, 0)
  assert.equal(h.values.ParamMouthForm, 0.5, 'outgoing expression must remain visible while the SDK fades it')
})

test('scene reset preserves an in-flight expression fade instead of snapping to defaults', () => {
  const h = setup()
  h.loader.clearExpression(h.model)
  h.loader.resetTransientParameters(h.model)
  h.advance(160)
  assert.ok(h.values.ParamMouthForm < 0.2 && h.values.ParamMouthForm > -0.3, 'expression fade survives scene cleanup')
  h.advance(340)
  assert.ok(Math.abs(h.values.ParamMouthForm - -0.5) < 1e-6)
})
