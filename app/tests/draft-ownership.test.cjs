'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const { canRestoreFailedDraft } = createLoader()('renderer/services/draft-ownership')
const failed = { sendSequence: 1, draftRevision: 4 }

test('a failed send restores only an empty, unchanged draft', () => {
  assert.equal(canRestoreFailedDraft(failed, {
    inputText: '', sendSequence: 1, draftRevision: 4,
  }), true)
  assert.equal(canRestoreFailedDraft(failed, {
    inputText: 'newer user draft', sendSequence: 1, draftRevision: 5,
  }), false)
  assert.equal(canRestoreFailedDraft(failed, {
    inputText: '', sendSequence: 2, draftRevision: 4,
  }), false)
  assert.equal(canRestoreFailedDraft(failed, {
    inputText: '   ', sendSequence: 1, draftRevision: 4,
  }), true)
})
