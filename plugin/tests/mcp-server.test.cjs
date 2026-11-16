'use strict'
// P2/L0：deskpet-mcp 服务器端到端测试。
// 真实子进程 + 真实 stdio + 真实回环 HTTP；运行时是测试自建的假端点，不是真实桌宠。
const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const { spawn } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const SERVER = path.resolve(__dirname, '../plugins/deskpet-mcp/server.mjs')
const LAUNCHER = path.resolve(__dirname, '../plugins/deskpet-mcp/scripts/launch_deskpet_mcp.cmd')
const TOKEN = 'test-token-0123456789abcdef'

const children = new Set()
const servers = new Set()

/** 假运行时：记录收到的请求，按 handler 回复 */
async function startFakeRuntime(handler) {
  const received = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const entry = { method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null }
      received.push(entry)
      const { status, payload } = handler(entry)
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.add(server)
  return {
    port: server.address().port,
    received,
    close: () => new Promise((resolve) => { servers.delete(server); server.close(resolve) }),
  }
}

const tmpDirs = new Set()
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
  tmpDirs.clear()
})

// 子进程统一使用隔离的 APPDATA，避免读到开发者机器上真实运行的桌宠端点
const ISOLATED_APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'deskpet-mcp-appdata-'))
tmpDirs.add(ISOLATED_APPDATA)

function writeEndpointFile(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskpet-mcp-test-'))
  tmpDirs.add(dir)
  const file = path.join(dir, 'runtime-endpoint.json')
  fs.writeFileSync(file, JSON.stringify({ version: 1, port, token: TOKEN, createdAt: new Date().toISOString() }))
  return file
}

/**
 * 以 stdio 客户端方式驱动服务器。
 * endpointFile 为 null 时不设置 DESKPET_ENDPOINT_FILE，用于验证 APPDATA 回退；
 * 子进程的 APPDATA 默认指向隔离目录，避免读到真实桌宠的端点文件。
 */
function startClient(endpointFile, options = {}) {
  const { command = process.execPath, args = [SERVER], appData = ISOLATED_APPDATA, extraEnv = {} } = options
  const env = { ...process.env, APPDATA: appData, ...extraEnv }
  if (endpointFile) env.DESKPET_ENDPOINT_FILE = endpointFile
  else delete env.DESKPET_ENDPOINT_FILE
  const child = spawn(command, args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  children.add(child)
  const pending = new Map()
  const stdoutLines = []
  const stderrChunks = []
  let buffer = ''
  let nextId = 1

  child.stdout.setEncoding('utf-8')
  child.stderr.setEncoding('utf-8')
  child.stderr.on('data', (c) => stderrChunks.push(c))
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      if (!line) continue
      stdoutLines.push(line)
      let msg
      try { msg = JSON.parse(line) } catch { continue } // 非法行会被下面的断言抓到
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
      }
    }
  })

  function request(method, params) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout waiting for ${method}`)) }, 8000)
      pending.set(id, (msg) => { clearTimeout(timer); resolve(msg) })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  return {
    request, notify, stdoutLines,
    stderr: () => stderrChunks.join(''),
    close: () => new Promise((resolve) => {
      children.delete(child)
      if (child.exitCode !== null) return resolve()
      child.once('exit', resolve)
      child.stdin.end()
      setTimeout(() => { try { child.kill() } catch {} }, 2000)
    }),
  }
}

test('initialize handshake returns protocol, capabilities and server info', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 200, payload: { ok: true } }))
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port))
  t.after(() => client.close())

  const res = await client.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } })
  assert.equal(res.jsonrpc, '2.0')
  assert.equal(res.result.protocolVersion, '2024-11-05', '应回显受支持的客户端版本')
  assert.equal(res.result.serverInfo.name, 'deskpet-mcp')
  assert.ok(res.result.capabilities.tools, '应声明 tools 能力')
  assert.match(res.result.instructions, /not a second transcript/)
  assert.match(res.result.instructions, /1-2 messages per turn/)
})

test('initialize falls back to a known protocol for unknown versions', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 200, payload: { ok: true } }))
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port))
  t.after(() => client.close())
  const res = await client.request('initialize', { protocolVersion: '9999-01-01' })
  assert.ok(['2025-06-18', '2025-03-26', '2024-11-05'].includes(res.result.protocolVersion))
})

test('tools/list exposes the whitelisted character and planning tools', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 200, payload: { ok: true } }))
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port))
  t.after(() => client.close())
  const res = await client.request('tools/list', {})
  const names = res.result.tools.map((x) => x.name).sort()
  assert.deepEqual(names, [
    'deskpet_get_capabilities',
    'deskpet_motion',
    'deskpet_notify',
    'deskpet_play_animation',
    'deskpet_set_emotion',
    'deskpet_set_preset',
    'deskpet_update_plan',
  ])
  for (const tool of res.result.tools) {
    assert.equal(tool.inputSchema.type, 'object')
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} 不应接受额外字段`)
  }
})

