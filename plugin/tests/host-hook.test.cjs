const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { execFileSync, spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const hookPath = path.resolve(__dirname, '..', 'shared', 'uta-host-hook.mjs')
const hookUrl = pathToFileURL(hookPath).href

async function loadHook() {
  return import(hookUrl)
}

function tempAppData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'uta-host-hook-'))
}

test('mapEventToCommands maps lifecycle events to deskpet commands', async () => {
  const { mapEventToCommands, resolveHost } = await loadHook()
  const host = resolveHost(['--host=claude-code'])

  assert.deepEqual(mapEventToCommands('SessionStart', {}, host), [
    { command: 'agent_state', state: 'idle', narrate: 'session_start' },
    { command: 'summon' },
  ])
  assert.deepEqual(
    mapEventToCommands('SessionStart', { source: 'compact' }, host),
    [],
    'auto compact must not reset the working state',
  )
  assert.deepEqual(mapEventToCommands('UserPromptSubmit', {}, host), [
    { command: 'agent_state', state: 'thinking', label: '思考中...', narrate: 'thinking' },
  ])
  assert.deepEqual(
    mapEventToCommands('PreToolUse', { tool_name: 'mcp__server__tool' }, host),
    [
      {
        command: 'agent_state',
        state: 'tool_running',
        toolName: 'mcp__server__tool',
        narrate: 'running',
      },
    ],
  )
  assert.deepEqual(mapEventToCommands('SessionEnd', {}, host), [
    { command: 'agent_state', state: 'idle' },
  ])
  assert.deepEqual(mapEventToCommands('Interrupt', {}, host), [
    { command: 'agent_state', state: 'idle', narrate: 'retry' },
  ])
  assert.deepEqual(mapEventToCommands('Stop', {}, host), [])
  assert.deepEqual(mapEventToCommands('StopFailure', { error: 'rate_limit', error_details: 'private' }, host), [
    { command: 'agent_state', state: 'error', label: '宿主回复失败' },
  ])
  assert.deepEqual(mapEventToCommands('StopFailure', {}, resolveHost(['--host=zcode'])), [])
})

test('tool names are normalized for the runtime whitelist', async () => {
  const { sanitizeToolName } = await loadHook()
  assert.equal(sanitizeToolName('Bash'), 'Bash')
  assert.equal(sanitizeToolName('tool.with spaces/and:colons'), 'tool_with_spaces_and_colons')
  assert.equal(sanitizeToolName('x'.repeat(80)).length, 32)
  assert.equal(sanitizeToolName(''), '')
})

test('Stop dedupe suppresses duplicate completion and keeps different text', async () => {
  const { buildStopCommands, hashReply, resolveHost } = await loadHook()
  const host = resolveHost(['--host=zcode'])
  const now = Date.now()

  const first = buildStopCommands({ session_id: 's1', last_assistant_message: 'hello' }, null, now, host)
  assert.equal(first.length, 2)
  assert.equal(first[0].command, 'rp_reply')
  assert.equal(first[1].state, 'completed')

  const dup = buildStopCommands(
    { session_id: 's1', last_assistant_message: 'hello' },
    { session: 's1', at: now - 1000, hash: hashReply('hello') },
    now,
    host,
  )
  assert.deepEqual(dup, [])

  const changed = buildStopCommands(
    { session_id: 's1', last_assistant_message: 'different' },
    { session: 's1', at: now - 1000, hash: hashReply('hello') },
    now,
    host,
  )
  assert.equal(changed.length, 1)
  assert.equal(changed[0].command, 'rp_reply')

  const spoke = buildStopCommands(
    { session_id: 's1', last_assistant_message: 'hello' },
    null,
    now,
    host,
    true,
  )
  assert.deepEqual(spoke, [{ command: 'agent_state', state: 'completed', label: '回复完成' }])
})

test('stop_hook_active and long replies are handled safely', async () => {
  const { buildStopCommands, summarizeReply, resolveHost } = await loadHook()
  const host = resolveHost(['--host=codex'])
  assert.deepEqual(buildStopCommands({ stop_hook_active: true }, null, Date.now(), host), [])
  assert.equal(summarizeReply('', host.label), '')
  const summary = summarizeReply('x'.repeat(100), host.label)
  assert.ok(summary.length <= 81, 'long replies should be summarized, not copied')
  assert.ok(summary.endsWith('…'))
  assert.ok(!summary.includes('完整内容请回'))
})

