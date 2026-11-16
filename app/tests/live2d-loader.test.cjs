'use strict'
// DP-009 / DP-011 / DP-014: loader 的实例尺寸、动作结果、参数复位。全部使用替身，无 WebGL。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/services/live2d/loader.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText

const focusMappingModule = { exports: {} }
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../src/renderer/services/live2d/focus-mapping.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  { module: focusMappingModule, exports: focusMappingModule.exports, require: () => ({}) },
)

const SIZES = { 'small.model3.json': [100, 100], 'large.model3.json': [400, 800] }

function fakeModel(w, h) {
  return {
    width: w, height: h,
    anchor: { set() {} },
    scale: { x: 1, y: 1, set(sx, sy) { this.x = sx; this.y = sy } },
    position: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y } },
    destroyed: false,
    destroy() { this.destroyed = true },
    motion: async () => true,
    internalModel: { motionManager: null, coreModel: null },
  }
}

function harness({ now } = {}) {
  const created = []
  const requireMap = {
    './dafish-happy-performance': require('./support/settings-loader.cjs')()('renderer/services/live2d/dafish-happy-performance'),
    './focus-mapping': focusMappingModule.exports,
    './cubism-color': { installCubismDrawableColor() {} },
    '../performance/model-runtime': require('./support/settings-loader.cjs')({}, { performance: globalThis.performance })('renderer/services/performance/model-runtime'),
    '@pixi/app': { Application: function Application() {} },
    '@pixi/extensions': { extensions: { add() {} } },
    '@pixi/ticker': { Ticker: function Ticker() {}, TickerPlugin: {} },
    'pixi-live2d-display/cubism4': {
      Live2DModel: {
        registerTicker() {},
        from: async (p) => {
          const [w, h] = SIZES[p] || [100, 100]
          const m = fakeModel(w, h)
          m.path = p
          created.push(m)
          return m
        },
      },
      MotionPriority: { IDLE: 1, FORCE: 3, NORMAL: 2 },
    },
  }
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (n) => requireMap[n],
    window: {}, console, ...(now ? { performance: { now } } : {}),
  })
  return { loader: module.exports, created }
}

test('model metrics are per instance, not a module-level global', async () => {
  const h = harness()
  const small = await h.loader.createLive2DModel('small.model3.json')
  const large = await h.loader.createLive2DModel('large.model3.json')
  // 注意：vm 上下文里的对象原型与宿主不同，逐字段比较而不是 deepStrictEqual
  const metricsOf = (m) => { const x = h.loader.getModelMetrics(m); return [x.refW, x.refH] }
  assert.deepEqual(metricsOf(small), [100, 100])
  assert.deepEqual(metricsOf(large), [400, 800])
  // 未知模型回落默认值，不再读到"上一个模型"的尺寸
  assert.deepEqual(metricsOf({}), [100, 100])
})

test('preset ownership blocks automatic idle motion and releases it after cancellation', async () => {
  const { loader } = harness()
  const requests = []
  const model = { internalModel: { motionManager: {
    startRandomMotion: async (group, priority) => { requests.push([group, priority]); return true },
  } } }
  loader.attachMotionPolicy(model)
  const manager = model.internalModel.motionManager
  loader.setPresetMotionOwnership(model, true)
  assert.equal(await manager.startRandomMotion('Idle', 1), false)
  assert.deepEqual(requests, [])
  assert.equal(await manager.startRandomMotion('Idle', 3), true)
  loader.setPresetMotionOwnership(model, false)
  assert.equal(await manager.startRandomMotion('Idle', 1), true)
  assert.deepEqual(requests, [['Idle', 3], ['Idle', 1]])
})

test('resize uses the model own metrics', async () => {
  const h = harness()
  const large = await h.loader.createLive2DModel('large.model3.json')
  h.loader.resizeModel(large, 1000, 1000, 1)
  // base = min(850/400, 850/800) = 1.0625
  assert.ok(Math.abs(large.scale.x - 1.0625) < 1e-9, `got ${large.scale.x}`)
  h.loader.resizeModelFit(large, 1000, 1000, 2)
  assert.ok(Math.abs(large.scale.x - 2.125) < 1e-9, `got ${large.scale.x}`)
})

test('createLive2DModel does not touch the visible stage', async () => {
  const h = harness()
  const app = { view: { width: 600, height: 800 }, stage: { children: [], addChild(c) { this.children.push(c) } } }
  const m = await h.loader.createLive2DModel('small.model3.json')
  assert.equal(app.stage.children.length, 0, '准备阶段不得上舞台')
  h.loader.attachLive2DModel(m, app)
  h.loader.attachLive2DModel(m, app)
  assert.equal(app.stage.children.length, 1, '重复提交不应重复挂载')
  assert.ok(m.scale.x > 0)
})

test('discardLive2DModel destroys a prepared model', async () => {
  const h = harness()
  const m = await h.loader.createLive2DModel('small.model3.json')
  h.loader.discardLive2DModel(m)
  assert.equal(m.destroyed, true)
})

test('playMotion reports the library result instead of always succeeding', async () => {
  const h = harness()
  const m = fakeModel(100, 100)
  m.motion = async () => false
  assert.equal(await h.loader.playMotion(m, 'wave', 0), false)
  m.motion = async () => true
  assert.equal(await h.loader.playMotion(m, 'wave', 0), true)
  m.motion = async () => { throw new Error('boom') }
  assert.equal(await h.loader.playMotion(m, 'wave', 0), false)
})

test('onMotionFinish subscribes and unsubscribes safely', async () => {
  const h = harness()
  const listeners = {}
  const manager = {
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn) },
    off(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn) },
  }
  const m = fakeModel(100, 100)
  m.internalModel.motionManager = manager
  let hits = 0
  const off = h.loader.onMotionFinish(m, () => { hits++ })
  assert.equal(listeners.motionFinish.length, 1)
  listeners.motionFinish[0]()
  assert.equal(hits, 1)
  off()
  assert.equal(listeners.motionFinish.length, 0)
  // 没有 motionManager 时是安全的空操作
  const noop = h.loader.onMotionFinish({}, () => {})
  assert.equal(typeof noop, 'function')
  noop()
})

