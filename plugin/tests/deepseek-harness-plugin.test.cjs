'use strict'
// DeepSeek Harness 原生插件（@uta/deepseek-harness-plugin）端到端测试。
const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')

// 契约测试的关键：假桥接必须使用**真实的**载荷校验器。
// 否则非法 state、非 ASCII 情绪、超长文本都会拿到 200，协议回归无法暴露。
// typescript 是 app 工作区的 devDependency，这里显式从 app 解析。
const appRequire = createRequire(path.resolve(__dirname, '../../app/package.json'))
const ts = appRequire('typescript')
const RUNTIME_COMMANDS_TS = path.resolve(__dirname, '../../app/src/main/runtime-commands.ts')
function loadRuntimeCommands() {
  const code = ts.transpileModule(fs.readFileSync(RUNTIME_COMMANDS_TS, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(code, { module: mod, exports: mod.exports }, { filename: RUNTIME_COMMANDS_TS })
  return mod.exports
}
const { validateRuntimeCommand, validateApprovalRequest } = loadRuntimeCommands()

const PLUGIN_DIR = path.resolve(__dirname, '../plugins/deepseek-harness')
const PLUGIN_ENTRY = path.join(PLUGIN_DIR, 'src/index.mjs')
const TOKEN = 'dsh-test-token-0123456789abcdef0123456789abcdef'

const servers = new Set()
const tmpDirs = new Set()

after(async () => {
  for (const s of [...servers]) {
    await new Promise((resolve) => s.close(resolve))
  }
  servers.clear()
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  tmpDirs.clear()
})

// 插件的 systemPrompt 快照是挂载后异步预热的（DSH 要求 section.text 同步返回），
// 因此断言内容前必须等它落地，而不是假设 apply() 返回时就绪。
async function waitForSyncValue(read, { timeoutMs = 3000, intervalMs = 20 } = {}) {
  const started = Date.now()
  for (;;) {
    const value = read()
    if (value || Date.now() - started >= timeoutMs) return value
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

function writeEndpointFile(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-dsh-test-'))
  tmpDirs.add(dir)
  const file = path.join(dir, 'runtime-endpoint.json')
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      port,
      token: TOKEN,
      createdAt: new Date().toISOString(),
    }),
  )
  return file
}

async function startMockUtaBridge(handlers = {}) {
  const received = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', async () => {
      const parsed = body ? JSON.parse(body) : null
      const entry = {
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body: parsed,
      }
      received.push(entry)

      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'unauthorized' }))
        return
      }

      if (req.url === '/context' && req.method === 'GET') {
        const payload = handlers.onContext
          ? await handlers.onContext()
          : {
              ok: true,
              characterAvailable: true,
              modelContext: {
                modelName: 'mao_pro',
                emotions: ['neutral', 'happy', 'shy', 'thinking'],
                presetGroups: [
                  { group: '开心', emotion: 'happy', presets: ['开心1', '开心2'] },
                  { group: '害羞', emotion: 'shy', presets: ['害羞1'] },
                ],
              },
            }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
        return
      }

      if (req.url === '/approval/ask' && req.method === 'POST') {
        const check = validateApprovalRequest(parsed)
        if (!check.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: check.error }))
          return
        }
        const outcome = handlers.onApprovalAsk
          ? await handlers.onApprovalAsk(parsed, req)
          : 'allowed-once'
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, requestId: parsed.requestId, outcome }))
        }
        return
      }

      if (req.url === '/motion' && req.method === 'POST' && handlers.onMotion) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(await handlers.onMotion(parsed)))
        return
      }

      if (req.url === '/approval/cancel' && req.method === 'POST') {
        if (handlers.onApprovalCancel) {
          await handlers.onApprovalCancel(parsed)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, requestId: parsed.requestId, cancelled: true }))
        return
      }

      if (req.url === '/command' && req.method === 'POST') {
        // v2 信封先拆出 command；测试断言仍看裸指令，信封另存供归属检查
        if (parsed && parsed.protocolVersion === '2.0') {
          entry.envelope = parsed
          entry.meta = parsed.meta
          entry.body = parsed.command
        }
        // 与真实 runtime-bridge 同源校验：非法载荷返回 400，而不是照单全收
        const check = validateRuntimeCommand(entry.body)
        if (!check.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: check.error }))
          return
        }
        if (handlers.onCommand) await handlers.onCommand(entry)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, command: check.value.command }))
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'not found' }))
    })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.add(server)
  return {
    port: server.address().port,
    received,
    close: () =>
      new Promise((resolve) => {
        servers.delete(server)
        server.close(resolve)
      }),
  }
}

