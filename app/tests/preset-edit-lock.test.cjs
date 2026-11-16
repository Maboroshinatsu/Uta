'use strict'
// 工坊编辑锁：真实加载 usePresetController，验证外部预设入口在锁定时无副作用，
// 解锁后正常，工坊主动预览与手动控件/滑杆编辑仍然可用。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

function transpile(relativePath) {
  return ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
}

function loadModule(relativePath, requireMap = {}) {
  const mod = { exports: {} }
  vm.runInNewContext(transpile(relativePath), {
    module: mod,
    exports: mod.exports,
    console,
    require: (id) => requireMap[id] ?? (id === '../../../shared/native-motion'
      ? require('./support/settings-loader.cjs')()('shared/native-motion') : {}),
  })
  return mod.exports
}

/** 假计时器：控制器只依赖 setTimeout/clearTimeout，用 pending 数量断言锁中是否被取消/重启 */
function createTimers() {
  let nextId = 1
  const pending = new Map()
  return {
    setTimeout(fn, ms) {
      const id = nextId++
      pending.set(id, { fn, ms })
      return id
    },
    clearTimeout(id) {
      pending.delete(id)
    },
    count() {
      return pending.size
    },
    nextDelay() {
      return pending.values().next().value?.ms
    },
    fireNext() {
      const id = [...pending.keys()][0]
      if (id === undefined) return 0
      const task = pending.get(id)
      pending.delete(id)
      task.fn()
      return 1
    },
    fireAll() {
      const due = [...pending.values()]
      pending.clear()
      for (const task of due) task.fn()
      return due.length
    },
  }
}

// 真实依赖：情绪/预设解析与序列时序都走生产实现，只替换舞台侧 store 与 Live2D 落地函数
const emotionAdapter = loadModule('src/renderer/services/live2d/emotion-adapter.ts')
const presetSequence = loadModule('src/renderer/services/preset-sequence.ts', {
  './live2d/emotion-adapter': emotionAdapter,
})
const motionPriority = loadModule('src/renderer/composables/useMotionPriority.ts', {
  '@/stores/deskpet': { useDeskpetStore: () => ({}) },
  '@/services/live2d/loader': {
    onMotionFinish: () => () => {},
    playMotion: async () => true,
  },
})

