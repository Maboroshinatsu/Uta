'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { createPinia, setActivePinia } = require('pinia')
const createLoader = require('./support/settings-loader.cjs')

const { createChatHistory } = createLoader()('main/chat-history')
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-chat-history-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
const entry = (id, text = 'hello') => ({ id, role: 'assistant', text, timestamp: 1000, hostId: 'codex', sessionId: 'session-a' })

test('history persists within its own profile and preserves session attribution', (t) => {
  const a = tempDir(t), b = tempDir(t)
  const history = createChatHistory(a)
  assert.equal(history.write([entry('a')]).ok, true)
  assert.equal(createChatHistory(a).read().entries[0].sessionId, 'session-a')
  assert.equal(createChatHistory(b).read().entries.length, 0)
  assert.equal(history.write([entry('b')]).ok, true)
  assert.equal(history.read().entries[0].id, 'b')
  assert.equal(fs.readdirSync(a).some(f => f.endsWith('.tmp')), false)
})

test('corrupt and future history remain byte-for-byte untouched', (t) => {
  const dir = tempDir(t), file = path.join(dir, 'chat-history.v1.json')
  const history = createChatHistory(dir)
  for (const raw of ['{broken', JSON.stringify({ version: 2, entries: [entry('future')] })]) {
    fs.writeFileSync(file, raw)
    assert.equal(history.read().ok, false)
    assert.equal(history.write([entry('new')]).ok, false)
    assert.equal(fs.readFileSync(file, 'utf8'), raw)
  }
})

test('invalid entries cannot replace a valid history', (t) => {
  const dir = tempDir(t), history = createChatHistory(dir)
  assert.equal(history.write([entry('keep')]).ok, true)
  const original = fs.readFileSync(path.join(dir, 'chat-history.v1.json'), 'utf8')
  assert.equal(history.write([{ ...entry('bad'), text: 'a'.repeat(50001) }]).ok, false)
  assert.equal(fs.readFileSync(path.join(dir, 'chat-history.v1.json'), 'utf8'), original)
})

test('store restores, attributes and clears records only after successful disk writes', async (t) => {
  const dir = tempDir(t), disk = createChatHistory(dir)
  const api = { readChatHistory: async () => disk.read(), writeChatHistory: async entries => disk.write(entries) }
  const load = createLoader({}, { window: { utaAPI: api } })
  const useChatStore = load('renderer/stores/chat').useChatStore
  setActivePinia(createPinia())
  const first = useChatStore()
  await first.initializeHistory()
  first.showChatMessage('answer', { hostId: 'codex', sessionId: 'session-a' })
  const id = first.addUserMessage('question', { hostId: 'codex' })
  first.setDelivery(id, 'sent', { sessionId: 'session-b' })
  await first.flushHistory()
  setActivePinia(createPinia())
  const restarted = useChatStore()
  await restarted.initializeHistory()
  assert.equal(restarted.messages.length, 2)
  assert.equal(restarted.messages[0].sessionId, 'session-a')
  assert.equal(restarted.messages[0].restored, true)
  assert.equal(restarted.messages[1].sessionId, 'session-b')
  assert.equal(restarted.messages[1].delivery, 'sent')
  api.writeChatHistory = async () => ({ ok: false, error: 'write-failed' })
  assert.equal(await restarted.clearHistory(), false)
  assert.equal(restarted.messages.length, 2)
  assert.equal(disk.read().entries.length, 2)
  api.writeChatHistory = async entries => disk.write(entries)
  await restarted.initializeHistory()
  assert.equal(await restarted.clearHistory(), true)
  assert.equal(restarted.messages.length, 0)
  assert.equal(disk.read().entries.length, 0)
})

