'use strict'
// Antigravity 宿主 hook 单测：事件映射、命令投递、去重防抖、审批卡片与隐私边界。
const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const HOOK = path.resolve(__dirname, '../plugins/antigravity/src/uta-antigravity-hook.mjs')
const TOKEN = 'antigravity-test-token-abcdef123456'
const servers = new Set()
const tmpDirs = new Set()

after(async () => {
  for (const server of [...servers]) await new Promise((resolve) => server.close(resolve))
  servers.clear()
  for (const dir of [...tmpDirs]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  tmpDirs.clear()
})

function makeAppDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-ag-test-'))
  tmpDirs.add(dir)
  return dir
}

function writeEndpointFile(appDataDir, port) {
  const dir = path.join(appDataDir, 'uta')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'runtime-endpoint.json')
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, port, token: TOKEN, createdAt: new Date().toISOString() }),
  )
  return file
}

async function startMockRuntime(options = {}) {
  const received = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      let parsed = null
      try {
        parsed = body ? JSON.parse(body) : null
      } catch {
        /* ignore */
      }
      const envelope = parsed && parsed.protocolVersion === '2.0' ? parsed : null
      received.push({
        url: req.url,
        method: req.method,
        auth: req.headers.authorization,
        body: envelope ? envelope.command : parsed,
        envelope,
        meta: envelope?.meta,
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (req.url === '/approval/ask') {
        res.end(
          JSON.stringify({
            ok: true,
            requestId: parsed?.requestId,
            outcome: options.approvalOutcome || 'unavailable',
          }),
        )
        return
      }
      res.end(JSON.stringify({ ok: true, characterAvailable: true }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.add(server)
  return {
    port: server.address().port,
    received,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function runHookSync({ payload, appDataDir, endpointFile, event, extraEnv = {} }) {
  const env = { ...process.env, APPDATA: appDataDir, ...extraEnv }
  if (endpointFile) env.DESKPET_ENDPOINT_FILE = endpointFile
  const args = [HOOK]
  if (event) args.push(`--event=${event}`)
  return spawnSync(process.execPath, args, {
    input: payload === undefined ? '' : JSON.stringify(payload),
    env,
    encoding: 'utf8',
    timeout: 10000,
  })
}

function runHookAsync({ payload, appDataDir, endpointFile, event, extraEnv = {} }) {
  const env = { ...process.env, APPDATA: appDataDir, ...extraEnv }
  if (endpointFile) env.DESKPET_ENDPOINT_FILE = endpointFile
  const args = [HOOK]
  if (event) args.push(`--event=${event}`)
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, args, { env })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => {
      stdout += d
    })
    proc.stderr.on('data', (d) => {
      stderr += d
    })
    proc.on('close', (status) => resolve({ status, stdout, stderr }))
    if (payload !== undefined) proc.stdin.write(JSON.stringify(payload))
    proc.stdin.end()
  })
}

test('resolveEventName 解析命令行参数、环境变量与 payload', async () => {
  const mod = await import(pathToFileURL(HOOK).href)
  assert.equal(mod.resolveEventName(['node', 'hook.mjs', '--event=SessionStart']), 'SessionStart')
  assert.equal(mod.resolveEventName(['node', 'hook.mjs'], null, { UTA_HOOK_EVENT: 'PreInvocation' }), 'PreInvocation')
  assert.equal(mod.resolveEventName(['node', 'hook.mjs'], { hookEventName: 'PreToolUse' }, {}), 'PreToolUse')
  assert.equal(mod.resolveEventName(['node', 'hook.mjs'], { event: 'Stop' }, {}), 'Stop')
})

test('mapEventToCommands 纯函数映射各个生命周期事件', async () => {
  const mod = await import(pathToFileURL(HOOK).href)

  // SessionStart 触发待命与唤起
  assert.deepEqual(mod.mapEventToCommands('SessionStart', {}), [
    { command: 'agent_state', state: 'idle', narrate: 'session_start' },
    { command: 'summon' },
  ])

  // PreInvocation 触发思考中
  assert.deepEqual(mod.mapEventToCommands('PreInvocation', {}), [
    { command: 'agent_state', state: 'thinking', label: '思考中...', narrate: 'thinking' },
  ])

  // PreToolUse 携带工具名称
  assert.deepEqual(
    mod.mapEventToCommands('PreToolUse', { toolCall: { name: 'run_command' } }),
    [{ command: 'agent_state', state: 'tool_running', toolName: 'run_command', narrate: 'running' }],
  )

  // PostToolUse 正常与报错差分
  assert.deepEqual(mod.mapEventToCommands('PostToolUse', {}), [
    { command: 'agent_state', state: 'thinking', label: '处理结果...' },
  ])
  assert.deepEqual(mod.mapEventToCommands('PostToolUse', { error: 'exit status 1' }), [
    { command: 'agent_state', state: 'thinking', label: '处理报错，分析中...', narrate: 'error' },
  ])
})

test('Stop 指令生成与气泡摘要', async () => {
  const mod = await import(pathToFileURL(HOOK).href)

  assert.equal(mod.summarizeReply('   代码已经编写完毕。   '), '代码已经编写完毕。')
  const longReply = 'x'.repeat(200)
  const longSummary = mod.summarizeReply(longReply)
  assert.ok(longSummary.length <= 81, '长回复压成一两句摘要，不原样搬运')
  assert.ok(longSummary.endsWith('…'))

  const stopCommands = mod.buildStopCommands({
    conversationId: 'c1',
    terminationReason: 'NO_TOOL_CALL',
  })
  assert.deepEqual(stopCommands, [
    { command: 'agent_state', state: 'completed', label: '回复完成' },
  ])

  const errored = mod.buildStopCommands({ conversationId: 'c2', terminationReason: 'ERROR' })
  assert.equal(errored[0].state, 'error')
  assert.equal(errored[0].narrate, 'error')

  const canceled = mod.buildStopCommands({ conversationId: 'c3', terminationReason: 'USER_CANCELED' })
  assert.deepEqual(canceled, [{ command: 'agent_state', state: 'idle' }])
  assert.equal(mod.buildStopCommands({ conversationId: 'c4', terminationReason: 'UNKNOWN' })[0].state, 'idle')

  // PostInvocation 只缓存正文，等 Stop 时作为本轮最终回复投递
  assert.deepEqual(mod.mapEventToCommands('PostInvocation', { modelOutput: '完成测试。' }), [])
  const longCommentary = `[uta:等待] 我先看一下。\n\n| 项 | 值 |\n|---|---|\n| a | b |\n\n${'补充说明。'.repeat(40)}`
  const commentary = mod.summarizeCommentary(longCommentary)
  assert.ok(commentary.startsWith('我先看一下。'), commentary)
  assert.ok(!commentary.includes('|'))
  assert.ok(commentary.length <= 121, `实际 ${commentary.length}`)
})

test('Stop 跨会话隔离与 10 秒去重', async () => {
  const mod = await import(pathToFileURL(HOOK).href)
  const now = 1_000_000
  const previous = {
    ...mod.stopReasonState({ conversationId: 'conv-1', terminationReason: 'NO_TOOL_CALL' }),
    at: now,
  }

  const duplicate = mod.buildStopCommands(
    { conversationId: 'conv-1', terminationReason: 'NO_TOOL_CALL' },
    previous,
    now + 2000,
  )
  assert.deepEqual(duplicate, [])

  const otherConv = mod.buildStopCommands(
    { conversationId: 'conv-2', terminationReason: 'NO_TOOL_CALL' },
    previous,
    now + 2000,
  )
  assert.equal(otherConv.length, 1)
})

test('Stop 投递最后一次 PostInvocation 正文，且不再逐步骤弹通知', async (t) => {
  const mod = await import(pathToFileURL(HOOK).href)
  const rt = await startMockRuntime()
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const first = await runHookAsync({
    payload: { modelOutput: '第一步的中间汇报。', conversationId: 'conv-final' },
    appDataDir,
    endpointFile,
    event: 'PostInvocation',
  })
  assert.equal(first.status, 0)
  assert.equal(
    rt.received.filter((entry) => entry.url === '/command').length,
    0,
    'PostInvocation 不应逐步骤弹气泡',
  )

  const second = await runHookAsync({
    payload: { modelOutput: '最终答案已经写好。', conversationId: 'conv-final' },
    appDataDir,
    endpointFile,
    event: 'PostInvocation',
  })
  assert.equal(second.status, 0)

  const stop = await runHookAsync({
    payload: { conversationId: 'conv-final', terminationReason: 'NO_TOOL_CALL' },
    appDataDir,
    endpointFile,
    event: 'Stop',
  })
  assert.equal(stop.status, 0)

  const commands = rt.received.filter((entry) => entry.url === '/command').map((entry) => entry.body)
  assert.equal(commands[0].command, 'rp_reply')
  assert.equal(commands[0].text, '最终答案已经写好。')
  assert.ok(commands.some((item) => item.command === 'agent_state' && item.state === 'completed'))
  assert.equal(
    fs.existsSync(mod.pendingReplyFile('conv-final', { APPDATA: appDataDir })),
    false,
    'Stop 后应清理临时回复缓存',
  )
})

test('模型通过桌宠 MCP 发言后，Stop 不再补发最终摘要', async (t) => {
  const rt = await startMockRuntime()
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const pre = await runHookAsync({
    payload: {
      conversationId: 'conv-speech',
      toolCall: {
        name: 'call_mcp_tool',
        args: { ServerName: 'uta-deskpet_uta-deskpet', ToolName: 'deskpet_notify' },
      },
      result: { ok: true },
    },
    appDataDir,
    endpointFile,
    event: 'PostToolUse',
  })
  assert.equal(pre.status, 0)

  const post = await runHookAsync({
    payload: { conversationId: 'conv-speech', modelOutput: '这是一段不应再进入桌宠的最终回复。' },
    appDataDir,
    endpointFile,
    event: 'PostInvocation',
  })
  assert.equal(post.status, 0)

  const stop = await runHookAsync({
    payload: { conversationId: 'conv-speech', terminationReason: 'NO_TOOL_CALL' },
    appDataDir,
    endpointFile,
    event: 'Stop',
  })
  assert.equal(stop.status, 0)

  const commands = rt.received.filter((entry) => entry.url === '/command').map((entry) => entry.body)
  assert.equal(commands.some((item) => item.command === 'rp_reply'), false)
  assert.ok(commands.some((item) => item.command === 'agent_state' && item.state === 'completed'))
})

test('Antigravity 两个会话的待发回复互不串台', async (t) => {
  const rt = await startMockRuntime()
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  for (const [conversationId, modelOutput] of [
    ['conv-a', 'A 会话的最终答案。'],
    ['conv-b', 'B 会话的最终答案。'],
  ]) {
    const res = await runHookAsync({
      payload: { conversationId, modelOutput },
      appDataDir,
      endpointFile,
      event: 'PostInvocation',
    })
    assert.equal(res.status, 0)
  }

  const stopA = await runHookAsync({
    payload: { conversationId: 'conv-a', terminationReason: 'NO_TOOL_CALL' },
    appDataDir,
    endpointFile,
    event: 'Stop',
  })
  assert.equal(stopA.status, 0)
  const commandsA = rt.received.filter((entry) => entry.url === '/command').map((entry) => entry.body)
  const replyA = commandsA.find((item) => item.command === 'rp_reply')
  assert.ok(replyA)
  assert.equal(replyA.text, 'A 会话的最终答案。')
})

test('实机投递：SessionStart 投递 idle 与 summon，并写入心跳日志', async (t) => {
  const rt = await startMockRuntime()
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const res = await runHookAsync({
    payload: { conversationId: 'conv-start-001' },
    appDataDir,
    endpointFile,
    event: 'SessionStart',
  })

  assert.equal(res.status, 0, res.stderr)
  assert.equal(res.stdout, '{}')

  const commands = rt.received.filter((r) => r.url === '/command').map((r) => r.body)
  assert.deepEqual(commands, [
    { command: 'agent_state', state: 'idle', narrate: 'session_start' },
    { command: 'summon' },
  ])

  // 检查心跳日志生成且不含私密内容
  const logFile = path.join(appDataDir, 'uta', 'hooks', 'antigravity-events.jsonl')
  assert.ok(fs.existsSync(logFile), '心跳日志必须存在')
  const logLines = fs.readFileSync(logFile, 'utf8').trim().split('\n')
  assert.equal(logLines.length, 1)
  const logEntry = JSON.parse(logLines[0])
  assert.equal(logEntry.event, 'SessionStart')
  assert.equal(logEntry.conversationId, 'tart-001')
})

test('Antigravity commands carry conversation ownership and multiple workspaces never pick a cwd', async t => {
  const rt = await startMockRuntime()
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir(), endpointFile = writeEndpointFile(appDataDir, rt.port)
  for (const [conversationId, workspacePaths] of [['A', [appDataDir]], ['B', [appDataDir, path.dirname(appDataDir)]]]) {
    const response = await runHookAsync({ payload: { conversationId, workspacePaths }, appDataDir, endpointFile, event: 'SessionStart' })
    assert.equal(response.status, 0)
  }
  const commands = rt.received.filter(value => value.url === '/command')
  assert.ok(commands.every(value => value.meta?.hostId === 'antigravity' && ['A', 'B'].includes(value.meta.sessionId) && value.meta.eventId))
  assert.equal(commands.find(value => value.body.command === 'session_bind' && value.meta.sessionId === 'A').body.cwd, appDataDir)
  assert.equal(commands.find(value => value.body.command === 'session_bind' && value.meta.sessionId === 'B').body.cwd, '')
  assert.equal(new Set(commands.map(value => value.meta.eventId)).size, commands.length)
})

test('实机投递：PreToolUse 投递 tool_running', async (t) => {
  const rt = await startMockRuntime()
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const res = await runHookAsync({
    payload: {
      toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } },
      stepIdx: 12,
      conversationId: 'conv-tool-002',
    },
    appDataDir,
    endpointFile,
    event: 'PreToolUse',
  })

  assert.equal(res.status, 0, res.stderr)
  // 普通工具不接管：返回 ask，交回 Antigravity 自己的权限流程
  assert.equal(JSON.parse(res.stdout).decision, 'ask')

  const commands = rt.received.filter((r) => r.url === '/command').map((r) => r.body)
  assert.deepEqual(commands, [
    { command: 'agent_state', state: 'tool_running', toolName: 'run_command', narrate: 'testing' },
  ])

  // call_mcp_tool 默认免审批但附带 MCP 权限豁免，保证宿主 IDE 静默无弹窗
  const resMcp = await runHookAsync({
    payload: {
      toolCall: {
        name: 'call_mcp_tool',
        args: {
          ServerName: 'uta-deskpet_uta-deskpet',
          ToolName: 'deskpet_set_emotion',
          Arguments: { emotion: 'happy' },
        },
      },
      stepIdx: 13,
      conversationId: 'conv-tool-mcp',
    },
    appDataDir,
    endpointFile,
    event: 'PreToolUse',
  })
  assert.equal(resMcp.status, 0)
  const mcpOut = JSON.parse(resMcp.stdout)
  assert.equal(mcpOut.decision, 'allow')
  assert.ok(Array.isArray(mcpOut.permissionOverrides))
  assert.ok(mcpOut.permissionOverrides.includes('mcp(uta-deskpet_uta-deskpet/deskpet_set_emotion)'))
})