test('permission output matches Claude/Codex schema and fails open', async () => {
  const { buildPermissionOutput, handlePermissionRequest, resolveHost } = await loadHook()
  const host = resolveHost(['--host=codex'])
  assert.deepEqual(buildPermissionOutput('allow'), {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  })
  assert.equal(buildPermissionOutput('deny').hookSpecificOutput.decision.behavior, 'deny')
  assert.equal(buildPermissionOutput('cancelled'), null)

  const allow = await handlePermissionRequest(
    { tool_name: 'Bash', tool_input: { command: 'echo hi' }, session_id: 's1' },
    { host, askApproval: async () => ({ outcome: 'allowed-once' }) },
  )
  assert.equal(allow.hookSpecificOutput.decision.behavior, 'allow')

  const reject = await handlePermissionRequest(
    { tool_name: 'Bash', tool_input: { command: 'echo hi' }, session_id: 's1' },
    { host, askApproval: async () => ({ outcome: 'rejected' }) },
  )
  assert.equal(reject.hookSpecificOutput.decision.behavior, 'deny')

  const offline = await handlePermissionRequest(
    { tool_name: 'Bash', tool_input: { command: 'echo hi' }, session_id: 's1' },
    {
      host,
      askApproval: async () => {
        throw new Error('offline')
      },
    },
  )
  assert.equal(offline, null)

  const bypass = await handlePermissionRequest(
    { tool_name: 'Bash', permission_mode: 'bypassPermissions' },
    { host, askApproval: async () => ({ outcome: 'allowed-once' }) },
  )
  assert.equal(bypass, null)
})

test('user-choice tools delegate to the host without an approval card', async () => {
  const { handlePermissionRequest, resolveHost } = await loadHook()
  const host = resolveHost(['--host=claude-code'])
  const sent = []
  let asked = false
  const result = await handlePermissionRequest(
    {
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: '选哪个方案？' }] },
      session_id: 'choice-session',
    },
    {
      host,
      sendCommand: async (command) => {
        sent.push(command)
        return true
      },
      askApproval: async () => {
        asked = true
        return { outcome: 'allowed-once' }
      },
    },
  )
  assert.equal(result, null)
  assert.equal(asked, false, '选择工具不应弹出桌宠审批卡')
  assert.deepEqual(sent.map((item) => item.command), ['agent_state', 'choice_hint'])
  assert.match(sent[1].text, /Claude Code 在等你选择方案/)
})

test('debug log records only metadata, never prompt or tool input', async () => {
  const { logPayloadShape, resolveHost } = await loadHook()
  const appData = tempAppData()
  const host = resolveHost(['--host=claude-code'])
  const payload = {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'TOP-SECRET-COMMAND' },
    prompt: 'TOP-SECRET-PROMPT',
    session_id: 'session-123456789',
  }
  logPayloadShape('PreToolUse', payload, host, { APPDATA: appData })
  const file = path.join(appData, 'uta', 'hooks', host.logFile)
  const text = fs.readFileSync(file, 'utf-8')
  assert.match(text, /PreToolUse/)
  assert.match(text, /Bash/)
  assert.ok(!text.includes('TOP-SECRET-COMMAND'))
  assert.ok(!text.includes('TOP-SECRET-PROMPT'))
})

test('hook exits 0 and emits JSON when the runtime is offline', () => {
  const appData = tempAppData()
  const env = {
    ...process.env,
    APPDATA: appData,
    DESKPET_ENDPOINT_FILE: path.join(appData, 'missing-endpoint.json'),
    UTA_ENDPOINT_FILE: path.join(appData, 'missing-endpoint.json'),
  }
  const output = execFileSync(process.execPath, [hookPath, '--host=codex'], {
    input: JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'offline-session',
      prompt: 'secret',
    }),
    env,
    encoding: 'utf-8',
    timeout: 15000,
  })
  assert.equal(output.trim(), '{}')
})