test('applyParameters restores the model default value, not a hard-coded 0', () => {
  const h = harness()
  const core = {
    values: {},
    defaults: { ParamCheek: 0.5, ParamMouthForm: 0.25 },
    setParameterValueById(id, v) { this.values[id] = v },
    getParameterDefaultValueById(id) { return this.defaults[id] ?? 0 },
  }
  const m = fakeModel(100, 100)
  m.internalModel.coreModel = core
  h.loader.applyParameters(m, { ParamCheek: 1, ParamMouthForm: -1 })
  assert.equal(core.values.ParamCheek, 1)
  assert.equal(core.values.ParamMouthForm, -1)
  h.loader.applyParameters(m, {})
  assert.equal(core.values.ParamCheek, 0.5, '非零默认值必须复位到默认而不是 0')
  assert.equal(core.values.ParamMouthForm, 0.25)
})

test('applyParameters falls back to 0 when the core model has no default lookup', () => {
  const h = harness()
  const core = { values: {}, setParameterValueById(id, v) { this.values[id] = v } }
  const m = fakeModel(100, 100)
  m.internalModel.coreModel = core
  h.loader.applyParameters(m, { ParamEyeLSmile: 1 })
  h.loader.applyParameters(m, {})
  assert.equal(core.values.ParamEyeLSmile, 0)
})

test('3-layer stack preserves base watermarks and controls when transient emotions revert', () => {
  const h = harness()
  const core = {
    values: {},
    partOpacities: {},
    defaults: { Paramheadxy: 0, ParamHat: 0, ParamMouthForm: 0 },
    setParameterValueById(id, v) { this.values[id] = v },
    getParameterDefaultValueById(id) { return this.defaults[id] ?? 0 },
    setPartOpacityById(id, v) { this.partOpacities[id] = v },
  }
  const m = fakeModel(100, 100)
  m.internalModel.coreModel = core

  // 1. 底层常驻去水印参数
  h.loader.setBaseParameters(m, { Paramheadxy: 30 })
  assert.equal(core.values.Paramheadxy, 30)

  // 2. 开启持久控件（戴帽子 + 隐藏某部件）
  h.loader.setControlParameters(m, { ParamHat: 1 })
  h.loader.setHiddenParts(m, ['PartCoat'])
  assert.equal(core.values.Paramheadxy, 30)
  assert.equal(core.values.ParamHat, 1)
  assert.equal(core.partOpacities.PartCoat, 0)

  // 3. 触发瞬态情绪，随后 6 秒回退释放情绪参数
  h.loader.applyParameters(m, { ParamMouthForm: 1 })
  assert.equal(core.values.ParamMouthForm, 1)
  h.loader.applyParameters(m, {})
  assert.equal(core.values.ParamMouthForm, 0, '瞬态情绪参数应复位到默认值')
  assert.equal(core.values.Paramheadxy, 30, '去水印底层参数不得被情绪回退冲掉')
  assert.equal(core.values.ParamHat, 1, '已开启的持久控件不得被情绪回退冲掉')

  // 4. 关闭持久控件后复位到默认值，但底层去水印依然保留
  h.loader.setControlParameters(m, {})
  h.loader.setHiddenParts(m, [])
  assert.equal(core.values.ParamHat, 0)
  assert.equal(core.partOpacities.PartCoat, 1)
  assert.equal(core.values.Paramheadxy, 30)
})

test('setBaseParameters collapses vertices pushed off-canvas by watermark parameters while keeping normal vertices', () => {
  const h = harness()
  const m = fakeModel(100, 100)

  // 模拟 RetrynowMiku 的 ArtMesh77：前 1 个顶点 (0.2, 1.0) 是正常脸部，后 1 个顶点在 Watermark=1 时从 (0.0, 1.0) 平移到画布顶边 (1.875) 之外的 (0.0, 2.4)
  const verts = new Float32Array([0.2, 1.0, 0.0, 1.0])
  const rawModel = {
    canvasinfo: { CanvasWidth: 6000, CanvasHeight: 7501, PixelsPerUnit: 2000 },
    parameters: {
      ids: ['Watermark'],
      defaultValues: new Float32Array([0]),
      values: new Float32Array([0]),
    },
    drawables: {
      vertexPositions: [verts],
    },
    update() {
      const wm = this.parameters.values[0]
      verts[0] = 0.2
      verts[1] = 1.0
      verts[2] = 0.0
      verts[3] = wm > 0.5 ? 2.4 : 1.0
    },
  }

  const core = {
    _model: rawModel,
    setParameterValueById(id, val) {
      const idx = rawModel.parameters.ids.indexOf(id)
      if (idx >= 0) rawModel.parameters.values[idx] = val
    },
    getParameterDefaultValueById() {
      return 0
    },
    update() {
      rawModel.update()
    },
  }
  m.internalModel.coreModel = core

  h.loader.setBaseParameters(m, { Watermark: 1 })
  core.update()

  assert.ok(Math.abs(verts[0] - 0.2) < 1e-5, '正常脸部顶点 X 不应受影响')
  assert.ok(Math.abs(verts[1] - 1.0) < 1e-5, '正常脸部顶点 Y 不应受影响')
  assert.equal(verts[2], 0, '被推到画布外的水印顶点 X 应折叠为 0')
  assert.equal(verts[3], 0, '被推到画布外的水印顶点 Y 应折叠为 0')
})