test('motion skill is discoverable and MCP forwards playback with the exact model revision and host', async t => {
  const rt = await startFakeRuntime(entry => ({ status: 200, payload: {
    ok: true, jobId: entry.body.jobId, status: 'playing',
  } }))
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port), { extraEnv: { UTA_HOST: 'qoder', UTA_SESSION_ID: 'motion-chat' } })
  t.after(() => client.close())
  const prompt = await client.request('prompts/get', { name: 'uta_live2d_motion', arguments: { performance: '轻轻点头' } })
  assert.match(prompt.result.messages[0].content.text, /轻轻点头/)
  const plan = { version: 1, tracks: [{ parameterId: 'ParamAngleY', keyframes: [{ atMs: 340, value: -10 }] }] }
  const res = await client.request('tools/call', { name: 'deskpet_motion', arguments: { operation: 'play', revision: 'model-1', plan } })
  assert.equal(res.result.isError, false)
  const body = rt.received[0].body
  assert.equal(rt.received[0].url, '/motion')
  assert.equal(body.hostId, 'qoder')
  assert.equal(body.sessionId, 'motion-chat')
  assert.equal(body.revision, 'model-1')
  assert.deepEqual(body.plan, plan)
  assert.equal(JSON.parse(res.result.content[0].text).jobId, body.jobId)
})

test('notify forwards a validated command to the local runtime', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 200, payload: { ok: true, command: 'notify' } }))
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port))
  t.after(() => client.close())

  const res = await client.request('tools/call', { name: 'deskpet_notify', arguments: { text: '你好' } })
  assert.equal(res.result.isError, false)
  assert.match(res.result.content[0].text, /你好/)
  assert.equal(rt.received.length, 1)
  assert.equal(rt.received[0].method, 'POST')
  assert.equal(rt.received[0].url, '/command')
  assert.equal(rt.received[0].auth, `Bearer ${TOKEN}`)
  assert.deepEqual(rt.received[0].body, { command: 'notify', text: '你好', speak: true })
})

test('deskpet_update_plan forwards validated plan to local runtime', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 200, payload: { ok: true } }))
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port))
  t.after(() => client.close())

  const res = await client.request('tools/call', {
    name: 'deskpet_update_plan',
    arguments: {
      title: '测试目标',
      plan: [
        { step: '第一步', status: 'completed' },
        { step: '第二步', status: 'in_progress' },
      ],
    },
  })
  assert.equal(res.result.isError, false)
  assert.match(res.result.content[0].text, /Updated deskpet plan/)
  assert.equal(rt.received.length, 1)
  assert.equal(rt.received[0].method, 'POST')
  assert.equal(rt.received[0].url, '/command')
  assert.deepEqual(rt.received[0].body, {
    command: 'todo_snapshot',
    source: 'codex-plan',
    title: '测试目标',
    items: [
      { text: '第一步', status: 'completed' },
      { text: '第二步', status: 'in_progress' },
    ],
  })
})

test('Codex MCP uses v2 host/session metadata without taking over the visible session', async (t) => {
  const rt = await startFakeRuntime(entry => ({ status: 200, payload: entry.url === '/health'
    ? { ok: true, protocolVersions: ['1.0', '2.0'] } : { ok: true } }))
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port), {
    extraEnv: { UTA_HOST: 'codex', UTA_SESSION_ID: '', CODEX_THREAD_ID: 'codex-mcp-session' },
  })
  t.after(() => client.close())
  await client.request('tools/call', { name: 'deskpet_notify', arguments: { text: 'v2 hello' } })
  await client.request('tools/call', { name: 'deskpet_set_preset', arguments: { preset: '开心' } })
  const commands = rt.received.filter(entry => entry.url === '/command').map(entry => entry.body)
  assert.deepEqual(commands.map(body => body.command.command), ['hello', 'notify', 'set_preset'])
  for (const body of commands) {
    assert.equal(body.protocolVersion, '2.0')
    assert.equal(body.meta.hostId, 'codex')
    assert.equal(body.meta.sessionId, 'codex-mcp-session')
    assert.equal(body.meta.turnId, undefined)
    assert.equal(body.meta.seq, undefined)
  }
})

