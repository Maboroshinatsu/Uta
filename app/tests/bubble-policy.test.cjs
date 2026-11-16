'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/services/bubble-policy.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const mod = { exports: {} }
vm.runInNewContext(code, { module: mod, exports: mod.exports })
const {
  MAX_BUBBLES,
  bubblePriority,
  estimateBubbleTtl,
  planBubbleAdmission,
} = mod.exports

const bubble = (id, type) => ({ id, type })
const plain = (value) => JSON.parse(JSON.stringify(value))

test('priority orders choice above replies and status last', () => {
  assert.equal(MAX_BUBBLES, 2)
  assert.ok(bubblePriority('choice') > bubblePriority('text'))
  assert.ok(bubblePriority('text') > bubblePriority('status'))
  assert.equal(bubblePriority('emoji'), bubblePriority('text'))
})

test('a third reply evicts the oldest reply', () => {
  const plan = planBubbleAdmission([bubble('a', 'text'), bubble('b', 'text')], bubble('c', 'text'))
  assert.deepEqual(plain(plan), { admit: true, removeIds: ['a'] })
})

test('status is dropped while a reply is visible', () => {
  const plan = planBubbleAdmission([bubble('a', 'text')], bubble('s', 'status'))
  assert.deepEqual(plain(plan), { admit: false, removeIds: [] })
  const withChoice = planBubbleAdmission([bubble('c', 'choice')], bubble('s', 'status'))
  assert.deepEqual(plain(withChoice), { admit: false, removeIds: [] })
})

test('a reply clears status, and a new status replaces the old one', () => {
  const reply = planBubbleAdmission([bubble('s', 'status')], bubble('a', 'text'))
  assert.deepEqual(plain(reply), { admit: true, removeIds: ['s'] })

  const nextStatus = planBubbleAdmission([bubble('s1', 'status')], bubble('s2', 'status'))
  assert.deepEqual(plain(nextStatus), { admit: true, removeIds: ['s1'] })
})

test('a new choice replaces the old choice and keeps the newest reply', () => {
  const plan = planBubbleAdmission(
    [bubble('c1', 'choice'), bubble('t1', 'text')],
    bubble('c2', 'choice'),
  )
  assert.deepEqual(plain(plan), { admit: true, removeIds: ['c1'] })

  const withTwoReplies = planBubbleAdmission(
    [bubble('c1', 'choice'), bubble('t1', 'text'), bubble('t2', 'text')],
    bubble('c2', 'choice'),
  )
  assert.deepEqual(new Set(withTwoReplies.removeIds), new Set(['c1', 't1']))
})

test('a reply never evicts a choice', () => {
  const plan = planBubbleAdmission(
    [bubble('c1', 'choice'), bubble('t1', 'text')],
    bubble('t2', 'text'),
  )
  assert.deepEqual(plain(plan), { admit: true, removeIds: ['t1'] })
})

test('bubble TTL grows with text length and stays bounded', () => {
  assert.equal(estimateBubbleTtl(''), 5000)
  assert.equal(estimateBubbleTtl('好'), 5000)
  const short = estimateBubbleTtl('正在读取这个文件')
  const long = estimateBubbleTtl('这是一段需要完整读完的回复。'.repeat(8))
  assert.ok(short < long)
  assert.ok(long <= 16_000)
})

test('line breaks buy extra reading time without inflating short replies', () => {
  const line = '这一行内容比较长一些，需要看清楚'
  const single = estimateBubbleTtl(line.repeat(3))
  const multi = estimateBubbleTtl([line, line, line].join('\n'))
  assert.ok(multi > single, `多行内容的停留时间应更长（${multi} vs ${single}）`)
  assert.ok(multi - single >= 400)
  assert.equal(estimateBubbleTtl('\n\n'), 5000, '空行不应延长停留')
})
