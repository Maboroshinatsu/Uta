'use strict'
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const { resolveHostEndpointFile } = createLoader()('main/host-endpoint')
const appData = path.join(os.tmpdir(), 'uta-host-endpoint-fixture')

test('stable instances publish the shared host-pets endpoint', () => {
  assert.equal(
    resolveHostEndpointFile(appData, 'codex', { isStable: true }),
    path.join(appData, 'uta', 'host-pets', 'codex', 'runtime-endpoint.json'),
  )
})

test('development and plain candidate profiles stay on their private main endpoint', () => {
  assert.equal(resolveHostEndpointFile(appData, 'codex', { isStable: false }), '')
  assert.equal(
    resolveHostEndpointFile(appData, 'codex', { isStable: false, explicitBoundHost: '' }),
    '',
  )
})

test('explicit Pets launchers keep host-specific discovery', () => {
  assert.equal(
    resolveHostEndpointFile(appData, 'harness', {
      isStable: false,
      explicitBoundHost: 'harness',
    }),
    path.join(appData, 'uta', 'host-pets', 'harness', 'runtime-endpoint.json'),
  )
})

test('only the host manually paired in this profile gets shared discovery', () => {
  assert.equal(resolveHostEndpointFile(appData, 'codex', { isStable: false, pairedHost: 'codex' }),
    path.join(appData, 'uta', 'host-pets', 'codex', 'runtime-endpoint.json'))
  assert.equal(resolveHostEndpointFile(appData, 'qoder', { isStable: false, pairedHost: 'codex' }), '')
})
