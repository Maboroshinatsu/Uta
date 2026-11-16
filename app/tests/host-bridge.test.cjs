'use strict'
// 宿主直连桥：只测纯函数与不启动进程的分支。真正 spawn DSH 的路径由实机验证。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const SRC = path.join(__dirname, '../src/main/host-bridge.ts')
const code = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

const adapterModule = { exports: {} }
// 可变的路径桩：个别用例需要把 harnessExe/harnessCli 指向假的宿主 CLI
const stubPaths = {
  harnessExe: '', harnessCli: '', opencodeExe: '', zcodeCli: '',
  nodeExe: '', claudeExe: '', claudeJs: '', codexExe: '',
}
vm.runInNewContext(
  code,
  {
    module: adapterModule,
    exports: adapterModule.exports,
    require: (name) => name === './host-paths'
      ? { resolveHostPaths: () => stubPaths }
      : name === './host-output' ? require('./support/settings-loader.cjs')()('main/host-output')
      : require(name),
    process,
    Buffer,
    console,
    setTimeout,
    clearTimeout,
  },
  { filename: SRC },
)
const {
  sessionFilePath,
  readHostSession,
  buildHarnessArgs,
  buildClaudeArgs,
  buildZcodeArgs,
  buildOpenCodeArgs,
  buildCodexArgs,
  summarizeHostOutput,
  sendHostMessage,
  getHostInputStatus,
} = adapterModule.exports

