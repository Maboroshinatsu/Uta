'use strict'
// P2/L0：本机角色指令端点。真实回环 HTTP；Electron 用替身；不涉及真实桌宠窗口。
const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const vm = require('node:vm')
const ts = require('typescript')
const load = require('./support/settings-loader.cjs')()

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/main/runtime-bridge.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
).outputText


let commandsModule = null
function loadCommands() {
  if (commandsModule) return commandsModule
  const cmds = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../src/main/runtime-commands.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  const hostModule = { exports: {} }
  vm.runInNewContext(cmds, { module: hostModule, exports: hostModule.exports })
  commandsModule = hostModule.exports
  return commandsModule
}

let sessionsModule = null
function loadSessions() {
  if (sessionsModule) return sessionsModule
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../src/main/runtime-sessions.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  const hostModule = { exports: {} }
  vm.runInNewContext(source, { module: hostModule, exports: hostModule.exports })
  sessionsModule = hostModule.exports
  return sessionsModule
}

let protocolModule = null
function loadProtocol() {
  if (!protocolModule) {
    protocolModule = require(path.join(__dirname, '../../plugin/shared/uta-protocol.mjs'))
  }
  return protocolModule
}

function loadBridge(userData) {
  const hostModule = { exports: {} }
  const dependencies = {
    electron: {
      app: { getPath: () => userData },
      BrowserWindow: { getAllWindows: () => [] },
    },
    // 加载真实的校验模块，使测试覆盖实际使用的边界逻辑
    './runtime-commands': loadCommands(),
    './chat-image': load('main/chat-image'),
    './runtime-sessions': loadSessions(),
    '../shared/motion-choreography': load('shared/motion-choreography'),
    '../../../plugin/shared/uta-protocol.mjs': loadProtocol(),
  }
  vm.runInNewContext(code, {
    module: hostModule, exports: hostModule.exports,
    require: (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      return require(name)
    },
    process, console, Buffer, URL, URLSearchParams, Date, JSON, Promise, setTimeout, clearTimeout, AbortController,
  }, { filename: 'runtime-bridge.ts' })
  return hostModule.exports
}

const tmpDirs = new Set()
function tmpdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskpet-bridge-'))
  tmpDirs.add(dir)
  return dir
}
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
  tmpDirs.clear()
})

function request(port, { method = 'POST', route = '/command', token, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1', port, path: route, method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
      timeout: 5000,
    }, (res) => {
      res.setEncoding('utf-8')
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(data) } catch { /* 非 JSON */ }
        resolve({ status: res.statusCode, body: parsed, raw: data })
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (payload !== null) req.write(payload)
    req.end()
  })
}

async function start(t, options = {}) {
  const dir = tmpdir()
  const bridgeMod = loadBridge(dir)
  const delivered = []
  const metas = []
  const bridge = await bridgeMod.startRuntimeBridge({
    sink: async (cmd, meta) => {
      delivered.push(cmd)
      metas.push(meta)
      return options.deliver ? options.deliver(cmd, meta) : options.sinkResult ?? true
    },
    available: options.available ?? (() => true),
    endpointFile: options.endpointFile ?? path.join(dir, 'runtime-endpoint.json'),
    extraEndpointFile: options.extraEndpointFile,
    allowedHostId: options.allowedHostId,
    onApprovalRequest: options.onApprovalRequest,
    onApprovalCancel: options.onApprovalCancel,
    getContextSnapshot: options.getContextSnapshot,
  })
  t.after(() => bridge.close())
  return { bridge, delivered, metas, dir, bridgeMod }
}

test('model commands reject stale capabilities and unsupported actions before delivery', async t => {
  let model = { revision: 'model-A', ready: true, kind: 'live2d', modelName: 'A', emotions: ['happy'], animations: ['wave'], presetGroups: [{ group: '开心', emotion: 'happy', presets: ['开心1'] }] }
  const { bridge, delivered, metas } = await start(t, { getContextSnapshot: () => ({ modelContext: model }) })
  const send = body => request(bridge.port, { token: bridge.token, body })
  assert.equal((await send({ command: 'set_preset', preset: '开心1', modelRevision: 'model-A' })).status, 200)
  assert.equal(metas[0].modelRevision, 'model-A')
  model = { revision: 'model-B', ready: true, kind: 'image-set', modelName: 'B', emotions: ['neutral'], animations: [], presetGroups: [] }
  assert.equal((await send({ command: 'set_preset', preset: '开心1', modelRevision: 'model-A' })).status, 409)
  assert.equal((await send({ command: 'play_animation', name: 'wave' })).status, 422)
  assert.equal(delivered.length, 1)
  assert.equal((await send({ command: 'set_emotion', emotion: 'neutral', modelRevision: 'model-B' })).status, 200)
  model.ready = false
  assert.equal((await send({ command: 'set_emotion', emotion: 'neutral', modelRevision: 'model-B' })).status, 409)
  assert.equal(delivered.length, 2)

  // 中文原生动作与 #索引 语法校验
  model = { revision: 'model-C', ready: true, kind: 'live2d', modelName: '大肥鱼', emotions: ['default'], animations: ['脱捕', '狗尾巴草打开', 'Tap'], presetGroups: [] }
  assert.equal((await send({ command: 'play_animation', name: '脱捕', modelRevision: 'model-C' })).status, 200)
  assert.equal((await send({ command: 'play_animation', name: '脱捕#0', modelRevision: 'model-C' })).status, 200)
  assert.equal((await send({ command: 'play_animation', name: '狗尾巴草打开', modelRevision: 'model-C' })).status, 200)
  assert.equal((await send({ command: 'play_animation', name: 'tap#1', modelRevision: 'model-C' })).status, 200)
  assert.equal((await send({ command: 'play_animation', name: '不存在的动作', modelRevision: 'model-C' })).status, 422)
  assert.equal(delivered.length, 6)
})

