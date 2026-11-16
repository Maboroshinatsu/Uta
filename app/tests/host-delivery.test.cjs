'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const childProcess = require('node:child_process')
const { test } = require('node:test')
const { createPinia, setActivePinia } = require('pinia')
const createLoader = require('./support/settings-loader.cjs')

const { deliveryPresentation, deliveryLabel } = createLoader()('shared/host-delivery')

test('queue, unknown and confirmed rejection have distinct labels and recovery actions', () => {
  const queued = deliveryPresentation({ ok: true, accepted: true, delivery: 'queued' })
  assert.equal(queued.delivery, 'sent')
  assert.equal(queued.deliveryStage, 'queued')
  assert.equal(deliveryLabel(queued.delivery, queued.deliveryStage), '已排队')
  assert.equal(queued.restoreDraft, false)
  for (const receipt of [null, { ok: false, delivery: 'unknown' }]) {
    const unknown = deliveryPresentation(receipt)
    assert.equal(unknown.delivery, 'unknown')
    assert.equal(unknown.restoreDraft, false, 'an ambiguous request must not be offered as a failed-send retry')
  }
  assert.equal(deliveryPresentation({ ok: false, delivery: 'not-sent' }).restoreDraft, true)
})

test('queue receipts survive store persistence and a restart without changing the history schema', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-delivery-history-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const disk = createLoader()('main/chat-history').createChatHistory(directory)
  const api = { readChatHistory: async () => disk.read(), writeChatHistory: async entries => disk.write(entries) }
  const makeStore = () => {
    setActivePinia(createPinia())
    return createLoader({}, { window: { utaAPI: api } })('renderer/stores/chat').useChatStore()
  }
  const first = makeStore()
  await first.initializeHistory()
  const id = first.addUserMessage('queued message', { hostId: 'codex', sessionId: 'A' })
  first.setDelivery(id, 'sent', undefined, 'queued')
  await first.flushHistory()
  const persisted = JSON.parse(fs.readFileSync(path.join(directory, 'chat-history.v1.json'), 'utf8'))
  assert.equal(persisted.version, 1)
  assert.equal(persisted.entries[0].delivery, 'sent')
  const second = makeStore()
  await second.initializeHistory()
  assert.equal(second.messages[0].deliveryStage, 'queued')
  assert.equal(deliveryLabel(second.messages[0].delivery, second.messages[0].deliveryStage), '已排队')
  await second.flushHistory()
})

