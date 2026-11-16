'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const {
  readHostSessionPreference,
  resolveHostSessionSelection,
  writeHostSessionPreference,
} = createLoader()('main/host-session-preference')

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-host-session-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('a pinned host session is stored per host and can be cleared', (t) => {
  const dir = tempDir(t)
  writeHostSessionPreference(dir, 'codex', {
    sessionId: 'session-a',
    cwd: 'D:/work/a',
    updatedAt: 1000,
  })
  writeHostSessionPreference(dir, 'harness', {
    sessionId: 'session-b',
    cwd: 'D:/work/b',
    updatedAt: 2000,
  })
  assert.equal(readHostSessionPreference(dir, 'codex').sessionId, 'session-a')
  assert.equal(readHostSessionPreference(dir, 'harness').cwd, 'D:/work/b')
  writeHostSessionPreference(dir, 'codex', null)
  assert.equal(readHostSessionPreference(dir, 'codex'), null)
  assert.equal(readHostSessionPreference(dir, 'harness').sessionId, 'session-b')
})

test('invalid host ids and malformed session preferences are rejected', (t) => {
  const dir = tempDir(t)
  assert.throws(() => writeHostSessionPreference(dir, 'bad host!', {
    sessionId: 'x', cwd: '', updatedAt: 1,
  }))
  assert.throws(() => writeHostSessionPreference(dir, 'codex', {
    sessionId: '', cwd: '', updatedAt: 1,
  }))
  fs.writeFileSync(path.join(dir, 'host-session-preference.json'), '{broken')
  assert.deepEqual(readHostSessionPreference(dir, 'codex'), null)
})

test('a pinned session that vanished from a non-empty list is reported as expired without auto-follow', () => {
  const pinned = { sessionId: 'session-b', cwd: '', updatedAt: 2 }
  const hit = resolveHostSessionSelection(['session-a', 'session-b'], pinned)
  assert.equal(hit.selectedSessionId, 'session-b')
  assert.equal(hit.selectionExpired, false)
  const expired = resolveHostSessionSelection(['session-a'], pinned)
  assert.equal(expired.selectedSessionId, null)
  assert.equal(expired.selectionExpired, true)
  const offline = resolveHostSessionSelection([], pinned)
  assert.equal(offline.selectedSessionId, null)
  assert.equal(offline.selectionExpired, false)
  const auto = resolveHostSessionSelection(['session-a'], null)
  assert.equal(auto.selectedSessionId, null)
  assert.equal(auto.selectionExpired, false)
})