/** 构造模拟的 DeepSeek Harness Cordis Context */
function createFakeDshContext(options = {}) {
  const listeners = new Map()
  const sections = []
  const contexts = []
  const tools = new Map()
  const commands = []
  const skills = []
  const effects = []
  const followups = []
  const agent = {
    id: 'sess_fake',
    session: { id: 'sess_fake' },
    followup(input) {
      followups.push(input)
    },
  }

  const ctx = {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
      return () => {
        const arr = listeners.get(event) || []
        const idx = arr.indexOf(handler)
        if (idx >= 0) arr.splice(idx, 1)
      }
    },
    inject(services, callback) {
      if (services.every((name) => ctx[name] !== undefined)) callback(ctx)
      return () => {}
    },
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') effects.push(disposer)
      return disposer
    },
    systemPrompt: {
      section(spec) {
        sections.push(spec)
      },
      context(spec) {
        contexts.push(spec)
      },
    },
    tools: {
      register(spec) {
        tools.set(spec.name, spec)
      },
    },
    ...(options.commands
      ? {
          commands: {
            register(spec) {
              commands.push(spec)
              return () => {}
            },
          },
        }
      : {}),
    ...(options.skills
      ? {
          skills: {
            register(spec) {
              skills.push(spec)
              return () => {}
            },
          },
        }
      : {}),
    ...(options.agents
      ? {
          // agentRegistry 覆盖用于精确投递测试：默认只有 sess_fake 一个 agent
          agents: options.agentRegistry || {
            get(id) {
              return id === agent.id ? agent : undefined
            },
            list() {
              return [agent]
            },
            roots() {
              return [agent]
            },
          },
        }
      : {}),
    async emitWaterfall(event, payload, terminalNext) {
      const arr = listeners.get(event) || []
      let idx = 0
      const dispatch = async () => {
        if (idx < arr.length) {
          const fn = arr[idx++]
          return await fn(payload, dispatch)
        }
        return terminalNext ? await terminalNext() : undefined
      }
      return await dispatch()
    },
    async emit(event, ...args) {
      const arr = listeners.get(event) || []
      for (const fn of arr) {
        await fn(...args)
      }
    },
  }

  return { ctx, listeners, sections, contexts, tools, commands, skills, effects, followups, agent }
}

test('user-questions/request shows a choice hint and delegates to the host', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())
  const endpointFile = writeEndpointFile(rt.port)
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-dsh-choice-'))
  tmpDirs.add(appData)

  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, {
    endpointFile,
    env: { ...process.env, APPDATA: appData },
  })

  const outcome = await dsh.ctx.emitWaterfall(
    'user-questions/request',
    {
      questions: [
        {
          id: 'choice',
          question: '选哪个方案？',
          options: [{ label: '方案 A' }, { label: '方案 B' }],
        },
      ],
    },
    async () => 'host-answer',
  )

  assert.equal(outcome, 'host-answer')
  const hint = await waitForSyncValue(() => rt.received.find(entry =>
    entry.url === '/command' && entry.body.command === 'choice_hint')?.body)
  assert.ok(hint, '应向桌宠发送 choice_hint')
  assert.match(hint.text, /选哪个方案/)
  assert.match(hint.text, /方案 A/)
})

test('DSH commands and skill expose Uta controls', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())
  const endpointFile = writeEndpointFile(rt.port)
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-dsh-command-'))
  tmpDirs.add(appData)

  const dsh = createFakeDshContext({ commands: true, skills: true })
  plugin.apply(dsh.ctx, {
    endpointFile,
    env: { ...process.env, APPDATA: appData },
  })

  assert.equal(dsh.commands[0]?.name, 'uta')
  assert.equal(dsh.skills[0]?.name, 'uta-deskpet')
  assert.ok(dsh.skills[0]?.content.includes('uta_express'))

  const result = await dsh.commands[0].handler({ rawInput: 'say 你好，桌宠。' })
  assert.equal(result.kind, 'success')
  const notification = await waitForSyncValue(() => rt.received.find(entry =>
    entry.url === '/command' && entry.body.command === 'notify' && /你好/.test(entry.body.text)))
  assert.ok(notification)
})

