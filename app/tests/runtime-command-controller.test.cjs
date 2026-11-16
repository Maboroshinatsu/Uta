'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

function loadTs(relativePath) {
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, relativePath), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports, console })
  return module.exports
}

const sessionScope = loadTs('../src/renderer/services/session-scope.ts')
const replySpeechModule = loadTs('../src/renderer/services/reply-speech.ts')
const controllerSource = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/services/runtime-command-controller.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const controllerModule = { exports: {} }
vm.runInNewContext(controllerSource, {
  module: controllerModule,
  exports: controllerModule.exports,
  console,
  require: (id) => {
    if (id === './session-scope') return sessionScope
    if (id === './reply-speech') return replySpeechModule
    throw new Error(`unexpected require: ${id}`)
  },
})
const { RuntimeCommandController } = controllerModule.exports

test('completion announces once per session, respects host scope, and preserves replies', () => {
  const { controller, calls } = setup()
  const current = { hostId: 'qoder', sessionId: 'current' }
  controller.apply({ command: 'session_bind' }, current)
  controller.apply({ command: 'agent_state', state: 'completed' }, { hostId: 'codex', sessionId: 'other' })
  controller.apply({ command: 'agent_state', state: 'error' }, current)
  assert.equal(calls.completions, 0)
  controller.apply({ command: 'agent_state', state: 'thinking' }, current)
  controller.apply({ command: 'rp_reply', text: '实际回复' }, current)
  controller.apply({ command: 'agent_state', state: 'completed' }, current)
  controller.apply({ command: 'agent_state', state: 'completed' }, current)
  assert.equal(calls.completions, 1)
  assert.deepEqual(calls.chat, [{ kind: 'message', text: '实际回复' }])
  controller.apply({ command: 'agent_state', state: 'completed' }, { ...current, sessionId: 'other' })
  assert.equal(calls.completions, 2)
  assert.deepEqual(calls.completionSources, [current, { ...current, sessionId: 'other' }])
  controller.apply({ command: 'agent_state', state: 'thinking' }, current)
  controller.apply({ command: 'agent_state', state: 'completed' }, current)
  assert.equal(calls.completions, 3)
})

test('a model changed after the HTTP receipt cannot apply an old renderer command', () => {
  const { controller, calls } = setup(() => 'model-B')
  controller.apply({ command: 'set_preset', preset: 'old-action' }, { hostId: 'qoder', modelRevision: 'model-A' })
  assert.equal(calls.presets.length, 0)
  controller.apply({ command: 'set_preset', preset: 'new-action' }, { hostId: 'qoder', modelRevision: 'model-B' })
  assert.equal(calls.presets.length, 1)
})

