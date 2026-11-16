'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')
const { createPinia, setActivePinia } = require('pinia')
const chatContracts = require('./support/settings-loader.cjs')()('shared/chat-history-contracts')

function clock() {
  let now = 100000
  let seq = 0
  const timers = new Map()
  return {
    now: () => now,
    setTimeout(fn, delay) { const id = ++seq; timers.set(id, { fn, at: now + delay }); return id },
    clearTimeout(id) { timers.delete(id) },
    advance(ms) {
      const end = now + ms
      while (true) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        timers.delete(next[0]); now = next[1].at; next[1].fn()
      }
      now = end
    },
    pending: () => timers.size,
  }
}

function load(file, imports = {}, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, console,
    require: (name) => {
      if (name === '@/services/live2d/dafish-happy-performance') return require('./support/settings-loader.cjs')()('renderer/services/live2d/dafish-happy-performance')
      if (name in imports) return imports[name]
      if (name === 'vue' || name === 'pinia') return require(name)
      throw new Error(`Unexpected dependency: ${name}`)
    }, ...globals,
  })
  return module.exports
}

function harness() {
  setActivePinia(createPinia())
  const time = clock()
  const store = { agentWorkingState: 'idle', agentStateLabel: '', agentActiveToolName: '',
    isThinking: false, isSpeaking: false, presetEditingLocked: false, currentApproval: null,
    live2dModel: null, modelSliders: [], modelControls: [] }
  const chat = load('stores/chat.ts', { '../../shared/chat-history-contracts': chatContracts }).useChatStore()
  const { ReplySpeechTracker } = load('services/reply-speech.ts')
  const replySpeech = new ReplySpeechTracker({ summarize: text => text, now: time.now })
  let runtime
  let host = 'qoder'
  let cancels = 0
  const spoken = []
  const companion = load('composables/useCompanionDirector.ts', {
    '@/stores/deskpet': { useDeskpetStore: () => store },
    '@/services/live2d/loader': { hasPresetMotionOwnership: () => false }, '@/services/live2d/emotion-adapter': {},
    '@/services/preset-sequence': {}, '@/services/idle-gate': { canRunIdleActions: () => true },
    './useMotionPriority': {},
  }, { setTimeout: time.setTimeout, clearTimeout: time.clearTimeout }).useCompanionDirector({
    isReplyStreaming: () => runtime.hasActiveStreams(),
  })
  const { AgentPresentationController } = load('services/agent-presentation-controller.ts')
  const presentation = new AgentPresentationController({
    store, triggerPresetOrGroup: () => true, pickNarration: () => null,
    showStatusMessage: chat.showStatusMessage, speakNarration: () => {}, beginTtsTurn: () => {},
    resetReplyDedupe: () => replySpeech.resetDedupe(), lastFinalReplyAt: () => replySpeech.lastFinalAt,
    noteRenderActivity: () => {}, resetAgentVisualToHold: () => {},
    onStreamingTimeout: () => runtime.finishReplyStreams(),
    now: time.now, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
  })
  const { RuntimeCommandController } = load('services/runtime-command-controller.ts', {
    './session-scope': load('services/session-scope.ts'),
    './reply-speech': { isRecapPayload: load('services/reply-speech.ts').isRecapPayload },
  })
  runtime = new RuntimeCommandController({
    getActiveHostId: () => host, resetSessionTurnState: () => presentation.resetSessionTurnState(),
    noteRenderActivity: () => {}, markModelNarrated: () => presentation.markModelNarrated(),
    summarizeSpeechText: text => text, replySpeech, chat,
    tts: { speak: text => spoken.push(text), beginTurn: () => {}, cancel: () => { cancels++ } },
    pulseBubbleSpeaking: companion.pulseBubbleSpeaking, cancelSpeakingPulse: companion.cancelSpeakingPulse,
    applyAgentWorkingState: (...args) => presentation.applyAgentWorkingState(...args),
    triggerPresetOrGroup: () => true, playNarration: () => {},
    resetAgentStateForReply: () => presentation.resetAgentStateForReply(),
    clearThinkingTimeout: () => presentation.clearThinkingTimeout(),
    armStreamingWatchdog: () => presentation.armStreamingWatchdog(), setPendingAnimation: () => {},
    getAgentWorkingState: () => store.agentWorkingState,
    setSpeaking: value => { store.isSpeaking = value }, setThinking: value => { store.isThinking = value },
  })
  const meta = sessionId => ({ hostId: host, sessionId })
  const stream = (text, sessionId = 'A', extra = {}) => runtime.apply({
    command: 'rp_reply', requestId: 'same-id', streaming: true, text, ...extra,
  }, meta(sessionId))
  return { runtime, chat, store, time, replySpeech, presentation, companion, spoken, stream, meta,
    cancelCount: () => cancels, setHost: value => { host = value } }
}