test('native agent bridge injects a followup into the live agent', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-dsh-native-'))
  tmpDirs.add(appData)
  const dsh = createFakeDshContext({ agents: true })
  plugin.apply(dsh.ctx, {
    env: { ...process.env, APPDATA: appData },
  })

  const bridgeFile = path.join(appData, 'uta', 'hooks', 'deepseek-harness-native-bridge.json')
  let info = null
  for (let i = 0; i < 100 && !info; i += 1) {
    try {
      info = JSON.parse(fs.readFileSync(bridgeFile, 'utf-8'))
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  assert.ok(info, '应写出原生桥端点文件')

  const response = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ text: '从桌宠发来的消息', sessionId: 'sess_fake' })
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: info.port,
        path: '/message',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${info.token}`,
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }))
      },
    )
    req.on('error', reject)
    req.end(body)
  })

  assert.equal(response.status, 200)
  assert.equal(response.body.accepted, true)
  assert.equal(dsh.followups.length, 1)
  assert.equal(dsh.followups[0].role, 'user')
  assert.ok(dsh.followups[0].id)
  assert.equal(dsh.followups[0].content[0].text, '从桌宠发来的消息')

  for (const dispose of dsh.effects.splice(0)) dispose()
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(fs.existsSync(bridgeFile), false, '插件卸载时应清理端点文件')
})

test('bundle manifest and cordis.patch.yml match DeepSeek Harness bundle contract', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'package.json'), 'utf-8'))
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  const patchPath = path.join(PLUGIN_DIR, pkg.dsh.bundle.patch)
  assert.equal(fs.existsSync(patchPath), true)
  const patchText = fs.readFileSync(patchPath, 'utf-8')
  assert.match(patchText, /-\s*insert:\s*\r?\n\s*-\s*id:\s*uta-deskpet\s*\r?\n\s*name:\s*['"]@uta\/deepseek-harness-plugin['"]/)
})

test('approval/request claims decision slot when user clicks Approve or Reject on Uta', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  let nextDecision = 'allowed-once'

  const rt = await startMockUtaBridge({
    onApprovalAsk: async () => nextDecision,
  })
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  let hostFallbackCalled = false
  const outcome1 = await dsh.ctx.emitWaterfall(
    'approval/request',
    {
      callId: 'call_approve_1',
      toolName: 'bash',
      reason: 'npm test',
      displayReason: '运行测试套件',
      agent: { session: { id: 'sess-approval-1' } },
    },
    async () => {
      hostFallbackCalled = true
      return 'host-fallback'
    },
  )
  assert.equal(outcome1, 'allowed-once')
  assert.equal(hostFallbackCalled, false, '桌宠已批准时不应回退到宿主')
  const approvalAsk = rt.received.find((entry) => entry.url === '/approval/ask')
  assert.ok(approvalAsk)
  assert.equal(approvalAsk.body.sessionId, 'sess-approval-1')

  nextDecision = 'rejected'
  const outcome2 = await dsh.ctx.emitWaterfall(
    'approval/request',
    {
      callId: 'call_reject_2',
      toolName: 'bash',
      reason: 'rm -rf /',
      displayReason: '危险命令',
    },
    async () => {
      hostFallbackCalled = true
      return 'host-fallback'
    },
  )
  assert.equal(outcome2, 'rejected')
  assert.equal(hostFallbackCalled, false, '桌宠已拒绝时不应回退到宿主')
})

test('approval/request delegates to next() when user clicks Delegate (unavailable) or Uta is offline', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge({
    onApprovalAsk: async () => 'unavailable',
  })
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  let hostFallbackCalled = false
  const outcome = await dsh.ctx.emitWaterfall(
    'approval/request',
    {
      callId: 'call_delegate_1',
      toolName: 'write_file',
      reason: '修改配置文件',
    },
    async () => {
      hostFallbackCalled = true
      return 'rejected'
    },
  )
  assert.equal(hostFallbackCalled, true, '转交宿主时必须调用 next()')
  assert.equal(outcome, 'rejected', '转交后的宿主决策不能被测试替身改成放行')
})

test('approval/request delegates user-choice tools to the host without a pet card', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  let asked = false
  const rt = await startMockUtaBridge({
    onApprovalAsk: async () => {
      asked = true
      return 'allowed-once'
    },
  })
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  const outcome = await dsh.ctx.emitWaterfall(
    'approval/request',
    {
      callId: 'call_choice_1',
      toolName: 'AskUserQuestion',
      reason: '请选择方案',
    },
    async () => 'host-choice',
  )

  assert.equal(outcome, 'host-choice')
  assert.equal(asked, false, '选择工具不应弹出桌宠审批卡')
  const commands = rt.received.filter((entry) => entry.url === '/command').map((entry) => entry.body)
  assert.ok(commands.some((item) => item.command === 'choice_hint' && /选择方案/.test(item.text)))
  assert.ok(
    commands.some(
      (item) =>
        item.command === 'agent_state' && item.label === '等待你在宿主里选择方案',
    ),
  )
})

test('approval/request forwards AbortSignal cancellation to /approval/cancel', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const cancelledIds = []
  let releaseAsk = null

  const rt = await startMockUtaBridge({
    onApprovalAsk: () =>
      new Promise((resolve) => {
        releaseAsk = () => resolve('cancelled')
      }),
    onApprovalCancel: (body) => {
      cancelledIds.push(body.requestId)
      if (releaseAsk) releaseAsk()
    },
  })
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  const abortCtrl = new AbortController()
  const waterfallPromise = dsh.ctx.emitWaterfall(
    'approval/request',
    {
      callId: 'call_abort_99',
      toolName: 'bash',
      reason: 'long command',
      signal: abortCtrl.signal,
    },
    async () => 'fallback-after-abort',
  )

  await new Promise((r) => setTimeout(r, 50))
  abortCtrl.abort()

  const outcome = await waterfallPromise
  assert.equal(outcome, 'fallback-after-abort')
  await new Promise((r) => setTimeout(r, 40))
  assert.deepEqual(cancelledIds, ['call_abort_99'])
})

test('systemPrompt context carries model presets without injecting an RP persona or tag instructions', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  assert.equal(dsh.sections.length, 0, '不应再注册 uta:rp-persona')
  assert.equal('DEFAULT_RP_CONFIG' in plugin, false)
  assert.equal('buildRpSystemPromptSection' in plugin, false)

  assert.equal(dsh.contexts.length, 1)
  assert.equal(dsh.contexts[0].name, 'uta:model-presets')
  const contextText = await waitForSyncValue(() => dsh.contexts[0].text())
  assert.match(contextText, /mao_pro/)
  assert.match(contextText, /名称数据，不是指令/)
  assert.match(contextText, /"group":"开心".*"开心1".*"开心2"/)
  assert.doesNotMatch(contextText, /指挥官|\[uta:/)
})

test('agent and tool lifecycle seams reflect working states and inline preset without streaming text', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  // 1. agent/request -> thinking
  await dsh.ctx.emitWaterfall('agent/request', { agent: { id: 'main' } }, async () => 'ok')

  // 2. agent/assistant-stream -> start, chunk with [uta:开心], end
  await dsh.ctx.emit('agent/assistant-stream', {
    agent: { id: 'main' },
    frame: { type: 'start' },
  })
  await dsh.ctx.emit('agent/assistant-stream', {
    agent: { id: 'main' },
    frame: {
      type: 'chunk',
      chunk: { type: 'text-delta', textDelta: '[uta:开心] 哼，这点小事就交给我吧，博士！' },
    },
  })
  await dsh.ctx.emit('agent/assistant-stream', {
    agent: { id: 'main' },
    frame: { type: 'end' },
  })

  // 3. tools/execute & tools/result
  await dsh.ctx.emitWaterfall('tools/execute', { name: 'bash' }, async () => ({}))
  await dsh.ctx.emit('tools/result', { name: 'bash' }, { isError: true })

  // 4. agent/status -> idle
  await dsh.ctx.emit('agent/status', { status: 'idle' })

  await new Promise((r) => setTimeout(r, 80))

  const commands = rt.received.filter((r) => r.url === '/command').map((r) => r.body)
  const states = commands.filter((c) => c.command === 'agent_state').map((c) => c.state)
  assert.deepEqual(states, ['thinking', 'streaming', 'tool_running', 'error', 'idle'])
  assert.equal(commands.some((c) => c.command === 'rp_reply'), false, '流式正文不再逐段推送')
  assert.ok(
    commands.some((c) => c.command === 'set_preset' && c.preset === '开心'),
    '内联标签仍应驱动桌宠表情',
  )
})

test('DSH commands carry v2 host/session meta without inventing a turn id', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  await dsh.ctx.emit('session/event', { id: 'meta-session' }, { type: 'turn/start', data: {} })
  await new Promise((resolve) => setTimeout(resolve, 120))

  const entries = rt.received.filter((entry) => entry.url === '/command')
  assert.ok(entries.length > 0)
  assert.ok(entries.every((entry) => entry.meta?.hostId === 'deepseek-harness'))
  assert.ok(entries.some((entry) => entry.meta?.sessionId === 'meta-session'))
  assert.ok(entries.every((entry) => entry.meta?.turnId === undefined))
  const bind = entries.find((entry) => entry.body.command === 'session_bind')
  assert.ok(bind)
  assert.equal(bind.meta.sessionId, 'meta-session')
})

test('流式正文不再进入桌宠，内联表情标签只触发一次', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  await dsh.ctx.emit('agent/assistant-stream', {
    agent: { id: 'stream-main' },
    frame: { type: 'start' },
  })
  for (const delta of ['[uta:开', '心] 第一段', '，第二段', '。']) {
    await dsh.ctx.emit('agent/assistant-stream', {
      agent: { id: 'stream-main' },
      frame: { type: 'chunk', delta },
    })
  }
  await dsh.ctx.emit('agent/assistant-stream', {
    agent: { id: 'stream-main' },
    frame: { type: 'end' },
  })
  await new Promise((resolve) => setTimeout(resolve, 120))

  const commands = rt.received.filter((entry) => entry.url === '/command').map((entry) => entry.body)
  assert.equal(commands.some((body) => body.command === 'rp_reply'), false)
  assert.equal(commands.filter((body) => body.command === 'notify').length, 0)
  const presets = commands.filter((body) => body.command === 'set_preset')
  assert.equal(presets.length, 1, '同一表情只应下发一次')
  assert.equal(presets[0].preset, '开心')
})

test('DSH 思考链（reasoning-delta）不会进入桌宠气泡或 TTS', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  const agent = { id: 'reason-stream' }
  const emitFrame = (frame) => dsh.ctx.emit('agent/assistant-stream', { agent, frame })

  await emitFrame({ type: 'start' })
  await emitFrame({ type: 'chunk', chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } })
  await emitFrame({
    type: 'chunk',
    chunk: { type: 'reasoning-delta', index: 0, text: '我先分析一下用户意图。' },
  })
  await emitFrame({
    type: 'chunk',
    chunk: { type: 'reasoning-delta', index: 0, text: '我需要测试一下这个函数。' },
  })
  await emitFrame({
    type: 'chunk',
    chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: '我先分析一下用户意图。' } },
  })
  await emitFrame({ type: 'chunk', chunk: { type: 'block-start', index: 1, blockType: 'text' } })
  await emitFrame({ type: 'chunk', chunk: { type: 'text-delta', index: 1, text: '这是最终回复。' } })
  await emitFrame({
    type: 'chunk',
    chunk: { type: 'block-end', index: 1, block: { type: 'text', text: '这是最终回复。' } },
  })
  await emitFrame({ type: 'end' })
  await new Promise((resolve) => setTimeout(resolve, 120))

  const commands = rt.received.filter((entry) => entry.url === '/command').map((entry) => entry.body)
  assert.equal(commands.some((body) => body.command === 'rp_reply'), false, '正文不再自动进入气泡')
  assert.equal(commands.some((body) => body.command === 'notify'), false, '思考链不得进入气泡或 TTS')

  const narrations = rt.received
    .filter((entry) => entry.url === '/command')
    .map((entry) => entry.body)
    .filter((body) => body.command === 'agent_narrate')
  assert.ok(
    narrations.some((body) => body.intent === 'testing' && body.reasoning === true),
    '推理流应发送 testing 视觉意图',
  )
  assert.ok(
    narrations.every((body) => !String(body.text || '').includes('测试一下这个函数')),
    '推理正文不得进入指令',
  )
})

test('DSH 回合结束时兜底一条摘要，只取 text block 并忽略 reasoning', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  const session = { id: 'fallback-session' }
  await dsh.ctx.emit('session/event', session, { type: 'turn/start', data: {} })
  await dsh.ctx.emit(
    'session/event',
    session,
    {
      type: 'assistant/message',
      data: {
        message: {
          text: '这段纯文本字段混合了思考链，不应使用。',
          content: [
            { type: 'reasoning', text: '这段思考链不应显示。' },
            { type: 'text', text: '这是兜底正文。' },
          ],
        },
      },
    },
  )
  await dsh.ctx.emit('session/event', session, {
    type: 'turn/end',
    data: { reason: { kind: 'completed' } },
  })
  await new Promise((resolve) => setTimeout(resolve, 150))

  const replies = rt.received
    .filter((entry) => entry.url === '/command')
    .map((entry) => entry.body)
    .filter((body) => body.command === 'rp_reply')

  assert.equal(replies.length, 1, '整轮只兜底一条摘要')
  assert.equal(replies[0].text, '这是兜底正文。')
  assert.ok(!replies[0].text.includes('思考链'))
  const commands = rt.received.filter(entry => entry.url === '/command').map(entry => entry.body)
  const completed = commands.filter(body => body.command === 'agent_state' && body.state === 'completed')
  assert.equal(completed.length, 1)
  assert.ok(commands.indexOf(completed[0]) > commands.indexOf(replies[0]))
})

test('DSH 累计式 text-delta 在回合兜底时只保留摘要，不重复拼接', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  const session = { id: 'cumulative-session' }
  const agent = { id: 'cumulative-stream', session }
  const emitFrame = (frame) => dsh.ctx.emit('agent/assistant-stream', { agent, frame })
  await dsh.ctx.emit('session/event', session, { type: 'turn/start', data: {} })
  await emitFrame({ type: 'start' })
  for (const snapshot of [
    '[uta:surprised] 文件',
    '[uta:surprised] 文件已经',
    '[uta:surprised] 文件已经写',
    '[uta:surprised] 文件已经写进去了。',
    '[uta:surprised] 文件已经写进去了。让我从日志',
    '[uta:surprised] 文件已经写进去了。让我从日志确认这次是否同样停下来等了你：',
  ]) {
    await emitFrame({ type: 'chunk', chunk: { type: 'text-delta', index: 0, text: snapshot } })
  }
  await emitFrame({ type: 'end' })
  await dsh.ctx.emit('session/event', session, {
    type: 'turn/end',
    data: { reason: { kind: 'completed' } },
  })
  await new Promise((resolve) => setTimeout(resolve, 150))

  const replies = rt.received
    .filter((entry) => entry.url === '/command')
    .map((entry) => entry.body)
    .filter((body) => body.command === 'rp_reply')
  assert.equal(replies.length, 1)
  assert.equal(replies[0].text, '文件已经写进去了。')
  assert.ok(!replies[0].text.includes('文件文件'))
  assert.ok(!replies[0].text.includes('[uta'))
})

test('DSH 未闭合的 [uta 前缀不会漏进兜底摘要', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  const session = { id: 'partial-tag-session' }
  const agent = { id: 'partial-tag-stream', session }
  const emitFrame = (frame) => dsh.ctx.emit('agent/assistant-stream', { agent, frame })
  await dsh.ctx.emit('session/event', session, { type: 'turn/start', data: {} })
  await emitFrame({ type: 'start' })
  await emitFrame({ type: 'chunk', chunk: { type: 'text-delta', index: 0, text: '[uta' } })
  await emitFrame({
    type: 'chunk',
    chunk: { type: 'text-delta', index: 0, text: ':surprise] 文件已经写进去了。' },
  })
  await emitFrame({ type: 'end' })
  await dsh.ctx.emit('session/event', session, {
    type: 'turn/end',
    data: { reason: { kind: 'completed' } },
  })
  await new Promise((resolve) => setTimeout(resolve, 150))

  const commands = rt.received.filter((entry) => entry.url === '/command').map((entry) => entry.body)
  const replies = commands.filter((body) => body.command === 'rp_reply')
  assert.equal(replies.length, 1)
  assert.equal(replies[0].text, '文件已经写进去了。')
  assert.ok(!replies[0].text.includes('[uta'))
  assert.ok(commands.some((body) => body.command === 'set_emotion' && body.emotion === 'surprise'))
})

test('DSH 长回复在桌宠端只发送短摘要，完整表格留在宿主', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  const session = { id: 'long-session' }
  const agent = { id: 'long-reply', session }
  const longTail = '这是一段很长的补充说明，不应该整段塞进桌宠气泡。'.repeat(30)
  const text = `[uta:等待] 第三次完成。\n\n| 项 | 值 |\n|---|---|\n| approval/asked | 12:39:16 |\n| 结果 | allowed-once |\n\n${longTail}`
  await dsh.ctx.emit('session/event', session, { type: 'turn/start', data: {} })
  await dsh.ctx.emit('agent/assistant-stream', {
    agent,
    frame: { type: 'start' },
  })
  await dsh.ctx.emit('agent/assistant-stream', {
    agent,
    frame: { type: 'chunk', chunk: { type: 'text-delta', index: 0, text } },
  })
  await dsh.ctx.emit('agent/assistant-stream', { agent, frame: { type: 'end' } })
  await dsh.ctx.emit('session/event', session, {
    type: 'turn/end',
    data: { reason: { kind: 'completed' } },
  })
  await new Promise((resolve) => setTimeout(resolve, 150))

  const replies = rt.received
    .filter((entry) => entry.url === '/command')
    .map((entry) => entry.body)
    .filter((body) => body.command === 'rp_reply')
  assert.equal(replies.length, 1)
  assert.equal(replies[0].text, '第三次完成。')
  assert.ok(!replies[0].text.includes('|'), '表格不应进入桌宠气泡')
})

test('uta_express tool triggers preset, emotion, animation and notify commands', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  const expressTool = dsh.tools.get('uta_express')
  assert.ok(expressTool, '应注册 uta_express 工具')

  const result = await expressTool.execute({
    preset: '开心',
    mode: 'revert',
    emotion: 'happy',
    animation: 'wave',
    loop: false,
    text: '任务搞定啦~',
  })
  assert.match(result, /preset=开心\(ok\)/)

  const commands = rt.received
    .filter((r) => r.url === '/command')
    .map((r) => r.body)
    .filter((item) => item.command !== 'hello' && item.command !== 'session_bind')
  assert.deepEqual(commands, [
    { command: 'set_preset', preset: '开心', mode: 'revert' },
    { command: 'set_emotion', emotion: 'happy' },
    { command: 'play_animation', name: 'wave', loop: false },
    { command: 'notify', text: '任务搞定啦~', speak: true },
  ])
})

test('the native DSH skill discovers and calls choreography with the invoking session', async t => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge({ onMotion: () => ({ ok: true, timelineVersion: 1, revision: 'model-a' }) })
  t.after(() => rt.close())
  const dsh = createFakeDshContext({ skills: true })
  plugin.apply(dsh.ctx, { endpointFile: writeEndpointFile(rt.port) })
  const motion = dsh.tools.get('deskpet_motion')
  assert.ok(motion)
  assert.ok(dsh.skills.some(skill => skill.content.includes('deskpet_motion')))
  const result = await motion.execute({ operation: 'capabilities' }, { sessionId: 'motion-session' })
  assert.equal(result.revision, 'model-a')
  assert.deepEqual(rt.received.find(entry => entry.url === '/motion').body, {
    operation: 'capabilities', hostId: 'deepseek-harness', sessionId: 'motion-session',
  })
})

test('DSH 模型主动发言后，回合结束不再补发最终摘要', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  const session = { id: 'spoken-session' }
  await dsh.ctx.emit('session/event', session, { type: 'turn/start', data: {} })
  await dsh.ctx.emit('session/event', session, {
    type: 'tool/call',
    data: { name: 'uta_express', callId: 'call-1', arguments: { text: '已经找到问题了。' } },
  })
  await dsh.ctx.emit('session/event', session, {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: '这是一段完整的最终回复，不应再进入桌宠。' }] } },
  })
  await dsh.ctx.emit('session/event', session, {
    type: 'turn/end',
    data: { reason: { kind: 'completed' } },
  })
  await new Promise((resolve) => setTimeout(resolve, 150))

  const commands = rt.received.filter((entry) => entry.url === '/command').map((entry) => entry.body)
  assert.equal(commands.some((body) => body.command === 'rp_reply'), false)
  assert.ok(commands.some((body) => body.command === 'agent_state' && body.state === 'completed'))
})

test('uta_express 的中文情绪自动改走预设通道，不再被 400 误报为离线', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())

  const endpointFile = writeEndpointFile(rt.port)
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile })

  const expressTool = dsh.tools.get('uta_express')
  const result = await expressTool.execute({ emotion: '开心' })

  assert.match(result, /emotion=开心\(ok\)/, '中文情绪应成功，而不是 offline')
  const commands = rt.received
    .filter((r) => r.url === '/command')
    .map((r) => r.body)
    .filter((item) => item.command !== 'hello' && item.command !== 'session_bind')
  assert.deepEqual(commands, [{ command: 'set_preset', preset: '开心', mode: 'revert' }])
})

// DSH 0.2.x 的契约：Session 只有 `get id()`，工作目录在 `session.header.cwd`；
// tools/execute 的 exec 对象只有 `agent`，**没有** `session`。
// 之前三处取值都是不存在的属性，静默退到 process.cwd()（Electron 下是 profile 目录），
// 桌面宠物的待办归属与会话登记就全错在工作目录上。
test('[DSH-ADAPT: 会话工作目录取自 header.cwd] todo 快照与会话登记都用会话工作区', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())
  const endpointFile = writeEndpointFile(rt.port)
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-dsh-cwd-'))
  tmpDirs.add(appData)

  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile, env: { ...process.env, APPDATA: appData } })

  const workspace = path.join(appData, 'proj-alpha')
  const session = { id: 'cwd-session', header: { cwd: workspace } }
  const agent = { id: 'cwd-agent', session }

  // 1) session/event 的 todo/write 分支
  await dsh.ctx.emit('session/event', session, {
    type: 'todo/write',
    data: { todos: [{ content: '适配 DSH 0.2.1-rc.3', status: 'pending' }] },
  })
  // 2) tools/execute 分支：exec 上只有 agent.session.header，没有 exec.session
  await dsh.ctx.emitWaterfall(
    'tools/execute',
    {
      name: 'todo_write',
      arguments: { todos: [{ content: '验证 cwd 归属', status: 'in_progress' }] },
      agent,
    },
    async () => ({}),
  )
  // 3) 会话登记文件（桌宠直发消息时用它启动 headless 子进程）
  await dsh.ctx.emit('agent/assistant-stream', { agent, frame: { type: 'start' } })
  await new Promise((resolve) => setTimeout(resolve, 250))

  const snapshots = rt.received
    .filter((entry) => entry.url === '/command')
    .map((entry) => entry.body)
    .filter((body) => body.command === 'todo_snapshot')
  assert.ok(snapshots.length >= 2, `应发出两次 todo_snapshot，实际 ${snapshots.length}`)
  for (const snapshot of snapshots) {
    assert.equal(snapshot.cwd, workspace, 'todo_snapshot 的 cwd 必须是会话工作区')
  }

  // hooksDir 跟着 endpoint 文件走（runtimeDir = endpoint 所在目录），不是 APPDATA
  const record = JSON.parse(
    fs.readFileSync(path.join(path.dirname(endpointFile), 'hooks', 'harness-session.json'), 'utf8'),
  )
  assert.equal(record.sessionId, 'cwd-session')
  assert.equal(record.cwd, workspace, '会话登记必须写真实工作区，不能是进程 cwd')
})

test('[DSH-ADAPT: v2 信封元数据] hostInstanceId/eventId/seq/ts 齐全且 seq 单调', async (t) => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const rt = await startMockUtaBridge()
  t.after(() => rt.close())
  const endpointFile = writeEndpointFile(rt.port)
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-dsh-meta-'))
  tmpDirs.add(appData)

  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile, env: { ...process.env, APPDATA: appData } })

  const session = { id: 'meta-session', header: { cwd: appData } }
  await dsh.ctx.emit('session/event', session, { type: 'turn/start', data: {} })
  await dsh.ctx.emit('session/event', session, { type: 'turn/start', data: {} })
  await new Promise((resolve) => setTimeout(resolve, 200))

  const envelopes = rt.received
    .filter((entry) => entry.url === '/command')
    .map((entry) => entry.envelope)
    .filter(Boolean)
  assert.ok(envelopes.length >= 3, `应有 hello/session_bind 等信封，实际 ${envelopes.length}`)

  const instance = envelopes[0].meta.hostInstanceId
  assert.match(instance, /^[A-Za-z0-9._-]{1,64}$/, 'hostInstanceId 必须符合协议白名单')
  const ids = new Set()
  let previousSeq = -1
  for (const envelope of envelopes) {
    assert.equal(envelope.meta.hostId, 'deepseek-harness')
    assert.equal(envelope.meta.hostInstanceId, instance, '同一次插件加载必须共用一个实例 ID')
    assert.match(envelope.meta.eventId, /^[A-Za-z0-9._-]{1,128}$/)
    assert.ok(!ids.has(envelope.meta.eventId), 'eventId 不能重复')
    ids.add(envelope.meta.eventId)
    assert.ok(typeof envelope.meta.seq === 'number' && envelope.meta.seq > previousSeq)
    previousSeq = envelope.meta.seq
    assert.ok(!Number.isNaN(Date.parse(envelope.meta.ts)), 'ts 必须是可解析的时间戳')
  }

  // 能力声明必须覆盖 Uta 的 RUNTIME_CAPABILITIES，少报会让桌宠退回复制模式
  const hello = rt.received.find((entry) => entry.body?.command === 'hello')
  assert.ok(hello, '应发送 hello')
  for (const capability of [
    'statusEvents',
    'assistantText',
    'characterTools',
    'approval',
    'streamingReply',
    'sessionBinding',
    'receipts',
  ]) {
    assert.ok(hello.body.capabilities.includes(capability), `hello 应声明 ${capability}`)
  }
})

// ---------------------------------------------------------------------------
// [DSH-P1: 指定会话失效时消息误投其他会话] 的回归
// 审查报告复现：请求 session-A-missing、agents 里只有 session-B 时，
// B 的 followup() 会收到消息，而主程序把请求 ID 写回成功结果。
// ---------------------------------------------------------------------------

async function readNativeBridgeFile(appData) {
  const file = path.join(appData, 'uta', 'hooks', 'deepseek-harness-native-bridge.json')
  for (let i = 0; i < 100; i += 1) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  return null
}

async function postNativeBridge(info, payload) {
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: info.port,
        path: '/message',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${info.token}`,
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }))
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