for (const lookup of ['core-array', 'sdk-index']) for (const duration of [0, 400]) {
  test(`nonzero defaults survive control release without a ById lookup (${lookup}, ${duration}ms)`, () => {
    let time = 0
    const { loader } = harness({ now: () => time })
    const model = fakeModel(100, 100), hooks = {}
    const params = { ids: ['Accessory', 'NegativeDefault'], values: [1, -2],
      ...(lookup === 'core-array' ? { defaultValues: new Float32Array([1, -2]) } : {}) }
    const core = { _model: { parameters: params }, _savedParameters: [1, -2],
      getParameterDefaultValue(index) { return [1, -2][index] },
      getParameterValueById(id) { return params.values[params.ids.indexOf(id)] },
      setParameterValueById(id, value) { const i = params.ids.indexOf(id); if (i >= 0) params.values[i] = value },
    }
    model.internalModel.coreModel = core
    model.internalModel.on = (event, callback) => { hooks[event] = callback }
    const frame = () => { params.values = [...core._savedParameters]; hooks.beforeModelUpdate(); return [...params.values] }
    loader.setControlParameters(model, { Accessory: 0, NegativeDefault: -1 })
    assert.deepEqual(frame(), [0, -1])
    loader.setControlParameters(model, {}, { transitionMs: duration })
    time = duration
    assert.deepEqual(frame(), [1, -2])
    time += 20
    assert.deepEqual(frame(), [1, -2], 'SDK loadParameters must retain the restored defaults on later frames')
    assert.deepEqual(core._savedParameters, [1, -2])
  })
}

test('transition release updates _savedParameters so loadParameters does not revert SchoolUniform back to 1', async () => {
  const h = harness()
  const m = fakeModel(100, 100)
  const hooks = {}
  m.internalModel.on = (ev, fn) => {
    hooks[ev] = fn
  }

  const rawParams = {
    ids: ['SchoolUniform'],
    defaultValues: [0],
    values: [0],
  }
  const core = {
    _model: { parameters: rawParams },
    _savedParameters: [0],
    setParameterValueById(id, val) {
      const idx = rawParams.ids.indexOf(id)
      if (idx >= 0) rawParams.values[idx] = val
    },
    getParameterValueById(id) {
      const idx = rawParams.ids.indexOf(id)
      return idx >= 0 ? rawParams.values[idx] : 0
    },
    getParameterDefaultValueById(id) {
      const idx = rawParams.ids.indexOf(id)
      return idx >= 0 ? rawParams.defaultValues[idx] : 0
    },
    saveParameters() {
      this._savedParameters[0] = rawParams.values[0]
    },
    loadParameters() {
      rawParams.values[0] = this._savedParameters[0]
    },
  }
  m.internalModel.coreModel = core

  function simulateCubismFrame() {
    core.saveParameters()
    if (hooks.beforeModelUpdate) hooks.beforeModelUpdate()
    const renderedVal = rawParams.values[0]
    core.loadParameters()
    return renderedVal
  }

  // 1) 激活带 SchoolUniform=1 的预设，并跑一帧让 _savedParameters 固化为 1
  h.loader.setControlParameters(m, { SchoolUniform: 1 }, { transitionMs: 20 })
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(simulateCubismFrame(), 1)
  assert.equal(core._savedParameters[0], 1)

  // 2) 切换到不含 SchoolUniform 的预设（transitionMs: 20）
  h.loader.setControlParameters(m, {}, { transitionMs: 20 })
  const midVal = simulateCubismFrame()
  assert.ok(midVal > 0 && midVal <= 1, '过渡期间应平滑插值')

  // 3) 等待过渡动画结束，再跑多帧验证绝不会跳回 1
  await new Promise((r) => setTimeout(r, 35))
  const endVal1 = simulateCubismFrame()
  const endVal2 = simulateCubismFrame()
  assert.equal(endVal1, 0, '过渡结束帧应为默认值 0')
  assert.equal(endVal2, 0, '过渡结束后的后续帧不得被 loadParameters 还原回 1')
})

test('instant loop restarts enter the next render frame once without polluting the SDK baseline', () => {
  const { loader } = harness()
  const model = fakeModel(100, 100), hooks = {}
  const params = { ids: ['ParamAngleX', 'AlienInput', 'ParamEyeLOpen', 'ParamEyeBallX'],
    values: [0, 0, 1, 0], defaultValues: [0, 0, 1, 0] }
  const core = { _model: { parameters: params }, _savedParameters: [0, 0, 1, 0],
    getParameterValueById(id) { return params.values[params.ids.indexOf(id)] },
    setParameterValueById(id, value) { const i = params.ids.indexOf(id); if (i >= 0) params.values[i] = value },
  }
  model.internalModel.coreModel = core
  model.internalModel.on = (event, callback) => { hooks[event] = callback }
  loader.setFocusMapping(model, { bodyXParam: 'AlienInput', headXParam: null })
  const frame = () => {
    // Cubism 的真实顺序：保存底层 → 跟随/参数/物理 → 渲染 → 加载底层。
    core._savedParameters = [...params.values]
    params.values[3] += .5
    hooks.beforeModelUpdate()
    const rendered = [...params.values]
    params.values = [...core._savedParameters]
    return rendered
  }
  for (let i = 0; i < 6; i++) for (const target of [8, -8]) {
    loader.setControlLayer(model, { parameters: { ParamAngleX: target, AlienInput: target, ParamEyeLOpen: .4, ParamEyeBallX: .08 },
      hiddenParts: [], shownParts: [], additiveGaze: true }, { transitionMs: 0 })
    assert.deepEqual(params.values, [0, 0, 1, 0], 'between-frame writes must not become the next SDK baseline')
    assert.deepEqual(frame(), [target, target, .4, .58])
    assert.deepEqual(core._savedParameters, [0, 0, 1, 0])
  }
})