test('PermissionRequest is delivered to the runtime and mapped to an allow decision', async (t) => {
  const received = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null
      received.push({ url: req.url, body })
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/approval/ask') {
        res.end(JSON.stringify({ ok: true, requestId: body?.requestId, outcome: 'allowed-once' }))
      } else {
        res.end(JSON.stringify({ ok: true }))
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))

  const appData = tempAppData()
  const endpointFile = path.join(appData, 'endpoint.json')
  fs.writeFileSync(
    endpointFile,
    JSON.stringify({ port: server.address().port, token: 'test-token' }),
  )

  const env = {
    ...process.env,
    APPDATA: appData,
    DESKPET_ENDPOINT_FILE: endpointFile,
  }
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [hookPath, '--host=codex'], { env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
    child.stdin.end(
      JSON.stringify({
        hook_event_name: 'PermissionRequest',
        permission_mode: 'default',
        session_id: 'sess-abc-123',
        tool_name: 'Bash',
        tool_input: { command: 'curl https://github.com' },
      }),
    )
  })

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout.trim())
  assert.equal(output.hookSpecificOutput.decision.behavior, 'allow')

  const ask = received.find((entry) => entry.url === '/approval/ask')
  assert.ok(ask, 'should ask the desktop pet for approval')
  assert.equal(ask.body.host, 'codex')
  assert.equal(ask.body.sessionId, 'sess-abc-123')
  assert.match(ask.body.requestId, /^codex-sess-abc-123-/)
  assert.match(ask.body.reason, /curl https:\/\/github\.com/)
})

async function startCodexRuntime(t, v2 = true, hostId = 'codex') {
  const received = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      received.push({ url: req.url, body: raw ? JSON.parse(raw) : null })
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(req.url === '/health' && v2
        ? { ok: true, protocolVersions: ['1.0', '2.0'] }
        : { ok: true, ...(req.url === '/approval/ask' ? { outcome: 'allowed-once' } : {}) }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const appData = tempAppData()
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }))
  const endpointFile = path.join(appData, 'endpoint.json')
  fs.writeFileSync(endpointFile, JSON.stringify({ port: server.address().port, token: 'codex-sdk-test' }))
  const env = { ...process.env, APPDATA: appData, DESKPET_ENDPOINT_FILE: endpointFile }
  return {
    received,
    run(payload) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [hookPath, `--host=${hostId}`], { env, windowsHide: true })
        let stdout = '', stderr = ''
        const timer = setTimeout(() => { child.kill(); reject(new Error('hook timed out')) }, 12000)
        child.stdout.on('data', chunk => { stdout += chunk })
        child.stderr.on('data', chunk => { stderr += chunk })
        child.on('error', reject)
        child.on('close', status => {
          clearTimeout(timer)
          if (status !== 0) reject(new Error(stderr || `hook exit ${status}`))
          else resolve(JSON.parse(stdout.trim()))
        })
        child.stdin.end(JSON.stringify(payload))
      })
    },
  }
}

test('Claude StopFailure emits a sanitized error state and does not mark the turn completed', async t => {
  const runtime = await startCodexRuntime(t, true, 'claude-code')
  const output = await runtime.run({ hook_event_name: 'StopFailure', session_id: 'failure-session', error: 'rate_limit', error_details: 'secret error detail' })
  assert.deepEqual(output, {})
  const command = runtime.received.find(item => item.url === '/command')?.body
  assert.deepEqual(command, { command: 'agent_state', state: 'error', label: '宿主回复失败' })
  assert.ok(!JSON.stringify(runtime.received).includes('secret error detail'))
})