function makeAgent(id, delivered, label = id) {
  return {
    id,
    session: { id },
    followup(input) {
      delivered.push({ to: id, label, text: input.content[0].text })
    },
  }
}

test('two DSH connectors keep separately registered native bridges', async t => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-dsh-dual-'))
  tmpDirs.add(appData)
  const delivered = []
  const hooks = path.join(appData, 'uta', 'hooks')
  async function launch(id) {
    const agent = makeAgent(id, delivered)
    const dsh = createFakeDshContext({ agents: true, agentRegistry: {
      get: key => key === id ? agent : undefined, list: () => [agent], roots: () => [agent],
    } })
    plugin.apply(dsh.ctx, { env: { ...process.env, APPDATA: appData } })
    t.after(() => { for (const dispose of dsh.effects.splice(0)) dispose() })
    await dsh.ctx.emit('session/event', { id }, { type: 'turn/start', data: {} })
    const file = path.join(hooks, 'sessions', 'deepseek-harness', `${require('node:crypto').createHash('sha256').update(id).digest('hex')}.json`)
    const { nativeBridgeId } = JSON.parse(fs.readFileSync(file, 'utf8'))
    return await waitForSyncValue(() => {
      try { return JSON.parse(fs.readFileSync(path.join(hooks, 'native-bridges', 'deepseek-harness', `${nativeBridgeId}.json`), 'utf8')) }
      catch { return null }
    })
  }
  const a = await launch('session-A')
  const b = await launch('session-B')
  assert.ok(a && b)
  assert.notEqual(a.port, b.port)
  assert.equal((await postNativeBridge(a, { text: 'A only', sessionId: 'session-A' })).status, 200)
  assert.equal((await postNativeBridge(b, { text: 'B only', sessionId: 'session-B' })).status, 200)
  assert.deepEqual(delivered.map(entry => entry.to), ['session-A', 'session-B'])
})