test('private data identity survives restart and differs across profiles despite equal display names', async t => {
  const dir = tmpdir(), mod = loadBridge(dir)
  const file = path.join(dir, 'one.json')
  const first = await mod.startRuntimeBridge({ sink: () => true, endpointFile: file, profile: 'same-name', stableData: true })
  const a = JSON.parse(fs.readFileSync(file, 'utf8'))
  await first.close()
  const second = await mod.startRuntimeBridge({ sink: () => true, endpointFile: file, profile: 'same-name', stableData: true })
  const b = JSON.parse(fs.readFileSync(file, 'utf8'))
  await second.close()
  const otherFile = path.join(dir, 'two.json')
  const other = await mod.startRuntimeBridge({ sink: () => true, endpointFile: otherFile, profile: 'same-name' })
  t.after(() => other.close())
  const c = JSON.parse(fs.readFileSync(otherFile, 'utf8'))
  assert.match(a.profileId, /^[a-f0-9]{64}$/)
  assert.equal(a.profileId, b.profileId)
  assert.notEqual(a.instanceId, b.instanceId)
  assert.notEqual(a.token, b.token)
  assert.notEqual(a.profileId, c.profileId)
  assert.equal(b.stableData, true)
  assert.equal(c.stableData, false)
})

test('endpoint file is written with token/port and removed on close', async (t) => {
  const dir = tmpdir()
  const endpointFile = path.join(dir, 'runtime-endpoint.json')
  const bridgeMod = loadBridge(dir)
  const bridge = await bridgeMod.startRuntimeBridge({ sink: async () => true, endpointFile })

  const info = JSON.parse(fs.readFileSync(endpointFile, 'utf-8'))
  assert.equal(info.port, bridge.port)
  assert.equal(info.token, bridge.token)
  assert.equal(info.version, 2)
  assert.equal(info.protocolVersion, '2.0')
  assert.ok(info.token.length >= 32, '令牌应足够长')

  await bridge.close()
  assert.equal(fs.existsSync(endpointFile), false, '关闭后应删除端点文件')
})

test('does not delete an endpoint file owned by another instance', async (t) => {
  const dir = tmpdir()
  const endpointFile = path.join(dir, 'runtime-endpoint.json')
  const bridgeMod = loadBridge(dir)
  const bridge = await bridgeMod.startRuntimeBridge({ sink: async () => true, endpointFile })

  fs.writeFileSync(
    endpointFile,
    JSON.stringify({ version: 1, port: 1, token: 'another-instance-token', createdAt: new Date().toISOString() }),
  )
  await bridge.close()
  assert.equal(fs.existsSync(endpointFile), true, '不应误删其他实例的配对文件')
})

test('a pairing-file publish failure closes the newly created listener', async () => {
  const dir = tmpdir()
  const file = path.join(dir, 'runtime-endpoint.json')
  // 目标是非空目录，真实文件系统会拒绝替换，不依赖操作系统 ACL。
  fs.mkdirSync(file)
  fs.writeFileSync(path.join(file, 'occupied'), 'x')
  const http = require('node:http')
  const original = http.createServer
  let listener
  http.createServer = (...args) => (listener = original(...args))
  try {
    await assert.rejects(loadBridge(dir).startRuntimeBridge({ sink: async () => true, endpointFile: file }))
    assert.equal(listener.listening, false)
  } finally {
    http.createServer = original
    listener?.close()
  }
})

test('requests without a valid bearer token are rejected', async (t) => {
  const { bridge } = await start(t)
  assert.equal((await request(bridge.port, { body: { command: 'notify', text: 'x' } })).status, 401)
  assert.equal((await request(bridge.port, { token: 'wrong', body: { command: 'notify', text: 'x' } })).status, 401)
  assert.equal((await request(bridge.port, { token: bridge.token.slice(0, 8), body: {} })).status, 401)
})

test('unknown routes and wrong methods are rejected', async (t) => {
  const { bridge } = await start(t)
  assert.equal((await request(bridge.port, { route: '/../etc', token: bridge.token, body: {} })).status, 404)
  assert.equal((await request(bridge.port, { route: '/command', method: 'GET', token: bridge.token })).status, 405)
  assert.equal((await request(bridge.port, { route: '/health', method: 'POST', token: bridge.token, body: {} })).status, 405)
})