test('Codex MCP without a session stays host-scoped and never guesses the active session', async (t) => {
  const rt = await startFakeRuntime(entry => ({ status: 200, payload: entry.url === '/health'
    ? { ok: true, protocolVersions: ['2.0'] } : { ok: true } }))
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port), {
    extraEnv: { UTA_HOST: 'codex', UTA_SESSION_ID: '', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '' },
  })
  t.after(() => client.close())
  await client.request('tools/call', { name: 'deskpet_set_emotion', arguments: { emotion: 'happy' } })
  const commands = rt.received.filter(entry => entry.url === '/command').map(entry => entry.body)
  assert.deepEqual(commands.map(body => body.command.command), ['hello', 'set_emotion'])
  assert.equal(commands[1].meta.hostId, 'codex')
  assert.equal(commands[1].meta.sessionId, undefined)
})

test('Codex MCP falls back to bare commands with a v1 runtime', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 200, payload: { ok: true } }))
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port), { extraEnv: { UTA_HOST: 'codex' } })
  t.after(() => client.close())
  const result = await client.request('tools/call', { name: 'deskpet_notify', arguments: { text: 'legacy hello' } })
  assert.equal(result.result.isError, false)
  const commands = rt.received.filter(entry => entry.url === '/command')
  assert.deepEqual(commands.map(entry => entry.body), [{ command: 'notify', text: 'legacy hello', speak: true }])
})

test('emotion, preset and animation map to their commands', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 200, payload: { ok: true } }))
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port))
  t.after(() => client.close())

  await client.request('tools/call', { name: 'deskpet_set_emotion', arguments: { emotion: 'happy' } })
  await client.request('tools/call', { name: 'deskpet_set_preset', arguments: { preset: '开心' } })
  await client.request('tools/call', { name: 'deskpet_set_preset', arguments: { preset: '思考', mode: 'hold' } })
  await client.request('tools/call', { name: 'deskpet_play_animation', arguments: { name: 'wave' } })
  await client.request('tools/call', { name: 'deskpet_play_animation', arguments: { name: 'dance', loop: true } })
  await client.request('tools/call', { name: 'deskpet_play_animation', arguments: { name: '脱捕' } })
  await client.request('tools/call', { name: 'deskpet_play_animation', arguments: { name: '狗尾巴草打开', loop: true } })
  assert.deepEqual(rt.received.map((r) => r.body), [
    { command: 'set_emotion', emotion: 'happy' },
    { command: 'set_preset', preset: '开心', mode: 'revert' },
    { command: 'set_preset', preset: '思考', mode: 'hold' },
    { command: 'play_animation', name: 'wave', loop: false },
    { command: 'play_animation', name: 'dance', loop: true },
    { command: 'play_animation', name: '脱捕', loop: false },
    { command: 'play_animation', name: '狗尾巴草打开', loop: true },
  ])
})

test('capabilities returns current model emotions and state preset groups', async (t) => {
  const rt = await startFakeRuntime((entry) => {
    if (entry.url === '/context') {
      return {
        status: 200,
        payload: {
          ok: true,
          characterAvailable: true,
          modelContext: {
            modelName: '测试模型',
            emotions: ['neutral', 'happy'],
            presetGroups: [{ group: '开心', emotion: 'happy', presets: ['开心', '开心2'] }],
          },
        },
      }
    }
    return { status: 200, payload: { ok: true, characterAvailable: true } }
  })
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port))
  t.after(() => client.close())
  const res = await client.request('tools/call', { name: 'deskpet_get_capabilities', arguments: {} })
  assert.equal(res.result.isError, false)
  const text = res.result.content[0].text
  assert.match(text, /character window available: yes/)
  assert.match(text, /测试模型/)
  assert.match(text, /"group":"开心"/)
  assert.match(text, /"presets":\["开心","开心2"\]/)
  assert.match(text, /deskpet_set_preset/)
  assert.deepEqual(rt.received.map((r) => r.url), ['/health', '/context'])
})