test('all express actions use the invoking session even if a different turn starts', async t => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  let release, received
  const pending = new Promise(resolve => { release = resolve })
  const presetReceived = new Promise(resolve => { received = resolve })
  const rt = await startMockUtaBridge({ onCommand: async entry => {
    if (entry.body.command === 'set_preset') { received(); await pending }
  } })
  t.after(() => { release(); return rt.close() })
  const dsh = createFakeDshContext()
  plugin.apply(dsh.ctx, { endpointFile: writeEndpointFile(rt.port) })
  const result = dsh.tools.get('uta_express').execute({ preset: '开心', text: '仍属于 A' }, { sessionId: 'A' })
  await presetReceived
  await dsh.ctx.emit('session/event', { id: 'B' }, { type: 'turn/start', data: {} })
  release()
  await result
  const actions = rt.received.filter(entry => ['set_preset', 'notify'].includes(entry.body?.command))
  assert.deepEqual(actions.map(entry => entry.meta?.sessionId), ['A', 'A'])
})

test('[DSH-P1: 指定会话失效不得改投] 目标不存在时拒绝，且不送给活动会话', async () => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-dsh-target-'))
  tmpDirs.add(appData)

  const delivered = []
  const agentB = makeAgent('session-B', delivered)
  const registry = {
    get: (id) => (id === 'session-B' ? agentB : undefined),
    list: () => [agentB],
    roots: () => [agentB],
  }
  const dsh = createFakeDshContext({ agents: true, agentRegistry: registry })
  plugin.apply(dsh.ctx, { env: { ...process.env, APPDATA: appData } })

  // 把活动会话设成 session-B，制造「改投就能发出去」的诱惑
  await dsh.ctx.emit('session/event', { id: 'session-B' }, { type: 'turn/start', data: {} })

  const info = await readNativeBridgeFile(appData)
  assert.ok(info, '应写出原生桥端点文件')
  const response = await postNativeBridge(info, { text: '给 A 的消息', sessionId: 'session-A-missing' })

  assert.equal(response.status, 409)
  assert.equal(response.body.error, 'session-not-found')
  assert.equal(response.body.requestedSession, 'session-A-missing')
  assert.equal(delivered.length, 0, '目标失效时不得改投 session-B')
  for (const dispose of dsh.effects.splice(0)) dispose()
})