test('health reports availability without side effects', async (t) => {
  const { bridge, delivered } = await start(t, { available: () => true })
  const res = await request(bridge.port, { route: '/health', method: 'GET', token: bridge.token })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.characterAvailable, true)
  assert.equal(res.body.protocolVersion, '2.0')
  assert.ok(res.body.capabilities.includes('sessionBinding'))
  assert.equal(res.body.maxBodyBytes, 8 * 1024)
  assert.equal(delivered.length, 0, '健康检查不得发送任何指令')

  const off = await start(t, { available: () => false })
  const res2 = await request(off.bridge.port, { route: '/health', method: 'GET', token: off.bridge.token })
  assert.equal(res2.body.characterAvailable, false)
})

test('malformed JSON is rejected with 400', async (t) => {
  const { bridge } = await start(t)
  const res = await request(bridge.port, { token: bridge.token, body: '{not json' })
  assert.equal(res.status, 400)
  assert.match(res.body.error, /invalid json/i)
})

test('invalid commands are rejected before reaching the renderer', async (t) => {
  const { bridge, delivered } = await start(t)
  for (const body of [
    { command: 'run_command', argv: ['calc'] },
    { command: 'read_file', path: 'C:\\secret' },
    { command: 'notify', text: '' },
    { command: 'set_emotion', emotion: 'a; rm -rf /' },
    { command: 'play_animation' },
    {},
  ]) {
    const res = await request(bridge.port, { token: bridge.token, body })
    assert.equal(res.status, 400, `should reject ${JSON.stringify(body)}`)
    assert.equal(res.body.ok, false)
  }
  assert.equal(delivered.length, 0, '非法指令绝不能触达渲染层')
})

test('valid commands are normalized then delivered to the sink', async (t) => {
  const { bridge, delivered } = await start(t)
  const res = await request(bridge.port, { token: bridge.token, body: { command: 'notify', text: '  hi   there ' } })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.legacy, true)
  assert.equal(res.body.hostId, 'legacy')
  assert.deepEqual(delivered.map((d) => JSON.parse(JSON.stringify(d))), [{ command: 'notify', text: 'hi there' }])

  await request(bridge.port, { token: bridge.token, body: { command: 'set_emotion', emotion: 'happy' } })
  await request(bridge.port, { token: bridge.token, body: { command: 'play_animation', name: 'wave', loop: true } })
  await request(bridge.port, { token: bridge.token, body: { command: 'play_animation', name: '脱捕', loop: true } })
  await request(bridge.port, { token: bridge.token, body: { command: 'play_animation', name: '狗尾巴草打开', loop: false } })
  assert.deepEqual(delivered.map((d) => JSON.parse(JSON.stringify(d))), [
    { command: 'notify', text: 'hi there' },
    { command: 'set_emotion', emotion: 'happy' },
    { command: 'play_animation', name: 'wave', loop: true },
    { command: 'play_animation', name: '脱捕', loop: true },
    { command: 'play_animation', name: '狗尾巴草打开', loop: false },
  ])
})

test('v2 envelopes keep host/session/turn identity and deliver meta to the sink', async (t) => {
  const { bridge, delivered, metas } = await start(t)
  const res = await request(bridge.port, {
    token: bridge.token,
    body: {
      protocolVersion: '2.0',
      meta: { hostId: 'qoder', sessionId: 's1', turnId: 't1', eventId: 'e1' },
      command: { command: 'notify', text: 'hello' },
    },
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.legacy, false)
  assert.equal(res.body.protocolVersion, '2.0')
  assert.equal(res.body.hostId, 'qoder')
  assert.equal(res.body.sessionId, 's1')
  assert.deepEqual(delivered.map((d) => JSON.parse(JSON.stringify(d))), [{ command: 'notify', text: 'hello' }])
  assert.equal(metas[0].hostId, 'qoder')
  assert.equal(metas[0].sessionId, 's1')
  assert.equal(metas[0].turnId, 't1')
  assert.equal(metas[0].eventId, 'e1')
})

test('MaiBot media uses a separate authenticated route and deduplicates by session event', async (t) => {
  let boundHost = 'maibot'
  const { bridge, delivered, metas } = await start(t, { allowedHostId: () => boundHost })
  const base64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  const body = {
    protocolVersion: '2.0',
    meta: { hostId: 'maibot', sessionId: 'test-chat', eventId: 'image-1' },
    command: { command: 'chat_image', base64, description: '表情包' },
  }
  const send = (override = {}) => request(bridge.port, { route: '/maibot-media', token: bridge.token, body, ...override })
  assert.equal((await send({ token: '' })).status, 401)
  assert.equal((await send({ route: '/command' })).status, 400)
  assert.equal((await send({ body: { ...body, meta: { ...body.meta, hostId: 'codex' } } })).status, 403)
  assert.equal((await send({ body: { ...body, command: { ...body.command, base64: 'PHN2Zy8+' } } })).status, 400)
  assert.equal((await send({ body: 'x'.repeat(2 * 1024 * 1024), headers: { Connection: 'close' } })).status, 413)
  boundHost = 'codex'
  assert.equal((await send()).status, 403)
  boundHost = 'maibot'
  assert.equal((await send()).status, 200)
  assert.equal((await send()).body.duplicate, true)
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].image.mimeType, 'image/gif')
  assert.equal(delivered[0].image.base64, base64)
  assert.equal(metas[0].sessionId, 'test-chat')
  boundHost = 'astrbot'
  const astrbot = { ...body, meta: { ...body.meta, hostId: 'astrbot' } }
  assert.equal((await send({ body: astrbot })).status, 403)
  assert.equal((await send({ route: '/astrbot-media', body: astrbot })).status, 200)
  assert.equal(metas[1].hostId, 'astrbot')
})