test('additive posture parameters and eye-open scaling preserve continuous motion curves and blinking', () => {
  const h = harness()
  const m = fakeModel(100, 100)
  const hooks = {}
  m.internalModel.on = (ev, fn) => {
    hooks[ev] = fn
  }

  const rawParams = {
    ids: ['ParamAngleZ', 'ParamEyeLOpen', 'ParamEyeBallX'],
    defaultValues: [0, 1, 0],
    values: [0, 1, 0],
  }
  const partOpacities = new Map()
  const core = {
    _model: { parameters: rawParams },
    _savedParameters: [0, 1, 0],
    setParameterValueById(id, val) {
      const idx = rawParams.ids.indexOf(id)
      if (idx >= 0) rawParams.values[idx] = val
    },
    getParameterValueById(id) {
      const idx = rawParams.ids.indexOf(id)
      return idx >= 0 ? rawParams.values[idx] : 0
    },
    getParameterDefaultValueById(id) {
      const idx = rawParams.ids.indexOf(id)
      return idx >= 0 ? rawParams.defaultValues[idx] : 0
    },
    setPartOpacityById(partId, op) {
      partOpacities.set(partId, op)
    },
  }
  m.internalModel.coreModel = core

  // 设定歪头偏移 ParamAngleZ = -10、半眯眼 ParamEyeLOpen = 0.4、视线左飘 ParamEyeBallX = -0.8，并强制显示 PartArmB
  h.loader.setControlParameters(m, { ParamAngleZ: -10, ParamEyeLOpen: 0.4, ParamEyeBallX: -0.8 })
  h.loader.setShownParts(m, ['PartArmB'])

  // 模拟第 1 帧：动作曲线输出 ParamAngleZ = +6，眨眼处于睁眼状态 ParamEyeLOpen = 1.0，待机随机视线输出 +0.5
  rawParams.values[0] = 6
  rawParams.values[1] = 1.0
  rawParams.values[2] = 0.5
  hooks.beforeModelUpdate()
  assert.ok(Math.abs(rawParams.values[0] - -4) < 1e-5, '歪头预设应与动作曲线叠加 (6 + -10 = -4)')
  assert.ok(Math.abs(rawParams.values[1] - 0.4) < 1e-5, '半眯眼在睁眼帧应保持 0.4')
  assert.ok(Math.abs(rawParams.values[2] - -0.8) < 1e-5, '预设眼球视线由关键帧直接驱动 (-0.8)，不受待机随机斜视 (+0.5) 干扰')
  assert.equal(partOpacities.get('PartArmB'), 1, 'setShownParts 应将 PartArmB 透明度设为 1')

  // 模拟第 2 帧：眨眼器触发闭眼 (ParamEyeLOpen = 0)
  rawParams.values[0] = 3
  rawParams.values[1] = 0
  rawParams.values[2] = 0.5
  hooks.beforeModelUpdate()
  assert.ok(Math.abs(rawParams.values[0] - -7) < 1e-5, '歪头预设继续跟随动作曲线摆动 (3 + -10 = -7)')
  assert.equal(rawParams.values[1], 0, '半眯眼在眨眼闭眼帧仍能自然完全闭合到 0')
  assert.ok(Math.abs(rawParams.values[2] - -0.8) < 1e-5, '眼球视线持续保持预设目标 (-0.8)')
})

for (const eyeId of ['ParamEyeBallX', 'PupilHorizontal']) for (const naturalHook of [false, true]) test(`ambient ${eyeId} offsets preserve mouse gaze across frames (natural hook: ${naturalHook})`, () => {
  const { loader } = harness()
  const model = fakeModel(100, 100)
  const hooks = {}
  const params = { ids: [eyeId], defaultValues: [0], values: [0] }
  const core = {
    _model: { parameters: params }, _savedParameters: [0],
    setParameterValueById(id, value) { if (id === eyeId) params.values[0] = value },
    getParameterValueById(id) { return id === eyeId ? params.values[0] : 0 },
    getParameterDefaultValueById() { return 0 },
  }
  model.internalModel.coreModel = core
  model.internalModel.on = (event, callback) => { hooks[event] = callback }
  if (naturalHook) model.internalModel.updateNaturalMovements = () => {}
  loader.setFocusMapping(model, { eyeXParam: eyeId, eyeYParam: null, headScale: 30, eyeScale: 1, bodyScale: 10 })
  loader.setControlLayer(model, { parameters: { [eyeId]: -0.1 }, hiddenParts: [], shownParts: [], additiveGaze: true })
  const frame = gaze => {
    params.values[0] = gaze // Cubism loadParameters + updateFocus 的当前帧输出
    if (naturalHook) model.internalModel.updateNaturalMovements(16, 0)
    hooks.beforeModelUpdate()
    return params.values[0]
  }
  assert.ok(Math.abs(frame(0.5) - 0.4) < 1e-6)
  assert.ok(Math.abs(frame(-0.2) - -0.3) < 1e-6, '鼠标换边仍能跟随')
  assert.ok(Math.abs(frame(0.5) - 0.4) < 1e-6, '多帧没有累积漂移或物理后绝对覆盖')
  assert.equal(core._savedParameters[0], 0, '不得污染 SDK 下一帧基线')
  loader.setControlLayer(model, { parameters: { [eyeId]: -0.1 }, hiddenParts: [], shownParts: [] })
  assert.equal(frame(0.5), -0.1, '切回表演后恢复绝对视线')
  model.internalModel.focusController = { x: 0.5, y: 0 }
  loader.setControlLayer(model, { parameters: {}, hiddenParts: [], shownParts: [] })
  loader.setControlLayer(model, { parameters: { [eyeId]: -0.1 }, hiddenParts: [], shownParts: [], additiveGaze: true }, { transitionMs: 100000 })
  assert.equal(loader.inspectModelStack(model).transitions.find(t => t.id === eyeId).from, 0,
    '首次待机过渡不能把当前鼠标朝向当作偏移起点')
  loader.setControlLayer(model, { parameters: { [eyeId]: -0.1 }, hiddenParts: [], shownParts: [], additiveGaze: true })
  loader.setControlLayer(model, { parameters: { [eyeId]: -0.4 }, hiddenParts: [], shownParts: [] }, { transitionMs: 100000 })
  assert.ok(Math.abs(loader.inspectModelStack(model).transitions[0].from - 0.4) < 1e-6,
    '待机切表演时把偏移换算成当前绝对视线，避免起手跳变')
  loader.setControlLayer(model, { parameters: { [eyeId]: -0.1 }, hiddenParts: [], shownParts: [], additiveGaze: true }, { transitionMs: 100000 })
  assert.ok(Math.abs(frame(0.5) - 0.4) < 1e-6, '切回待机时当前画面保持连续')
  loader.setControlLayer(model, { parameters: {}, hiddenParts: [], shownParts: [], additiveGaze: true }, { transitionMs: 100000 })
  assert.ok(Math.abs(frame(-0.2) - -0.3) < 1e-4, '释放待机眼球偏移仍叠加当前鼠标方向')
})

