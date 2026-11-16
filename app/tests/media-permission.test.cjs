'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const { shouldAllowMediaPermission } = createLoader()('main/media-permission')

test('microphone permission follows the trusted pet window, not the data profile', () => {
  assert.equal(shouldAllowMediaPermission('media', true), true)
  assert.equal(shouldAllowMediaPermission('media', false), false)
  assert.equal(shouldAllowMediaPermission('geolocation', true), false)
  assert.equal(shouldAllowMediaPermission('notifications', false), false)
})