test('session bind finishes the old stream and keeps reused request IDs isolated', () => {
  const h = harness()
  h.stream('旧会话内容。')
  assert.equal(h.store.isSpeaking, true)
  const before = h.cancelCount()
  h.runtime.apply({ command: 'session_bind' }, h.meta('B'))
  assert.equal(h.chat.messages[0].streaming, false)
  assert.equal(h.store.isSpeaking, false)
  assert.equal(h.store.isThinking, false)
  assert.equal(h.cancelCount(), before + 1)
  h.stream('新会话内容。', 'B', { done: true })
  assert.deepEqual(Array.from(h.chat.messages, m => m.text), ['旧会话内容。', '新会话内容。'])
  assert.equal(h.chat.messages[0].hostId, 'qoder')
  assert.equal(h.chat.messages[0].sessionId, 'A')
  assert.equal(h.chat.messages[1].sessionId, 'B')
  assert.deepEqual(h.spoken, ['新会话内容。'])
  assert.notEqual(h.chat.messages[0].requestId, h.chat.messages[1].requestId)
})

test('host changes reset once, while reconnect notifications and inactive binds preserve the active stream', () => {
  const h = harness()
  h.stream('qoder partial')
  const before = h.cancelCount()
  h.runtime.syncActiveHost()
  h.runtime.apply({ command: 'session_bind' }, { hostId: 'harness', sessionId: 'elsewhere' })
  assert.equal(h.cancelCount(), before)
  assert.equal(h.runtime.hasActiveStreams(), true)
  h.setHost('harness'); h.runtime.syncActiveHost()
  assert.equal(h.cancelCount(), before + 1)
  assert.equal(h.chat.messages[0].streaming, false)
  h.runtime.apply({ command: 'rp_reply', text: 'late', requestId: 'same-id', streaming: true },
    { hostId: 'qoder', sessionId: 'A' })
  h.stream('harness reply', 'elsewhere', { done: true })
  assert.deepEqual(Array.from(h.chat.messages, m => m.text), ['qoder partial', 'harness reply'])
})

test('a notification timer created before a stream cannot close the stream mouth', () => {
  const h = harness()
  h.runtime.apply({ command: 'notify', text: '提示' }, h.meta('A'))
  h.time.advance(200)
  h.stream('持续回复')
  h.time.advance(1400)
  assert.equal(h.store.agentWorkingState, 'idle')
  assert.equal(h.store.isSpeaking, true)
  assert.equal(h.chat.messages.at(-1).streaming, true)
  h.stream('', 'A', { done: true })
  assert.equal(h.store.isSpeaking, false)
  assert.equal(h.runtime.hasActiveStreams(), false)
})

test('a notification inserted during a stream also leaves active reply ownership intact', () => {
  const h = harness()
  h.stream('持续回复')
  h.runtime.apply({ command: 'notify', text: '过程通知' }, h.meta('A'))
  h.time.advance(1500)
  assert.equal(h.store.isSpeaking, true)
  h.stream('', 'A', { done: true })
  assert.deepEqual(h.spoken, ['持续回复'])
  assert.equal(h.store.isSpeaking, false)
})

test('watchdog finishes abandoned chat streams and drops partial speech before reusing an ID', () => {
  const h = harness()
  h.stream('遗弃的部分')
  h.time.advance(30001)
  assert.equal(h.chat.messages[0].streaming, false)
  assert.equal(h.runtime.hasActiveStreams(), false)
  assert.equal(h.store.isSpeaking, false)
  h.stream('新的完整回复', 'A', { done: true })
  assert.deepEqual(h.spoken, ['新的完整回复'])
})

test('disposing presentation clears watchdog callbacks instead of writing into an unmounted stage', () => {
  const h = harness()
  h.presentation.applyAgentWorkingState('thinking')
  assert.equal(h.time.pending(), 1)
  h.presentation.dispose()
  assert.equal(h.time.pending(), 0)
  h.time.advance(60000)
  assert.equal(h.store.agentWorkingState, 'thinking')
})