test('a custom eyelid binding preserves blinking and never persists its expression into the SDK baseline', () => {
  const { loader } = harness()
  const model = fakeModel(100, 100), hooks = {}, params = { ids: ['LidA'], values: [1], defaultValues: [1] }
  const core = { _model: { parameters: params }, _savedParameters: [1],
    getParameterValueById() { return params.values[0] }, getParameterDefaultValueById() { return 1 },
    setParameterValueById(_id, value) { params.values[0] = value },
  }
  model.internalModel.coreModel = core
  model.internalModel.on = (event, callback) => { hooks[event] = callback }
  model.internalModel.updateNaturalMovements = () => {}
  loader.setFocusMapping(model, null, [{ input: 'EyeOpenLeft', output: 'LidA' }])
  loader.setControlParameters(model, { LidA: .4 })
  for (const [blink, expected] of [[1, .4], [0, 0], [.5, .2]]) {
    params.values[0] = blink
    model.internalModel.updateNaturalMovements(16, 0); hooks.beforeModelUpdate()
    assert.equal(params.values[0], expected)
  }
  assert.equal(core._savedParameters[0], 1)
})

for (const inputId of ['ParamBodyAngleXinput', 'Param13', 'UnknownRigTorso']) {
  for (const naturalHook of [false, true]) test(`mapped pose input ${inputId} blends, releases and preserves SDK baseline (natural hook: ${naturalHook})`, () => {
    let time = 0
    const { loader } = harness({ now: () => time })
    const model = fakeModel(100, 100), hooks = {}
    const params = { ids: [inputId, 'ParamBodyAngleX', 'Accessory'], values: [0, 0, 0], defaultValues: [0, 0, 0] }
    const core = { _model: { parameters: params }, _savedParameters: [0, 0, 0],
      getParameterValueById(id) { return params.values[params.ids.indexOf(id)] ?? 0 },
      getParameterDefaultValueById() { return 0 },
      setParameterValueById(id, value) { const i = params.ids.indexOf(id); if (i >= 0) params.values[i] = value },
    }
    model.internalModel.coreModel = core
    model.internalModel.on = (event, callback) => { hooks[event] = callback }
    model.internalModel.focusController = { x: .5, y: 0 }
    model.internalModel.updateFocus = () => {}
    if (naturalHook) model.internalModel.updateNaturalMovements = () => {}
    loader.setFocusMapping(model, { headScale: 30, eyeScale: 1, bodyScale: 10, bodyXParam: inputId, bodyYParam: null, bodyZParam: null,
      headXParam: null, headYParam: null, headZParam: null, eyeXParam: null, eyeYParam: null })
    loader.setControlLayer(model, { parameters: { [inputId]: 2, Accessory: .3 }, hiddenParts: [], shownParts: [] }, { transitionMs: 400 })
    const frame = (at, cursor) => {
      time = at; params.values = [...core._savedParameters]
      model.internalModel.focusController.x = cursor
      model.internalModel.updateFocus()
      if (naturalHook) {
        model.internalModel.updateNaturalMovements(16, at)
        params.values[1] = params.values[0] * 2 // 真实 SDK 中物理求值发生在姿态层之后
      }
      hooks.beforeModelUpdate()
      return params.values[0]
    }
    assert.ok(Math.abs(frame(200, .5) - 6) < 1e-6, '过渡中的姿态偏移叠加跟随')
    assert.equal(frame(400, .5), 7)
    if (naturalHook) assert.equal(params.values[1], 14, '物理看到叠加后的输入，物理后不再覆盖')
    assert.equal(core._savedParameters[0], 0, '不能把姿态偏移存进 SDK 下一帧基线')
    assert.equal(frame(450, .5), 7, '不能逐帧累加漂移')
    assert.equal(frame(500, -.5), -3)
    loader.setControlLayer(model, { parameters: { Accessory: .3 }, hiddenParts: [], shownParts: [] }, { transitionMs: 400 })
    assert.equal(frame(700, .5), 6)
    assert.equal(frame(900, .5), 5)
    assert.equal(frame(1000, .5), 5, '释放完成后持续跟随，不残留偏移')
    assert.equal(core._savedParameters[0], 0)
    assert.equal(core._savedParameters[2], .3, '非姿态部件仍采用持久值')
  })
}