test('[DSH-P1: 精确命中] 目标存在时只送给目标，回执回传 messageId', async () => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-dsh-target-hit-'))
  tmpDirs.add(appData)

  const delivered = []
  const agentA = makeAgent('session-A', delivered)
  const agentB = makeAgent('session-B', delivered)
  const registry = {
    get: (id) => (id === 'session-A' ? agentA : id === 'session-B' ? agentB : undefined),
    list: () => [agentA, agentB],
    roots: () => [agentA, agentB],
  }
  const dsh = createFakeDshContext({ agents: true, agentRegistry: registry })
  plugin.apply(dsh.ctx, { env: { ...process.env, APPDATA: appData } })

  await dsh.ctx.emit('session/event', { id: 'session-B' }, { type: 'turn/start', data: {} })

  const info = await readNativeBridgeFile(appData)
  assert.ok(info)
  const response = await postNativeBridge(info, {
    text: '给 A 的消息',
    sessionId: 'session-A',
    messageId: 'msg-0001',
  })

  assert.equal(response.status, 200)
  assert.equal(response.body.accepted, true)
  assert.equal(response.body.sessionId, 'session-A')
  assert.equal(response.body.messageId, 'msg-0001')
  assert.deepEqual(delivered, [{ to: 'session-A', label: 'session-A', text: '给 A 的消息' }])
  for (const dispose of dsh.effects.splice(0)) dispose()
})

test('[DSH-P1: 未指定目标] 只有调用方不给 sessionId 时才允许按活动会话兜底', async () => {
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href)
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-dsh-target-none-'))
  tmpDirs.add(appData)

  const delivered = []
  const agentB = makeAgent('session-B', delivered)
  const registry = {
    get: (id) => (id === 'session-B' ? agentB : undefined),
    list: () => [agentB],
    roots: () => [agentB],
  }
  const dsh = createFakeDshContext({ agents: true, agentRegistry: registry })
  plugin.apply(dsh.ctx, { env: { ...process.env, APPDATA: appData } })

  await dsh.ctx.emit('session/event', { id: 'session-B' }, { type: 'turn/start', data: {} })

  const info = await readNativeBridgeFile(appData)
  assert.ok(info)
  const response = await postNativeBridge(info, { text: '没有指定目标' })

  assert.equal(response.status, 200)
  assert.equal(response.body.sessionId, 'session-B')
  assert.equal(delivered.length, 1)
  for (const dispose of dsh.effects.splice(0)) dispose()
})