function sandbox(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-delivery-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

function bridge(paths, spawn = childProcess.spawn) {
  return createLoader({ './host-paths': { resolveHostPaths: () => paths }, 'node:child_process': { spawn } })('main/host-bridge')
}

test('Qoder desktop cannot borrow a CLI route; explicit CLI keeps its config, cwd and permission', async t => {
  const directory = sandbox(t)
  const host = bridge({})
  const session = { host: 'qoder', sessionId: 'qoder-target', cwd: directory, updatedAt: Date.now() - 5000 }
  assert.equal(host.getHostInputStatus(directory, 'qoder', directory, session).ready, false)
  const cli = path.join(directory, 'qoder.cjs')
  fs.writeFileSync(cli, `process.stdout.write(JSON.stringify({type:'result',session_id:'qoder-target',result:JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),config:process.env.UTA_QODER_CONFIG_DIR})}))`)
  const injected = bridge({}, (exe, args, options) => childProcess.spawn(exe, [cli, ...args], options))
  const registered = { ...session, inputSurface: 'cli', hostExecutable: process.execPath, hostConfigDir: directory, hostPluginDir: directory, permissionMode: 'default', activity: 'idle' }
  const result = await injected.sendHostMessage(directory, 'qoder', 'hello', directory, registered)
  assert.equal(result.delivery, 'completed')
  const actual = JSON.parse(result.text)
  for (const [flag, value] of [['--resume', session.sessionId], ['--config-dir', directory], ['--cwd', directory], ['--permission-mode', 'default']]) assert.equal(actual.args[actual.args.indexOf(flag) + 1], value)
  assert.equal(actual.cwd, directory)
  assert.equal(actual.config, directory)
  assert.equal(actual.args.includes('--dangerously-skip-permissions'), false)
})

test('a queued native CLI exit reports only queue admission and preserves the selected session', async t => {
  const directory = sandbox(t)
  const cli = path.join(directory, 'cli.cjs')
  const argsFile = path.join(directory, 'args.json')
  fs.writeFileSync(cli, `require('node:fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2))); process.stdout.write('queued')`)
  const host = bridge({ codexExe: process.execPath }, (exe, args, options) => childProcess.spawn(exe, [cli, ...args], options))
  const session = { host: 'codex', sessionId: 'A', cwd: directory, activity: 'busy', updatedAt: Date.now() }
  const displayed = host.getHostInputStatus(directory, 'codex', directory, session).targetSession
  assert.equal(displayed.sessionId, 'A')
  const result = await host.sendHostMessage(directory, 'codex', 'hello', undefined, session, displayed.sessionId)
  assert.equal(result.delivery, 'queued')
  assert.equal(result.sessionId, 'A')
  assert.match(result.text, /已排队/)
  assert.equal(JSON.parse(fs.readFileSync(argsFile, 'utf8'))[2], 'A')
})

test('a displayed target changing before send preserves the draft and starts no host process', async t => {
  const directory = sandbox(t)
  let launches = 0
  const host = bridge({ codexExe: process.execPath }, () => { launches++; throw Error('stale target') })
  const session = { host: 'codex', sessionId: 'B', cwd: directory, updatedAt: Date.now() }
  const receipt = await host.sendHostMessage(directory, 'codex', 'my draft', directory, session, 'A')
  assert.equal(receipt.code, 'target-changed')
  assert.equal(receipt.delivery, 'not-sent')
  assert.equal(deliveryPresentation(receipt).restoreDraft, true)
  assert.equal(launches, 0)
})

test('a host mismatch cannot start another host or use its latest session', async t => {
  const host = bridge({ codexExe: process.execPath }, () => { throw Error('must not spawn') })
  const result = await host.sendHostMessage(sandbox(t), 'codex', 'hello', undefined, { host: 'claude-code', sessionId: 'A', cwd: '', updatedAt: Date.now() - 5000 })
  assert.equal(result.delivery, 'not-sent')
  assert.equal(result.code, 'no-session')
})

test('resume hosts remain busy after the last hook ages past the recent-file threshold', async t => {
  const directory = sandbox(t)
  const host = bridge({ claudeExe: process.execPath }, () => { throw Error('busy host must not spawn') })
  const session = { host: 'claude-code', sessionId: 'A', cwd: directory, activity: 'busy', updatedAt: Date.now() - 20_000 }
  assert.equal(host.getHostInputStatus(directory, 'claude-code', directory, session).ready, false)
  const receipt = await host.sendHostMessage(directory, 'claude-code', 'hello', directory, session)
  assert.equal(receipt.code, 'busy')
  assert.equal(receipt.delivery, 'not-sent')
  const { reportHostSession, resolveHost } = await import(require('node:url').pathToFileURL(path.resolve(__dirname, '../../plugin/shared/uta-host-hook.mjs')).href)
  const env = { UTA_USER_DATA_DIR: directory, UTA_RUNTIME_DIR: directory }
  for (const [event, activity] of [['PreToolUse', 'busy'], ['Stop', 'idle']]) {
    reportHostSession(resolveHost(['--host=claude-code']), { session_id: 'A', cwd: directory, hook_event_name: event }, env)
    assert.equal(host.readHostSession(directory, 'claude-code', directory, 'A').activity, activity, 'busy->idle within 2s must not be throttled away')
  }
})

test('OpenCode sessions keep their owning native bridge and never fall back to another server', async t => {
  const directory = sandbox(t), received = []
  const ids = [require('node:crypto').randomUUID(), require('node:crypto').randomUUID()]
  const nativeRoot = path.join(directory, 'hooks/native-bridges/opencode')
  fs.mkdirSync(nativeRoot, { recursive: true })
  for (const [index, id] of ids.entries()) {
    const server = http.createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk
      const input = JSON.parse(raw); received.push({ server: index, session: input.sessionId })
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, accepted: true, delivery: 'queued', sessionId: input.sessionId }))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
    const metadata = JSON.stringify({ version: 1, pid: process.pid, port: server.address().port, token: 'fake-test-native-token' })
    fs.writeFileSync(path.join(nativeRoot, `${id}.json`), metadata)
    fs.writeFileSync(path.join(directory, 'hooks/opencode-native-bridge.json'), metadata)
  }
  const session = { host: 'opencode', sessionId: 'A', cwd: directory, updatedAt: Date.now(), nativeBridgeId: ids[0] }
  const host = bridge({})
  assert.equal(host.getHostInputStatus(directory, 'opencode', directory, session).mode, 'queue')
  const owner = path.join(nativeRoot, `${ids[0]}.json`)
  const ownerInfo = JSON.parse(fs.readFileSync(owner, 'utf8'))
  fs.writeFileSync(owner, JSON.stringify({ ...ownerInfo, delivery: 'accepted' }))
  const input = host.getHostInputStatus(directory, 'opencode', directory, session)
  assert.equal(input.mode, 'native')
  assert.doesNotMatch(input.detail, /排队/)
  assert.equal((await bridge({}).sendHostMessage(directory, 'opencode', 'hello', directory, session)).delivery, 'queued')
  assert.deepEqual(received, [{ server: 0, session: 'A' }])
  fs.rmSync(path.join(nativeRoot, `${ids[0]}.json`))
  const missing = await bridge({}).sendHostMessage(directory, 'opencode', 'hello', directory, session)
  assert.equal(missing.delivery, 'not-sent')
  assert.equal(received.length, 1, 'a live latest bridge must not replace the selected session owner')
})

