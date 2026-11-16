'use strict'
// Qoder 宿主 hook：事件映射、真实投递、故障放行与隐私边界。
const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const HOOK = path.resolve(__dirname, '../plugins/qoder/src/uta-hook.mjs')
const TOKEN = 'qoder-hook-test-token-0123456789'
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-qoder-test-'))
  tmpDirs.add(dir)
  return dir
}

function writeEndpointFile(appDataDir, port) {
  const dir = path.join(appDataDir, 'uta')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'runtime-endpoint.json')
  fs.writeFileSync(file, JSON.stringify({ version: 1, port, token: TOKEN, createdAt: new Date().toISOString() }))
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
      if (req.url === '/health') {
        res.end(
          JSON.stringify({
            ok: true,
            protocolVersion: '2.0',
            protocolVersions: ['1.0', '2.0'],
          }),
        )
        return
      }
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

function runHook({ payload, appDataDir, endpointFile, event }) {
  const env = { ...process.env, APPDATA: appDataDir }
  if (endpointFile) env.DESKPET_ENDPOINT_FILE = endpointFile
  if (event) env.UTA_HOOK_EVENT = event
  return spawnSync(process.execPath, [HOOK], {
    input: payload === undefined ? '' : JSON.stringify(payload),
    env,
    encoding: 'utf8',
    timeout: 10000,
  })
}

/**
 * 异步跑 hook：mock 运行时就在本进程里，spawnSync 会阻塞事件循环
 * 导致服务端无法应答，必须用异步 spawn。
 */
function runHookAsync({ payload, appDataDir, endpointFile, event }) {
  const env = { ...process.env, APPDATA: appDataDir }
  if (endpointFile) env.DESKPET_ENDPOINT_FILE = endpointFile
  if (event) env.UTA_HOOK_EVENT = event
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], { env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
    child.stdin.end(payload === undefined ? '' : JSON.stringify(payload))
  })
}

test('每个生命周期事件都映射到预期的桌宠状态', async () => {
  const { mapEventToCommand } = await import(pathToFileURL(HOOK).href)

  assert.deepEqual(mapEventToCommand({ hook_event_name: 'SessionStart' }), {
    command: 'agent_state',
    state: 'idle',
    narrate: 'session_start',
  })
  assert.deepEqual(mapEventToCommand({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }), {
    command: 'agent_state',
    state: 'thinking',
    label: '思考中...',
    narrate: 'thinking',
  })
  assert.deepEqual(mapEventToCommand({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }), {
    command: 'agent_state',
    state: 'tool_running',
    toolName: 'Bash',
    narrate: 'running',
  })
  assert.equal(mapEventToCommand({ hook_event_name: 'PostToolUse' }).state, 'thinking')
  assert.equal(mapEventToCommand({ hook_event_name: 'PostToolUseFailure' }).state, 'thinking')
  assert.equal(mapEventToCommand({ hook_event_name: 'Stop' }), null, 'Stop 由 buildStopCommands 单独处理')
  assert.deepEqual(mapEventToCommand({ hook_event_name: 'SessionEnd' }), {
    command: 'agent_state',
    state: 'idle',
  })

  // 审批暂时只观察，不参与决策
  assert.equal(mapEventToCommand({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }), null)
  assert.equal(mapEventToCommand({}), null)
})

test('SessionStart 额外请求呼出桌宠，其他事件不附带 summon', async () => {
  const { mapEventToCommands } = await import(pathToFileURL(HOOK).href)

  assert.deepEqual(mapEventToCommands({ hook_event_name: 'SessionStart' }), [
    { command: 'agent_state', state: 'idle', narrate: 'session_start' },
    { command: 'summon' },
  ])
  assert.deepEqual(mapEventToCommands({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }), [
    { command: 'agent_state', state: 'thinking', label: '思考中...', narrate: 'thinking' },
  ])
  assert.deepEqual(mapEventToCommands({ hook_event_name: 'Stop' }), [])
})

test('SessionStart 同时投递 idle 与 summon', async (t) => {
  const rt = await startMockRuntime()
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const result = await runHookAsync({
    payload: { hook_event_name: 'SessionStart', session_id: 'session-1', cwd: 'D:/work' },
    appDataDir,
    endpointFile,
  })

  assert.equal(result.status, 0, result.stderr)
  const entries = rt.received.filter((r) => r.url === '/command')
  const commands = entries.map((r) => r.body)
  assert.deepEqual(
    commands.filter((item) => item.command !== 'hello' && item.command !== 'session_bind'),
    [
      { command: 'agent_state', state: 'idle', narrate: 'session_start' },
      { command: 'summon' },
    ],
  )
  assert.deepEqual(
    commands.filter((item) => item.command === 'hello' || item.command === 'session_bind').map((item) => item.command),
    ['hello', 'session_bind'],
  )
  for (const entry of entries) {
    assert.equal(entry.envelope.protocolVersion, '2.0')
    assert.equal(entry.meta.hostId, 'qoder')
    assert.equal(entry.meta.sessionId, 'session-1')
  }
})