function setup(getModelRevision) {
  let now = 1000
  let agentState = 'idle'
  const calls = {
    resets: 0,
    notes: 0,
    marks: 0,
    pulse: null,
    speaking: null,
    thinking: null,
    resetReply: 0,
    clearTimeout: 0,
    watchdog: 0,
    pendingAnimation: null,
    chat: [],
    tts: [],
    presets: [],
    narrations: [],
    agentStates: [],
    directActions: [],
    completions: 0,
    completionSources: [],
  }
  const replySpeech = new replySpeechModule.ReplySpeechTracker({
    summarize: (text, maxChars = 240) => String(text).slice(0, maxChars),
    now: () => now,
  })
  const controller = new RuntimeCommandController({
    getModelRevision,
    showTaskCompletion: source => { calls.completions++; calls.completionSources.push({ ...source }) },
    getActiveHostId: () => 'qoder',
    resetSessionTurnState: () => {
      calls.resets += 1
      agentState = 'idle'
    },
    noteRenderActivity: () => {
      calls.notes += 1
    },
    markModelNarrated: () => {
      calls.marks += 1
    },
    summarizeSpeechText: (text, maxChars) => String(text).slice(0, maxChars),
    replySpeech,
    chat: {
      showChatMessage: (text) => calls.chat.push({ kind: 'message', text }),
      showChoiceMessage: (text, ttlMs) => calls.chat.push({ kind: 'choice', text, ttlMs }),
      appendChatText: (delta, requestId, replace) =>
        calls.chat.push({ kind: 'append', delta, requestId, replace }),
      finishChatStream: (requestId) => calls.chat.push({ kind: 'finish', requestId }),
      finishAllStreams: () => {},
    },
    tts: {
      speak: (text, options) => calls.tts.push({ text, options }),
      beginTurn: () => calls.tts.push({ kind: 'beginTurn' }),
      cancel: () => {},
    },
    pulseBubbleSpeaking: (durationMs) => {
      calls.pulse = durationMs
    },
    cancelSpeakingPulse: () => {},
    applyAgentWorkingState: (state, label, toolName, narrate) => {
      agentState = state
      calls.agentStates.push({ state, label, toolName, narrate })
    },
    triggerPresetOrGroup: (query, mode) => {
      calls.presets.push({ query, mode })
      return true
    },
    playNarration: (intent, immediate, options) => {
      calls.narrations.push({ intent, immediate, options })
    },
    resetAgentStateForReply: () => {
      calls.resetReply += 1
    },
    clearThinkingTimeout: () => {
      calls.clearTimeout += 1
    },
    armStreamingWatchdog: () => {
      calls.watchdog += 1
    },
    setPendingAnimation: (name, loop) => {
      calls.pendingAnimation = { name, loop }
    },
    getAgentWorkingState: () => agentState,
    setSpeaking: (value) => {
      calls.speaking = value
    },
    setThinking: (value) => {
      calls.thinking = value
    },
    executeDirectActions: (plan, prompt) => {
      calls.directActions.push({ plan, prompt })
      return true
    },
  })
  return {
    controller,
    calls,
    replySpeech,
    setAgentState: (value) => {
      agentState = value
    },
    advance: (ms) => {
      now += ms
    },
  }
}

const meta = (hostId, sessionId) => ({ hostId, sessionId })

test('host scope filters other platforms while sessions of the bound platform share the pet', () => {
  const { controller, calls } = setup()
  controller.apply({ command: 'notify', text: 's1' }, meta('qoder', 's1'))
  assert.equal(calls.chat.filter((item) => item.kind === 'message').length, 1)

  controller.apply({ command: 'notify', text: 's2' }, meta('qoder', 's2'))
  assert.equal(calls.chat.filter((item) => item.kind === 'message').length, 2, '同平台其他会话可以驱动桌宠')

  controller.apply({ command: 'notify', text: 'harness' }, meta('harness', 's1'))
  assert.equal(calls.chat.filter((item) => item.kind === 'message').length, 2, '非当前平台不应投递')

  controller.apply({ command: 'session_bind', label: '会话二' }, meta('qoder', 's2'))
  assert.equal(calls.resets, 1, '同平台切到另一个会话会结束旧回合')
  controller.apply({ command: 'notify', text: 's2 after bind' }, meta('qoder', 's2'))
  assert.equal(calls.chat.filter((item) => item.kind === 'message').length, 3)
})

test('legacy commands without meta still apply', () => {
  const { controller, calls } = setup()
  controller.apply({ command: 'notify', text: 'legacy' })
  assert.equal(calls.chat.length, 1)
})