test('setModelLipSync overrides motion and emotion mouth openness in beforeModelUpdate and restores when speaking ends', () => {
  const h = harness()
  const m = fakeModel(100, 100)
  const hooks = {}
  m.internalModel.on = (ev, fn) => {
    hooks[ev] = fn
  }

  const rawParams = {
    ids: ['ParamMouthOpenY'],
    defaultValues: [0],
    values: [0],
  }
  const core = {
    _model: { parameters: rawParams },
    _savedParameters: [0],
    setParameterValueById(id, val) {
      const idx = rawParams.ids.indexOf(id)
      if (idx >= 0) rawParams.values[idx] = val
    },
    getParameterValueById(id) {
      const idx = rawParams.ids.indexOf(id)
      return idx >= 0 ? rawParams.values[idx] : 0
    },
    getParameterDefaultValueById(id) {
      const idx = rawParams.ids.indexOf(id)
      return idx >= 0 ? rawParams.defaultValues[idx] : 0
    },
  }
  m.internalModel.coreModel = core

  // 当前处于带张嘴的情绪（如 surprise: ParamMouthOpenY = 0.8）
  h.loader.applyParameters(m, { ParamMouthOpenY: 0.8 })
  assert.ok(Math.abs(rawParams.values[0] - 0.8) < 1e-5)

  // TTS 开始播报：句中某字音张嘴 0.45，即使待机动作把曲线刷成 0、情绪栈想写成 0.8，beforeModelUpdate 后也应为 0.45
  h.loader.setModelLipSync(m, 'ParamMouthOpenY', 0.45, true)
  rawParams.values[0] = 0 // 模拟 motionManager.update 覆盖为 0
  hooks.beforeModelUpdate()
  assert.ok(Math.abs(rawParams.values[0] - 0.45) < 1e-5, '说话期间口型应覆盖待机动作与情绪栈')

  // TTS 句中停顿：speakingActive 仍为 true，但音量为 0，嘴应闭合到 0 而不是跳回 surprise 的 0.8
  h.loader.setModelLipSync(m, 'ParamMouthOpenY', 0, true)
  rawParams.values[0] = 0
  hooks.beforeModelUpdate()
  assert.equal(rawParams.values[0], 0, '句间停顿应保持闭嘴 0')

  // TTS 播放结束：speakingActive = false，口型释放回当前激活情绪的 0.8
  h.loader.setModelLipSync(m, 'ParamMouthOpenY', 0, false)
  assert.ok(Math.abs(rawParams.values[0] - 0.8) < 1e-5, '说话结束后应恢复当前情绪的张嘴值')
})

test('releaseParameterIds clears stale saved values but leaves active control params alone', () => {
  const h = harness()
  const rawParams = { ids: ['ParamCheek19'], defaultValues: [0], values: [1] }
  const core = {
    _model: { parameters: rawParams },
    _savedParameters: [1],
    setParameterValueById(id, val) {
      const idx = rawParams.ids.indexOf(id)
      if (idx >= 0) rawParams.values[idx] = val
    },
    getParameterValueById(id) {
      const idx = rawParams.ids.indexOf(id)
      return idx >= 0 ? rawParams.values[idx] : 0
    },
    getParameterDefaultValueById(id) {
      const idx = rawParams.ids.indexOf(id)
      return idx >= 0 ? rawParams.defaultValues[idx] : 0
    },
  }

  const owned = fakeModel(100, 100)
  owned.internalModel.coreModel = core
  h.loader.setControlLayer(owned, { parameters: { ParamCheek19: 1 }, hiddenParts: [], shownParts: [] })
  h.loader.releaseParameterIds(owned, ['ParamCheek19'])
  assert.equal(rawParams.values[0], 1, '仍被控件接管的参数不得被兜底释放')

  const orphaned = fakeModel(100, 100)
  orphaned.internalModel.coreModel = core
  h.loader.releaseParameterIds(orphaned, ['ParamCheek19'])
  assert.equal(rawParams.values[0], 0, '无图层接管的残留参数应回到模型默认值')
  assert.equal(core._savedParameters[0], 0, 'savedParameters 也必须同步复位，避免 loadParameters 还原旧值')
})

test('idle cleanup restores the model-load pose instead of Core defaults', () => {
  const h = harness()
  const ids = ['ParamArmLA', 'ParamCheek17', 'ParamAngleX']
  const home = [7, 0, -3]
  const values = new Float32Array(home)
  const saved = [...home]
  const core = {
    _model: { parameters: { ids, values } },
    _savedParameters: saved,
    getParameterValueById(id) {
      const idx = ids.indexOf(id)
      return idx >= 0 ? values[idx] : 0
    },
    getParameterDefaultValueById() {
      return 0
    },
    setParameterValueById(id, value) {
      const idx = ids.indexOf(id)
      if (idx >= 0) values[idx] = value
    },
  }
  const model = fakeModel(100, 100)
  model.internalModel.coreModel = core

  h.loader.inspectModelStack(model)
  values[0] = 0
  values[1] = 1
  values[2] = 8

  h.loader.resetTransientParametersToHome(model)
  assert.equal(values[0], 7, '初始手臂姿态必须恢复，而不是回到 Core 默认值')
  assert.equal(values[1], 0, '特效参数必须清除')
  assert.equal(values[2], -3, '初始头部姿态必须恢复')
  assert.equal(saved[1], 0, 'savedParameters 同步复位，避免 loadParameters 还原特效')
})

test('unload still destroys the model when removing it from the stage throws', () => {
  const h = harness()
  const model = fakeModel(100, 100)
  const app = {
    stage: {
      removeChild() {
        throw new Error('not attached')
      },
    },
  }

  h.loader.unloadLive2DModel(model, app)

  // 模型挂在共享 Ticker 上，不销毁就会以 60fps 永久空转（B04 的僵尸模型）
  assert.equal(model.destroyed, true, '移出舞台失败也必须销毁模型')
})

test('standard parameter names map onto uppercase or underscored model ids', () => {
  const h = harness()
  const core = {
    values: {},
    _model: { parameters: { ids: ['PARAM_CHEEK', 'PARAM_MOUTH_OPEN_Y', 'param_eye_l_open'] } },
    _savedParameters: [0, 0, 1],
    setParameterValueById(id, v) { this.values[id] = v },
    getParameterValueById(id) { return this.values[id] ?? 0 },
    getParameterDefaultValueById(id) { return this.values[id] ?? 0 },
  }
  const m = fakeModel(100, 100)
  m.internalModel.coreModel = core

  assert.equal(h.loader.resolveCoreParamId(core, 'ParamCheek'), 'PARAM_CHEEK')
  assert.equal(h.loader.resolveCoreParamId(core, 'PARAM_CHEEK'), 'PARAM_CHEEK')
  assert.equal(h.loader.resolveCoreParamId(core, 'ParamUnknown'), 'ParamUnknown')

  h.loader.applyParameters(m, { ParamCheek: 0.5 })
  assert.equal(core.values.PARAM_CHEEK, 0.5, '预设里的标准参数名要写到模型真实 id')
  assert.equal(core._savedParameters[0], 0.5)

  h.loader.setModelLipSync(m, 'ParamMouthOpenY', 0.6)
  assert.equal(core.values.PARAM_MOUTH_OPEN_Y, 0.6, '口型参数同样按真实 id 写入')
})