test('missing arguments are reported as tool errors, not protocol errors', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 200, payload: { ok: true } }))
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port))
  t.after(() => client.close())
  const res = await client.request('tools/call', { name: 'deskpet_notify', arguments: {} })
  assert.equal(res.result.isError, true)
  assert.match(res.result.content[0].text, /text is required/)
  assert.equal(rt.received.length, 0, '无效参数不应触达运行时')
})

test('MCP remembers capability revision and asks the host to refresh after a character change', async t => {
  let revision = 'model-A'
  const rt = await startFakeRuntime(entry => {
    if (entry.url === '/context') return { status: 200, payload: { ok: true, modelContext: { revision, ready: true, kind: 'image-set', modelName: 'static', emotions: ['neutral'], animations: [], presetGroups: [] } } }
    if (entry.body?.command === 'set_emotion' && entry.body.modelRevision !== revision) return { status: 409, payload: { ok: false, error: 'Character capabilities changed. Call deskpet_get_capabilities again.' } }
    return { status: 200, payload: { ok: true, characterAvailable: true } }
  })
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port))
  t.after(() => client.close())
  const first = await client.request('tools/call', { name: 'deskpet_get_capabilities', arguments: {} })
  assert.match(first.result.content[0].text, /unavailable for this image set/)
  revision = 'model-B'
  const stale = await client.request('tools/call', { name: 'deskpet_set_emotion', arguments: { emotion: 'neutral' } })
  assert.equal(stale.result.isError, true)
  assert.match(stale.result.content[0].text, /deskpet_get_capabilities/)
  await client.request('tools/call', { name: 'deskpet_get_capabilities', arguments: {} })
  const fresh = await client.request('tools/call', { name: 'deskpet_set_emotion', arguments: { emotion: 'neutral' } })
  assert.equal(fresh.result.isError, false)
  assert.equal(rt.received.at(-1).body.modelRevision, 'model-B')
})

test('runtime rejection surfaces as a readable tool error', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 400, payload: { ok: false, error: 'text is empty or invalid' } }))
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port))
  t.after(() => client.close())
  const res = await client.request('tools/call', { name: 'deskpet_notify', arguments: { text: 'x' } })
  assert.equal(res.result.isError, true)
  assert.match(res.result.content[0].text, /text is empty or invalid/)
})

test('unreachable runtime yields an actionable error instead of hanging', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 200, payload: { ok: true } }))
  const port = rt.port
  await rt.close() // 关掉，模拟桌宠未运行
  const client = startClient(writeEndpointFile(port))
  t.after(() => client.close())
  const res = await client.request('tools/call', { name: 'deskpet_notify', arguments: { text: 'hi' } })
  assert.equal(res.result.isError, true)
  assert.match(res.result.content[0].text, /runtime|ECONNREFUSED/i)
})

test('missing pairing file explains that the desktop app must be started', async (t) => {
  // APPDATA 指向隔离目录，因此不会回退到本机真实安装的端点文件
  const client = startClient(path.join(os.tmpdir(), 'definitely-missing-deskpet-endpoint.json'))
  t.after(() => client.close())
  const res = await client.request('tools/call', { name: 'deskpet_get_capabilities', arguments: {} })
  assert.equal(res.result.isError, true)
  assert.match(res.result.content[0].text, /not running|pairing info is unavailable/i)
})

/** 在隔离的 APPDATA 下写一个应用级端点文件，返回其所在目录 */
function writeAppDataEndpoint(appDataDir, appName, port) {
  const dir = path.join(appDataDir, appName)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'runtime-endpoint.json'),
    JSON.stringify({ version: 1, port, token: TOKEN, createdAt: new Date().toISOString() }))
  return dir
}

test('falls back to the Uta userData endpoint when no override is set', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 200, payload: { ok: true, characterAvailable: true } }))
  t.after(() => rt.close())
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'deskpet-mcp-uta-appdata-'))
  tmpDirs.add(appData)
  writeAppDataEndpoint(appData, 'uta', rt.port)
  const client = startClient(null, { appData })
  t.after(() => client.close())
  const res = await client.request('tools/call', { name: 'deskpet_get_capabilities', arguments: {} })
  assert.equal(res.result.isError, false, '应通过 %APPDATA%\\uta 下的端点文件找到运行时')
  assert.deepEqual(rt.received.map((entry) => entry.url), ['/health', '/context'])
})

