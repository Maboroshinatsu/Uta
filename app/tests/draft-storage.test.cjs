'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

function makeStorage() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
  }
}

test('todo drafts survive a page switch through session storage', () => {
  const storage = makeStorage()
  const { readDraft, writeDraft } = createLoader({}, { sessionStorage: storage })('renderer/services/draft-storage')
  assert.equal(readDraft('todo-project'), '')
  writeDraft('todo-project', '写了一半的项目待办')
  assert.equal(readDraft('todo-project'), '写了一半的项目待办')
  writeDraft('todo-project', '')
  assert.equal(readDraft('todo-project'), '')

  const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
  assert.match(read('src/renderer/components/DailyTodoList.vue'), /readDraft\(/)
  assert.match(read('src/renderer/components/DailyTodoList.vue'), /writeDraft\(/)
})