test('an explicit runtime reads only its own session records', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-session-isolation-'))
  try {
    const stable = sessionFilePath(dir, 'codex')
    fs.mkdirSync(path.dirname(stable), { recursive: true })
    fs.writeFileSync(stable, JSON.stringify({ host: 'codex', sessionId: 'stable-session', updatedAt: Date.now() }))
    const runtime = path.join(dir, 'task-profile')
    assert.equal(readHostSession(dir, 'codex', runtime), null)
    const task = sessionFilePath(dir, 'codex', runtime)
    fs.mkdirSync(path.dirname(task), { recursive: true })
    fs.writeFileSync(task, JSON.stringify({ host: 'codex', sessionId: 'task-session', updatedAt: Date.now() }))
    assert.equal(readHostSession(dir, 'codex', runtime).sessionId, 'task-session')
    assert.equal(readHostSession(dir, 'codex').sessionId, 'stable-session')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('host bridge reads the per-host session record and rejects malformed files', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-host-bridge-'))
  try {
    const file = sessionFilePath(appData, 'deepseek-harness')
    assert.ok(file && file.endsWith('harness-session.json'))
    fs.mkdirSync(path.dirname(file), { recursive: true })

    assert.equal(readHostSession(appData, 'deepseek-harness'), null)
    fs.writeFileSync(file, JSON.stringify({ host: 'other', sessionId: 'x', updatedAt: Date.now() }))
    assert.equal(readHostSession(appData, 'deepseek-harness'), null)

    fs.writeFileSync(
      file,
      JSON.stringify({ host: 'deepseek-harness', sessionId: ' sess_123 ', cwd: 'D:/tmp', updatedAt: 123 }),
    )
    const record = readHostSession(appData, 'deepseek-harness')
    assert.equal(record.sessionId, 'sess_123')
    assert.equal(record.cwd, 'D:/tmp')
  } finally {
    fs.rmSync(appData, { recursive: true, force: true })
  }
})

test('harness invocation passes the session id and reads the prompt from stdin', () => {
  const args = buildHarnessArgs('sess_abc')
  assert.ok(args.includes('--profile'))
  assert.ok(args.includes('headless'))
  assert.ok(args.includes('--session-id'))
  assert.equal(args[args.indexOf('--session-id') + 1], 'sess_abc')
  assert.equal(args.at(-1), '-')
  assert.equal(args.some((arg) => arg.includes('hello')), false)
})

test('host command builders use official resume/queue arguments', () => {
  assert.deepEqual(Array.from(buildClaudeArgs('uuid-1', '你好')), ['-p', '--resume', 'uuid-1', '--output-format', 'json', '--', '你好'])

  const zcode = buildZcodeArgs('sess_1', '你好', 'D:/work')
  assert.ok(zcode.includes('--prompt'))
  assert.ok(zcode.includes('--resume'))
  assert.equal(zcode[zcode.indexOf('--resume') + 1], 'sess_1')
  assert.ok(zcode.includes('--cwd'))

  const opencode = buildOpenCodeArgs('ses_1', '你好', 'D:/work')
  assert.ok(opencode.includes('run'))
  assert.equal(opencode[opencode.indexOf('--session') + 1], 'ses_1')
  assert.ok(opencode.includes('--dir'))
  assert.equal(opencode.at(-1), '你好')

  const codex = buildCodexArgs('uuid-2', '你好')
  assert.deepEqual(Array.from(codex), ['queue', '--thread', 'uuid-2', '--message', '你好'])

  assert.ok(sessionFilePath('/tmp/app', 'claude-code').endsWith('claude-code-session.json'))
  assert.ok(sessionFilePath('/tmp/app', 'zcode').endsWith('zcode-session.json'))
  assert.ok(sessionFilePath('/tmp/app', 'opencode').endsWith('opencode-session.json'))
  assert.ok(sessionFilePath('/tmp/app', 'codex').endsWith('codex-session.json'))
})

test('getHostInputStatus returns helpful hint when hostId is none or empty', () => {
  const statusNone = getHostInputStatus('/tmp', 'none')
  assert.equal(statusNone.supported, false)
  assert.equal(statusNone.configured, false)
  assert.equal(statusNone.ready, false)
  assert.equal(statusNone.detail, '当前未绑定宿主，请在快捷设置中选择宿主。')

  const statusEmpty = getHostInputStatus('/tmp', '')
  assert.equal(statusEmpty.supported, false)
  assert.equal(statusEmpty.detail, '当前未绑定宿主，请在快捷设置中选择宿主。')
})

test('host output is stripped of ANSI and clipped', () => {
  assert.equal(summarizeHostOutput('\u001b[32m你好\u001b[0m\n世界'), '你好\n世界')
  assert.equal(summarizeHostOutput('a'.repeat(2000)).length, 1200)
})

test('unsupported hosts and missing sessions fail without spawning a process', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-host-bridge-'))
  try {
    const unsupported = await sendHostMessage(appData, 'antigravity', 'hi')
    assert.equal(unsupported.ok, false)
    assert.equal(unsupported.code, 'unsupported')
    for (const host of ['deepseek-harness', 'claude-code', 'zcode', 'opencode', 'codex', 'qoder']) {
      const missing = await sendHostMessage(appData, host, 'hi')
      assert.equal(missing.ok, false)
      assert.equal(missing.code, 'no-session')
    }

    const file = sessionFilePath(appData, 'deepseek-harness')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({ host: 'deepseek-harness', sessionId: 'sess_old', cwd: '', updatedAt: 1 }),
    )
    const expired = await sendHostMessage(appData, 'deepseek-harness', 'hi')
    assert.equal(expired.code, 'no-session')
  } finally {
    fs.rmSync(appData, { recursive: true, force: true })
  }
})

test('a missing explicitly selected session never falls back to the latest session', async (t) => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-pinned-session-'))
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }))
  const file = sessionFilePath(appData, 'codex')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ host: 'codex', sessionId: 'other-session', updatedAt: Date.now() - 5000 }))
  const result = await sendHostMessage(appData, 'codex', 'private request', undefined, null)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'no-session')
  assert.match(result.error, /聊天.*草稿已保留/)
})

test('long input is rejected before any session or host process is used', async () => {
  const result = await sendHostMessage('nonexistent-profile', 'codex', 'a'.repeat(1001))
  assert.equal(result.ok, false)
  assert.match(result.error, /超过 1000 字符/)
  const atLimit = await sendHostMessage('nonexistent-profile', 'codex', 'a'.repeat(1000))
  assert.equal(atLimit.code, 'no-session')
})