test('still finds the legacy MaiBot Deskpet endpoint for un-migrated installs', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 200, payload: { ok: true, characterAvailable: true } }))
  t.after(() => rt.close())
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'deskpet-mcp-legacy-appdata-'))
  tmpDirs.add(appData)
  writeAppDataEndpoint(appData, 'maibot-deskpet', rt.port)
  const client = startClient(null, { appData })
  t.after(() => client.close())
  const res = await client.request('tools/call', { name: 'deskpet_get_capabilities', arguments: {} })
  assert.equal(res.result.isError, false)
  assert.deepEqual(rt.received.map((entry) => entry.url), ['/health', '/context'])
})

test('unknown method returns a JSON-RPC method-not-found error', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 200, payload: { ok: true } }))
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port))
  t.after(() => client.close())
  const res = await client.request('does/not/exist', {})
  assert.equal(res.error.code, -32601)
})

test('stdout carries protocol frames only; logs go to stderr', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 200, payload: { ok: true } }))
  t.after(() => rt.close())
  const client = startClient(writeEndpointFile(rt.port))
  t.after(() => client.close())
  await client.request('initialize', { protocolVersion: '2024-11-05' })
  await client.request('tools/list', {})
  for (const line of client.stdoutLines) {
    const parsed = JSON.parse(line) // 任何非 JSON 都会抛错
    assert.equal(parsed.jsonrpc, '2.0')
  }
  assert.match(client.stderr(), /\[deskpet-mcp\]/, '启动日志应走 stderr')
})

test('launcher resolves the server relative to itself from an unrelated cwd', async (t) => {
  const rt = await startFakeRuntime(() => ({ status: 200, payload: { ok: true } }))
  t.after(() => rt.close())
  // 故意用系统临时目录作为 cwd，验证启动器不依赖调用方的工作目录
  const client = startClient(writeEndpointFile(rt.port), { command: 'cmd.exe', args: ['/d', '/s', '/c', 'call', LAUNCHER] })
  t.after(() => client.close())
  const res = await client.request('initialize', { protocolVersion: '2024-11-05' })
  assert.equal(res.result.serverInfo.name, 'deskpet-mcp')
})

test('no child processes are left behind', async () => {
  for (const child of [...children]) {
    try { child.kill() } catch { /* 已退出 */ }
  }
  children.clear()
  for (const server of [...servers]) {
    await new Promise((resolve) => server.close(resolve))
  }
  servers.clear()
  assert.equal(children.size, 0)
  assert.equal(servers.size, 0)
})

test('Codex MCP 启动入口支持展开路径及插件缓存回退', async () => {
  const { spawnSync } = require('node:child_process')
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../plugins/codex/.mcp.json'), 'utf8'))
  const args = config.mcpServers['uta-deskpet'].args
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../plugins/codex/.codex-plugin/plugin.json'), 'utf8'))
  assert.match(args[1], new RegExp(manifest.version.replaceAll('.', '\\.')))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-codex-launch-'))
  tmpDirs.add(dir)
  const runtime = path.join(dir, 'plugins', 'cache', 'test-market', 'uta-deskpet', manifest.version, 'runtime')
  fs.mkdirSync(runtime, { recursive: true })
  fs.writeFileSync(path.join(runtime, 'deskpet-mcp.mjs'), "console.log('runtime-ready')\n")
  const run = (root) => spawnSync(process.execPath, [args[0], args[1], root], { env: { ...process.env, CODEX_HOME: dir }, encoding: 'utf8' })
  const fallback = run('${PLUGIN_ROOT}')
  assert.equal(fallback.status, 0, fallback.stderr)
  assert.match(fallback.stdout, /runtime-ready/)
  const direct = run(path.dirname(runtime))
  assert.equal(direct.status, 0, direct.stderr)
  assert.match(direct.stdout, /runtime-ready/)
  const second = path.join(dir, 'plugins', 'cache', 'other-market', 'uta-deskpet', manifest.version, 'runtime')
  fs.mkdirSync(second, { recursive: true })
  fs.writeFileSync(path.join(second, 'deskpet-mcp.mjs'), '')
  const ambiguous = run('${PLUGIN_ROOT}')
  assert.notEqual(ambiguous.status, 0)
  assert.match(ambiguous.stderr, /ambiguous/)
})