test('a host-scoped context query requires the matching binding', async (t) => {
  let host = 'codex'
  const { bridge } = await start(t, { allowedHostId: () => host })
  const get = (route) => request(bridge.port, { method: 'GET', route, token: bridge.token })
  assert.equal((await get('/context')).status, 200)
  assert.equal((await get('/context?hostId=')).status, 403)
  assert.equal((await get('/context?hostId=maibot')).status, 403)
  host = ''
  assert.equal((await get('/context?hostId=maibot')).status, 403)
  host = 'maibot'
  assert.equal((await get('/context?hostId=maibot')).status, 200)
})

test('hello is consumed by the bridge and exposed through /context', async (t) => {
  const { bridge, delivered } = await start(t)
  const hello = await request(bridge.port, {
    token: bridge.token,
    body: {
      protocolVersion: '2.0',
      meta: { hostId: 'harness', sessionId: 's1', hostInstanceId: 'install-a' },
      command: { command: 'hello', sdkVersion: '0.6.0', capabilities: ['statusEvents', 'approval'] },
    },
  })
  assert.equal(hello.status, 200)
  assert.equal(hello.body.command, 'hello')
  assert.equal(hello.body.ack.protocolVersion, '2.0')
  assert.ok(hello.body.ack.capabilities.includes('sessionBinding'))
  assert.equal(delivered.length, 0, 'hello 不应进入渲染层')

  const context = await request(bridge.port, { route: '/context', method: 'GET', token: bridge.token })
  const session = context.body.sessions.find((entry) => entry.key === 'harness:s1')
  assert.ok(session)
  assert.equal(session.hostInstanceId, 'install-a')
  assert.deepEqual([...session.capabilities], ['statusEvents', 'approval'])
})

test('duplicate eventIds are acknowledged without redelivery', async (t) => {
  const { bridge, delivered } = await start(t)
  const body = {
    protocolVersion: '2.0',
    meta: { hostId: 'qoder', sessionId: 's1', eventId: 'dup-1' },
    command: { command: 'notify', text: 'once' },
  }
  const first = await request(bridge.port, { token: bridge.token, body })
  const second = await request(bridge.port, { token: bridge.token, body })
  assert.equal(first.status, 200)
  assert.equal(first.body.duplicate, undefined)
  assert.equal(second.status, 200)
  assert.equal(second.body.duplicate, true)
  assert.equal(delivered.length, 1)
})

test('an in-flight duplicate waits for the first delivery and mirrors its failure', async (t) => {
  const dir = tmpdir()
  const bridgeMod = loadBridge(dir)
  let calls = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const bridge = await bridgeMod.startRuntimeBridge({
    sink: async () => { calls += 1; await gate; return false },
    endpointFile: path.join(dir, 'runtime-endpoint.json'),
  })
  t.after(() => bridge.close())
  const body = {
    protocolVersion: '2.0',
    meta: { hostId: 'codex', sessionId: 's1', eventId: 'same-event', seq: 1 },
    command: { command: 'notify', text: 'isolated probe' },
  }
  const first = request(bridge.port, { token: bridge.token, body })
  while (calls === 0) await new Promise(resolve => setTimeout(resolve, 10))
  let secondSettled = false
  const second = request(bridge.port, { token: bridge.token, body }).then(result => {
    secondSettled = true
    return result
  })
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(secondSettled, false, 'the duplicate must wait for the original delivery')
  release()
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(firstResult.status, 503)
  assert.equal(secondResult.status, 503)
  assert.equal(calls, 1)
})

test('an in-flight duplicate reports duplicate only after the first delivery succeeds', async (t) => {
  const dir = tmpdir()
  const bridgeMod = loadBridge(dir)
  let calls = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const bridge = await bridgeMod.startRuntimeBridge({
    sink: async () => { calls += 1; await gate; return true },
    endpointFile: path.join(dir, 'runtime-endpoint.json'),
  })
  t.after(() => bridge.close())
  const body = {
    protocolVersion: '2.0',
    meta: { hostId: 'codex', sessionId: 's1', eventId: 'same-event-ok', seq: 1 },
    command: { command: 'notify', text: 'isolated probe' },
  }
  const first = request(bridge.port, { token: bridge.token, body })
  while (calls === 0) await new Promise(resolve => setTimeout(resolve, 10))
  const second = request(bridge.port, { token: bridge.token, body })
  release()
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(firstResult.status, 200)
  assert.equal(firstResult.body.duplicate, undefined)
  assert.equal(secondResult.status, 200)
  assert.equal(secondResult.body.duplicate, true)
  assert.equal(calls, 1)
})