test('notify, choice and command dispatch preserve their options', () => {
  const { controller, calls } = setup()
  controller.apply({ command: 'notify', text: 'hi', speak: true }, meta('qoder', 's1'))
  assert.equal(calls.marks, 1)
  assert.equal(calls.tts[0].text, 'hi')
  assert.equal(calls.tts[0].options.kind, 'reply')

  controller.apply({ command: 'notify', text: 'silent' }, meta('qoder', 's1'))
  assert.equal(calls.tts.length, 1)

  controller.apply({ command: 'choice_hint', text: 'choose' }, meta('qoder', 's1'))
  assert.deepEqual(calls.chat.at(-1), { kind: 'choice', text: 'choose', ttlMs: 15000 })

  const options = '把它发给哪个会话？\nA. 当前会话\nB. 新建会话'
  controller.apply({ command: 'choice_hint', text: options }, meta('qoder', 's1'))
  const choice = calls.chat.at(-1)
  assert.equal(choice.text, options, '选项换行必须原样保留，不能被朗读摘要压成一行')
  assert.ok(choice.ttlMs > 15000, '多行选项应获得更长的阅读时间')
  assert.ok(choice.ttlMs <= 30000)

  controller.apply({ command: 'set_preset', preset: '开心', mode: 'hold' }, meta('qoder', 's1'))
  controller.apply({ command: 'set_emotion', emotion: 'happy' }, meta('qoder', 's1'))
  controller.apply({ command: 'play_animation', name: 'wave', loop: true }, meta('qoder', 's1'))
  controller.apply({ command: 'agent_state', state: 'thinking', label: '想' }, meta('qoder', 's1'))
  controller.apply({ command: 'agent_narrate', intent: 'reading', reasoning: true }, meta('qoder', 's1'))

  assert.deepEqual(calls.presets, [
    { query: '开心', mode: 'hold' },
    { query: 'happy', mode: 'revert' },
  ])
  assert.deepEqual(calls.pendingAnimation, { name: 'wave', loop: true })
  assert.equal(calls.agentStates.at(-1).state, 'thinking')
  assert.equal(calls.narrations.at(-1).intent, 'reading')
  assert.equal(calls.narrations.at(-1).immediate, true)
  assert.equal(calls.narrations.at(-1).options.reasoning, true)
})

test('streaming rp_reply buffers, speaks once on done, and resets thinking', () => {
  const { controller, calls, setAgentState } = setup()
  controller.apply({ command: 'session_bind' }, meta('qoder', 's1'))
  setAgentState('thinking')
  controller.apply(
    {
      command: 'rp_reply',
      text: '第一段',
      streaming: true,
      done: false,
      requestId: 'r1',
    },
    meta('qoder', 's1'),
  )
  assert.equal(calls.speaking, true)
  assert.equal(calls.resetReply, 1)
  assert.equal(calls.watchdog, 1)
  assert.deepEqual(calls.chat[0], {
    kind: 'append',
    delta: '第一段',
    requestId: JSON.stringify(['qoder', 's1', 'r1']),
    replace: false,
  })

  controller.apply(
    {
      command: 'rp_reply',
      text: '',
      streaming: true,
      done: true,
      requestId: 'r1',
    },
    meta('qoder', 's1'),
  )
  assert.equal(calls.speaking, false)
  assert.equal(calls.chat.at(-1).kind, 'finish')
  assert.equal(calls.tts.length, 1)
  assert.equal(calls.tts[0].text, '第一段')
})

test('non-streaming rp_reply dedupes repeats without extra speech', () => {
  const { controller, calls } = setup()
  const payload = { command: 'rp_reply', text: '完成了。', streaming: false, done: false }
  controller.apply(payload, meta('qoder', 's1'))
  controller.apply(payload, meta('qoder', 's1'))
  assert.equal(calls.chat.length, 1)
  assert.equal(calls.tts.length, 1)
})

test('recap rp_reply closes the stream without displaying or speaking', () => {
  const { controller, calls } = setup()
  controller.apply(
    {
      command: 'rp_reply',
      text: '{"recap":{"x":1}}',
      streaming: true,
      done: true,
      requestId: 'r2',
    },
    meta('qoder', 's1'),
  )
  assert.equal(calls.chat.at(-1).kind, 'finish')
  assert.equal(calls.tts.length, 0)
  assert.equal(calls.speaking, false)
})

test('unknown commands are ignored without throwing', () => {
  const { controller, calls } = setup()
  assert.doesNotThrow(() => controller.apply({ command: 'unknown' }, meta('qoder', 's1')))
  assert.equal(calls.chat.length, 0)
})

test('direct_actions command routes to executeDirectActions', () => {
  const { controller, calls } = setup(() => 'model-A')
  controller.apply(
    { command: 'direct_actions', prompt: 'nod twice', plan: { version: 1, actions: [{ kind: 'nod' }] } },
    { hostId: 'qoder', modelRevision: 'model-A' },
  )
  assert.equal(calls.directActions.length, 1)
  assert.equal(calls.directActions[0].prompt, 'nod twice')
  assert.deepEqual(calls.directActions[0].plan, { version: 1, actions: [{ kind: 'nod' }] })
})