test('lip sync falls back to a real mouth parameter when the standard id is absent', async () => {
  const h = harness()
  const core = {
    values: {},
    _model: { parameters: { ids: ['ParamAngleX', 'param_mouth_open', 'ParamMouthForm'] } },
    setParameterValueById(id, v) { this.values[id] = v },
    getParameterValueById(id) { return this.values[id] ?? 0 },
    getParameterDefaultValueById() { return 0 },
  }
  assert.equal(h.loader.pickLipSyncCoreParam(core, 'ParamMouthOpenY'), 'param_mouth_open')
  const upper = { _model: { parameters: { ids: ['PARAM_MOUTH_OPEN_Y'] } } }
  assert.equal(h.loader.pickLipSyncCoreParam(upper, 'ParamMouthOpenY'), 'PARAM_MOUTH_OPEN_Y')
  const none = { _model: { parameters: { ids: ['ParamAngleX'] } } }
  assert.equal(h.loader.pickLipSyncCoreParam(none, 'ParamMouthOpenY'), null)

  const m = fakeModel(100, 100)
  m.internalModel.coreModel = core
  h.loader.setModelLipSync(m, 'ParamMouthOpenY', 0.4)
  assert.equal(core.values.param_mouth_open, 0.4, '口型应写到模型真实存在的嘴部参数')
  assert.equal(core.values.ParamMouthOpenY, undefined, '不要再写幻影参数')
})

test('a model with only mouth shape never receives audio opening writes, including frame hooks', () => {
  const h = harness(), m = fakeModel(100, 100), writes = [], hooks = {}
  m.internalModel.coreModel = {
    _model: { parameters: { ids: ['ParamMouthForm'], defaultValues: [0], values: [0] } },
    setParameterValueById: (id, value) => writes.push([id, value]),
  }
  m.internalModel.on = (name, fn) => { hooks[name] = fn }
  h.loader.setModelLipSync(m, 'ParamMouthOpenY', 0.7, true)
  hooks.beforeModelUpdate?.()
  h.loader.setModelLipSync(m, 'ParamMouthOpenY', 0, false)
  assert.equal(h.loader.pickLipSyncCoreParam(m.internalModel.coreModel, 'ParamMouthOpenY'), null)
  assert.equal(writes.length, 0)
})

test('model watermark handling can filter the verified credit triangles without hiding the face', () => {
  const h = harness()
  const load = require('./support/settings-loader.cjs')()
  const { prepareModelWatermarkDrawables } = load('renderer/services/live2d/model-watermarks')
  const makeModel = () => {
    const model = fakeModel(100, 100)
    const ids = ['ArtMesh183', 'ArtMesh255', 'WaterMark3', 'ArtMesh50']
    const indices = [Uint16Array.of(0, 1, 2, 3, 4, 5), Uint16Array.of(0, 1, 2)]
    const credits = [0.1, 0.8, 0.11, 0.8, 0.11, 0.81]
    const uv = [Float32Array.of(0.5, 0.5, 0.6, 0.5, 0.6, 0.6, ...credits), Float32Array.from(credits)]
    model.internalModel.coreModel = {
      _model: { drawables: { ids } },
      getDrawableIndex: id => ids.indexOf(id), getDrawableDynamicFlagIsVisible: () => true,
      getDrawableVertexIndices: index => indices[index], getDrawableVertexIndexCount: index => indices[index].length,
      getDrawableVertexUvs: index => uv[index],
    }
    return { model, core: model.internalModel.coreModel }
  }
  const { model, core } = makeModel()
  h.loader.setHiddenDrawables(model, prepareModelWatermarkDrawables(
    model, [], 'uta-live2d-assets-v1:a4496b307bbeec92781ba2098fb0e0078d67e5da517bdf6f4470f4d36b3c16ca',
  ))
  assert.deepEqual([...core.getDrawableVertexIndices(0)], [0, 1, 2])
  assert.equal(core.getDrawableVertexIndexCount(0), 3)
  assert.deepEqual([0, 1, 2, 3].map(core.getDrawableDynamicFlagIsVisible), [true, false, false, true])
  const other = makeModel()
  h.loader.setHiddenDrawables(other.model, prepareModelWatermarkDrawables(other.model, [], 'other-revision'))
  assert.equal(other.core.getDrawableVertexIndexCount(0), 6)
  assert.equal(other.core.getDrawableDynamicFlagIsVisible(1), true)
})

test('native duration is tied to the declared motion or its exact relative file', () => {
  const h = harness()
  const model = fakeModel(100, 100)
  model.internalModel.motionManager = { definitions: {
    Long: [{ File: 'a/same.motion3.json' }], Short: [{ File: 'b/same.motion3.json' }],
  } }
  const files = { 'a/same.motion3.json': { durationMs: 4000 }, 'b/same.motion3.json': { durationMs: 500 } }
  const fromPaths = h.loader.getMotionDetails(model, { motionDetails: files })
  assert.equal(fromPaths['Long#0'].durationMs, 4000)
  assert.equal(fromPaths['Short#0'].durationMs, 500)
  const fromManifest = h.loader.getMotionDetails(model, { motionDetails: files, performance: { metadata: { motions: [
    { group: 'Long', index: 0, json: { Meta: { Duration: 3.5 }, Curves: [{ Target: 'Parameter', Id: 'Head' }] } },
  ] } } })
  assert.equal(fromManifest['Long#0'].durationMs, 3500)
  assert.equal(fromManifest['Long#0'].writes.parameters[0], 'Head')
  assert.equal(fromManifest['Short#0'].durationMs, 500)
})

