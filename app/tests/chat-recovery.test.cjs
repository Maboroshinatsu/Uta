'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')

test('failed messages can be copied or put back into the input', () => {
  const bubble = read('src/renderer/components/ChatBubble.vue')
  assert.match(bubble, /'retry-message': \[message: TextMessage\]/)
  assert.match(bubble, /class="msg-actions"/)
  assert.match(bubble, /放回输入框/)
  assert.match(bubble, /document\.execCommand\('copy'\)/)
  assert.match(bubble, /user-select: text;/)
  assert.match(bubble, /\.msg-delivery\.is-failed \{ color: var\(--dp-danger/)

  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /@retry-message="retryMessage"/)
  assert.match(stage, /function retryMessage\(message: TextMessage\)/)
  assert.match(stage, /inputText\.value = message\.text/)
})

test('history shows a source chat title even for a single known session', () => {
  const bubble = read('src/renderer/components/ChatBubble.vue')
  assert.match(bubble, /v-if="isHistoryMessage\(msg\) && \(msg\.sessionId \|\|[^\n]+"\s+class="msg-session-tag"/)
  assert.match(bubble, /\{\{ messageSessionTitle\(msg\) \}\}/)
  assert.match(bubble, /\.msg-session-tag \{/)
  assert.doesNotMatch(bubble, /sessionShort\(|`会话 \$\{msg\.sessionId/)
})

test('the pet toolbar shows how many messages need attention', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /const failedMessageCount = computed\(/)
  assert.match(stage, /class="btn-bar-badge is-error"/)
  assert.match(stage, /消息记录（\$\{failedMessageCount\} 条未发送）/)
})

test('long histories render progressively instead of all at once', () => {
  const bubble = read('src/renderer/components/ChatBubble.vue')
  assert.match(bubble, /const RENDER_STEP = 120/)
  assert.match(bubble, /const visibleMessages = computed/)
  assert.match(bubble, /显示更早的/)
  assert.match(bubble, /v-for="msg in visibleMessages"/)
})

test('new messages only auto-scroll when the reader is already at the bottom', () => {
  const bubble = read('src/renderer/components/ChatBubble.vue')
  assert.match(bubble, /STICK_TO_BOTTOM_PX = 72/)
  assert.match(bubble, /function isNearBottom\(el: HTMLElement\)/)
  assert.match(bubble, /last\?\.role === 'user' \|\| isNearBottom/)
  assert.doesNotMatch(bubble, /watch\(\s*\(\) => props\.messages\.length,\s*\(\) => \{\s*if \(props\.panelOpen\)/)
})

test('a new-message pill appears while reading older history and returns to latest', () => {
  const bubble = read('src/renderer/components/ChatBubble.vue')
  assert.match(bubble, /class="history-unseen"/)
  assert.match(bubble, /unseenCount\.value \+= Math\.max\(1, next - previous\)/)
  assert.match(bubble, /function onBodyScroll\(\)/)
  assert.match(bubble, /function jumpToLatest\(\)/)
})

test('retrying a failed message never overwrites a newer draft', () => {
  const stage = fs.readFileSync(path.join(__dirname, '../src/renderer/components/DeskpetStage.vue'), 'utf8')
  assert.match(stage, /if \(inputText\.value\.trim\(\) && inputText\.value !== message\.text\)/)
  assert.match(stage, /输入框里已有草稿，没有覆盖/)
})
