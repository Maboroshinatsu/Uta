'use strict'
// 陪伴导演纯函数：空闲台词池与随机选择。无 Vue / Pinia / Electron 依赖。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const code = ts.transpileModule(
  fs.readFileSync(
    path.join(__dirname, '../src/renderer/composables/useCompanionDirector.ts'),
    'utf8',
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText

const requireMap = {
  '@/services/live2d/dafish-happy-performance': require('./support/settings-loader.cjs')()('renderer/services/live2d/dafish-happy-performance'),
  '@/stores/deskpet': { useDeskpetStore: () => ({}) },
  '@/services/live2d/loader': { hasPresetMotionOwnership: model => model.ownsMotion === true },
  '@/services/live2d/emotion-adapter': {},
  '@/services/preset-sequence': { RETURN_GAZE_MS: 0 },
  './useMotionPriority': { MotionLayer: { Idle: 1, Reply: 2, Interaction: 3 } },
  '@/services/idle-gate': { canRunIdleActions: () => true },
}
const mod = { exports: {} }
vm.runInNewContext(code, {
  module: mod,
  exports: mod.exports,
  require: (id) => requireMap[id] ?? {},
  setTimeout: () => 0,
  clearTimeout: () => {},
  console,
})
const { IDLE_PHRASES, pickIdlePhrase } = mod.exports
const plain = (value) => JSON.parse(JSON.stringify(value))

test('idle phrase pool and selection stay unchanged', () => {
  assert.deepEqual(plain(IDLE_PHRASES), [
    '要不要休息一下？',
    '我在这儿呢。',
    '需要我帮忙吗？',
    '呼……发会儿呆。',
    '肩膀有点酸，活动一下。',
    '有进展的话记得叫我。',
  ])
  assert.equal(pickIdlePhrase(() => 0), IDLE_PHRASES[0])
  assert.equal(pickIdlePhrase(() => 0.999999), IDLE_PHRASES[IDLE_PHRASES.length - 1])
  let calls = 0
  pickIdlePhrase(() => {
    calls += 1
    return 0.5
  })
  assert.equal(calls, 1)
})

test('user interaction yields to active work and observes its cooldown', () => {
  const { canRespondToInteraction } = require('./support/settings-loader.cjs')()('renderer/services/interaction-policy')
  const ready = { enabled: true, modelLoaded: true, busy: false, overlayOpen: false, now: 5000, lastInteractionAt: 1000 }
  assert.equal(canRespondToInteraction(ready), true)
  for (const patch of [{ enabled: false }, { modelLoaded: false }, { busy: true }, { overlayOpen: true }, { now: 3000 }]) {
    assert.equal(canRespondToInteraction({ ...ready, ...patch }), false)
  }
})

const idleGate = require('./support/settings-loader.cjs')()('renderer/services/idle-gate')

function createDirector(store) {
  const map = {
    ...requireMap,
    '@/stores/deskpet': { useDeskpetStore: () => store },
    '@/services/idle-gate': idleGate,
  }
  const box = { exports: {} }
  vm.runInNewContext(code, {
    module: box,
    exports: box.exports,
    require: (id) => map[id] ?? {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    console,
  })
  const deps = {
    isTtsSpeaking: () => false,
    isDragging: () => false,
    isPanelOpen: () => false,
    isInputOpen: () => false,
    isReplyStreaming: () => false,
    showStatusMessage: () => {},
    speak: () => {},
    noteRenderActivity: () => {},
    triggerPresetOrGroup: () => true,
    playMotionWithPriority: () => true,
    getIdleGroups: () => [],
    stopMotion: () => {},
    releaseMotionLayer: () => {},
  }
  return box.exports.useCompanionDirector(deps)
}

const idleStore = {
  focusActive: false,
  modelLoaded: true,
  live2dModel: {},
  agentWorkingState: 'idle',
  isSpeaking: false,
  isThinking: false,
  pendingApprovals: [],
  presetEditingLocked: false,
  presetPreviewActive: false,
  idleActionsEnabled: true,
  activeHoldPresetId: '',
  currentEmotion: 'neutral',
  emotionPulse: 0,
}

test('scheduled idle actions yield even when a compiled neutral preset owns motion', () => {
  const store = { ...idleStore, live2dModel: { ownsMotion: true }, presetSequenceActive: false }
  const director = createDirector(store)
  assert.equal(director.canRunIdleAction(), false)
  store.live2dModel.ownsMotion = false
  assert.equal(director.canRunIdleAction(), true)
})

test('预设正在播放时，空闲动作必须让路（闸门确实接在调度上）', () => {
  assert.equal(createDirector({ ...idleStore, presetSequenceActive: false }).canRunIdleAction(), true)
  assert.equal(createDirector({ ...idleStore, presetSequenceActive: true }).canRunIdleAction(), false)
})
