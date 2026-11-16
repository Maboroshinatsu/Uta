'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const Vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const createLoader = require('./support/settings-loader.cjs')

function harness() {
  const filename = path.join(__dirname, '../src/renderer/components/ChatBubble.vue')
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
  const compiled = compileScript(descriptor, { id: 'bubble-stream-test' })
  const code = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  let now = 0, seq = 0
  const timers = new Map(), cleanups = []
  const advance = ms => {
    now += ms
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) { timers.delete(id); timer.fn() }
    }
  }
  const load = createLoader(), mod = { exports: {} }
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports, console,
    require: id => id === 'vue'
      ? { ...Vue, onMounted: () => {}, onUnmounted: fn => cleanups.push(fn) }
      : id.startsWith('@/services/') ? load('renderer/services/' + id.slice('@/services/'.length))
      : id === '@/stores/chat' ? load('renderer/stores/chat')
      : id === '@/composables/useSessionTitles' ? load('renderer/composables/useSessionTitles')
      : id === '../../shared/session-title' ? load('shared/session-title') : {},
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id },
    clearTimeout: id => timers.delete(id),
    window: { utaAPI: {}, removeEventListener() {} },
  }, { filename })
  const props = Vue.reactive({ messages: [], panelOpen: false, sessions: [] })
  const scope = Vue.effectScope()
  const state = scope.run(() => mod.exports.default.setup(props, { expose() {}, emit() {} }))
  return { props, state, advance, timers, close() { cleanups.forEach(fn => fn()); scope.stop() } }
}

const message = (id, streaming = true) => ({ id, type: 'text', role: 'assistant', text: '正在回复', streaming })

test('completion events never appear in history, its source choices or floating reply bubbles', async () => {
  const h = harness()
  try {
    h.props.messages.push(message('reply', false),
      { id: 'failed', type: 'text', role: 'user', text: 'draft', delivery: 'failed' },
      { id: 'completed', type: 'completion', role: 'assistant', text: '宿主任务已完成',
        hostId: 'codex', sessionId: 'session-B', sessionTitle: '检查动作库' })
    await Vue.nextTick()
    assert.deepEqual(Array.from(h.state.floatingBubbles.value, bubble => bubble.id), ['reply'])
    assert.deepEqual(Array.from(h.state.filteredMessages.value, record => record.id), ['reply', 'failed'])
    assert.equal(h.state.sourceChoices.value.length, 0)
    h.state.searchTerm.value = '动作库'
    assert.equal(h.state.filteredMessages.value.length, 0)
    h.state.sourceFilter.value = JSON.stringify(['codex', 'session-A'])
    assert.equal(h.state.filteredMessages.value.length, 0)
    h.state.searchTerm.value = h.state.sourceFilter.value = ''
    h.state.historyFilter.value = 'failed'
    assert.deepEqual(Array.from(h.state.filteredMessages.value, record => record.id), ['failed'])
  } finally { h.close() }
})

test('speaker names follow each message host, allow customization and never depend on the model', () => {
  const h = harness()
  try {
    const codex = { ...message('codex'), hostId: 'codex' }
    const maibot = { ...message('maibot'), hostId: 'maibot' }
    assert.equal(h.state.speakerLabel(codex), 'Codex')
    assert.equal(h.state.speakerLabel(maibot), 'MaiBot')
    assert.equal(h.state.speakerLabel(message('legacy')), 'Uta')
    assert.equal(h.state.speakerLabel({ ...message('standalone'), hostId: 'none' }), 'Uta')
    h.props.displayName = '  小鱼  '
    assert.equal(h.state.speakerLabel(codex), '小鱼')
    assert.equal(h.state.sourceLabel(codex), 'Codex', 'custom names preserve provenance')
    h.props.displayName = ' '
    assert.equal(h.state.speakerLabel(maibot), 'MaiBot')
  } finally { h.close() }
})

test('a long active stream stays visible, then receives its full reading time after completion', async () => {
  const h = harness()
  try {
    h.props.messages.push(message('stream'))
    await Vue.nextTick()
    for (let i = 0; i < 8; i++) {
      h.advance(10_000)
      h.props.messages[0].text += '继续'
      await Vue.nextTick()
      assert.equal(h.state.floatingBubbles.value.length, 1)
      assert.equal(h.timers.size, 0, 'active streams have no reading deadline')
    }
    h.props.messages[0].streaming = false
    await Vue.nextTick()
    assert.equal(h.timers.size, 1)
    h.advance(4999)
    assert.equal(h.state.floatingBubbles.value.length, 1)
    h.advance(20_000)
    assert.equal(h.state.floatingBubbles.value.length, 0)
  } finally { h.close() }
})

test('updates to another message do not postpone a completed reply, or resurrect a dismissed stream', async () => {
  const h = harness()
  try {
    h.props.messages.push(message('finished', false), message('stream'))
    await Vue.nextTick()
    h.advance(4000)
    h.props.messages[1].text += '新内容'
    await Vue.nextTick()
    h.advance(1001)
    assert.deepEqual(Array.from(h.state.floatingBubbles.value, b => b.id), ['stream'])
    h.state.removeBubble('stream')
    h.props.messages[1].text += '最终回复'
    h.props.messages[1].streaming = false
    await Vue.nextTick()
    assert.equal(h.state.floatingBubbles.value.length, 0)
    assert.equal(h.timers.size, 0)
  } finally { h.close() }
})