test('MaiBot images survive a history reload without becoming fresh bubbles', async (t) => {
  const disk = createChatHistory(tempDir(t))
  const api = { readChatHistory: async () => disk.read(), writeChatHistory: async entries => disk.write(entries) }
  const { useChatStore } = createLoader({}, { window: { utaAPI: api } })('renderer/stores/chat')
  const image = { mimeType: 'image/gif', base64: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }
  setActivePinia(createPinia())
  const first = useChatStore()
  await first.initializeHistory()
  first.showChatMessage('你好', { hostId: 'maibot', sessionId: 'deskpet' })
  first.addChatImage(image, '表情包', { hostId: 'maibot', sessionId: 'deskpet' })
  await first.flushHistory()
  setActivePinia(createPinia())
  const reopened = useChatStore()
  await reopened.initializeHistory()
  assert.equal(reopened.messages[0].text, '你好')
  const media = reopened.messages[1]
  assert.equal(media.type, 'emoji')
  assert.equal(media.restored, true)
  assert.equal(media.sessionId, 'deskpet')
  assert.equal(media.image.base64, image.base64)
  assert.equal(media.image.mimeType, image.mimeType)
  assert.equal(await reopened.clearHistory(), true)
  assert.equal(disk.read().entries.length, 0)
})

test('a message arriving during initial read is merged rather than replacing saved history', async (t) => {
  const dir = tempDir(t), disk = createChatHistory(dir)
  assert.equal(disk.write([entry('saved')]).ok, true)
  let release
  const pending = new Promise(resolve => { release = resolve })
  const api = { readChatHistory: async () => { await pending; return disk.read() }, writeChatHistory: async entries => disk.write(entries) }
  const useChatStore = createLoader({}, { window: { utaAPI: api } })('renderer/stores/chat').useChatStore
  setActivePinia(createPinia())
  const chat = useChatStore()
  const opening = chat.initializeHistory()
  chat.showChatMessage('new', { hostId: 'codex', sessionId: 'session-b' })
  release()
  await opening
  await chat.flushHistory()
  const entries = disk.read().entries
  assert.equal(entries.length, 2)
  assert.equal(entries[0].id, 'saved')
  assert.equal(entries[1].sessionId, 'session-b')
})

test('private completion receipts survive restart for deduplication but are not conversation messages', async t => {
  const dir = tempDir(t), disk = createChatHistory(dir)
  assert.equal(disk.write([entry('old-reply')]).ok, true)
  const api = { readChatHistory: async () => disk.read(), writeChatHistory: async entries => disk.write(entries) }
  const useChatStore = createLoader({}, { window: { utaAPI: api } })('renderer/stores/chat').useChatStore
  const source = { hostId: 'codex', sessionId: 'session-b', sessionTitle: '检查动作库', eventKey: 'a'.repeat(64) }
  setActivePinia(createPinia())
  const first = useChatStore()
  await first.initializeHistory()
  assert.equal(first.recordTaskCompletion(source), true)
  assert.equal(first.recordTaskCompletion(source), false)
  await first.flushHistory()
  const [oldReply, completion] = disk.read().entries
  assert.equal(oldReply.kind, undefined)
  assert.equal(completion.kind, 'completion')
  assert.equal(completion.sessionTitle, source.sessionTitle)
  assert.equal(completion.sessionId, source.sessionId)
  assert.equal(disk.write([{ ...completion, role: 'user' }]).ok, false)
  setActivePinia(createPinia())
  const restarted = useChatStore()
  await restarted.initializeHistory()
  assert.equal(restarted.recordTaskCompletion(source), false)
  assert.equal(restarted.messages[1].type, 'completion')
  assert.equal(restarted.messages[1].sessionTitle, source.sessionTitle)
  assert.equal(restarted.messages.length, 2)
  const { isHistoryMessage } = createLoader()('renderer/stores/chat')
  assert.equal(restarted.messages.filter(isHistoryMessage).length, 1)
  assert.equal(await restarted.clearHistory(), true)
  assert.equal(disk.read().entries.length, 0)
})

