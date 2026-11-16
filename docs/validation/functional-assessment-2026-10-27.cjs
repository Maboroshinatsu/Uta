'use strict'

// Diagnostic only: no real CLI, network, runtime profile or user data writes.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const root = path.resolve(__dirname, '../..')
const appRequire = createRequire(path.join(root, 'app/package.json'))
const ts = appRequire('typescript')

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
}

function readSource(file) {
  return fs.readFileSync(path.join(root, 'app/src', file), 'utf8')
}

async function main() {
  const source = readSource('main/index.ts')
  const start = source.indexOf('  const selectedHostSession =')
  const end = source.indexOf('  const hostOnboarding =', start)
  assert.ok(start >= 0 && end > start, 'production selection helper must be found')
  const selectionModule = { exports: {} }
  vm.runInNewContext(compile('export ' + source.slice(start, end).trim()), {
    module: selectionModule,
    exports: selectionModule.exports,
    environment: { runtimeDir: 'X:/controlled-probe' },
    readHostSessionPreference: () => ({ sessionId: 'pinned-A' }),
    runtimeBridge: { sessions: { get: () => undefined } },
  })
  const selected = selectionModule.exports.selectedHostSession('codex')
  assert.equal(selected, null)

  let captured
  const fakeFs = {
    readFileSync(file) {
      assert.ok(file.endsWith('codex-session.json'), 'only the mocked session file may be read')
      return JSON.stringify({
        host: 'codex', sessionId: 'latest-B', cwd: 'X:/probe', updatedAt: Date.now() - 5000,
      })
    },
  }
  function fakeSpawn(command, args) {
    captured = { command, args }
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.stdin = new PassThrough()
    child.kill = () => {}
    queueMicrotask(() => child.emit('close', 0))
    return child
  }
  const bridgeModule = { exports: {} }
  vm.runInNewContext(compile(readSource('main/host-bridge.ts')), {
    module: bridgeModule,
    exports: bridgeModule.exports,
    require(name) {
      if (name === 'node:fs') return fakeFs
      if (name === 'node:child_process') return { spawn: fakeSpawn }
      if (name === './host-paths') return { resolveHostPaths: () => ({ codexExe: 'mock-codex' }) }
      // Deny network access even if the probe is adapted later.
      if (name === 'node:http') return { request() { throw new Error('Network disabled in diagnostic') } }
      return require(name)
    },
    process, Buffer, console, setTimeout, clearTimeout,
  })
  const missing = await bridgeModule.exports.sendHostMessage(
    'X:/probe', 'codex', 'private request', 'X:/probe/runtime', selected,
  )
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'no-session')
  assert.equal(captured, undefined)
  const original = 'a'.repeat(1000) + 'END_MARKER_请先确认再执行'
  const tooLong = await bridgeModule.exports.sendHostMessage(
    'X:/probe', 'codex', original, 'X:/probe/runtime', undefined,
  )
  assert.equal(tooLong.ok, false)
  assert.match(tooLong.error, /超过 1000 字符/)
  assert.equal(captured, undefined)
  console.log(JSON.stringify({
    probe: 'production selection helper and host bridge with mocked IO',
    intendedTarget: 'pinned-A', missingSelection: missing,
    originalLength: original.length, tooLong, processStarted: captured !== undefined,
  }))

}

main().catch(error => { console.error(error); process.exitCode = 1 })