test('an unbound pet rejects legacy commands, then accepts them once bound', async (t) => {
  let bound = ''
  const { bridge, delivered } = await start(t, { allowedHostId: () => bound })
  const legacy = { command: 'notify', text: 'legacy' }
  const rejected = await request(bridge.port, { token: bridge.token, body: legacy })
  assert.equal(rejected.status, 403)
  assert.equal(delivered.length, 0)
  bound = 'codex'
  const accepted = await request(bridge.port, { token: bridge.token, body: legacy })
  assert.equal(accepted.status, 200)
  assert.equal(delivered.length, 1)
})

test('a bound pet rejects events from another platform', async (t) => {
  const { bridge, delivered, dir } = await start(t, { allowedHostId: () => 'codex' })
  const foreign = await request(bridge.port, {
    token: bridge.token,
    body: {
      protocolVersion: '2.0',
      meta: { hostId: 'qoder', sessionId: 'q1', eventId: 'foreign-1' },
      command: { command: 'notify', text: 'should not arrive' },
    },
  })
  assert.equal(foreign.status, 403)
  assert.equal(foreign.body.error, 'host-not-bound')
  assert.equal(delivered.length, 0)

  const own = await request(bridge.port, {
    token: bridge.token,
    body: {
      protocolVersion: '2.0',
      meta: { hostId: 'codex', sessionId: 'c1', eventId: 'own-1' },
      command: { command: 'notify', text: 'arrives' },
    },
  })
  assert.equal(own.status, 200)
  assert.equal(delivered.length, 1)
  assert.ok(dir)
})

test('the host-specific endpoint is published, switchable and removed on close', async t => {
  const dir = tmpdir()
  const bridgeMod = loadBridge(dir)
  const extraFile = path.join(dir, 'host-pets', 'codex', 'runtime-endpoint.json')
  const bridge = await bridgeMod.startRuntimeBridge({
    sink: async () => true,
    endpointFile: path.join(dir, 'runtime-endpoint.json'),
    extraEndpointFile: extraFile,
  })
  t.after(() => bridge.close())
  const published = JSON.parse(fs.readFileSync(extraFile, 'utf-8'))
  assert.equal(published.port, bridge.port)
  assert.equal(published.token, bridge.token)

  const nextFile = path.join(dir, 'host-pets', 'codex', 'next.json')
  bridge.setExtraEndpointFile(nextFile)
  assert.equal(fs.existsSync(extraFile), false)
  assert.equal(JSON.parse(fs.readFileSync(nextFile, 'utf-8')).port, bridge.port)

  bridge.setExtraEndpointFile('')
  assert.equal(fs.existsSync(nextFile), false)
})

test('a second live instance cannot replace or delete the shared host endpoint', async t => {
  const dir = tmpdir()
  const bridgeMod = loadBridge(dir)
  const shared = path.join(dir, 'host-pets', 'qoder', 'runtime-endpoint.json')
  const first = await bridgeMod.startRuntimeBridge({
    sink: async () => true,
    endpointFile: path.join(dir, 'first.json'),
    extraEndpointFile: shared,
  })
  t.after(() => first.close())
  const firstInfo = JSON.parse(fs.readFileSync(shared, 'utf-8'))
  assert.equal(firstInfo.token, first.token)

  const second = await bridgeMod.startRuntimeBridge({
    sink: async () => true,
    endpointFile: path.join(dir, 'second.json'),
    extraEndpointFile: shared,
  })
  const afterSecondStart = JSON.parse(fs.readFileSync(shared, 'utf-8'))
  assert.equal(afterSecondStart.token, first.token, '后启动的实例不能抢走共享端点')
  assert.notEqual(afterSecondStart.token, second.token)

  assert.equal(second.setExtraEndpointFile(shared), false, 'reconnect reports a live pairing conflict')

  await second.close()
  assert.equal(fs.existsSync(shared), true, '后启动实例退出不能删掉原实例端点')
  assert.equal(JSON.parse(fs.readFileSync(shared, 'utf-8')).token, first.token)

  await first.close()
  assert.equal(fs.existsSync(shared), false, '原实例退出后才清理自己的热点')
})

test('reconnect retries the same pairing path after the previous owner exits', async t => {
  const dir = tmpdir(), bridgeMod = loadBridge(dir)
  const shared = path.join(dir, 'host-pets', 'codex', 'runtime-endpoint.json')
  const first = await bridgeMod.startRuntimeBridge({ sink: async () => true, endpointFile: path.join(dir, 'one.json'), extraEndpointFile: shared })
  const second = await bridgeMod.startRuntimeBridge({ sink: async () => true, endpointFile: path.join(dir, 'two.json'), extraEndpointFile: shared })
  t.after(() => first.close())
  t.after(() => second.close())
  assert.equal(second.setExtraEndpointFile(shared), false)
  await first.close()
  assert.equal(second.setExtraEndpointFile(shared), true)
  assert.equal(JSON.parse(fs.readFileSync(shared, 'utf8')).token, second.token)
})

test('sequence gaps are marked but the event is still delivered', async (t) => {
  const { bridge, delivered } = await start(t)
  const send = (seq, text) =>
    request(bridge.port, {
      token: bridge.token,
      body: {
        protocolVersion: '2.0',
        meta: { hostId: 'qoder', sessionId: 's1', eventId: `seq-${seq}`, seq },
        command: { command: 'notify', text },
      },
    })
  const first = await send(2, 'two')
  const gap = await send(5, 'five')
  assert.equal(first.body.gap, undefined)
  assert.equal(gap.body.gap, true)
  assert.equal(delivered.length, 2)

  const context = await request(bridge.port, { route: '/context', method: 'GET', token: bridge.token })
  const session = context.body.sessions.find((entry) => entry.key === 'qoder:s1')
  assert.equal(session.incomplete, true)
  assert.equal(session.lastSeq, 5)
})

