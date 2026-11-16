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

const { AgentPresentationController } = loadTs(
  '../src/renderer/services/agent-presentation-controller.ts',
)

/** 假时钟：按到期时间顺序执行 setTimeout，覆盖控制器里的所有防呆定时器 */
function createFakeClock(start = 100000) {
  let now = start
  let nextId = 1
  const timers = new Map()
  return {
    now: () => now,
    setTimeout(handler, delayMs) {
      const id = nextId++
      timers.set(id, { id, at: now + delayMs, handler })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    advance(ms) {
      const target = now + ms
      for (;;) {
        let next = null
        for (const timer of timers.values()) {
          if (timer.at <= target && (!next || timer.at < next.at)) next = timer
        }
        if (!next) break
        timers.delete(next.id)
        now = next.at
        next.handler()
      }
      now = target
    },
    pending: () => timers.size,
  }
}

const REACTIONS = {
  session_start: { emotion: 'happy', bubbleTtlMs: 3600, ttsStyle: 'cheerful' },
  looking: { preset: '思考', emotion: 'thinking', bubbleTtlMs: 4800, ttsStyle: 'thinking' },
  searching: { preset: '好奇', emotion: 'curious', bubbleTtlMs: 4800, ttsStyle: 'curious' },
  reading: { preset: '思考', emotion: 'thinking', bubbleTtlMs: 4800, ttsStyle: 'thinking' },
  editing: { preset: '专注', emotion: 'thinking', bubbleTtlMs: 4600, ttsStyle: 'focused' },
  testing: { preset: '测试', emotion: 'thinking', bubbleTtlMs: 4800, ttsStyle: 'focused' },
  success: { preset: '开心', emotion: 'happy', bubbleTtlMs: 5200, ttsStyle: 'cheerful' },
  error: { preset: '惊讶', emotion: 'surprise', bubbleTtlMs: 5600, ttsStyle: 'concerned' },
  retry: { preset: '专注', emotion: 'thinking', bubbleTtlMs: 4200, ttsStyle: 'focused' },
}

function createHarness(options = {}) {
  const clock = createFakeClock(options.start)
  const store = {
    agentWorkingState: 'idle',
    agentStateLabel: '',
    agentActiveToolName: '',
    isThinking: false,
    isSpeaking: false,
    presetEditingLocked: false,
    currentApproval: null,
    live2dModel: null,
  }
  const calls = {
    presets: [],
    statuses: [],
    speech: [],
    picks: [],
    beginTurns: 0,
    dedupeResets: 0,
    notes: 0,
    visualResets: 0,
    lastFinalReplyAt: 0,
    missingPresets: new Set(options.missingPresets || []),
    presentation: 'visible',
  }
  let phraseSeq = 0
  const controller = new AgentPresentationController({
    store,
    onStatusPresentationChange: value => { calls.presentation = value },
    triggerPresetOrGroup: (query, mode) => {
      calls.presets.push({ query, mode })
      return !calls.missingPresets.has(query)
    },
    pickNarration: (intent, pickOptions) => {
      calls.picks.push({ intent, lastPhrase: pickOptions.lastPhrase })
      const base = REACTIONS[intent]
      if (!base) return null
      phraseSeq += 1
      return { ...base, intent, phrase: `${intent}#${phraseSeq}` }
    },
    showStatusMessage: (text, ttlMs) => {
      calls.statuses.push({ text, ttlMs })
    },
    speakNarration: (text, style) => {
      calls.speech.push({ text, style })
    },
    beginTtsTurn: () => {
      calls.beginTurns += 1
    },
    resetReplyDedupe: () => {
      calls.dedupeResets += 1
    },
    lastFinalReplyAt: () => calls.lastFinalReplyAt,
    noteRenderActivity: () => {
      calls.notes += 1
    },
    resetAgentVisualToHold: () => {
      calls.visualResets += 1
    },
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  return { controller, store, calls, clock }
}

test('thinking 30s only marks the hint stale; completed confirms idle and preserves narration dedupe', () => {
  const h = createHarness()
  h.controller.applyAgentWorkingState('thinking', '思考中')
  assert.equal(h.store.agentWorkingState, 'thinking')
  assert.equal(h.store.agentStateLabel, '思考中')
  assert.equal(h.store.agentActiveToolName, '')
  assert.equal(h.store.isThinking, true)
  assert.equal(h.store.isSpeaking, false)
  assert.deepEqual(h.calls.presets, [{ query: '聆听记录', mode: 'loop' }])

  h.clock.advance(29999)
  assert.equal(h.store.agentWorkingState, 'thinking', '30 秒内不能提前复位')
  h.clock.advance(1)
  assert.equal(h.store.agentWorkingState, 'thinking')
  assert.equal(h.store.isThinking, true)
  assert.equal(h.store.agentStateLabel, '思考中')
  assert.equal(h.calls.presentation, 'stale')
  assert.equal(h.clock.pending(), 0)

  h.controller.applyAgentWorkingState('thinking', '思考中')
  h.controller.markModelNarrated()
  h.controller.applyAgentWorkingState('completed')
  assert.equal(h.store.agentWorkingState, 'idle')
  assert.equal(h.store.agentStateLabel, '')
  assert.equal(h.store.isThinking, false)
  assert.equal(h.clock.pending(), 0, 'completed 必须清掉 thinking 定时器')
  assert.deepEqual(h.calls.presets.at(-1), { query: '开心', mode: 'revert' })

  h.controller.playNarration('success')
  h.clock.advance(1200)
  assert.equal(h.calls.statuses.length, 0, 'completed 保留 modelNarratedThisTurn，不再补完成气泡')
})

test('聆听记录接管工作视觉，工具切换不重启，推理解说不抢预设', () => {
  const h = createHarness()
  h.controller.applyAgentWorkingState('thinking', '思考中')
  assert.deepEqual(h.calls.presets, [{ query: '聆听记录', mode: 'loop' }])

  h.controller.playNarration('reading', true, { reasoning: true })
  assert.equal(h.calls.presets.length, 1, '工作循环拥有视觉时不再切思考 hold')

  h.controller.applyAgentWorkingState('tool_running', '执行中', 'bash', 'editing')
  assert.equal(h.calls.presets.length, 1, '思考到工具之间不重启循环')

  h.controller.applyAgentWorkingState('streaming')
  h.controller.playNarration('reading', true, { reasoning: true })
  assert.deepEqual(h.calls.presets.at(-1), { query: '思考', mode: 'hold' }, '进入流式后交还解说视觉')
})

test('工作视觉按 聆听记录 → 聆听 → 工作 → 意图预设 依次回退', () => {
  const thinking = createHarness({ missingPresets: ['聆听记录', '聆听', '工作'] })
  thinking.controller.applyAgentWorkingState('thinking', '思考中')
  assert.deepEqual(thinking.calls.presets, [
    { query: '聆听记录', mode: 'loop' },
    { query: '聆听', mode: 'loop' },
    { query: '工作', mode: 'loop' },
    { query: '思考', mode: 'hold' },
  ])

  const tool = createHarness({ missingPresets: ['聆听记录', '聆听', '工作', '测试'] })
  tool.controller.applyAgentWorkingState('tool_running', '运行测试...', 'shell', 'testing')
  assert.deepEqual(tool.calls.presets, [
    { query: '聆听记录', mode: 'loop' },
    { query: '聆听', mode: 'loop' },
    { query: '工作', mode: 'loop' },
    { query: '测试', mode: 'hold' },
    { query: '好奇', mode: 'hold' },
  ])
})

test('error 状态 5 秒后复位，惊讶预设缺失时回退难过', () => {
  const h = createHarness({ missingPresets: ['惊讶'] })
  h.controller.applyAgentWorkingState('error', '出错了', 'bash')
  assert.equal(h.store.agentWorkingState, 'error')
  assert.equal(h.store.agentStateLabel, '出错了')
  assert.equal(h.store.agentActiveToolName, 'bash')
  assert.equal(h.store.isThinking, false)
  assert.equal(h.store.isSpeaking, false)
  assert.deepEqual(h.calls.presets, [
    { query: '惊讶', mode: 'revert' },
    { query: '难过', mode: 'revert' },
  ])

  h.clock.advance(4999)
  assert.equal(h.store.agentWorkingState, 'error')
  h.clock.advance(1)
  assert.equal(h.store.agentWorkingState, 'idle')
  assert.equal(h.store.agentStateLabel, '')
  assert.equal(h.store.agentActiveToolName, '')
})

test('tool_running keeps the work loop past 45 seconds and waits for host completion', () => {
  const continuous = createHarness()
  continuous.controller.applyAgentWorkingState('thinking', '思考中')
  continuous.controller.applyAgentWorkingState('tool_running', '运行测试...', 'shell', 'testing')
  assert.equal(continuous.store.agentWorkingState, 'tool_running')
  assert.equal(continuous.store.agentStateLabel, '运行测试...')
  assert.equal(continuous.store.agentActiveToolName, 'shell')
  assert.equal(continuous.store.isThinking, true)
  assert.deepEqual(continuous.calls.presets, [{ query: '聆听记录', mode: 'loop' }])

  continuous.clock.advance(44999)
  assert.equal(continuous.store.agentWorkingState, 'tool_running', '45 秒内不能提前复位')
  continuous.clock.advance(1)
  assert.equal(continuous.store.agentWorkingState, 'tool_running')
  assert.equal(continuous.store.agentActiveToolName, 'shell')
  assert.equal(continuous.calls.presentation, 'stale')
  assert.equal(continuous.calls.visualResets, 0)
  continuous.controller.applyAgentWorkingState('thinking', '继续检查')
  assert.equal(continuous.calls.presentation, 'visible', 'a new host event replaces the stale hint')
  continuous.controller.applyAgentWorkingState('idle')
  assert.equal(continuous.store.agentWorkingState, 'idle')

  const h = createHarness({ missingPresets: ['聆听记录', '聆听', '工作', '测试'] })
  h.controller.applyAgentWorkingState('tool_running', '运行测试...', 'shell', 'testing')
  assert.deepEqual(h.calls.presets, [
    { query: '聆听记录', mode: 'loop' },
    { query: '聆听', mode: 'loop' },
    { query: '工作', mode: 'loop' },
    { query: '测试', mode: 'hold' },
    { query: '好奇', mode: 'hold' },
  ])

  const editing = createHarness({ missingPresets: ['聆听记录', '聆听', '工作'] })
  editing.controller.applyAgentWorkingState('tool_running', '编辑中', 'edit', 'editing')
  assert.deepEqual(editing.calls.presets, [
    { query: '聆听记录', mode: 'loop' },
    { query: '聆听', mode: 'loop' },
    { query: '工作', mode: 'loop' },
    { query: '专注', mode: 'hold' },
  ])
})

test('narration 气泡固定延迟 1200ms，预设缺失时回退情绪', () => {
  const h = createHarness({ missingPresets: ['思考'] })
  h.controller.playNarration('looking')
  assert.deepEqual(h.calls.presets, [
    { query: '思考', mode: 'revert' },
    { query: 'thinking', mode: 'revert' },
  ])
  assert.equal(h.calls.notes, 1)
  assert.equal(h.calls.statuses.length, 0)

  h.clock.advance(1199)
  assert.equal(h.calls.statuses.length, 0, '1199ms 时还不能弹气泡')
  h.clock.advance(1)
  assert.deepEqual(h.calls.statuses, [{ text: 'looking#1', ttlMs: 4800 }])
  assert.deepEqual(h.calls.speech, [{ text: 'looking#1', style: 'thinking' }])
})

test('narration 全局最小间隔 900ms，pending 气泡不重复排队', () => {
  const h = createHarness()
  h.controller.playNarration('looking')
  h.controller.playNarration('searching')
  assert.equal(h.calls.picks.length, 1, '900ms 内换意图也被挡')
  assert.equal(h.calls.presets.length, 1)

  h.clock.advance(900)
  h.controller.playNarration('searching')
  assert.equal(h.calls.picks.length, 2)
  assert.deepEqual(h.calls.presets.at(-1), { query: '好奇', mode: 'revert' })
  assert.equal(h.calls.statuses.length, 0)

  h.clock.advance(300)
  assert.deepEqual(h.calls.statuses, [{ text: 'looking#1', ttlMs: 4800 }], '只弹先排队的那条')
  h.clock.advance(1200)
  assert.equal(h.calls.statuses.length, 1, 'pending 期间的 searching 不再叠一条气泡')

  h.clock.advance(2000)
  h.controller.playNarration('searching')
  assert.equal(h.calls.picks.length, 3)
  h.clock.advance(1200)
  assert.deepEqual(h.calls.statuses.at(-1), { text: 'searching#3', ttlMs: 4800 })
})

test('narration 同一意图 3500ms 内不重复', () => {
  const h = createHarness()
  h.controller.playNarration('looking')
  h.clock.advance(1200)
  assert.equal(h.calls.statuses.length, 1)

  h.clock.advance(2299)
  h.controller.playNarration('looking')
  assert.equal(h.calls.picks.length, 1, '3499ms 时同意图仍被挡')
  assert.equal(h.calls.presets.length, 1)

  h.clock.advance(1)
  h.controller.playNarration('looking')
  assert.equal(h.calls.picks.length, 2, '满 3500ms 后允许')
  h.clock.advance(1200)
  assert.deepEqual(h.calls.statuses.at(-1), { text: 'looking#2', ttlMs: 4800 })
})

test('success 解说在最终回复 8 秒内抑制', () => {
  const h = createHarness()
  h.calls.lastFinalReplyAt = h.clock.now() - 7999
  h.controller.playNarration('success')
  assert.equal(h.calls.picks.length, 0)
  assert.equal(h.calls.statuses.length, 0)

  h.clock.advance(1)
  h.controller.playNarration('success')
  assert.equal(h.calls.picks.length, 1, '恰好满 8000ms 允许')
  h.clock.advance(1200)
  assert.deepEqual(h.calls.statuses, [{ text: 'success#1', ttlMs: 5200 }])
})

test('reasoning 解说视觉间隔 2500ms、台词间隔 20000ms', () => {
  const h = createHarness()
  h.store.agentWorkingState = 'thinking'
  h.controller.playNarration('reading', true, { reasoning: true })
  assert.deepEqual(h.calls.presets, [{ query: '思考', mode: 'hold' }])
  assert.deepEqual(h.calls.statuses, [{ text: 'reading#1', ttlMs: 2800 }])
  assert.deepEqual(h.calls.speech, [{ text: 'reading#1', style: 'thinking' }])

  h.clock.advance(1000)
  h.controller.playNarration('searching', true, { reasoning: true })
  assert.equal(h.calls.presets.length, 1, '2500ms 内不再切预设')
  assert.equal(h.calls.statuses.length, 1, '20000ms 内不再说台词')

  h.clock.advance(1500)
  h.controller.playNarration('searching', true, { reasoning: true })
  assert.deepEqual(h.calls.presets.at(-1), { query: '好奇', mode: 'hold' })
  assert.equal(h.calls.presets.length, 2)
  assert.equal(h.calls.statuses.length, 1)

  h.clock.advance(17499)
  h.controller.playNarration('error', true, { reasoning: true })
  assert.equal(h.calls.presets.length, 3, '新目标预设满 2500ms 后切换')
  assert.equal(h.calls.statuses.length, 1, '19999ms 时仍不说台词')

  h.clock.advance(1)
  h.controller.playNarration('error', true, { reasoning: true })
  assert.deepEqual(h.calls.statuses.at(-1), { text: 'error#5', ttlMs: 2800 })
  assert.equal(h.calls.presets.length, 3, '目标预设未变时不重复切')

  h.controller.markModelNarrated()
  h.controller.playNarration('reading', true, { reasoning: true })
  assert.equal(h.calls.picks.length, 5, '本轮已说话后 reasoning 不再取词')
  assert.equal(h.calls.statuses.length, 2)
})

test('streaming 看门狗 30 秒无帧复位，重新 arm 会重新计时', () => {
  const h = createHarness()
  h.controller.applyAgentWorkingState('thinking', '思考中')
  h.controller.applyAgentWorkingState('streaming')
  assert.equal(h.store.agentWorkingState, 'streaming')
  assert.equal(h.store.isThinking, false)
  assert.equal(h.store.isSpeaking, true)
  assert.equal(h.clock.pending(), 1)

  h.clock.advance(20000)
  h.controller.armStreamingWatchdog()
  h.clock.advance(29999)
  assert.equal(h.store.agentWorkingState, 'streaming', '续期后 29999ms 仍在流式')
  assert.equal(h.store.isSpeaking, true)

  h.clock.advance(1)
  assert.equal(h.store.isSpeaking, false)
  assert.equal(h.store.agentWorkingState, 'idle')
  assert.equal(h.clock.pending(), 0)
})

test('resetSessionTurnState 清定时器、pending 气泡与本轮标记', () => {
  const h = createHarness()
  h.controller.applyAgentWorkingState('thinking', '思考中', 'bash')
  h.controller.playNarration('looking')
  assert.equal(h.clock.pending(), 2)
  assert.equal(h.calls.dedupeResets, 1)
  assert.equal(h.calls.beginTurns, 1)

  h.calls.dedupeResets = 0
  h.calls.beginTurns = 0
  h.controller.resetSessionTurnState()
  assert.equal(h.store.agentWorkingState, 'idle')
  assert.equal(h.store.agentStateLabel, '')
  assert.equal(h.store.agentActiveToolName, '')
  assert.equal(h.clock.pending(), 0)
  assert.equal(h.calls.dedupeResets, 1)
  assert.equal(h.calls.beginTurns, 1)

  h.clock.advance(1200)
  assert.equal(h.calls.statuses.length, 0, 'reset 后旧解说气泡不能再弹出')

  h.clock.advance(2300)
  h.controller.markModelNarrated()
  h.controller.resetSessionTurnState()
  h.controller.playNarration('looking')
  h.clock.advance(1200)
  assert.equal(h.calls.statuses.length, 1, 'reset 清掉 modelNarratedThisTurn')
})

test('completed 保留本轮标记，error/idle/从空闲进入 thinking 才清标记', () => {
  const completed = createHarness()
  completed.controller.markModelNarrated()
  completed.controller.applyAgentWorkingState('completed')
  completed.controller.playNarration('success')
  completed.clock.advance(1200)
  assert.equal(completed.calls.statuses.length, 0)

  const errored = createHarness()
  errored.controller.markModelNarrated()
  errored.controller.applyAgentWorkingState('error')
  errored.controller.playNarration('success')
  errored.clock.advance(1200)
  assert.equal(errored.calls.statuses.length, 1)

  const idled = createHarness()
  idled.controller.markModelNarrated()
  idled.controller.applyAgentWorkingState('idle')
  idled.controller.playNarration('success')
  idled.clock.advance(1200)
  assert.equal(idled.calls.statuses.length, 1)

  const thinking = createHarness()
  thinking.controller.markModelNarrated()
  thinking.controller.applyAgentWorkingState('thinking')
  assert.equal(thinking.calls.dedupeResets, 1)
  assert.equal(thinking.calls.beginTurns, 1)
  thinking.controller.playNarration('success')
  thinking.clock.advance(1200)
  assert.equal(thinking.calls.statuses.length, 1)

  const toolThinking = createHarness()
  toolThinking.store.agentWorkingState = 'tool_running'
  toolThinking.controller.markModelNarrated()
  toolThinking.controller.applyAgentWorkingState('thinking')
  assert.equal(toolThinking.calls.dedupeResets, 0, '工具之间的 thinking 不重置去重')
  assert.equal(toolThinking.calls.beginTurns, 0)
  toolThinking.controller.playNarration('success')
  toolThinking.clock.advance(1200)
  assert.equal(toolThinking.calls.statuses.length, 0, '保留本轮已说话标记')
})

test('resetAgentStateForReply 仅在未锁定且有模型时复位视觉', () => {
  const h = createHarness()
  h.store.live2dModel = {}
  h.controller.resetAgentStateForReply()
  assert.equal(h.calls.visualResets, 1)

  h.store.presetEditingLocked = true
  h.controller.resetAgentStateForReply()
  assert.equal(h.calls.visualResets, 1, '编辑锁定时不抢占预设')

  h.store.presetEditingLocked = false
  h.store.live2dModel = null
  h.controller.resetAgentStateForReply()
  assert.equal(h.calls.visualResets, 1, '没有模型时不复位视觉')
})

test('beginUserTurn 清本轮标记与 pending 气泡，并开启新的语音回合', () => {
  const h = createHarness()
  h.controller.markModelNarrated()
  h.controller.playNarration('looking')
  assert.equal(h.clock.pending(), 0, '已说话标记存在时不会排解说气泡')

  h.calls.dedupeResets = 0
  h.calls.beginTurns = 0
  h.controller.beginUserTurn()
  assert.equal(h.calls.dedupeResets, 1)
  assert.equal(h.calls.beginTurns, 1)

  h.clock.advance(900)
  h.controller.playNarration('success')
  h.clock.advance(1200)
  assert.deepEqual(h.calls.statuses, [{ text: 'success#2', ttlMs: 5200 }])
})

test('dismissing a status only hides the hint and leaves work, speech and the watchdog intact', () => {
  const h = createHarness()
  h.controller.applyAgentWorkingState('tool_running', '执行中')
  h.store.isSpeaking = true
  h.controller.dismissAgentStatus()
  assert.equal(h.store.isSpeaking, true)
  assert.equal(h.store.agentWorkingState, 'tool_running')
  assert.equal(h.store.agentStateLabel, '执行中')
  assert.equal(h.clock.pending(), 1)
  assert.equal(h.calls.presentation, 'hidden')
  h.clock.advance(60000)
  assert.equal(h.calls.presentation, 'hidden', 'a stale timer does not reopen a dismissed hint')
  assert.equal(h.store.agentWorkingState, 'tool_running')
  assert.equal(h.calls.visualResets, 0)
  h.controller.applyAgentWorkingState('streaming')
  assert.equal(h.calls.presentation, 'visible')
  h.controller.dismissAgentStatus()
  h.clock.advance(30000)
  assert.equal(h.store.isSpeaking, false, 'the stream watchdog still closes an abandoned stream')
  assert.equal(h.store.agentWorkingState, 'idle')
  h.controller.resetSessionTurnState()
  assert.equal(h.calls.presentation, 'visible')
})

test('dispose clears both pending narration and watchdog without later presentation writes', () => {
  const h = createHarness()
  h.controller.applyAgentWorkingState('thinking')
  h.controller.playNarration('reading')
  assert.equal(h.clock.pending(), 2)
  h.controller.dispose()
  assert.equal(h.clock.pending(), 0)
  const statusCount = h.calls.statuses.length
  h.clock.advance(60000)
  assert.equal(h.calls.statuses.length, statusCount)
  assert.equal(h.store.agentWorkingState, 'thinking')
})