test('把 PreToolUse 投递为带工具名的 agent_state，并携带 Bearer 令牌', async (t) => {
  const rt = await startMockRuntime()
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const result = await runHookAsync({
    payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: 'D:/work' },
    appDataDir,
    endpointFile,
  })

  assert.equal(result.status, 0, result.stderr)
  const commands = rt.received.filter((r) => r.url === '/command').map((r) => r.body)
  assert.deepEqual(commands, [
    { command: 'agent_state', state: 'tool_running', toolName: 'Bash', narrate: 'running' },
  ])
  assert.equal(rt.received[0].auth, `Bearer ${TOKEN}`)
})

test('桌宠未运行时保持静默并 exit 0（绝不阻塞宿主）', () => {
  const appDataDir = makeAppDataDir()
  const started = Date.now()
  const result = runHook({ payload: { hook_event_name: 'UserPromptSubmit', prompt: 'hi' }, appDataDir })
  assert.equal(result.status, 0, 'hook 的退出码必须恒为 0')
  assert.equal(result.stdout, '')
  assert.ok(Date.now() - started < 5000, '桌宠离线时不应拖慢宿主')
})

test('调试日志只记录事件形状，不落用户内容', async (t) => {
  const rt = await startMockRuntime()
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  await runHookAsync({
    payload: {
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /important' },
      prompt: 'SECRET-PROMPT-TEXT',
    },
    appDataDir,
    endpointFile,
  })

  const logFile = path.join(appDataDir, 'uta', 'hooks', 'qoder-events.jsonl')
  const log = fs.readFileSync(logFile, 'utf8')
  const entries = log.trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].event, 'PermissionRequest')
  assert.equal(entries[0].tool, 'Bash')
  assert.ok(entries[0].keys.includes('tool_input'), '应记录字段名以便后续实现审批')
  assert.ok(!log.includes('SECRET-PROMPT-TEXT'), '绝不能记录提示词正文')
  assert.ok(!log.includes('rm -rf'), '绝不能记录工具参数')
})

test('审批决策的输出结构与摘要', async () => {
  const mod = await import(pathToFileURL(HOOK).href)
  assert.deepEqual(mod.buildPermissionDecision('allow', 'ok'), {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  })
  assert.deepEqual(mod.buildPermissionDecision('deny', '用户拒绝'), {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: '用户拒绝' },
    },
  })
  assert.equal(mod.summarizeToolInput({ command: 'curl https://github.com' }), 'curl https://github.com')
  assert.equal(mod.summarizeToolInput({ file_path: 'D:/x.txt' }), 'D:/x.txt')
  assert.equal(mod.summarizeToolInput(null), '')
})

test('审批：用户在桌宠点批准 -> 返回 allow 决策，并把上下文交给卡片', async (t) => {
  const rt = await startMockRuntime({ approvalOutcome: 'allowed-once' })
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const result = await runHookAsync({
    payload: {
      hook_event_name: 'PermissionRequest',
      permission_mode: 'default',
      session_id: 'sess-abc-123',
      tool_name: 'Bash',
      tool_input: { command: 'curl https://github.com' },
    },
    appDataDir,
    endpointFile,
  })

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout.trim())
  assert.equal(output.hookSpecificOutput.decision.behavior, 'allow')

  const ask = rt.received.find((r) => r.url === '/approval/ask')
  assert.ok(ask, '应向桌宠发起审批请求')
  assert.equal(ask.body.toolName, 'Bash')
  assert.equal(ask.body.host, 'qoder')
  assert.equal(ask.body.sessionId, 'sess-abc-123')
  assert.match(ask.body.reason, /curl https:\/\/github\.com/)
  assert.match(ask.body.requestId, /^qoder-sess-abc-123-/)
})

test('审批：用户在桌宠点拒绝 -> 返回 deny 决策', async (t) => {
  const rt = await startMockRuntime({ approvalOutcome: 'rejected' })
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const result = await runHookAsync({
    payload: {
      hook_event_name: 'PermissionRequest',
      permission_mode: 'default',
      session_id: 'sess-1',
      tool_name: 'Write',
      tool_input: { file_path: 'D:/outside.txt' },
    },
    appDataDir,
    endpointFile,
  })

  assert.equal(result.status, 0)
  const output = JSON.parse(result.stdout.trim())
  assert.equal(output.hookSpecificOutput.decision.behavior, 'deny')
  assert.ok(output.hookSpecificOutput.decision.message, 'deny 必须带 message')
})