test('DSH native bridge is preferred over spawning headless', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-host-bridge-native-'))
  const received = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      received.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, accepted: true, sessionId: 'sess_native' }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const sessionFile = sessionFilePath(appData, 'deepseek-harness')
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true })
    fs.writeFileSync(
      sessionFile,
      JSON.stringify({
        host: 'deepseek-harness',
        sessionId: 'sess_native',
        cwd: '',
        updatedAt: Date.now() - 5000,
      }),
    )
    const token = 'native-bridge-test-token-0123456789'
    fs.writeFileSync(
      path.join(appData, 'uta', 'hooks', 'deepseek-harness-native-bridge.json'),
      JSON.stringify({
        version: 1,
        port: server.address().port,
        token,
        pid: process.pid,
        startedAt: Date.now(),
      }),
    )

    const result = await sendHostMessage(appData, 'deepseek-harness', '从桌宠发消息')
    assert.equal(result.ok, true)
    assert.equal(result.accepted, true)
    assert.equal(received.length, 1)
    assert.equal(received[0].auth, `Bearer ${token}`)
    assert.equal(received[0].body.text, '从桌宠发消息')
    assert.equal(received[0].body.sessionId, 'sess_native')
    // messageId 用于回执关联，便于宿主侧识别同一次投递
    assert.match(received[0].body.messageId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(appData, { recursive: true, force: true })
  }
})

// DSH 0.2.x 的 headless adopt 要求 `session.header.cwd === process.cwd()`，
// 所以桌宠直发时子进程的 cwd 必须是会话登记的工作区，不能继承 Uta 自己的启动目录。
test('[DSH-ADAPT: 直发使用会话工作区作为子进程 cwd]', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-harness-cwd-'))
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-workspace-'))
  const cli = path.join(appData, 'fake-harness-cli.cjs')
  fs.writeFileSync(cli, 'process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }))\n')

  try {
    stubPaths.harnessExe = process.execPath
    stubPaths.harnessCli = cli

    // 两条节流门：同宿主 2.5s 内不能连发；会话记录本身也要「至少 2.5s 前」才算宿主空闲
    await new Promise((resolve) => setTimeout(resolve, 2600))

    const result = await sendHostMessage(appData, 'deepseek-harness', '从桌宠发消息', undefined, {
      host: 'deepseek-harness',
      sessionId: 'sess_cwd',
      cwd: workspace,
      updatedAt: Date.now() - 3000,
    })

    assert.equal(result.ok, true, `直发应成功：${result.error ?? ''}`)
    const observed = JSON.parse(result.text)
    assert.equal(observed.cwd, workspace, '子进程 cwd 必须是会话工作区')
    assert.ok(observed.argv.includes('--session-id'))
    assert.equal(observed.argv[observed.argv.indexOf('--session-id') + 1], 'sess_cwd')
    assert.equal(observed.argv.at(-1), '-', '任务从 stdin 读取')
  } finally {
    stubPaths.harnessExe = ''
    stubPaths.harnessCli = ''
    fs.rmSync(appData, { recursive: true, force: true })
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 审查报告两个投递问题的回归（2026-10-31）：
// [P1: DSH 指定会话失效时消息误投其他会话且报告原目标发送成功]
// [P2: DSH 原生桥回执中断后自动回退命令行可能重复投递]
// ---------------------------------------------------------------------------

const NATIVE_TOKEN = 'native-bridge-test-token-0123456789'
const SEND_WINDOW_MS = 2600

async function waitSendWindow() {
  await new Promise((resolve) => setTimeout(resolve, SEND_WINDOW_MS))
}

function writeNativeBridgeFile(appData, port) {
  const file = path.join(appData, 'uta', 'hooks', 'deepseek-harness-native-bridge.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, port, token: NATIVE_TOKEN, pid: process.pid, startedAt: Date.now() }),
  )
}

/** 假 CLI：被调用就记一笔，用来证明「有没有发生第二入口投递」 */
function makeCliProbe(appData) {
  const marker = path.join(appData, 'cli-invocations.txt')
  const cli = path.join(appData, 'fake-harness-cli.cjs')
  fs.writeFileSync(
    cli,
    `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'call\\n'); process.stdout.write('cli accepted')\n`,
  )
  const count = () => (fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean).length : 0)
  return { cli, count }
}

async function withServer(handler, body) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    return await body(server.address().port)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('[P1: DSH 回执会话与目标不一致时不得报成功]', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-p1-mismatch-'))
  const probe = makeCliProbe(appData)
  try {
    stubPaths.harnessExe = process.execPath
    stubPaths.harnessCli = probe.cli
    await withServer(
      (req, res) => {
        req.resume()
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          // 插件改投了别的会话，却仍然回 200 成功
          res.end(JSON.stringify({ ok: true, accepted: true, sessionId: 'sess_other' }))
        })
      },
      async (port) => {
        writeNativeBridgeFile(appData, port)
        await waitSendWindow()
        const result = await sendHostMessage(appData, 'deepseek-harness', '目标是 A 的消息', undefined, {
          host: 'deepseek-harness',
          sessionId: 'sess_target',
          cwd: '',
          updatedAt: Date.now() - 3000,
        })
        assert.equal(result.ok, false, '实际接收会话与目标不一致时不能报成功')
        assert.equal(result.code, 'no-session')
        assert.match(result.error, /不一致/)
        assert.equal(probe.count(), 0, '回执不一致也不得再用命令行补发一次')
      },
    )
  } finally {
    stubPaths.harnessExe = ''
    stubPaths.harnessCli = ''
    fs.rmSync(appData, { recursive: true, force: true })
  }
})