test('a message arriving during confirmed clear survives the clear', async (t) => {
  const dir = tempDir(t), disk = createChatHistory(dir)
  let release, blockClear = false
  const pending = new Promise(resolve => { release = resolve })
  const api = {
    readChatHistory: async () => disk.read(),
    writeChatHistory: async entries => { if (blockClear && entries.length === 0) await pending; return disk.write(entries) },
  }
  const useChatStore = createLoader({}, { window: { utaAPI: api } })('renderer/stores/chat').useChatStore
  setActivePinia(createPinia())
  const chat = useChatStore()
  await chat.initializeHistory()
  chat.showChatMessage('old')
  await chat.flushHistory()
  blockClear = true
  const clearing = chat.clearHistory()
  chat.recordTaskCompletion({ hostId: 'codex' })
  release()
  assert.equal(await clearing, true)
  await chat.flushHistory()
  assert.equal(chat.messages.length, 1)
  assert.equal(chat.messages[0].type, 'completion')
  assert.equal(disk.read().entries[0].kind, 'completion')
})

test('temporary status messages do not evict the saved conversation', async (t) => {
  const dir = tempDir(t), disk = createChatHistory(dir)
  const api = { readChatHistory: async () => disk.read(), writeChatHistory: async entries => disk.write(entries) }
  const useChatStore = createLoader({}, { window: { utaAPI: api } })('renderer/stores/chat').useChatStore
  setActivePinia(createPinia())
  const chat = useChatStore()
  await chat.initializeHistory()
  for (let i = 0; i < 1000; i++) chat.showChatMessage('message-' + i)
  for (let i = 0; i < 150; i++) chat.showStatusMessage('status-' + i)
  await chat.flushHistory()
  assert.equal(disk.read().entries.length, 1000)
  assert.equal(disk.read().entries[0].text, 'message-0')
  assert.equal(chat.messages.filter(message => message.type === 'status').length, 100)
})

test('oversized history keeps accepting new messages and receipts have a separate quota after restart', async t => {
  const dir = tempDir(t), disk = createChatHistory(dir)
  const api = { readChatHistory: async () => disk.read(), writeChatHistory: async entries => disk.write(entries) }
  const { useChatStore, isHistoryMessage } = createLoader({}, { window: { utaAPI: api } })('renderer/stores/chat')
  setActivePinia(createPinia())
  const chat = useChatStore()
  await chat.initializeHistory()
  for (let i = 0; i < 60; i++) chat.addUserMessage('长'.repeat(50001))
  for (let i = 0; i < 1000; i++) chat.recordTaskCompletion({ hostId: 'codex', eventKey: `receipt-${i}` })
  chat.showChatMessage('latest')
  await chat.flushHistory()
  assert.equal(chat.historyState, 'ready')
  assert.ok(fs.statSync(path.join(dir, 'chat-history.v1.json')).size <= 8 * 1024 * 1024)

  setActivePinia(createPinia())
  const reopened = useChatStore()
  await reopened.initializeHistory()
  const visible = reopened.messages.filter(isHistoryMessage)
  assert.ok(visible.length > 1 && visible.length < 61)
  assert.match(visible[0].text, /记录已截断/)
  assert.equal(visible.at(-1).text, 'latest')
  assert.equal(reopened.recordTaskCompletion({ hostId: 'codex', eventKey: 'receipt-999' }), false)
  reopened.showChatMessage('after restart')
  await reopened.flushHistory()
  assert.equal(disk.read().entries.filter(message => !message.kind).at(-1).text, 'after restart')
})

test('writes skip the re-read only while the file is our own last write', (t) => {
  const dir = tempDir(t), file = path.join(dir, 'chat-history.v1.json')
  const history = createChatHistory(dir)
  assert.equal(history.write([entry('one')]).ok, true)
  assert.equal(history.write([entry('two')]).ok, true)
  assert.equal(history.read().entries[0].id, 'two')

  // 外部改动（哪怕仍是合法 JSON）必须重新校验：未来版本要拒绝，且不覆盖
  fs.writeFileSync(file, JSON.stringify({ version: 2, entries: [] }))
  assert.equal(history.write([entry('three')]).ok, false)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 2)

  // 外部恢复成合法版本后可以继续写
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [] }))
  assert.equal(history.write([entry('four')]).ok, true)
  assert.equal(history.read().entries[0].id, 'four')
})
