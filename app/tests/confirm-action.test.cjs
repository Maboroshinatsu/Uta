'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const vueStub = {
  ref: value => ({ value }),
  onUnmounted: () => {},
}
const { useConfirmAction } = createLoader({ vue: vueStub })('renderer/composables/useConfirmAction')

test('destructive actions need a second click and disarm by themselves', async () => {
  const confirm = useConfirmAction(30)
  assert.equal(confirm.arm('item-1'), false)
  assert.equal(confirm.armed.value, 'item-1')
  assert.equal(confirm.arm('item-1'), true)
  assert.equal(confirm.armed.value, null)

  assert.equal(confirm.arm('item-2'), false)
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(confirm.armed.value, null, 'a stale confirmation must disarm')

  confirm.arm('item-3')
  confirm.cancel()
  assert.equal(confirm.armed.value, null)
})

test('todo surfaces use the two-step confirmation for delete and clear', () => {
  const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
  const daily = read('src/renderer/components/DailyTodoList.vue')
  assert.match(daily, /useConfirmAction/)
  assert.match(daily, /function requestDelete\(/)
  assert.match(daily, /function requestClearCompleted\(/)
  assert.match(daily, /确认删除/)
  assert.match(daily, /确认清除？/)

  const domain = read('src/renderer/settings-window/domains/TodoDomain.vue')
  assert.doesNotMatch(domain, /requestClearCompleted|dailyClearCompleted/)
})