test('ZCode cannot fall through to the CLI default when its permission mode is unknown', async t => {
  const host = bridge({ nodeExe: process.execPath, zcodeCli: 'must-not-run' }, () => { throw Error('must not spawn') })
  const result = await host.sendHostMessage(sandbox(t), 'zcode', 'hello', undefined, { host: 'zcode', sessionId: 'A', cwd: '', updatedAt: Date.now() - 5000 })
  assert.equal(result.delivery, 'not-sent')
  assert.match(result.error, /权限模式/)
})

test('ZCode keeps the recorded plan permission instead of the CLI prompt default', async t => {
  const directory = sandbox(t)
  const cli = path.join(directory, 'zcode.cjs')
  fs.writeFileSync(cli, "process.stdout.write(JSON.stringify({ sessionId: 'A', response: JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) }))")
  const host = bridge({ nodeExe: process.execPath, zcodeCli: cli })
  const result = await host.sendHostMessage(directory, 'zcode', 'hello', undefined, { host: 'zcode', sessionId: 'A', cwd: directory, permissionMode: 'plan', updatedAt: Date.now() - 5000 })
  const actual = JSON.parse(result.text)
  assert.equal(actual.argv[actual.argv.indexOf('--mode') + 1], 'plan')
  assert.equal(actual.argv[actual.argv.indexOf('--resume') + 1], 'A')
  assert.equal(actual.cwd, directory)
})

test('session metadata keeps separate configuration and permission ownership for each session', async t => {
  const directory = sandbox(t)
  const { reportHostSession, resolveHost } = await import(require('node:url').pathToFileURL(path.resolve(__dirname, '../../plugin/shared/uta-host-hook.mjs')).href)
  const env = { APPDATA: directory }
  reportHostSession(resolveHost(['--host=zcode']), { session_id: 'A', cwd: directory, permission_mode: 'plan' }, env)
  reportHostSession(resolveHost(['--host=zcode']), { session_id: 'B', cwd: directory, permission_mode: 'yolo' }, env)
  const host = bridge({})
  assert.equal(host.readHostSession(directory, 'zcode', undefined, 'A').permissionMode, 'plan')
  assert.equal(host.readHostSession(directory, 'zcode', undefined, 'B').permissionMode, 'yolo')
  assert.equal(host.readHostSession(directory, 'zcode', undefined, 'missing'), null)
  const configA = path.join(directory, 'config-A'), configB = path.join(directory, 'config-B')
  reportHostSession(resolveHost(['--host=codex']), { session_id: 'C', cwd: directory }, { ...env, CODEX_HOME: configA })
  reportHostSession(resolveHost(['--host=codex']), { session_id: 'D', cwd: directory }, { ...env, CODEX_HOME: configB })
  assert.equal(host.readHostSession(directory, 'codex', undefined, 'C').hostConfigDir, configA)
  assert.equal(host.readHostSession(directory, 'codex', undefined, 'D').hostConfigDir, configB)
})

test('a truncated DSH success response settles as unknown without a fallback process', async t => {
  const directory = sandbox(t)
  const hooks = path.join(directory, 'uta/hooks')
  fs.mkdirSync(hooks, { recursive: true })
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': 500 })
      res.write('{"ok":true,')
      setTimeout(() => res.destroy(), 10)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  fs.writeFileSync(path.join(hooks, 'deepseek-harness-native-bridge.json'), JSON.stringify({ version: 1, port: server.address().port, token: 'isolated-regression-token', pid: process.pid }))
  const host = bridge({ harnessExe: process.execPath, harnessCli: 'must-not-run' }, () => { throw Error('must not spawn') })
  const target = { host: 'deepseek-harness', sessionId: 'A', cwd: directory, updatedAt: Date.now() - 5000 }
  const result = await host.sendHostMessage(directory, 'deepseek-harness', 'one message', undefined, target)
  assert.equal(result.delivery, 'unknown')
  assert.equal(deliveryPresentation(result).restoreDraft, false)
})
