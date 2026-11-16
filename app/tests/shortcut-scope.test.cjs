'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const { findForeignLiveEndpoint } = createLoader()('main/shortcut-scope')

test('a live other instance keeps the global hotkeys away from a dev pet', () => {
  const alive = new Set([100, 300])
  const isAlive = pid => alive.has(pid)
  const owners = [
    { file: 'own', pid: 200 },
    { file: 'stale', pid: 100 },
    { file: 'live', pid: 300 },
  ]
  assert.equal(findForeignLiveEndpoint(owners, 200, isAlive), 'stale')
  assert.equal(findForeignLiveEndpoint([{ file: 'own', pid: 200 }], 200, isAlive), null)
  assert.equal(findForeignLiveEndpoint([{ file: 'dead', pid: 999 }], 200, isAlive), null)
  assert.equal(findForeignLiveEndpoint([{ file: 'bad', pid: '300' }], 200, () => true), null)
  assert.equal(findForeignLiveEndpoint([{ file: 'bad', pid: 0 }], 200, () => true), null)
  assert.equal(findForeignLiveEndpoint([{ file: 'bad', pid: 3.5 }], 200, () => true), null)
  assert.equal(findForeignLiveEndpoint([], 200, () => true), null)
})
