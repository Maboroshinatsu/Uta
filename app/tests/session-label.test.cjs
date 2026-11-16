'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const Vue = require('vue')
const createLoader = require('./support/settings-loader.cjs')

const load = createLoader()
const { cleanSessionTitle } = load('shared/session-title')
const { readCodexSessionTitle } = load('main/codex-session-titles')

test('the title index matches exact sessions and notices a rename', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-codex-titles-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'session_index.jsonl')
  fs.writeFileSync(file, '{"id":"prior","thread_name":"旧项目回顾"}\ninvalid\n{"id":"active","thread_name":"当前任务"}\n')
  assert.equal(readCodexSessionTitle('prior', directory), '旧项目回顾')
  assert.equal(readCodexSessionTitle('active', directory), '当前任务')
  assert.equal(readCodexSessionTitle('missing', directory), '')
  fs.appendFileSync(file, '{"id":"prior","thread_name":"旧项目回顾（已改名）"}\n')
  assert.equal(readCodexSessionTitle('prior', directory), '旧项目回顾（已改名）')
})

test('generic host and transport labels cannot become session titles', () => {
  assert.equal(cleanSessionTitle('DeepSeek Harness', 'deepseek-harness', 's1'), '')
  assert.equal(cleanSessionTitle('Qoder CLI', 'qoder', 's1'), '')
  assert.equal(cleanSessionTitle('s1', 'codex', 's1'), '')
  assert.equal(cleanSessionTitle('Codex 会话 52af66f1', 'codex', '52af66f1-aaaa-bbbb-cccc-dddddddddddd'), '')
  assert.equal(cleanSessionTitle('  修复提醒  ', 'codex', 's1'), '修复提醒')
  assert.equal(cleanSessionTitle('回顾 session 管理', 'codex', '52af66f1'), '回顾 session 管理')
})

test('a visible chat title refreshes in place when the host names or renames it', async () => {
  let refresh, title = ''
  const window = {
    setInterval(callback) { refresh = callback; return 1 },
    clearInterval() { refresh = undefined },
    utaAPI: { getSessionTitles: async refs => refs.map(ref => ({ ...ref, title })) },
  }
  const { useSessionTitles } = createLoader({ vue: Vue }, { window })('renderer/composables/useSessionTitles')
  const scope = Vue.effectScope()
  const visible = Vue.ref(true)
  const read = scope.run(() => useSessionTitles(() => visible.value ? [{ hostId: 'codex', sessionId: 'chat-a' }] : []))
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(read('codex', 'chat-a'), '')
    title = '原标题'
    await refresh()
    assert.equal(read('codex', 'chat-a'), '原标题')
    title = '新标题'
    await refresh()
    assert.equal(read('codex', 'chat-a'), '新标题')
    assert.equal(read('codex', 'chat-b'), '')
    visible.value = false
    await Vue.nextTick()
    assert.equal(refresh, undefined)
  } finally { scope.stop() }
})
