'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const gate = createLoader()('renderer/services/model-load-gate')

test('a static load settles only for the URL that armed it', async () => {
  let settled = null
  const pending = gate.armStaticModelLoad('C:/models/a', 5000).then(ok => { settled = ok })
  gate.settleStaticModelLoad('C:/models/b', true)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(settled, null)
  gate.settleStaticModelLoad('C:/models/a', true)
  await pending
  assert.equal(settled, true)
})

test('arming a new URL releases the old waiter as a failure', async () => {
  const first = gate.armStaticModelLoad('C:/models/a', 5000)
  const second = gate.armStaticModelLoad('C:/models/b', 5000)
  assert.equal(await first, false)
  gate.settleStaticModelLoad('C:/models/b', true)
  assert.equal(await second, true)
})

test('cancelling an unmounted static stage releases its waiter', async () => {
  const pending = gate.armStaticModelLoad('C:/models/a', 5000)
  gate.cancelStaticModelLoad()
  assert.equal(await pending, false)
})
