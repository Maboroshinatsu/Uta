'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/services/session-scope.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const mod = { exports: {} }
vm.runInNewContext(code, { module: mod, exports: mod.exports, console })
const { SessionScope } = mod.exports

const meta = (hostId, sessionId, extra = {}) => ({ hostId, sessionId, ...extra })
const plain = (value) => JSON.parse(JSON.stringify(value))

test('legacy commands and hosts without a session stay allowed', () => {
  const scope = new SessionScope()
  assert.deepEqual(plain(scope.allows('qoder', { legacy: true })), { allowed: true, bound: false })
  assert.deepEqual(plain(scope.allows('qoder', undefined)), { allowed: true, bound: false })
  assert.deepEqual(plain(scope.allows('qoder', { hostId: 'qoder' })), { allowed: true, bound: false })
})

test('only the bound platform is allowed; other platforms are ignored', () => {
  const scope = new SessionScope()
  assert.equal(scope.allows('qoder', meta('harness', 's1')).allowed, false)
  assert.equal(scope.allows('qoder', meta('qoder', 's1')).allowed, true)
  assert.equal(scope.allows('qoder', meta('qoder', 's2')).allowed, true)
  assert.equal(scope.allows('qoder', meta('qoder', 's1', { turnId: 't2' })).allowed, true)
})

test('session binding no longer filters same-platform chats', () => {
  const scope = new SessionScope()
  assert.deepEqual(plain(scope.allows('qoder', meta('qoder', 's1'))), { allowed: true, bound: false })
  assert.equal(scope.bind('qoder', 's2'), false)
  assert.equal(scope.allows('qoder', meta('qoder', 's1')).allowed, true)
  assert.equal(scope.allows('qoder', meta('qoder', 's2')).allowed, true)
  assert.deepEqual(plain(scope.snapshot()), {})
})