test('Codex SDK binds real sessions, propagates turn identity, and keeps Stop replies scoped', async t => {
  const rt = await startCodexRuntime(t)
  assert.deepEqual(await rt.run({ hook_event_name: 'SessionStart', session_id: 'codex-s1', cwd: 'D:/project' }), {})
  let bodies = rt.received.filter(entry => entry.url === '/command').map(entry => entry.body)
  assert.deepEqual(bodies.map(body => body.command.command), ['hello', 'session_bind', 'agent_state', 'summon'])
  assert.equal(bodies.find(body => body.command.command === 'session_bind').command.userInitiated, undefined)
  assert.equal(bodies[1].command.cwd, 'D:/project')
  assert.equal(bodies[0].command.sdkVersion, require('../plugins/codex/.codex-plugin/plugin.json').version)
  assert.ok(!bodies[0].command.capabilities.includes('streamingReply'))
  assert.ok(bodies.every(body => body.protocolVersion === '2.0' && body.meta.hostId === 'codex' && body.meta.sessionId === 'codex-s1'))
  rt.received.length = 0
  await rt.run({ hook_event_name: 'UserPromptSubmit', session_id: 'codex-s2', turn_id: 'real-turn', cwd: 'D:/project' })
  bodies = rt.received.filter(entry => entry.url === '/command').map(entry => entry.body)
  assert.deepEqual(bodies.map(body => body.command.command), ['hello', 'session_bind', 'agent_state'])
  assert.equal(bodies.find(body => body.command.command === 'session_bind').command.userInitiated, true)
  assert.ok(bodies.every(body => body.meta.sessionId === 'codex-s2' && body.meta.turnId === 'real-turn'))
  rt.received.length = 0
  await rt.run({ hook_event_name: 'Stop', session_id: 'codex-s2', turn_id: 'real-turn', last_assistant_message: '检查完成。' })
  bodies = rt.received.filter(entry => entry.url === '/command').map(entry => entry.body)
  assert.deepEqual(bodies.map(body => body.command.command), ['rp_reply', 'agent_state'])
  assert.ok(bodies.every(body => body.meta.sessionId === 'codex-s2' && body.meta.turnId === 'real-turn' && body.meta.seq === undefined))
})

test('Codex v2 permission state and approval share the true session', async t => {
  const rt = await startCodexRuntime(t)
  const result = await rt.run({ hook_event_name: 'PermissionRequest', session_id: 'permission-s', turn_id: 'turn-p', tool_name: 'Bash', tool_input: { command: 'echo test' } })
  assert.equal(result.hookSpecificOutput.decision.behavior, 'allow')
  const state = rt.received.find(entry => entry.url === '/command').body
  assert.equal(state.meta.sessionId, 'permission-s')
  assert.equal(state.meta.turnId, 'turn-p')
  assert.equal(rt.received.find(entry => entry.url === '/approval/ask').body.sessionId, 'permission-s')
})

test('Codex SDK skips hello and binding for v1 runtimes and preserves legacy delivery', async t => {
  const rt = await startCodexRuntime(t, false)
  await rt.run({ hook_event_name: 'SessionStart', session_id: 'legacy-s' })
  const bodies = rt.received.filter(entry => entry.url === '/command').map(entry => entry.body)
  assert.deepEqual(bodies, [
    { command: 'agent_state', state: 'idle', narrate: 'session_start' },
    { command: 'summon' },
  ])
})

test('桌宠说话工具识别：MCP notify 与带文本的 uta_express 才算发言', async () => {
  const speechUrl = pathToFileURL(
    path.resolve(__dirname, '..', 'shared', 'uta-pet-speech.mjs'),
  ).href
  const { isPetSpeechCall, isSuccessfulToolResult, shouldMarkPetSpoke } = await import(speechUrl)

  assert.equal(isPetSpeechCall('mcp__uta-deskpet__deskpet_notify', { text: '进度' }), true)
  assert.equal(isPetSpeechCall('deskpet_notify', { text: '进度' }), true)
  assert.equal(isPetSpeechCall('uta_express', { text: '进度' }), true)
  assert.equal(isPetSpeechCall('uta_express', { moment: 'found' }), false)
  assert.equal(isPetSpeechCall('uta_express', { moment: 'urgent' }), false)
  assert.equal(isPetSpeechCall('uta_express', { moment: 'listen', text: '你好' }), true)
  assert.equal(isPetSpeechCall('uta_express', { emotion: 'happy' }), false)
  assert.equal(isPetSpeechCall('deskpet_set_emotion', { emotion: 'happy' }), false)
  assert.equal(
    isPetSpeechCall('call_mcp_tool', {
      ServerName: 'uta-deskpet_uta-deskpet',
      ToolName: 'deskpet_notify',
    }),
    true,
  )
  assert.equal(
    isPetSpeechCall('mcp_call', {
      tool_name: 'deskpet_notify',
      arguments: { text: '进度' },
    }),
    true,
  )
  assert.equal(isPetSpeechCall('mcp_call', { name: 'deskpet_set_preset' }), false)
  assert.equal(
    isPetSpeechCall('mcp_call', { server: 'other', tool_name: 'deskpet_notify' }),
    false,
  )

  assert.equal(shouldMarkPetSpoke('PreToolUse', { tool_name: 'deskpet_notify' }), false)
  assert.equal(shouldMarkPetSpoke('PostToolUseFailure', { error: 'denied' }), false)
  assert.equal(shouldMarkPetSpoke('PostToolUse', { tool_response: { status: 'failed' } }), false)
  assert.equal(shouldMarkPetSpoke('PostToolUse', { tool_response: { is_error: true } }), false)
  assert.equal(shouldMarkPetSpoke('PostToolUse', { tool_response: { ok: true } }), true)
  assert.equal(isSuccessfulToolResult({ result: { success: false } }), false)
})

