'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/services/reply-speech.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const mod = { exports: {} }
vm.runInNewContext(code, { module: mod, exports: mod.exports, console })
const { ReplySpeechTracker, isSimilarFinalReply, isRecapPayload } = mod.exports

function makeTracker() {
  let now = 1000
  const tracker = new ReplySpeechTracker({
    summarize: (text, maxChars = 240) => String(text).slice(0, maxChars),
    now: () => now,
    dedupeMs: 12_000,
  })
  return {
    tracker,
    setNow(value) {
      now = value
    },
  }
}

test('final reply dedupe suppresses repeats without extending the window', () => {
  const { tracker, setNow } = makeTracker()
  assert.equal(tracker.consume('第一段回复'), true)
  setNow(5000)
  assert.equal(tracker.consume('第一段回复'), false)
  setNow(13_001)
  assert.equal(tracker.consume('第一段回复'), true, '重复命中不能刷新去重窗口')
})

test('dedupe covers raw and summarized forms', () => {
  const { tracker } = makeTracker()
  const long = '这是一段足够长的回复正文，用来测试前缀相似度判断。'
  assert.equal(tracker.consume(long), true)
  const similar = `${long}补充一句。`
  assert.equal(tracker.consume(similar), false)
  assert.equal(tracker.consume('完全不同的另一段回复正文。'), true)
})

test('short identical replies are still deduped, unrelated short replies are not', () => {
  const { tracker } = makeTracker()
  assert.equal(tracker.consume('好的'), true)
  assert.equal(tracker.consume('好的'), false)
  assert.equal(tracker.consume('收到'), true)
})

test('recap payloads are recognized but arrays and malformed JSON are not', () => {
  assert.equal(isRecapPayload('{"recap":{"x":1}}'), true)
  assert.equal(isRecapPayload('  {"recap":{}}  '), true)
  assert.equal(isRecapPayload('{"other":1}'), false)
  assert.equal(isRecapPayload('[{"recap":1}]'), false)
  assert.equal(isRecapPayload('{bad json'), false)
  assert.equal(isRecapPayload('普通文本'), false)
})

test('speech buffers accept cumulative snapshots and ignore echoed chunks', () => {
  const { tracker } = makeTracker()
  tracker.appendBuffer('r1', '你好')
  tracker.appendBuffer('r1', '你好，世界')
  assert.equal(tracker.getBuffer('r1'), '你好，世界')

  tracker.setBuffer('r1', '你好，世界，这是一段完整的回复')
  tracker.appendBuffer('r1', '这是一段完整的回复')
  assert.equal(tracker.getBuffer('r1'), '你好，世界，这是一段完整的回复')

  tracker.appendBuffer('r1', '继续')
  assert.equal(tracker.getBuffer('r1'), '你好，世界，这是一段完整的回复继续')
})

test('buffer replace, take, drop and clear keep the streaming keys isolated', () => {
  const { tracker } = makeTracker()
  tracker.setBuffer('a', '完整回复')
  tracker.setBuffer('b', '另一条')
  assert.equal(tracker.takeBuffer('a'), '完整回复')
  assert.equal(tracker.getBuffer('a'), undefined)
  assert.equal(tracker.getBuffer('b'), '另一条')
  tracker.dropBuffer('b')
  assert.equal(tracker.getBuffer('b'), undefined)
  tracker.setBuffer('c', '内容')
  tracker.clearBuffers()
  assert.equal(tracker.getBuffer('c'), undefined)
  assert.equal(tracker.consume('内容'), true, '清空 buffer 不应清掉最终回复去重')
})

test('similarity helper only compares enough leading text or exact matches', () => {
  assert.equal(isSimilarFinalReply('短', '短'), true)
  assert.equal(isSimilarFinalReply('短', '长'), false)
  const head = '共同开头共同开头共同开头共同开头'
  assert.equal(isSimilarFinalReply(`${head}A`, `${head}B`), true)
  assert.equal(isSimilarFinalReply(`X${head}`, `Y${head}`), false)
})