test('审批：AskUserQuestion 不弹桌宠卡，只提示回宿主选择', async (t) => {
  const rt = await startMockRuntime({ approvalOutcome: 'allowed-once' })
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const res = await runHookAsync({
    payload: {
      toolCall: {
        name: 'AskUserQuestion',
        args: { questions: [{ question: '选哪个方案？' }] },
      },
      stepIdx: 21,
      conversationId: 'conv-choice',
    },
    appDataDir,
    endpointFile,
    event: 'PreToolUse',
  })

  assert.equal(res.status, 0, res.stderr)
  assert.equal(JSON.parse(res.stdout).decision, 'ask')
  assert.equal(rt.received.filter((r) => r.url === '/approval/ask').length, 0)
  const commands = rt.received.filter((r) => r.url === '/command').map((r) => r.body)
  const notice = commands.find((item) => item.command === 'choice_hint')
  assert.ok(notice, '应给桌宠一条回宿主选择的提示')
  assert.match(notice.text, /Antigravity 在等你选择方案/)
  const state = commands.find((item) => item.command === 'agent_state')
  assert.equal(state.label, '等待你在宿主里选择方案')
})

test('审批：开启审批模式时，批准与拒绝正确输出决策', async (t) => {
  // 1. 批准分支
  const rtAllow = await startMockRuntime({ approvalOutcome: 'approved' })
  t.after(() => rtAllow.close())
  const appDataDir1 = makeAppDataDir()
  const endpointFile1 = writeEndpointFile(appDataDir1, rtAllow.port)

  const resAllow = await runHookAsync({
    payload: {
      toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf ./temp' } },
      stepIdx: 5,
      conversationId: 'conv-appr-1',
    },
    appDataDir: appDataDir1,
    endpointFile: endpointFile1,
    event: 'PreToolUse',
    extraEnv: { UTA_APPROVAL_ENABLED: 'true' },
  })

  assert.equal(resAllow.status, 0)
  const allowOut = JSON.parse(resAllow.stdout)
  assert.equal(allowOut.decision, 'allow')
  assert.ok(Array.isArray(allowOut.permissionOverrides))
  assert.ok(allowOut.permissionOverrides.includes('command(rm -rf ./temp)'))

  // 1b. 外网抓取走 Antigravity 宿主级网络沙箱，桌宠不再先弹一次审批
  const approvalCountBeforeUrl = rtAllow.received.filter((r) => r.url === '/approval/ask').length
  const resUrl = await runHookAsync({
    payload: {
      toolCall: { name: 'read_url_content', args: { Url: 'https://httpbin.org/get' } },
      stepIdx: 7,
      conversationId: 'conv-appr-url',
    },
    appDataDir: appDataDir1,
    endpointFile: endpointFile1,
    event: 'PreToolUse',
  })
  assert.equal(resUrl.status, 0)
  const urlOut = JSON.parse(resUrl.stdout)
  assert.equal(urlOut.decision, 'ask')
  assert.equal(urlOut.permissionOverrides, undefined)
  assert.equal(
    rtAllow.received.filter((r) => r.url === '/approval/ask').length,
    approvalCountBeforeUrl,
    'URL 抓取不应再请求桌宠审批',
  )

  // 1c. read_browser_page 同样交给宿主网络沙箱
  const resBrowser = await runHookAsync({
    payload: {
      toolCall: { name: 'read_browser_page', args: { Url: 'https://httpbin.org/get' } },
      stepIdx: 8,
      conversationId: 'conv-appr-browser',
    },
    appDataDir: appDataDir1,
    endpointFile: endpointFile1,
    event: 'PreToolUse',
  })
  assert.equal(resBrowser.status, 0)
  assert.equal(JSON.parse(resBrowser.stdout).decision, 'ask')

  // 2. 拒绝分支
  const rtDeny = await startMockRuntime({ approvalOutcome: 'rejected' })
  t.after(() => rtDeny.close())
  const appDataDir2 = makeAppDataDir()
  const endpointFile2 = writeEndpointFile(appDataDir2, rtDeny.port)

  const resDeny = await runHookAsync({
    payload: {
      toolCall: { name: 'run_command', args: { CommandLine: 'drop database' } },
      stepIdx: 6,
      conversationId: 'conv-appr-2',
    },
    appDataDir: appDataDir2,
    endpointFile: endpointFile2,
    event: 'PreToolUse',
    extraEnv: { UTA_APPROVAL_ENABLED: 'true' },
  })

  assert.equal(resDeny.status, 0)
  const denyOut = JSON.parse(resDeny.stdout)
  assert.equal(denyOut.decision, 'deny')
  assert.ok(denyOut.reason)
})

test('桌宠离线时保持静默（Fail-Open，退出码恒为 0）', async () => {
  const appDataDir = makeAppDataDir()
  // 不写入 endpoint 文件，模拟桌宠未启动
  const res = runHookSync({
    payload: { conversationId: 'offline-001' },
    appDataDir,
    event: 'SessionStart',
  })

  assert.equal(res.status, 0)
  assert.equal(res.stdout, '{}')
})