function loadControllerModule(store, loader, timers) {
  const mod = { exports: {} }
  vm.runInNewContext(transpile('src/renderer/composables/usePresetController.ts'), {
    module: mod,
    exports: mod.exports,
    console,
    require: (id) => {
      if (id === '@/services/live2d/dafish-happy-performance') return require('./support/settings-loader.cjs')()('renderer/services/live2d/dafish-happy-performance')
      if (id === '@/stores/deskpet') return { useDeskpetStore: () => store }
      if (id === '@/services/live2d/loader') return loader
      if (id === '@/services/live2d/emotion-adapter') return emotionAdapter
      if (id === '@/composables/useMotionPriority') return motionPriority
      if (id === '@/services/preset-sequence') return presetSequence
      if (id === '@/services/host/contracts') return {}
      if (id === '../../shared/native-motion') return require('./support/settings-loader.cjs')()('shared/native-motion')
      throw new Error(`unexpected require: ${id}`)
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    window: { setTimeout: timers.setTimeout },
  })
  return mod.exports
}

function createPresets() {
  return [
    {
      id: 'happy-fresh',
      label: '开心·元气wink',
      description: '',
      emotion: 'happy',
      group: '开心',
      controls: ['ctrl-smile'],
      parameters: { ParamAngleX: 12 },
      finishMode: 'hold',
    },
    {
      id: 'happy-peek',
      label: '开心·偷看',
      description: '',
      emotion: 'happy',
      group: '开心',
      controls: ['ctrl-wink'],
      parameters: { ParamAngleX: -8 },
      finishMode: 'hold',
    },
    {
      id: 'think',
      label: '思考',
      description: '',
      emotion: 'thinking',
      group: '思考',
      controls: [],
      parameters: { ParamAngleX: 5 },
      finishMode: 'hold',
    },
    {
      id: 'neutral',
      label: '日常待机',
      description: '',
      emotion: 'neutral',
      group: '日常待机',
      controls: [],
      parameters: {},
      finishMode: 'hold',
    },
    {
      id: 'eye-glance',
      label: '眼球偷看',
      description: '',
      emotion: 'neutral',
      group: '视线让位测试',
      controls: [],
      parameters: { ParamEyeBallX: -0.6, ParamEyeBallY: 0.2 },
      finishMode: 'hold',
    },
  ]
}

function createHarness({ locked = false } = {}) {
  const timers = createTimers()
  const calls = {
    layers: [],
    focus: [],
    gaze: [],
    reports: 0,
    motions: [],
    idle: 0,
    released: [],
    endPreview: 0,
  }
  const store = {
    presetEditingLocked: locked,
    presetPreviewActive: false,
    activeRunningPresetId: 'neutral',
    get presetSequenceActive() {
      return presetSequence.isPresetSequenceActive(this.activeRunningPresetId, this.activeHoldPresetId)
    },
    activeHoldPresetId: '',
    agentWorkingState: 'idle',
    currentEmotion: 'neutral',
    emotionPulse: 0,
    live2dModel: { id: 'mock-model' },
    emotionAdapter: null,
    modelCapabilities: {
      parameters: [
        { id: 'ParamAngleX', default: 0 },
        { id: 'ParamEyeLOpen', default: 1 },
      ],
      parts: [],
      motionGroups: {},
    },
    modelControls: [
      {
        id: 'ctrl-smile',
        label: '微笑',
        category: 'expression',
        active: false,
        defaultActive: false,
        parameters: { ParamEyeLOpen: 0.8 },
        hiddenParts: [],
        shownParts: [],
      },
      {
        id: 'ctrl-wink',
        label: '眨眼',
        category: 'expression',
        active: false,
        defaultActive: false,
        parameters: { ParamEyeLOpen: 0.2 },
        hiddenParts: [],
        shownParts: [],
      },
    ],
    modelSliders: [
      {
        id: 'ParamAngleX',
        label: '头部左右',
        group: 'pose',
        min: -30,
        max: 30,
        step: 1,
        defaultValue: 0,
        value: 0,
      },
    ],
    modelEmotions: ['neutral', 'happy', 'thinking', 'shy'],
    statePresets: createPresets(),
    beginPresetPreview() {
      this.presetPreviewActive = true
    },
    endPresetPreview() {
      calls.endPreview += 1
      this.presetPreviewActive = false
    },
  }
  const loader = {
    getModelParameterBlendMode: (_model, id) => {
      const mapping = require('./support/settings-loader.cjs')()('renderer/services/live2d/focus-mapping')
      return mapping.parameterBlendMode(id, mapping.resolveParameterBlendModes(
        store.modelCapabilities.parameters.map(p => p.id), store.modelCapabilities.focusMapping))
    },
    setControlLayer: (model, layer, options) => {
      calls.layers.push({ model, layer, options })
    },
    setFocusWeight: (model, weight, options) => {
      calls.focus.push({ model, weight, options })
    },
    setPresetMotionOwnership: (model, active) => { model.motionOwned = active },
    setSequenceGazeOverride: (model, active) => {
      calls.gaze.push({ model, active })
    },
    releaseParameterIds: (model, ids) => {
      calls.released.push([...ids])
    },
    clearExpression: () => {},
    resetTransientParametersToHome: () => {},
    applyParameters: () => {},
  }
  const controllerModule = loadControllerModule(store, loader, timers)
  const controller = controllerModule.usePresetController({
    getBaseHiddenParts: () => [],
    playMotionWithPriority: (group, layer, index, options) => {
      calls.motions.push({ group, layer, index, options })
      return true
    },
    notifyIdleInteraction: () => {
      calls.idle += 1
    },
    reportControlsAndPresetsToHost: () => {
      calls.reports += 1
    },
    isLive2dAvailable: () => true,
  })
  return { controller, store, calls, timers }
}

test('a custom looping neutral owns motion while a settled pose releases idle without losing its pose', () => {
  const h = createHarness()
  const neutral = { id: 'neutral', label: '日常待机', emotion: 'neutral', controls: [], motion: 'none', finishMode: 'loop',
    steps: [{ durationMs: 200, holdMs: 0, controls: [], parameters: { ParamAngleX: 8 } },
      { durationMs: 200, holdMs: 0, controls: [], parameters: { ParamAngleX: 0 } }] }
  h.store.statePresets = [neutral]
  h.controller.revertToActiveHoldPreset(0)
  for (let i = 0; i < 8; i++) assert.equal(h.timers.fireNext(), 1)
  assert.equal(h.store.live2dModel.motionOwned, true)
  h.controller.applyPresetByEntry({ ...neutral, finishMode: 'hold', steps: [neutral.steps[0]] })
  for (let i = 0; i < 8 && h.timers.fireNext(); i++) {}
  assert.equal(h.store.live2dModel.motionOwned, false, 'settled parameter layers must not keep SDK idle blocked')
  assert.equal(h.store.modelSliders[0].value, 8, 'the final authored pose stays in the control layer')
  h.controller.applyPresetByEntry({ ...neutral, finishMode: 'hold', steps: [{ durationMs: 200, holdMs: 0, controls: [], parameters: {} }] })
  for (let i = 0; i < 8 && h.timers.fireNext(); i++) {}
  assert.equal(h.store.live2dModel.motionOwned, false)
})

test('a multi-step hold idle releases native idle only after its complete timeline, including on restore', () => {
  const h = createHarness()
  const neutral = { id: 'neutral', label: '日常待机·从容微甜', emotion: 'neutral', group: '日常',
    controls: [], motion: 'none', finishMode: 'hold',
    steps: [{ durationMs: 600, holdMs: 0, controls: [], parameters: { ParamAngleX: 2 } },
      { durationMs: 600, holdMs: 0, controls: [], parameters: { ParamAngleX: -1.5 } },
      { durationMs: 1000, holdMs: 0, controls: [], parameters: { ParamAngleX: 0 } }] }
  h.store.statePresets = [neutral]
  h.controller.handlePresetTrigger(neutral)
  assert.equal(h.store.live2dModel.motionOwned, true)
  for (let i = 0; i < 2; i++) {
    h.timers.fireNext()
    assert.equal(h.store.live2dModel.motionOwned, true, 'all intermediate steps remain exclusive')
  }
  h.timers.fireNext()
  assert.equal(h.store.live2dModel.motionOwned, false)
  assert.equal(h.store.modelSliders[0].value, 0)
  h.controller.handlePresetTrigger({ id: 'reaction', label: '临时动作', controls: [], motion: 'none',
    parameters: { ParamAngleX: 9 }, finishMode: 'revert', revertHoldMs: 0 })
  for (let i = 0; i < 12 && h.timers.count(); i++) h.timers.fireNext()
  assert.equal(h.store.activeRunningPresetId, 'neutral')
  assert.equal(h.store.live2dModel.motionOwned, false, 'restoring the default idle cannot permanently own the SDK')
  assert.equal(h.store.modelSliders[0].value, 0)
  assert.equal(h.timers.count(), 0)
})

test('a temporary preset restores the pinned native motion through the complete hold playback path', () => {
  const h = createHarness()
  const pinned = { id: 'native-hold', label: '原生常驻', emotion: 'neutral', controls: [], parameters: {},
    motion: { group: 'Wave', index: 0 }, finishMode: 'revert' }
  h.store.modelCapabilities.motionGroups.Wave = 1
  h.store.statePresets.push(pinned)
  h.store.activeHoldPresetId = pinned.id
  h.controller.handlePresetTrigger(pinned, 'hold')
  h.calls.motions.at(-1).options.onStart(true)
  h.controller.handlePresetTrigger('think', 'revert')
  let startedRestoration = false
  for (let i = 0; i < 12 && h.timers.count(); i++) {
    h.timers.fireNext()
    if (!startedRestoration && h.calls.motions.filter(call => call.group === 'Wave').length === 2) {
      startedRestoration = true
      h.calls.motions.at(-1).options.onStart(true)
    }
  }
  assert.equal(h.store.activeRunningPresetId, pinned.id)
  const resumed = h.calls.motions.filter(call => call.group === 'Wave')
  assert.equal(resumed.length, 2, 'native motion must actually restart after the temporary action')
  assert.equal(resumed[1].options.loop, true, 'restore the pinned hold behavior, not its saved revert mode')
  assert.equal(h.store.modelSliders[0].value, 0, 'temporary pose is released')
  assert.equal(h.timers.count(), 0, 'restoration must not recursively schedule another revert')
})

test('temporary outfit stages render without overwriting the user stage on stop or completion', () => {
  const h = createHarness()
  const skirt = { id: 'skirt', label: '裙装', category: 'outfit', active: true, defaultActive: false,
    currentStageIndex: 0, defaultStageIndex: 0, parameters: { Cloth: 1 }, hiddenParts: [],
    stages: [{ label: '长', parameters: { Cloth: 1 } }, { label: '短', parameters: { Cloth: 2 } }] }
  h.store.modelControls.push(skirt)
  const preset = { id: 'temporary', label: '短裙', emotion: 'neutral', group: '会话动作',
    steps: [{ durationMs: 200, holdMs: 0, controls: ['skirt:1'], parameters: {} }], finishMode: 'revert', revertHoldMs: 0 }
  const results = []
  for (const stop of [true, false]) {
    assert.equal(h.controller.handlePresetTrigger(preset, 'revert', status => results.push(status)), true)
    assert.equal(h.calls.layers.at(-1).layer.parameters.Cloth, 2)
    assert.equal(skirt.currentStageIndex, 0)
    if (stop) assert.equal(h.controller.stopSequence(preset.id), true)
    for (let i = 0; i < 10 && h.timers.count(); i++) h.timers.fireNext()
    assert.equal(skirt.active, true)
    assert.equal(skirt.parameters.Cloth, 1)
    assert.equal(h.calls.layers.at(-1).layer.parameters.Cloth, 1)
  }
  assert.deepEqual(results, ['interrupted', 'completed'])
})

test('a host native preset waits for startup and natural finish, and reports launch failure', () => {
  const h = createHarness()
  h.store.modelCapabilities.motionGroups.Wave = 1
  const preset = { id: 'native-job', label: '挥手', group: '会话动作', emotion: 'neutral',
    motion: { group: 'Wave', index: 0 }, controls: [], parameters: {},
    steps: [{ durationMs: 200, holdMs: 0, controls: [], parameters: {} }], finishMode: 'revert', revertHoldMs: 0 }
  const states = []
  assert.equal(h.controller.handlePresetTrigger(preset, 'revert', state => states.push(state), () => states.push('started')), true)
  let callbacks = h.calls.motions.at(-1).options
  assert.deepEqual(states, [])
  callbacks.onStart(false)
  assert.deepEqual(states, ['failed'])
  for (let i = 0; i < 10 && h.timers.count(); i++) h.timers.fireNext()
  assert.equal(h.controller.handlePresetTrigger(preset, 'revert', state => states.push(state), () => states.push('started')), true)
  callbacks = h.calls.motions.at(-1).options
  callbacks.onStart(true)
  h.timers.fireNext()
  h.timers.fireNext()
  assert.deepEqual(states, ['failed', 'started'])
  callbacks.onFinish()
  assert.deepEqual(states, ['failed', 'started', 'completed'])
})

test('returning to an emotion-only hold restores the emotion and stale generations cannot reclaim it', () => {
  const h = createHarness()
  const pinned = { id: 'emotion-hold', label: '害羞常驻', emotion: 'shy', controls: [], parameters: {}, motion: 'none' }
  h.store.statePresets.push(pinned)
  h.store.activeHoldPresetId = pinned.id
  h.controller.handlePresetTrigger('think', 'revert')
  const stale = h.controller.cancelPresetSequence(true)
  h.controller.revertToActiveHoldPreset(stale)
  assert.equal(h.store.currentEmotion, 'shy')
  assert.equal(h.store.activeRunningPresetId, pinned.id)
  h.controller.handlePresetTrigger('happy-fresh', 'hold')
  h.controller.revertToActiveHoldPreset(stale)
  assert.equal(h.store.activeRunningPresetId, 'happy-fresh', 'an older return must not interrupt a new preset')
})

test('a step-bound motion in the hold preset is restarted, and deleted holds fall back to neutral', () => {
  const h = createHarness()
  const pinned = { id: 'step-hold', label: '分镜常驻', emotion: 'neutral', controls: [], parameters: {},
    steps: [{ durationMs: 100, holdMs: 0, controls: [], parameters: {}, motion: { group: 'Wave', index: 0 } }] }
  h.store.modelCapabilities.motionGroups.Wave = 1
  h.store.statePresets.push(pinned)
  h.store.activeHoldPresetId = pinned.id
  h.controller.handlePresetTrigger('think', 'revert')
  for (let i = 0; i < 12 && h.timers.count(); i++) h.timers.fireNext()
  assert.equal(h.calls.motions.at(-1).group, 'Wave')
  h.store.statePresets = h.store.statePresets.filter(p => p.id !== pinned.id)
  h.controller.handlePresetTrigger('think', 'revert')
  for (let i = 0; i < 12 && h.timers.count(); i++) h.timers.fireNext()
  assert.equal(h.store.activeRunningPresetId, 'neutral')
  assert.equal(h.store.modelSliders[0].value, 0)
})

function snapshot(harness) {
  return {
    activeRunningPresetId: harness.store.activeRunningPresetId,
    currentEmotion: harness.store.currentEmotion,
    emotionPulse: harness.store.emotionPulse,
    controls: harness.store.modelControls.map((c) => [c.id, c.active]),
    sliders: harness.store.modelSliders.map((s) => [s.id, s.value]),
    timers: harness.timers.count(),
    previewActive: harness.store.presetPreviewActive,
    endPreviewCalls: harness.calls.endPreview,
    layers: harness.calls.layers.length,
    focus: harness.calls.focus.length,
    reports: harness.calls.reports,
    motions: harness.calls.motions.length,
    idleInteractions: harness.calls.idle,
    released: harness.calls.released.length,
  }
}

test('编辑锁定时精确预设、分组与情绪 fallback 全部拒绝且无副作用', () => {
  const harness = createHarness({ locked: true })
  harness.store.presetPreviewActive = true
  const before = snapshot(harness)

  assert.equal(harness.controller.triggerPresetOrGroup('happy-fresh'), false)
  assert.equal(harness.controller.triggerPresetOrGroup('开心'), false)
  assert.equal(harness.controller.triggerPresetOrGroup('shy'), false)

  assert.deepEqual(snapshot(harness), before)
  assert.equal(harness.store.presetPreviewActive, true, '锁中外部触发不得结束工坊预览')
})

test('编辑锁定时控件 preset/精确 set 与 handlePresetTrigger 不改变舞台', () => {
  const harness = createHarness({ locked: true })
  harness.store.presetPreviewActive = true
  const before = snapshot(harness)

  assert.equal(harness.controller.handleControlAction('happy-fresh', 'preset'), false)
  assert.equal(harness.controller.handleControlAction('开心·元气wink', 'set'), false)
  assert.equal(harness.controller.handlePresetTrigger('happy-fresh'), false)
  assert.equal(harness.controller.applyPresetByEntry(harness.store.statePresets[0]), false)

  assert.deepEqual(snapshot(harness), before)
})

test('编辑锁定不会取消或重启在途预设计时器', () => {
  const harness = createHarness()
  assert.equal(harness.controller.triggerPresetOrGroup('happy-fresh'), true)
  assert.equal(harness.timers.count(), 1)
  const layerCalls = harness.calls.layers.length
  const focusCalls = harness.calls.focus.length

  harness.store.presetEditingLocked = true
  assert.equal(harness.controller.triggerPresetOrGroup('开心'), false)
  assert.equal(harness.controller.handleControlAction('happy-peek', 'preset'), false)
  assert.equal(harness.controller.handleControlAction('开心·偷看', 'set'), false)
  assert.equal(harness.controller.handlePresetTrigger('happy-peek'), false)
  assert.equal(harness.controller.applyPresetByEntry(harness.store.statePresets[1]), false)

  assert.equal(harness.timers.count(), 1)
  assert.equal(harness.calls.layers.length, layerCalls)
  assert.equal(harness.calls.focus.length, focusCalls)
  assert.equal(harness.store.activeRunningPresetId, 'happy-fresh')
})

test('编辑锁定时未命中控件的普通动作回退预设不产生任何副作用', () => {
  const harness = createHarness()
  assert.equal(harness.controller.triggerPresetOrGroup('happy-fresh'), true)
  assert.equal(harness.timers.count(), 1)
  harness.store.presetPreviewActive = true
  const before = snapshot(harness)

  harness.store.presetEditingLocked = true
  assert.equal(harness.controller.handleControlAction('happy-peek', 'toggle'), false)
  assert.equal(harness.controller.handleControlAction('happy-peek', 'on'), false)

  assert.deepEqual(snapshot(harness), before)
  assert.equal(harness.timers.count(), 1, '锁中 fallback 不得取消在途计时器')
  assert.equal(harness.store.activeRunningPresetId, 'happy-fresh')
  assert.equal(harness.store.presetPreviewActive, true, '锁中 fallback 不得结束工坊预览')
})

test('解除编辑锁后外部预设入口恢复正常', () => {
  const harness = createHarness({ locked: true })
  assert.equal(harness.controller.triggerPresetOrGroup('happy-fresh'), false)
  assert.equal(harness.store.activeRunningPresetId, 'neutral')
  assert.equal(harness.timers.count(), 0)

  harness.store.presetEditingLocked = false
  assert.equal(harness.controller.triggerPresetOrGroup('happy-fresh'), true)
  assert.equal(harness.store.activeRunningPresetId, 'happy-fresh')
  assert.equal(harness.store.modelSliders[0].value, 12)
  assert.equal(harness.timers.count(), 1)
})

test('无锁时精确预设正常应用并启动计时器', () => {
  const harness = createHarness()
  assert.equal(harness.controller.triggerPresetOrGroup('happy-fresh'), true)

  assert.equal(harness.store.activeRunningPresetId, 'happy-fresh')
  assert.equal(harness.store.modelSliders[0].value, 12)
  assert.equal(harness.store.modelControls.find((c) => c.id === 'ctrl-smile').active, true)
  assert.equal(harness.store.modelControls.find((c) => c.id === 'ctrl-wink').active, false)
  assert.equal(harness.timers.count(), 1)
  assert.ok(harness.calls.layers.length > 0, '应落地控件/滑杆层')
  assert.ok(harness.calls.reports > 0, '应同步宿主')
  assert.ok(
    harness.calls.focus.some((call) => call.weight === 0),
    '播放期间由预设主导眼神与头部指向，鼠标偏移必须暂时压住',
  )
  assert.equal(harness.calls.gaze.at(-1).active, true, '同时置视线让位标志')
})

test('自定义眼球通道在表演锁定时按本模型映射归中', () => {
  const h = createHarness()
  h.store.modelCapabilities.parameters.push({ id: 'PupilHorizontal', default: 0 })
  h.store.modelCapabilities.focusMapping = { eyeXParam: 'PupilHorizontal' }
  h.store.modelSliders.push({ id: 'PupilHorizontal', defaultValue: 0, value: 0 })
  h.controller.applyPresetByEntry(h.store.statePresets[0])
  assert.equal(h.calls.layers.at(-1).layer.parameters.PupilHorizontal, 0)
})

test('无锁时未命中控件的普通动作仍可回退到预设', () => {
  const harness = createHarness()
  assert.equal(harness.controller.handleControlAction('happy-peek', 'toggle'), true)
  assert.equal(harness.store.activeRunningPresetId, 'happy-peek')
  assert.equal(harness.store.modelSliders[0].value, -8)
  assert.equal(harness.store.modelControls.find((c) => c.id === 'ctrl-wink').active, true)
  assert.equal(harness.timers.count(), 1)
})

test('无锁时分组随机与情绪 fallback 正常生效', () => {
  const groupHarness = createHarness()
  assert.equal(groupHarness.controller.triggerPresetOrGroup('开心'), true)
  assert.ok(
    ['happy-fresh', 'happy-peek'].includes(groupHarness.store.activeRunningPresetId),
    '分组应命中组内变体',
  )

  const emotionHarness = createHarness()
  assert.equal(emotionHarness.controller.triggerPresetOrGroup('shy'), true)
  assert.equal(emotionHarness.store.currentEmotion, 'shy')
  assert.equal(emotionHarness.store.emotionPulse, 1)
  assert.equal(emotionHarness.timers.count(), 0)
})

test('无锁时 handleControlAction 的 preset 与精确 set 正常应用', () => {
  const presetHarness = createHarness()
  assert.equal(presetHarness.controller.handleControlAction('happy-fresh', 'preset'), true)
  assert.equal(presetHarness.store.activeRunningPresetId, 'happy-fresh')
  assert.equal(presetHarness.store.modelSliders[0].value, 12)

  const setHarness = createHarness()
  assert.equal(setHarness.controller.handleControlAction('开心·偷看', 'set'), true)
  assert.equal(setHarness.store.activeRunningPresetId, 'happy-peek')
  assert.equal(setHarness.store.modelSliders[0].value, -8)
  assert.equal(setHarness.store.modelControls.find((c) => c.id === 'ctrl-wink').active, true)
})

test('编辑锁定时手动控件与滑杆编辑仍然可用', () => {
  const harness = createHarness({ locked: true })
  assert.equal(harness.controller.handleControlAction('微笑', 'toggle'), true)
  assert.equal(harness.store.modelControls.find((c) => c.id === 'ctrl-smile').active, true)
  assert.ok(harness.calls.layers.length > 0, '手动控件应落地到模型')

  harness.store.modelSliders[0].value = 9
  const layersBefore = harness.calls.layers.length
  harness.controller.syncSlidersFromWorkshop(120)
  assert.equal(harness.calls.layers.length, layersBefore + 1)
  assert.equal(harness.calls.layers.at(-1).layer.parameters.ParamAngleX, 9)
  assert.equal(
    harness.store.modelControls.find((c) => c.id === 'ctrl-smile').active,
    true,
    '滑杆同步不得清掉用户手动开启的控件',
  )
})

test('编辑锁定时手动 set 控件仍然可用', () => {
  const harness = createHarness({ locked: true })
  assert.equal(harness.controller.handleControlAction('微笑', 'set'), true)
  assert.equal(harness.store.modelControls.find((c) => c.id === 'ctrl-smile').active, true)
  assert.ok(harness.calls.layers.length > 0, '手动 set 应落地到模型')
})

test('手动 reset 在锁内外保持原视线顺序', () => {
  const lockedHarness = createHarness({ locked: true })
  lockedHarness.store.modelSliders[0].value = 7
  lockedHarness.store.activeRunningPresetId = 'happy-fresh'
  lockedHarness.store.modelControls[0].active = true
  assert.equal(lockedHarness.controller.handleControlAction('', 'reset'), true)
  assert.equal(lockedHarness.store.activeRunningPresetId, 'neutral')
  assert.equal(lockedHarness.store.modelSliders[0].value, 0)
  assert.equal(
    lockedHarness.store.modelControls.every((c) => c.active === c.defaultActive),
    true,
  )
  assert.equal(lockedHarness.calls.focus.at(-1).weight, 0, '锁定 reset 应保持视线归中')

  const unlockedHarness = createHarness()
  unlockedHarness.store.modelSliders[0].value = 7
  assert.equal(unlockedHarness.controller.handleControlAction('', 'reset'), true)
  assert.equal(unlockedHarness.store.modelSliders[0].value, 0)
  assert.equal(
    unlockedHarness.calls.focus.at(-1).weight,
    1,
    '未锁 reset 取消序列后应恢复视线',
  )
})

test('回到日常待机会清理工坊临时部件并保留常驻服装', () => {
  const harness = createHarness()
  harness.store.modelControls[0].active = true
  harness.store.modelControls.push({
    id: 'ctrl-outfit',
    label: '外套',
    category: 'outfit',
    active: true,
    defaultActive: true,
    parameters: {},
    hiddenParts: [],
    shownParts: [],
  })

  assert.equal(harness.controller.triggerPresetOrGroup('neutral'), true)
  assert.equal(harness.store.modelControls[0].active, false, '临时表情特效应回默认')
  assert.equal(harness.store.modelControls.at(-1).active, true, '常驻服装不应被待机清掉')
  assert.ok(harness.calls.layers.length > 0)
})

test('用户保持的部件在预设步骤中保留，后续动作不会把它关掉', () => {
  const harness = createHarness()
  const wink = harness.store.modelControls.find((c) => c.id === 'ctrl-wink')
  wink.parameters = { ParamAngleZ: 1 }
  wink.active = true
  wink.held = true

  assert.equal(harness.controller.triggerPresetOrGroup('happy-fresh'), true)
  assert.equal(
    harness.store.modelControls.find((c) => c.id === 'ctrl-smile').active,
    true,
    '预设自己的部件照常开启',
  )
  assert.equal(wink.active, true, '用户保持的部件不能被预设步骤清掉')
  assert.equal(wink.held, true, '保持标记也应保留到后续动作')

  assert.equal(harness.controller.triggerPresetOrGroup('neutral'), true)
  assert.equal(wink.active, true, '回到日常待机同样不关闭保持部件')
})

test('保持部件与预设互斥时以用户选择为准', () => {
  const harness = createHarness()
  const wink = harness.store.modelControls.find((c) => c.id === 'ctrl-wink')
  wink.active = true
  wink.held = true

  assert.equal(harness.controller.triggerPresetOrGroup('happy-fresh'), true)
  assert.equal(wink.active, true, '互斥时保持部件仍然开启')
  assert.equal(
    harness.store.modelControls.find((c) => c.id === 'ctrl-smile').active,
    false,
    '冲突的预设部件让位给用户保持',
  )
})

test('关闭工坊时清理临时部件；有常驻预设时保留', () => {
  const open = createHarness()
  open.store.modelControls[0].active = true
  open.store.presetEditingLocked = true
  const beforeLayers = open.calls.layers.length
  open.controller.handleSettingsPanelClosed()
  assert.equal(open.store.modelControls[0].active, false)
  assert.ok(open.calls.layers.length > beforeLayers)

  const pinned = createHarness()
  pinned.store.modelControls[0].active = true
  pinned.store.activeHoldPresetId = 'happy-fresh'
  pinned.store.presetEditingLocked = true
  pinned.controller.handleSettingsPanelClosed()
  assert.equal(pinned.store.modelControls[0].active, true, '常驻预设相关的部件不随关窗清掉')
})

test('编辑锁定时工坊步预览与主动序列预览仍可用', () => {
  const harness = createHarness({ locked: true })
  harness.controller.previewPresetStepOnModel({
    durationMs: 240,
    holdMs: 0,
    controls: ['ctrl-wink'],
    parameters: { ParamAngleX: 18 },
  })
  assert.equal(harness.store.modelSliders[0].value, 18)
  assert.equal(harness.store.modelControls.find((c) => c.id === 'ctrl-wink').active, true)
  assert.ok(harness.calls.layers.length > 0, '步预览应落地到模型')
  assert.equal(harness.store.presetEditingLocked, true)

  // SettingsPanel 的整段序列预览：先显式解锁，再带 preview 标记触发
  harness.store.presetEditingLocked = false
  harness.store.beginPresetPreview()
  const previewPreset = {
    ...harness.store.statePresets[0],
    id: 'workshop-preview',
    label: '工坊预览',
    preview: true,
  }
  assert.equal(harness.controller.handlePresetTrigger(previewPreset, 'hold'), true)
  assert.equal(harness.store.activeRunningPresetId, 'workshop-preview')
  assert.equal(harness.store.presetPreviewActive, true)
  assert.equal(harness.calls.endPreview, 0)
  assert.equal(harness.timers.count(), 1)
})

test('[FIX-IDLE-PRESET-PREEMPTION] 控件动作终止序列后活动预设必须写回终值', () => {
  const harness = createHarness()
  assert.equal(harness.controller.triggerPresetOrGroup('happy-fresh'), true)
  assert.equal(presetSequence.isPresetSequenceActive(harness.store.activeRunningPresetId, harness.store.activeHoldPresetId), true)

  // 快捷面板「保持部件」走的控件路径：以前它只 bump 令牌、不复位活动 id，
  // 于是推导出来的「正在播放」永久为真，空闲小动作与悬停反应再也不来。
  harness.controller.handleControlAction('ctrl-smile', 'set')

  assert.equal(harness.store.activeRunningPresetId, 'neutral', '控件动作后活动预设应回到终值')
  assert.equal(harness.store.presetSequenceActive, false, '闸门应重新放行空闲表现')
})

test('[FIX-IDLE-PRESET-PREEMPTION] hold 型预设演完后闸门自行解除', () => {
  const harness = createHarness()
  assert.equal(harness.controller.applyPresetByEntry(harness.store.statePresets[0]), true)
  assert.equal(harness.store.presetSequenceActive, true)

  // statePresets[0] 默认 finishMode='hold' → 走 settle 收尾，不经过 revert
  const fired = harness.timers.fireAll()
  assert.ok(fired > 0, '应有待执行的收尾定时器')

  assert.equal(harness.store.activeRunningPresetId, 'neutral', 'settle 收尾后活动预设应回到终值')
  assert.equal(harness.store.presetSequenceActive, false, 'settle 收尾后空闲必须恢复')
})

test('重播已钉为常驻的预设仍会被判成「没在播放」（已知局限，显式序列位待收敛）', () => {
  const harness = createHarness()
  harness.store.activeHoldPresetId = 'happy-fresh'
  harness.store.activeRunningPresetId = 'happy-fresh'
  assert.equal(harness.store.presetSequenceActive, false)
})

test('收尾交回鼠标跟随使用长缓动，不再静止后猛切', () => {
  const harness = createHarness()
  assert.equal(harness.controller.triggerPresetOrGroup('happy-fresh'), true)
  harness.timers.fireAll()
  const back = harness.calls.focus.filter((call) => call.weight === 1).at(-1)
  assert.ok(back, '收尾应把视线权重交回鼠标跟随')
  assert.ok(back.options.transitionMs >= 500, `收尾缓动应至少 500ms，实际 ${back.options.transitionMs}ms`)
  assert.equal(harness.calls.gaze.at(-1).active, false, '收尾必须解除让位标志')
})

test('[FIX-GAZE-HANDOFF-AT-MOTION-END] 回退型预设演完即开始交回视线，不等姿态保持结束', () => {
  const harness = createHarness()
  assert.equal(harness.controller.applyPresetByEntry(harness.store.statePresets[0], 'revert'), true)
  const before = harness.calls.focus.length
  assert.ok(harness.timers.fireNext() === 1, '应存在“演完”这一拍的定时器')

  const back = harness.calls.focus.slice(before).find((call) => call.weight === 1)
  assert.ok(back, '动作放完就应开始把视线交回鼠标跟随，而不是等姿态保持结束')
  assert.ok(back.options.transitionMs >= 500, `交回仍需慢过渡，实际 ${back.options.transitionMs}ms`)
  assert.equal(harness.calls.gaze.at(-1).active, false, '让位标志在演完当拍就解除')
})

test('[FIX-GAZE-EARLY-HANDOFF] 多步预设在最后一步开始就交回视线，不等整段演完', () => {
  const harness = createHarness()
  const multiStep = {
    ...harness.store.statePresets[0],
    id: 'multi-happy',
    label: '多步开心',
    finishMode: 'revert',
    steps: [
      { label: '起手', durationMs: 400, holdMs: 400, controls: [], parameters: { ParamAngleX: 8 } },
      { label: '收尾', durationMs: 400, holdMs: 400, controls: [], parameters: { ParamAngleX: 3 } },
    ],
  }
  assert.equal(harness.controller.applyPresetByEntry(multiStep), true)

  // 播放开始时视线是被压住的
  assert.ok(harness.calls.focus.some((call) => call.weight === 0), '起手时应锁住视线')
  const beforeHandoff = harness.calls.focus.filter((call) => call.weight === 1).length

  // 只推进到「最后一步开始」这一拍，尚未走到演完
  assert.ok(harness.timers.count() >= 1, '多步预设应有分步定时器')
  harness.timers.fireNext()
  assert.ok(
    harness.calls.focus.filter((call) => call.weight === 1).length > beforeHandoff,
    '进入最后一步时就应开始把视线交回鼠标跟随',
  )
})

test('空名称分组在单步预览和分镜播放中保持原生动作绑定', () => {
  const h = createHarness()
  const step = { durationMs: 400, holdMs: 0, controls: [], parameters: {}, motion: { group: '', index: 1 } }
  h.controller.previewPresetStepOnModel(step)
  assert.equal(h.calls.motions.at(-1).group, '')
  assert.equal(h.calls.motions.at(-1).index, 1)
  h.calls.motions.length = 0
  h.controller.applyPresetByEntry({ id: 'native-step', label: '分镜', emotion: 'neutral', motion: 'none', controls: [],
    steps: [step, { ...step, motion: undefined }], finishMode: 'hold' })
  assert.equal(h.calls.motions.length, 1)
  assert.equal(h.calls.motions[0].group, '')
  assert.equal(h.calls.motions[0].index, 1)
})

test('单步绑定原生动作的循环交给 SDK 连续播放，直到被新动作停止', () => {
  const h = createHarness()
  h.store.modelCapabilities.motionGroups = { '': 1 }
  const loop = { id: 'single-native', label: '单步原生循环', emotion: 'neutral', controls: [], motion: 'none', finishMode: 'loop',
    steps: [{ durationMs: 200, holdMs: 0, controls: [], parameters: {}, motion: { group: '', index: 0 } }] }
  h.controller.applyPresetByEntry(loop)
  assert.equal(h.calls.motions.at(-1).options.loop, true)
  assert.equal(h.store.live2dModel.motionOwned, false, '等待 SDK 启动期间不封锁待机')
  h.calls.motions.at(-1).options.onStart(true)
  h.timers.fireNext()
  assert.equal(h.store.live2dModel.motionOwned, true, '单步原生循环仍须阻止 SDK 自动待机抢占')
  assert.equal(h.calls.motions.length, 1, '不通过重新发起播放来模拟循环')
  h.controller.applyPresetByEntry({ id: 'static', label: '静态', emotion: 'neutral', controls: [], motion: 'none', finishMode: 'hold', parameters: { ParamAngleX: 2 } })
  while (h.timers.count()) h.timers.fireNext()
  assert.equal(h.store.live2dModel.motionOwned, false)
})

test('a missing single-step native loop reports failure and releases the idle gate', () => {
  const h = createHarness()
  const loop = { id: 'neutral', label: '日常待机', emotion: 'neutral', controls: [], motion: 'none', finishMode: 'loop',
    steps: [{ durationMs: 200, holdMs: 0, controls: [], parameters: {}, motion: { group: 'Removed', index: 0 } }] }
  h.store.statePresets = [loop]
  const results = []
  h.controller.applyPresetByEntry(loop, 'loop', result => results.push(result))
  h.calls.motions.at(-1).options.onStart(false)
  for (let index = 0; index < 5 && h.timers.count(); index++) h.timers.fireNext()
  assert.deepEqual(results, ['failed'])
  assert.equal(h.calls.motions.length, 1, 'a broken idle preset must not retry itself')
  assert.equal(h.store.live2dModel.motionOwned, false)
  assert.equal(h.timers.count(), 0)
})

for (const holdMs of [0, 125]) test(`循环接缝直接落回首帧，只保留显式保持时间 (${holdMs}ms)`, () => {
  const h = createHarness()
  const loop = { id: 'seam', label: '循环接缝', emotion: 'happy', controls: [], motion: 'none', finishMode: 'loop',
    steps: [{ durationMs: 200, holdMs, controls: ['ctrl-smile'], parameters: { ParamAngleX: -8 } },
      { durationMs: 400, holdMs: 0, controls: ['ctrl-wink'], parameters: { ParamAngleX: 8 } }] }
  h.controller.applyPresetByEntry(loop)
  assert.equal(h.calls.layers.at(-1).options.transitionMs, 200, '首次进入仍允许淡入')
  assert.equal(h.timers.nextDelay(), 200 + holdMs)
  h.timers.fireNext()
  assert.equal(h.calls.layers.at(-1).layer.parameters.ParamAngleX, 8)
  const gazeCalls = h.calls.gaze.length
  h.timers.fireNext()
  assert.equal(h.calls.layers.at(-1).layer.parameters.ParamAngleX, -8)
  assert.equal(h.calls.layers.at(-1).options.transitionMs, 0, '接缝不能额外插入末帧到首帧的过渡')
  assert.equal(h.timers.nextDelay(), holdMs, '首帧入场过渡不变成每轮的静止等待')
  assert.equal(h.calls.gaze.length, gazeCalls)
  assert.equal(h.store.activeRunningPresetId, 'seam')
  assert.equal(h.store.live2dModel.motionOwned, true)
  h.timers.fireNext()
  assert.equal(h.calls.layers.at(-1).layer.parameters.ParamAngleX, 8)
  assert.equal(h.calls.layers.at(-1).options.transitionMs, 400)
  h.controller.handleControlAction('', 'reset')
  assert.equal(h.timers.count(), 0, '停止后不允许旧循环回魂')
})

test('表演循环跨轮持续控制视线，停止后恢复跟随', () => {
  const harness = createHarness()
  const loopPreset = {
    ...harness.store.statePresets[0],
    id: 'loop-happy',
    label: '循环开心',
    finishMode: 'loop',
    steps: [
      { label: '起手', durationMs: 200, holdMs: 0, controls: [], parameters: { ParamAngleX: 8 } },
      { label: '收尾', durationMs: 200, holdMs: 0, controls: [], parameters: { ParamAngleX: 3 } },
    ],
  }
  assert.equal(harness.controller.applyPresetByEntry(loopPreset), true)
  assert.equal(harness.calls.gaze.at(-1).active, true, '循环开始时视线让位')
  assert.equal(harness.calls.focus.at(-1).weight, 0, '循环开始时视线权重为 0')

  const focusCount = harness.calls.focus.length
  for (let i = 0; i < 6; i++) {
    assert.equal(harness.timers.fireNext(), 1)
    assert.equal(harness.calls.gaze.at(-1).active, true, '末步与循环接缝都不交回视线')
    assert.equal(harness.calls.focus.at(-1).weight, 0)
  }
  assert.equal(harness.calls.focus.length, focusCount, '每轮不重复启动视线过渡')
  harness.controller.applyPresetByEntry(harness.store.statePresets.find(p => p.id === 'neutral'))
  for (let i = 0; i < 3 && harness.calls.gaze.at(-1).active; i++) harness.timers.fireNext()
  assert.equal(harness.calls.gaze.at(-1).active, false)
  assert.equal(harness.calls.focus.at(-1).weight, 1)
})

test('日常待机循环叠加鼠标跟随，打断后恢复时仍不周期抢占视线', () => {
  const h = createHarness()
  const neutral = { id: 'neutral', label: '日常待机', emotion: 'neutral', motion: 'none', finishMode: 'loop',
    steps: [{ durationMs: 200, holdMs: 0, controls: [], parameters: { ParamAngleX: 8, ParamEyeBallX: 0.1 } },
      { durationMs: 200, holdMs: 0, controls: [], parameters: { ParamAngleX: 0, ParamEyeBallX: 0 } }] }
  h.store.statePresets = [neutral, ...h.store.statePresets.filter(p => p.id !== 'neutral')]
  h.controller.applyPresetByEntry(neutral)
  const focusCount = h.calls.focus.length
  for (let i = 0; i < 6; i++) {
    assert.equal(h.calls.gaze.at(-1).active, false)
    assert.equal(h.calls.focus.at(-1).weight, 1)
    assert.equal(h.calls.layers.at(-1).layer.additiveGaze, true, '眼球关键帧也叠加到跟随上')
    assert.equal(h.timers.fireNext(), 1)
  }
  assert.equal(h.calls.focus.length, focusCount)
  assert.equal(h.store.live2dModel.motionOwned, true, '时间线继续循环，不能混入 SDK 自动待机')
  h.controller.applyPresetByEntry(h.store.statePresets.find(p => p.id === 'happy-fresh'), 'revert')
  assert.equal(h.calls.focus.at(-1).weight, 0)
  assert.equal(h.calls.layers.at(-1).layer.additiveGaze, false)
  for (let i = 0; i < 4; i++) assert.equal(h.timers.fireNext(), 1)
  assert.equal(h.store.activeRunningPresetId, 'neutral')
  assert.equal(h.calls.focus.at(-1).weight, 1)
  assert.equal(h.calls.layers.at(-1).layer.additiveGaze, true)
})