test('hiddenDrawables hide from the draw pass but keep mask opacity', () => {
  const h = harness()
  const m = fakeModel(100, 100)
  const visibility = new Map()
  const core = {
    _drawableIds: ['ArtMesh246', 'ArtMesh682', 'ArtMesh46'],
    getDrawableIndex(id) { return this._drawableIds.indexOf(id) },
    getDrawableDynamicFlagIsVisible(index) { return visibility.get(index) ?? true },
    getDrawableOpacity() { return 1 },
  }
  m.internalModel.coreModel = core

  h.loader.setHiddenDrawables(m, ['ArtMesh246', 'ArtMesh682'])
  assert.equal(core.getDrawableDynamicFlagIsVisible(0), false)
  assert.equal(core.getDrawableDynamicFlagIsVisible(1), false)
  assert.equal(core.getDrawableDynamicFlagIsVisible(2), true)
  assert.equal(core.getDrawableOpacity(0), 1, '不能改 opacity，蒙版 pass 还要用它裁眼镜')

  h.loader.setHiddenDrawables(m, [])
  assert.equal(core.getDrawableDynamicFlagIsVisible(0), true)
  assert.equal(core.getDrawableDynamicFlagIsVisible(1), true)
})

test('focus mapping writes VTS controller params and keeps default behavior', () => {
  const h = harness()
  const values = {}
  const core = {
    _model: { parameters: { ids: ['ParamEyeBallX', 'ParamEyeBallY', 'ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY'] } },
    setParameterValueById(id, value) { values[id] = value },
    getParameterValueById(id) { return values[id] ?? 0 },
    getParameterDefaultValueById() { return 0 },
    setPartOpacityById() {},
  }
  const m = fakeModel(100, 100)
  m.internalModel.coreModel = core
  m.internalModel.focusController = { x: 0.5, y: 0.25 }
  m.internalModel.updateFocus = () => {}
  h.loader.setBaseParameters(m, {})

  h.loader.setFocusMapping(m, {
    headXParam: 'AngleX', headYParam: 'AngleY', headZParam: 'AngleZ', headScale: 30,
    eyeXParam: 'ParamEyeBallX', eyeYParam: 'ParamEyeBallY', eyeScale: 1, invertEyeX: true,
    bodyXParam: 'PositionX', bodyYParam: 'PositionY', bodyScale: 30,
  })
  m.internalModel.updateFocus()
  assert.equal(values.AngleX, 15)
  assert.equal(values.AngleY, 7.5)
  assert.equal(values.AngleZ, -3.75)
  assert.equal(values.ParamEyeBallX, -0.5)
  assert.equal(values.ParamEyeBallY, 0.25)
  assert.equal(values.PositionX, 15)
  assert.equal(values.PositionY, 7.5)
  assert.equal(values.ParamAngleX, undefined, '有 focus 映射时不再写标准头角度')

  for (const key of Object.keys(values)) delete values[key]
  h.loader.setFocusMapping(m, null)
  m.internalModel.updateFocus()
  assert.equal(values.ParamAngleX, 15)
  assert.equal(values.ParamAngleY, 7.5)
  assert.equal(values.ParamAngleZ, -3.75)
  assert.equal(values.ParamEyeBallX, 0.5)
  assert.equal(values.ParamEyeBallY, 0.25)
  assert.equal(values.ParamBodyAngleX, 5)
})


test('Cubism mask buffer is raised before the first draw', () => {
  const h = harness()
  const m = fakeModel(100, 100)
  const manager = { _clippingMaskBufferSize: 256, _maskTexture: {} }
  m.internalModel.renderer = { _clippingManager: manager }
  h.loader.ensureCubismMaskResolution(m)
  assert.equal(manager._clippingMaskBufferSize, h.loader.CUBISM_MASK_BUFFER_SIZE)
  assert.equal(manager._maskTexture, undefined, '旧蒙版纹理要在首次绘制前丢弃')

  const high = { _clippingMaskBufferSize: 8192, _maskTexture: {} }
  m.internalModel.renderer = { _clippingManager: high }
  h.loader.ensureCubismMaskResolution(m)
  assert.equal(high._clippingMaskBufferSize, 8192, '已更高的配置不回退')
})


test('[FEAT-UNIVERSAL-ONCE] attachMotionPolicy enforces loop policy and supports single-shot play', async () => {
  const h = harness()
  const m = fakeModel(100, 100)
  let loopState = null
  let loopFadeIn = true
  const motionMock = {
    setIsLoop(v) { loopState = v },
    setIsLoopFadeIn(v) { loopFadeIn = v },
    setFinishedMotionHandler(fn) { this._onFinish = fn },
  }
  const manager = {
    groups: { idle: 'Idle' },
    createMotion(data, group) { return motionMock },
    _startMotion(motion, onFinish) { return true },
  }
  m.internalModel.motionManager = manager

  h.loader.attachMotionPolicy(m)
  assert.equal(manager.__motionPolicyAttached, true)

  // 1. Idle group defaults to loop=true
  manager.createMotion({}, 'Idle')
  assert.equal(loopState, true, 'Idle group should loop by default')
  assert.equal(loopFadeIn, false, '循环不能每一轮重新淡入底层姿态')

  // 2. Non-idle group defaults to loop=false
  manager.createMotion({}, 'FingerOut')
  assert.equal(loopState, false, 'Non-idle motion should be single-shot by default')

  // 3. Explicit playMotion with loop: true forces loop=true
  await h.loader.playMotion(m, 'FingerOut', 0, { loop: true })
  manager.createMotion({}, 'FingerOut')
  assert.equal(loopState, true, 'playMotion with loop: true should force setIsLoop(true)')

  // 4. Explicit playMotion with loop: false forces loop=false even on Idle
  await h.loader.playMotion(m, 'Idle', 0, { loop: false })
  manager.createMotion({}, 'Idle')
  assert.equal(loopState, false, 'playMotion with loop: false should force setIsLoop(false)')

  loopFadeIn = true
  await h.loader.playMotion(m, 'FingerOut', 0, { loop: true })
  manager._startMotion(motionMock, () => {})
  assert.equal(loopState, true)
  assert.equal(loopFadeIn, false, '缓存原生动作也必须关闭逐轮淡入')
})