test('发言标记按会话生效，读取后立即清除', async () => {
  const speechUrl = pathToFileURL(
    path.resolve(__dirname, '..', 'shared', 'uta-pet-speech.mjs'),
  ).href
  const { markPetSpoke, consumePetSpoke, clearPetSpeech } = await import(speechUrl)
  const env = { APPDATA: tempAppData() }

  markPetSpoke('codex', 'session-a', 'deskpet_notify', env)
  assert.equal(consumePetSpoke('codex', 'session-b', env), false, '其他会话不能消费')
  markPetSpoke('codex', 'session-b', 'deskpet_notify', env)
  assert.equal(consumePetSpoke('codex', 'session-a', env), true)
  assert.equal(consumePetSpoke('codex', 'session-a', env), false, '消费后应清除')
  clearPetSpeech('codex', 'session-a', env)
  assert.equal(consumePetSpoke('codex', 'session-b', env), true)
})

test('共享最终摘要压缩到一两句、120 字以内，并去掉表格/代码', async () => {
  const commentaryUrl = pathToFileURL(
    path.resolve(__dirname, '..', 'shared', 'uta-commentary.mjs'),
  ).href
  const { summarizeCommentary } = await import(commentaryUrl)
  const text = `[uta:等待] 我先看一下。\n\n| 项 | 值 |\n|---|---|\n| a | b |\n\n\`\`\`js\nconst secret = 1\n\`\`\`\n\n${'这段补充不应整段进入气泡。'.repeat(30)}`
  const summary = summarizeCommentary(text)
  assert.ok(summary.startsWith('我先看一下。'), summary)
  assert.ok(!summary.includes('|'))
  assert.ok(!summary.includes('```'))
  assert.ok(summary.length <= 121, `实际 ${summary.length}`)
})

test('OpenCode 工作中汇报压缩到一两句、120 字以内，并去掉表格/代码', async () => {
  const opencodeUrl = pathToFileURL(
    path.resolve(__dirname, '..', 'plugins', 'opencode', 'uta-opencode.mjs'),
  ).href
  const { summarizeCommentary } = await import(opencodeUrl)
  const text = `[uta:等待] 我先看一下。\n\n| 项 | 值 |\n|---|---|\n| a | b |\n\n\`\`\`js\nconst secret = 1\n\`\`\`\n\n${'补充说明。'.repeat(40)}`
  const summary = summarizeCommentary(text)
  assert.ok(summary.startsWith('我先看一下。'), summary)
  assert.ok(!summary.includes('|'))
  assert.ok(!summary.includes('```'))
  assert.ok(summary.length <= 121, `实际 ${summary.length}`)
})

test('OpenCode 推理意图分类只输出视觉意图', async () => {
  const opencodeUrl = pathToFileURL(
    path.resolve(__dirname, '..', 'plugins', 'opencode', 'uta-opencode.mjs'),
  ).href
  const { inferReasoningIntent, isPetSpeechCall } = await import(opencodeUrl)
  assert.equal(
    isPetSpeechCall('mcp_call', { tool_name: 'deskpet_notify', arguments: { text: '进度' } }),
    true,
  )
  assert.equal(isPetSpeechCall('deskpet_set_emotion', { emotion: 'happy' }), false)
  assert.equal(inferReasoningIntent('我先搜索一下日志'), 'looking')
  assert.equal(inferReasoningIntent('准备修改这个文件'), 'editing')
  assert.equal(inferReasoningIntent('跑一下 pytest 测试'), 'testing')
  assert.equal(inferReasoningIntent('等待用户审批'), 'waiting')
  assert.equal(inferReasoningIntent('定位到原因了'), 'found')
  assert.equal(inferReasoningIntent('出现异常，需要重试'), 'error')
  assert.equal(inferReasoningIntent('再想一下'), 'thinking')
})