test('审批：桌宠不可用或取消时不输出决策，交回 Qoder 自己的弹窗', async (t) => {
  const rt = await startMockRuntime({ approvalOutcome: 'unavailable' })
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const result = await runHookAsync({
    payload: {
      hook_event_name: 'PermissionRequest',
      permission_mode: 'default',
      session_id: 'sess-2',
      tool_name: 'Bash',
      tool_input: { command: 'echo hi' },
    },
    appDataDir,
    endpointFile,
  })

  assert.equal(result.status, 0)
  assert.equal(result.stdout, '', '不接管时必须保持静默')
})

test('审批：bypassPermissions 模式不再打扰桌宠', async (t) => {
  const rt = await startMockRuntime({ approvalOutcome: 'allowed-once' })
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const result = await runHookAsync({
    payload: {
      hook_event_name: 'PermissionRequest',
      permission_mode: 'bypassPermissions',
      session_id: 'sess-3',
      tool_name: 'Bash',
      tool_input: { command: 'echo hi' },
    },
    appDataDir,
    endpointFile,
  })

  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(rt.received.filter((r) => r.url === '/approval/ask').length, 0)
})

test('审批：AskUserQuestion 不弹桌宠卡，只提示回宿主选择', async (t) => {
  const rt = await startMockRuntime({ approvalOutcome: 'allowed-once' })
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const result = await runHookAsync({
    payload: {
      hook_event_name: 'PermissionRequest',
      permission_mode: 'default',
      session_id: 'sess-choice',
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: '选哪个方案？' }] },
    },
    appDataDir,
    endpointFile,
  })

  assert.equal(result.status, 0)
  assert.equal(result.stdout, '', '选择工具必须交回 Qoder 自己处理')
  assert.equal(rt.received.filter((r) => r.url === '/approval/ask').length, 0)
  const commands = rt.received.filter((r) => r.url === '/command').map((r) => r.body)
  assert.deepEqual(commands.map((item) => item.command), ['agent_state', 'choice_hint'])
  assert.match(commands[1].text, /Qoder 在等你选择方案/)
})

test('Qoder recap JSON 不会进入最终回复或工作汇报', async () => {
  const mod = await import(pathToFileURL(HOOK).href)
  const recap = JSON.stringify({ recap: '你让先修 Qoder 的 bug' })
  assert.equal(mod.isRecapPayload(recap), true)
  assert.equal(mod.isRecapPayload('普通回复'), false)
  assert.equal(mod.summarizeReply(recap), '')
  assert.deepEqual(mod.buildStopCommands({ last_assistant_message: recap }), [
    { command: 'agent_state', state: 'completed', label: '回复完成' },
  ])
})

test('Stop：短回复原样显示，长回复压成一两句摘要', async () => {
  const mod = await import(pathToFileURL(HOOK).href)

  assert.deepEqual(mod.buildStopCommands({ last_assistant_message: '你好，世界' }), [
    { command: 'rp_reply', text: '你好，世界' },
    { command: 'agent_state', state: 'completed', label: '回复完成' },
  ])
  assert.deepEqual(mod.buildStopCommands({ stop_hook_active: true, last_assistant_message: 'x' }), [])
  assert.equal(mod.buildStopCommands({})[0].command, 'agent_state')

  assert.equal(mod.summarizeReply('  第一行\n\n第二行  '), '第一行 第二行')
  const long = 'a'.repeat(900)
  const longCommands = mod.buildStopCommands({ last_assistant_message: long })
  assert.equal(longCommands[0].command, 'rp_reply')
  assert.ok(longCommands[0].text.length <= 81, '长回复摘要不应原样搬运全文')
  assert.ok(longCommands[0].text.endsWith('…'))
  assert.ok(!longCommands[0].text.includes('完整内容请回'))
  assert.deepEqual(longCommands[1], {
    command: 'agent_state',
    state: 'completed',
    label: '回复完成',
  })
})

test('Stop 去重：同一会话 10 秒内重复事件不再重复播报完成', async () => {
  const mod = await import(pathToFileURL(HOOK).href)
  const now = 1_000_000
  const payload = { hook_event_name: 'Stop', session_id: 's1', last_assistant_message: '完成了' }
  const previous = { session: 's1', at: now, hash: mod.hashReply('完成了') }

  assert.deepEqual(mod.buildStopCommands(payload, previous, now + 3000), [], '完全重复应静默')

  const different = mod.buildStopCommands(
    { hook_event_name: 'Stop', session_id: 's1', last_assistant_message: '另一条' },
    previous,
    now + 3000,
  )
  assert.deepEqual(different, [{ command: 'rp_reply', text: '另一条' }], '窗口内新内容只补气泡')

  const later = mod.buildStopCommands(payload, previous, now + 11_000)
  assert.equal(later.length, 2, '超出窗口后恢复完整播报')

  const otherSession = mod.buildStopCommands(
    { hook_event_name: 'Stop', session_id: 's2', last_assistant_message: '完成了' },
    previous,
    now + 3000,
  )
  assert.equal(otherSession.length, 2, '不同会话不应互相去重')
})