test('[P1: DSH 目标会话不存在时不改投且直接失败]', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-p1-missing-'))
  const probe = makeCliProbe(appData)
  try {
    stubPaths.harnessExe = process.execPath
    stubPaths.harnessCli = probe.cli
    await withServer(
      (req, res) => {
        req.resume()
        req.on('end', () => {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'session-not-found', requestedSession: 'sess_target' }))
        })
      },
      async (port) => {
        writeNativeBridgeFile(appData, port)
        await waitSendWindow()
        const result = await sendHostMessage(appData, 'deepseek-harness', '目标是 A 的消息', undefined, {
          host: 'deepseek-harness',
          sessionId: 'sess_target',
          cwd: '',
          updatedAt: Date.now() - 3000,
        })
        assert.equal(result.ok, false)
        assert.equal(result.code, 'no-session')
        assert.match(result.error, /不存在/)
        assert.equal(probe.count(), 0, '目标失效时应直接报告失败，不得改投或补发')
      },
    )
  } finally {
    stubPaths.harnessExe = ''
    stubPaths.harnessCli = ''
    fs.rmSync(appData, { recursive: true, force: true })
  }
})

test('[P2: 宿主收下请求后断线不得自动改走命令行]', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-p2-drop-'))
  const probe = makeCliProbe(appData)
  let received = 0
  try {
    stubPaths.harnessExe = process.execPath
    stubPaths.harnessCli = probe.cli
    await withServer(
      (req, res) => {
        req.resume()
        req.on('end', () => {
          received += 1
          req.socket.destroy()
        })
      },
      async (port) => {
        writeNativeBridgeFile(appData, port)
        await waitSendWindow()
        const result = await sendHostMessage(appData, 'deepseek-harness', '只应投一次的消息', undefined, {
          host: 'deepseek-harness',
          sessionId: 'sess_target',
          cwd: '',
          updatedAt: Date.now() - 3000,
        })
        assert.equal(received, 1, '宿主应已收到一次')
        assert.equal(result.ok, false)
        assert.match(result.error, /可能已经送到/)
        assert.equal(probe.count(), 0, '回执丢失不得静默重发')
      },
    )
  } finally {
    stubPaths.harnessExe = ''
    stubPaths.harnessCli = ''
    fs.rmSync(appData, { recursive: true, force: true })
  }
})

test('[P2: 连接被拒仍允许回退命令行]', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-p2-refused-'))
  const probe = makeCliProbe(appData)
  try {
    stubPaths.harnessExe = process.execPath
    stubPaths.harnessCli = probe.cli
    // 先占一个端口再放掉，保证这个端口确实没人监听
    const closedPort = await withServer(
      (req, res) => {
        res.end()
      },
      async (port) => port,
    )
    writeNativeBridgeFile(appData, closedPort)
    await waitSendWindow()
    const result = await sendHostMessage(appData, 'deepseek-harness', '宿主没起来时的消息', undefined, {
      host: 'deepseek-harness',
      sessionId: 'sess_target',
      cwd: '',
      updatedAt: Date.now() - 3000,
    })
    assert.equal(probe.count(), 1, '确定没送到时才允许回退命令行')
    assert.equal(result.ok, true)
  } finally {
    stubPaths.harnessExe = ''
    stubPaths.harnessCli = ''
    fs.rmSync(appData, { recursive: true, force: true })
  }
})
