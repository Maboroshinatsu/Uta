'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(
  path.join(__dirname, '../src/renderer/services/markdown.ts'),
  'utf8',
)
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
vm.runInNewContext(code, { module: mod, exports: mod.exports })
const { parseMarkdown } = mod.exports
const plain = (value) => JSON.parse(JSON.stringify(value))

const only = (text) => plain(parseMarkdown(text))[0]

test('inline bold, italic, strike and code become styled segments', () => {
  assert.deepEqual(only('你好 **世界**'), {
    type: 'paragraph',
    segments: [{ text: '你好 ' }, { text: '世界', bold: true }],
  })
  assert.deepEqual(only('**加粗** 和 *斜体*'), {
    type: 'paragraph',
    segments: [
      { text: '加粗', bold: true },
      { text: ' 和 ' },
      { text: '斜体', italic: true },
    ],
  })
  assert.deepEqual(only('~~删除~~ 和 `x = 1`'), {
    type: 'paragraph',
    segments: [
      { text: '删除', strike: true },
      { text: ' 和 ' },
      { text: 'x = 1', code: true },
    ],
  })
})

test('links only keep http(s) destinations and never produce raw HTML', () => {
  assert.deepEqual(only('看 [Uta](https://example.com/a) 和 <b>标签</b>'), {
    type: 'paragraph',
    segments: [
      { text: '看 ' },
      { text: 'Uta', href: 'https://example.com/a' },
      { text: ' 和 <b>标签</b>' },
    ],
  })
  assert.deepEqual(only('[危险](javascript:alert(1))'), {
    type: 'paragraph',
    segments: [{ text: '[危险](javascript:alert(1))' }],
  })
})

test('fenced code keeps line breaks and language; incomplete markers stay literal', () => {
  const blocks = plain(parseMarkdown('前\n```js\nconst x = 1\n```\n后'))
  assert.equal(blocks.length, 3)
  assert.deepEqual(blocks[1], { type: 'code', text: 'const x = 1', language: 'js' })
  assert.deepEqual(only('**还没闭合'), {
    type: 'paragraph',
    segments: [{ text: '**还没闭合' }],
  })
})

test('lists, headings, quotes and rules are parsed as blocks', () => {
  const blocks = plain(parseMarkdown('# 标题\n\n- **一**\n- 二\n\n> 引用\n\n---'))
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['heading', 'list', 'quote', 'rule'],
  )
  assert.deepEqual(blocks[0].segments, [{ text: '标题' }])
  assert.deepEqual(blocks[1].items, [
    [{ text: '一', bold: true }],
    [{ text: '二' }],
  ])
  assert.deepEqual(blocks[2].segments, [{ text: '引用' }])
})

test('chat bubbles render assistant text through the token renderer, not v-html', () => {
  const bubble = fs.readFileSync(
    path.join(__dirname, '../src/renderer/components/ChatBubble.vue'),
    'utf8',
  )
  assert.match(bubble, /<MarkdownText\s+:text="b\.text"/)
  assert.match(bubble, /<MarkdownText\s+:text="msg\.text"\s+links-clickable/)
  assert.ok(!bubble.includes('v-html'), 'host text must never be injected as HTML')
})
