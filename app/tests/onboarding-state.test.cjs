'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createLoader = require('./support/settings-loader.cjs')

const { createOnboardingStateStore } = createLoader()('main/onboarding-state')

function tempDir(t, prefix = 'uta-onboarding-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('a fresh profile asks for onboarding once and remembers completion', t => {
  const dir = tempDir(t)
  const store = createOnboardingStateStore(dir)
  assert.equal(store.shouldOpen(), true)
  assert.equal(store.complete('codex'), true)
  assert.equal(store.shouldOpen(), false)
  const state = store.read()
  assert.equal(state.version, 1)
  assert.equal(state.completed, true)
  assert.equal(state.hostId, 'codex')
  assert.ok(state.completedAt)
})

test('an existing profile without onboarding state is treated as an upgrade', t => {
  const dir = tempDir(t)
  fs.writeFileSync(path.join(dir, 'settings.v1.json'), '{"revision":1}')
  const store = createOnboardingStateStore(dir)
  assert.equal(store.shouldOpen(), false)
  assert.equal(store.read(), null, 'upgrade detection must not invent a completion file')
})

test('marking the guide pending keeps it reopenable after an interrupted first run', t => {
  const dir = tempDir(t)
  const store = createOnboardingStateStore(dir)
  assert.equal(store.markPending(), true)
  assert.equal(store.shouldOpen(), true)
  assert.equal(store.read().completed, false)
  fs.writeFileSync(path.join(dir, 'window-state.json'), '{}')
  assert.equal(store.shouldOpen(), true, 'a window state file must not hide an unfinished guide')
  assert.equal(store.complete('skipped'), true)
  assert.equal(store.shouldOpen(), false)
})

test('a corrupt state file never crashes and is not silently overwritten by reads', t => {
  const dir = tempDir(t)
  fs.writeFileSync(path.join(dir, 'onboarding-state.json'), '{broken')
  const store = createOnboardingStateStore(dir)
  assert.equal(store.read(), null)
  assert.equal(store.shouldOpen(), true)
  assert.equal(fs.readFileSync(path.join(dir, 'onboarding-state.json'), 'utf8'), '{broken')
})

test('invalid host ids are rejected without writing state', t => {
  const dir = tempDir(t)
  const store = createOnboardingStateStore(dir)
  for (const value of ['', '  ', 'bad host', '../escape', 'x'.repeat(80), null]) {
    assert.equal(store.complete(value), false)
  }
  assert.equal(fs.existsSync(store.file), false)
})