test('Stop：真实投递 rp_reply 与 completed 两条指令', async (t) => {
  const rt = await startMockRuntime()
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const result = await runHookAsync({
    payload: {
      hook_event_name: 'Stop',
      session_id: 'sess-stop',
      last_assistant_message: '任务完成了，博士。',
    },
    appDataDir,
    endpointFile,
  })

  assert.equal(result.status, 0, result.stderr)
  const commands = rt.received.filter((r) => r.url === '/command').map((r) => r.body)
  assert.deepEqual(commands, [
    { command: 'rp_reply', text: '任务完成了，博士。' },
    { command: 'agent_state', state: 'completed', label: '回复完成' },
  ])
})

test('模型主动发言后，Stop 只补完成状态、不再重复最终摘要', async () => {
  const mod = await import(pathToFileURL(HOOK).href)
  const commands = mod.buildStopCommands(
    { hook_event_name: 'Stop', session_id: 's1', last_assistant_message: '完整回复' },
    null,
    Date.now(),
    true,
  )
  assert.deepEqual(commands, [{ command: 'agent_state', state: 'completed', label: '回复完成' }])
})

test('桌宠 MCP 发言工具会抑制本轮 Stop 兜底摘要', async (t) => {
  const rt = await startMockRuntime()
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const pre = await runHookAsync({
    payload: {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-speech',
      tool_name: 'mcp__uta-deskpet__deskpet_notify',
      tool_input: { text: '已经找到问题所在。' },
      tool_response: { ok: true },
    },
    appDataDir,
    endpointFile,
  })
  assert.equal(pre.status, 0, pre.stderr)

  const stop = await runHookAsync({
    payload: {
      hook_event_name: 'Stop',
      session_id: 'sess-speech',
      last_assistant_message: '这是一段更长的最终回复，不应该再进入桌宠。',
    },
    appDataDir,
    endpointFile,
  })
  assert.equal(stop.status, 0, stop.stderr)

  const commands = rt.received.filter((entry) => entry.url === '/command').map((entry) => entry.body)
  assert.equal(commands.some((item) => item.command === 'rp_reply'), false)
  assert.equal(commands.at(-1).command, 'agent_state')
  assert.equal(commands.at(-1).state, 'completed')
})

test('拒绝桌宠发言工具后，Stop 仍保留最终摘要', async (t) => {
  const rt = await startMockRuntime()
  t.after(() => rt.close())
  const appDataDir = makeAppDataDir()
  const endpointFile = writeEndpointFile(appDataDir, rt.port)

  const failed = await runHookAsync({
    payload: {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-rejected',
      tool_name: 'mcp__uta-deskpet__deskpet_notify',
      tool_input: { text: '不应算已发言' },
      tool_response: { status: 'failed', error: 'rejected by user' },
    },
    appDataDir,
    endpointFile,
  })
  assert.equal(failed.status, 0, failed.stderr)

  const stop = await runHookAsync({
    payload: {
      hook_event_name: 'Stop',
      session_id: 'sess-rejected',
      last_assistant_message: '用户拒绝后仍应显示的最终回复。',
    },
    appDataDir,
    endpointFile,
  })
  assert.equal(stop.status, 0, stop.stderr)
  const commands = rt.received.filter((entry) => entry.url === '/command').map((entry) => entry.body)
  assert.ok(commands.some((item) => item.command === 'rp_reply'))
})

test('最终摘要压缩为短文本，去掉表格/代码/表情标签', async () => {
  const { summarizeCommentary } = await import(pathToFileURL(HOOK).href)
  const text = `[uta:等待] 我先看一下。\n\n| 项 | 值 |\n|---|---|\n| a | b |\n\n\`\`\`js\nconst secret = 1\n\`\`\`\n\n${'这段补充不应整段进入气泡。'.repeat(30)}`
  const summary = summarizeCommentary(text)
  assert.ok(summary.startsWith('我先看一下。'), summary)
  assert.ok(!summary.includes('|'), '表格不应进入气泡')
  assert.ok(!summary.includes('```'), '代码块不应进入气泡')
  assert.ok(summary.length <= 121, `摘要应限制长度，实际 ${summary.length}`)
})