test('late notifications can retry, while an obsolete state gets no success receipt', async t => {
  let fail = true
  const { bridge, delivered } = await start(t, { deliver: (_, meta) => meta.seq !== 1 || !fail })
  const send = (seq, command) => request(bridge.port, { token: bridge.token, body: {
    protocolVersion: '2.0', meta: { hostId: 'codex', sessionId: 'isolated', eventId: `event-${seq}`, seq }, command,
  } })
  const notice = { command: 'notify', text: 'retry me' }
  const newer = { command: 'agent_state', state: 'thinking' }
  assert.equal((await send(1, notice)).status, 503)
  assert.equal((await send(3, newer)).status, 200)
  fail = false
  const retry = await send(1, notice)
  assert.equal(retry.body.accepted, true)
  assert.equal(retry.body.duplicate, undefined)
  assert.equal((await send(1, notice)).body.duplicate, true)
  const stale = await send(2, { command: 'agent_state', state: 'idle' })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.accepted, false)
  assert.deepEqual(delivered.map(command => command.command), ['notify', 'agent_state', 'notify'])
})

test('session_bind updates the registry and reaches the renderer with meta', async (t) => {
  const { bridge, delivered, metas } = await start(t)
  const res = await request(bridge.port, {
    token: bridge.token,
    body: {
      protocolVersion: '2.0',
      meta: { hostId: 'qoder', sessionId: 's2' },
      command: { command: 'session_bind', label: '会话 B', cwd: 'D:/work' },
    },
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.accepted, true)
  assert.equal(delivered[0].command, 'session_bind')
  assert.equal(metas[0].sessionId, 's2')

  const context = await request(bridge.port, { route: '/context', method: 'GET', token: bridge.token })
  const session = context.body.sessions.find((entry) => entry.key === 'qoder:s2')
  assert.equal(session.label, '会话 B')
  assert.equal(session.cwd, 'D:/work')
  assert.equal(session.lastCommand, 'session_bind')
})

test('malformed v2 envelopes are rejected before the sink', async (t) => {
  const { bridge, delivered } = await start(t)
  for (const body of [
    { protocolVersion: '9.0', meta: { hostId: 'qoder' }, command: { command: 'summon' } },
    { protocolVersion: '2.0', meta: {}, command: { command: 'summon' } },
    { protocolVersion: '2.0', meta: { hostId: 'qoder' } },
  ]) {
    const res = await request(bridge.port, { token: bridge.token, body })
    assert.equal(res.status, 400)
    assert.equal(res.body.ok, false)
  }
  assert.equal(delivered.length, 0)
})

test('oversized bodies are refused instead of buffered', async (t) => {
  const { bridge, delivered } = await start(t)
  const huge = 'x'.repeat(16 * 1024)
  let status = null
  try {
    const res = await request(bridge.port, { token: bridge.token, body: { command: 'notify', text: huge } })
    status = res.status
  } catch {
    status = 'aborted' // 服务端在读取过程中断开也是可接受的结果
  }
  assert.ok(status === 413 || status === 'aborted', `expected 413 or abort, got ${status}`)
  assert.equal(delivered.length, 0)
})

test('sink failures map to 503/500 with readable errors', async (t) => {
  const down = await start(t, { sinkResult: false })
  const res = await request(down.bridge.port, { token: down.bridge.token, body: { command: 'notify', text: 'x' } })
  assert.equal(res.status, 503)
  assert.match(res.body.error, /no deskpet window/i)

  const dir = tmpdir()
  const bridgeMod = loadBridge(dir)
  const bridge = await bridgeMod.startRuntimeBridge({
    sink: async () => { throw new Error('renderer exploded') },
    endpointFile: path.join(dir, 'runtime-endpoint.json'),
  })
  t.after(() => bridge.close())
  const res2 = await request(bridge.port, { token: bridge.token, body: { command: 'notify', text: 'x' } })
  assert.equal(res2.status, 500)
  assert.match(res2.body.error, /renderer exploded/)
})

test('approval/ask resolves with allowed-once / rejected / unavailable', async (t) => {
  const outcomes = ['allowed-once', 'rejected', 'unavailable']
  for (const expected of outcomes) {
    const { bridge } = await start(t, {
      onApprovalRequest: async (req) => {
        assert.equal(req.toolName, 'bash')
        assert.equal(req.sessionId, 'sess-1')
        return expected
      },
    })
    const res = await request(bridge.port, {
      route: '/approval/ask',
      method: 'POST',
      token: bridge.token,
      body: {
        requestId: `req-${expected}`,
        toolName: 'bash',
        displayReason: '执行测试脚本',
        sessionId: 'sess-1',
      },
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.outcome, expected)
  }
})

test('the same raw requestId can coexist across sessions of one host', async (t) => {
  const resolvers = []
  const { bridge } = await start(t, {
    onApprovalRequest: (req) => new Promise((resolve) => resolvers.push({ req, resolve })),
  })
  const body = (sessionId) => ({
    requestId: 'shared-request-1',
    toolName: 'bash',
    displayReason: '会话隔离测试',
    sessionId,
  })
  const first = request(bridge.port, {
    route: '/approval/ask',
    method: 'POST',
    token: bridge.token,
    body: body('s1'),
  })
  const second = request(bridge.port, {
    route: '/approval/ask',
    method: 'POST',
    token: bridge.token,
    body: body('s2'),
  })

  for (let i = 0; i < 30 && resolvers.length < 2; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(resolvers.length, 2, '不同会话的同名 requestId 不应互相覆盖')
  assert.equal(resolvers[0].req.sessionId, 's1')
  assert.equal(resolvers[1].req.sessionId, 's2')

  const ambiguousCancel = await request(bridge.port, {
    route: '/approval/cancel',
    method: 'POST',
    token: bridge.token,
    body: { requestId: 'shared-request-1' },
  })
  assert.equal(ambiguousCancel.status, 409)
  const scopedCancel = await request(bridge.port, {
    route: '/approval/cancel',
    method: 'POST',
    token: bridge.token,
    body: { requestId: 'shared-request-1', sessionId: 's1' },
  })
  assert.equal(scopedCancel.status, 200)
  assert.equal(scopedCancel.body.cancelled, true)

  for (const item of resolvers) item.resolve('unavailable')
  const [firstResponse, secondResponse] = await Promise.all([first, second])
  assert.equal(firstResponse.status, 200)
  assert.equal(secondResponse.status, 200)
})

test('approval/cancel cancels an in-flight approval request', async (t) => {
  const cancelledIds = []
  let resolvePending = null
  const { bridge } = await start(t, {
    onApprovalRequest: (req) => new Promise((resolve) => { resolvePending = resolve }),
    onApprovalCancel: (id) => {
      cancelledIds.push(id)
      if (resolvePending) resolvePending('cancelled')
    },
  })

  const askPromise = request(bridge.port, {
    route: '/approval/ask',
    method: 'POST',
    token: bridge.token,
    body: { requestId: 'req-cancel-1', toolName: 'bash', reason: 'sleep 10' },
  })

  await new Promise((r) => setTimeout(r, 40))
  const cancelRes = await request(bridge.port, {
    route: '/approval/cancel',
    method: 'POST',
    token: bridge.token,
    body: { requestId: 'req-cancel-1' },
  })
  assert.equal(cancelRes.status, 200)
  assert.equal(cancelRes.body.cancelled, true)
  assert.equal(cancelRes.body.requestId, 'req-cancel-1')

  const askRes = await askPromise
  assert.equal(askRes.status, 200)
  assert.equal(askRes.body.outcome, 'cancelled')
  assert.deepEqual(cancelledIds, ['["deepseek-harness","","req-cancel-1"]'])
})

test('duplicate in-flight approval for the same host+requestId is rejected, not replaced', async (t) => {
  let resolveFirst = null
  const { bridge } = await start(t, {
    onApprovalRequest: () =>
      new Promise((resolve) => {
        resolveFirst = resolve
      }),
  })

  const body = {
    requestId: 'dup-1',
    toolName: 'bash',
    reason: 'echo hi',
    host: 'qoder',
  }
  const firstAsk = request(bridge.port, {
    route: '/approval/ask',
    token: bridge.token,
    body,
  })
  await new Promise((r) => setTimeout(r, 40))

  const second = await request(bridge.port, {
    route: '/approval/ask',
    token: bridge.token,
    body,
  })
  assert.equal(second.status, 409)
  assert.match(second.body.error, /already in progress/i)

  resolveFirst('allowed-once')
  const first = await firstAsk
  assert.equal(first.status, 200)
  assert.equal(first.body.outcome, 'allowed-once')
  assert.equal(first.body.requestId, 'dup-1', 'the host sees its own requestId, not the internal namespace key')
})

test('different hosts can use the same raw requestId without collision', async (t) => {
  const seenIds = []
  const { bridge } = await start(t, {
    onApprovalRequest: (req) => {
      seenIds.push(req.requestId)
      return Promise.resolve('rejected')
    },
  })

  const base = { requestId: 'same-id', toolName: 'bash', reason: 'test' }
  const a = await request(bridge.port, {
    route: '/approval/ask',
    token: bridge.token,
    body: { ...base, host: 'host-a' },
  })
  const b = await request(bridge.port, {
    route: '/approval/ask',
    token: bridge.token,
    body: { ...base, host: 'host-b' },
  })
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.deepEqual(seenIds, ['["host-a","","same-id"]', '["host-b","","same-id"]'])
})

test('context endpoint returns modelContext', async (t) => {
  const { bridge } = await start(t, {
    getContextSnapshot: () => ({
      modelContext: {
        modelName: 'mao_pro',
        emotions: ['happy', 'shy'],
        presetGroups: [{ group: '开心', emotion: 'happy', presets: ['开心1', '开心2'] }],
      },
    }),
  })
  const res = await request(bridge.port, { route: '/context', method: 'GET', token: bridge.token })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.deepEqual(res.body.modelContext.presetGroups, [
    { group: '开心', emotion: 'happy', presets: ['开心1', '开心2'] },
  ])
})

test('window sink targets the explicitly supplied pet window instead of the first window', async () => {
  const { windowCommandSink } = loadBridge(tmpdir())
  const sent = []
  const pet = { isDestroyed: () => false, webContents: { send: (channel, payload) => sent.push([channel, payload]) } }
  const sink = windowCommandSink('runtime-command', () => pet)
  assert.equal(await sink({ command: 'agent_state', state: 'thinking' }, { hostId: 'host' }), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0][0], 'runtime-command')
  assert.deepEqual(sent[0][1].command, { command: 'agent_state', state: 'thinking' })
  assert.equal(await windowCommandSink('runtime-command', () => null)({ command: 'notify' }, { hostId: 'host' }), false)
  const destroyed = { isDestroyed: () => true, webContents: { send: () => { throw Error('must not send') } } }
  assert.equal(await windowCommandSink('runtime-command', () => destroyed)({ command: 'notify' }, { hostId: 'host' }), false)
})

test('endpoint binds loopback only, not the LAN interface', async (t) => {
  const { bridge } = await start(t)
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
  if (lan.length === 0) return // 无外部网卡时跳过

  const reachable = await new Promise((resolve) => {
    const req = http.request({ hostname: lan[0], port: bridge.port, path: '/health', method: 'GET', timeout: 2500 }, (res) => resolve(res.statusCode))
    req.on('timeout', () => { req.destroy(); resolve('timeout') })
    req.on('error', () => resolve('refused'))
    req.end()
  })
  assert.notEqual(reachable, 200, `端点不应在局域网地址 ${lan[0]} 上可达`)
})


test('oversized bodies get a readable 413 instead of a connection reset', async (t) => {
  const { bridge } = await start(t)
  const res = await request(bridge.port, { token: bridge.token, body: 'x'.repeat(9000) })
  assert.equal(res.status, 413)
  assert.equal(res.body?.ok, false)
  assert.match(String(res.body?.error ?? ''), /body too large/)
})

test('approval keys cannot collide through colons in session ids', async (t) => {
  const seen = []
  const { bridge } = await start(t, {
    onApprovalRequest: async (request) => {
      seen.push(request.requestId)
      return 'rejected'
    },
  })
  const approve = (sessionId, requestId) => request(bridge.port, {
    token: bridge.token,
    route: '/approval/ask',
    body: { requestId, sessionId, host: 'harness', toolName: 'bash', reason: 'r' },
  })
  const [a, b] = await Promise.all([approve('a:b', 'c'), approve('a', 'b:c')])
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.equal(seen.length, 2)
  assert.notEqual(seen[0], seen[1])
})

test('approval requests beyond the pending cap are delegated to the host', async (t) => {
  const { bridge } = await start(t, {
    onApprovalRequest: (_req, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve('cancelled'), { once: true })
    }),
  })
  const send = (id) => request(bridge.port, {
    route: '/approval/ask',
    token: bridge.token,
    body: { requestId: id, host: 'harness', toolName: 'bash', reason: 'r' },
  })
  for (let i = 0; i < 8; i += 1) void send(`cap-${i}`).catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 100))
  const overflow = await send('cap-overflow')
  assert.equal(overflow.status, 200)
  assert.equal(overflow.body.outcome, 'unavailable')
  assert.match(String(overflow.body.error ?? ''), /too many pending/)
})

test('window reload and renderer crash restore approval window state', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf8')
  assert.match(main, /function resolveAllPendingApprovals\(/)
  assert.match(main, /pendingApprovals\.clear\(\)\r?\n  updateWindowMouseIgnore\(\)\r?\n  restoreApprovalWindowLayer\(\)/)
  assert.equal((main.match(/resolveAllPendingApprovals\('unavailable'\)/g) ?? []).length, 2)
  assert.doesNotMatch(main, /for \(const \[, resolve\] of pendingApprovals\) \{\r?\n\s+resolve\('unavailable'\)/)
})

test('renderer crashes trigger a bounded reload and expose a manual reload action', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf8')
  assert.match(main, /MAX_RENDERER_RECOVERY_ATTEMPTS = 2/)
  assert.match(main, /scheduleRendererRecovery\(\)/)
  assert.match(main, /label: '重新加载桌宠'/)
  assert.match(main, /reloadRenderer\(true\)/)
})

test('cancelPendingApprovals aborts in-flight approvals during host rebind', async (t) => {
  const { bridge } = await start(t, {
    onApprovalRequest: () => new Promise(() => {}),
  })
  const pendingRequest = request(bridge.port, {
    route: '/approval/ask',
    method: 'POST',
    token: bridge.token,
    body: {
      requestId: 'rebind-test-req',
      hostId: 'codex',
      toolName: 'execute_command',
      actionDescription: 'Run test',
    },
  })
  await new Promise(r => setTimeout(r, 50))
  bridge.cancelPendingApprovals('codex')
  const res = await pendingRequest
  assert.equal(res.status, 200)
  assert.equal(res.body.outcome, 'cancelled')
})
