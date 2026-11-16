/**
 * Uta 桌宠的 OpenCode 插件。
 *
 * OpenCode 2.x 的插件默认导出必须形如 { id, effect } 或 { id, setup }。
 * 这里使用 setup(ctx)：ctx 是宿主的注册式上下文——
 * - ctx.event.subscribe() 返回异步迭代器，逐个产出 { type, data } 形式的宿主事件；
 * - ctx.tool.hook('execute.before'/'execute.after', handler) 跟踪工具生命周期；
 * - ctx.permission.hook('evaluate', handler) 在权限评估阶段改写 effect。
 * setup 返回清理函数；1.14.31 的 server(input) 则返回 Hooks，使用 input.client SDK。
 * 两个入口共用事件处理、会话校验和审批逻辑。
 *
 * 所有网络请求只发往 127.0.0.1 上的 Uta 运行时；桌宠离线或审批超时
 * 时一律交回 OpenCode 自己的权限弹窗，绝不替代用户放行。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolveRuntimePaths } from '../../shared/uta-environment.mjs'
import { wrapCommand } from '../../shared/uta-protocol.mjs'

const SEND_TIMEOUT_MS = 1500
const APPROVAL_TIMEOUT_MS = 60_000
const STOP_DEDUP_MS = 10_000
const FINISH_DELAY_MS = 150
const MAX_REPLY_SUMMARY_CHARS = 80
const MAX_COMMENTARY_TEXT_CHARS = 120
const HOST_ID = 'opencode'
const HOST_LABEL = 'OpenCode'
const MCP_NAME = 'uta-deskpet'
function bundledMcp() {
  const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../uta-deskpet-mcp/deskpet-mcp.mjs')
  return fs.existsSync(entry) ? { type: 'local', command: ['node', entry], environment: { UTA_HOST: HOST_ID } } : null
}
const DEBUG_LOG_LIMIT_BYTES = 256 * 1024
const lastSessionWrite = new Map()
const hostInstanceId = crypto.randomUUID()
let eventSequence = 0

/** OpenCode 按单文件分发，这里内联共享判定，避免安装后相对 import 失效 */
export function isPetSpeechCall(toolName, args = {}) {
  const name = String(toolName || '').toLowerCase()
  if (!name) return false
  const normalizedName = name.replace(/[^a-z0-9]/g, '')
  if (normalizedName === 'callmcptool' || normalizedName === 'mcpcall') {
    const server = String(
      args?.ServerName ?? args?.serverName ?? args?.server_name ?? args?.server ?? '',
    ).toLowerCase()
    const target = String(
      args?.ToolName ??
        args?.toolName ??
        args?.tool_name ??
        args?.mcpToolName ??
        args?.mcp_tool_name ??
        args?.tool ??
        args?.name ??
        '',
    ).toLowerCase()
    if (server && !/(deskpet|uta)/.test(server)) return false
    return /(^|[^a-z0-9])(deskpet_(notify|say)|uta_express)([^a-z0-9]|$)/.test(target)
  }
  if (name.includes('uta_express')) {
    const text = args?.text ?? args?.Text ?? ''
    return typeof text === 'string' && text.trim().length > 0
  }
  return /(^|[^a-z0-9])deskpet_(notify|say)([^a-z0-9]|$)/.test(name)
}

/** 只登记 session id/cwd，供 Uta 从桌宠续会话；不记录提示词或工具参数。 */
function runtimeDirectory(env = process.env) {
  const endpoint = readEndpoint(env)
  return endpoint ? path.dirname(endpoint.file) : resolveRuntimePaths(env).runtimeDir
}

function reportHostSession(sessionID, env = process.env, cwd = '', nativeBridgeId = '') {
  const id = String(sessionID || '').trim()
  if (!id) return
  const now = Date.now()
  const key = `${runtimeDirectory(env)}:${id}:${cwd}:${nativeBridgeId}`
  if (now - (lastSessionWrite.get(key) || 0) < 2000) return
  lastSessionWrite.set(key, now)
  try {
    const dir = path.join(runtimeDirectory(env), 'hooks')
    const scoped = path.join(dir, 'sessions', HOST_ID, `${crypto.createHash('sha256').update(id).digest('hex')}.json`)
    fs.mkdirSync(path.dirname(scoped), { recursive: true })
    const value = JSON.stringify({ host: HOST_ID, sessionId: id.slice(0, 200), cwd, updatedAt: now, ...(nativeBridgeId ? { nativeBridgeId } : {}) })
    for (const file of [scoped, path.join(dir, 'opencode-session.json')]) {
      const temp = `${file}.${crypto.randomUUID()}.tmp`
      try { fs.writeFileSync(temp, value); fs.renameSync(temp, file) }
      finally { try { fs.rmSync(temp, { force: true }) } catch {} }
    }
  } catch {
    /* 会话登记失败不能影响宿主 */
  }
}
/** 高频增量事件不写调试日志，避免日志被流式片段刷爆 */
const QUIET_EVENTS = new Set([
  'session.text.delta',
  'session.reasoning.delta',
  'session.tool.input.delta',
  'session.tool.progress',
  'session.usage.updated',
  'message.part.delta',
])

/** 只记录事件名、会话尾号和工具名，不记录提示词或工具参数 */
function logEvent(event, extra = {}, env = process.env) {
  try {
    const dir = path.join(runtimeDirectory(env), 'hooks')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'opencode-events.jsonl')
    try {
      if (fs.statSync(file).size > DEBUG_LOG_LIMIT_BYTES) fs.rmSync(file)
    } catch {
      /* 文件还不存在 */
    }
    fs.appendFileSync(
      file,
      JSON.stringify({ ts: new Date().toISOString(), event: String(event || ''), ...extra }) + '\n',
    )
  } catch {
    /* 日志失败绝不能影响宿主 */
  }
}

export function endpointCandidates(env = process.env) {
  const out = []
  const override = env.DESKPET_ENDPOINT_FILE || env.UTA_ENDPOINT_FILE
  if (override) return [override]
  const scoped = resolveRuntimePaths(env)
  if (scoped.explicit) return [scoped.endpointFile]
  const appData = env.APPDATA
  if (appData) {
    out.push(path.join(appData, 'uta', 'host-pets', 'opencode', 'runtime-endpoint.json'))
    out.push(path.join(appData, 'uta', 'runtime-endpoint.json'))
    out.push(path.join(appData, 'MaiBot Deskpet', 'runtime-endpoint.json'))
    out.push(path.join(appData, 'maibot-deskpet', 'runtime-endpoint.json'))
  }
  return out
}

export function readEndpoint(env = process.env) {
  for (const file of endpointCandidates(env)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
      if (Number.isSafeInteger(raw?.pid) && raw.pid > 0) {
        try {
          process.kill(raw.pid, 0)
        } catch (error) {
          if (error?.code !== 'EPERM') continue
        }
      }
      if (raw && typeof raw.port === 'number' && typeof raw.token === 'string' && raw.token) {
        return { port: raw.port, token: raw.token, file }
      }
    } catch {
      /* 试下一个候选 */
    }
  }
  return null
}

async function callRuntime(method, route, body, timeoutMs = SEND_TIMEOUT_MS) {
  const endpoint = readEndpoint()
  if (!endpoint) throw new Error('Uta runtime is not running')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`http://127.0.0.1:${endpoint.port}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${endpoint.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data || data.ok !== true) {
      throw new Error((data && data.error) || `runtime returned HTTP ${response.status}`)
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

async function sendCommand(command, sessionID = '') {
  try {
    await callRuntime('POST', '/command', wrapCommand(command, {
      hostId: HOST_ID, hostInstanceId,
      ...(sessionID ? { sessionId: sessionID } : {}),
      eventId: crypto.randomUUID(), seq: ++eventSequence,
    }), SEND_TIMEOUT_MS)
    return true
  } catch {
    /* 桌宠没开时静默跳过 */
    return false
  }
}

/** 宿主计划只读快照：带 v2 归属信息，避免被当成无名会话。 */
async function sendTodoSnapshot(sessionID, command) {
  return sendCommand(command, sessionID)
}

function normalizeTodoStatus(value) {
  const status = String(value || '').trim()
  if (status === 'completed' || status === 'in_progress' || status === 'inProgress') {
    return status === 'inProgress' ? 'in_progress' : status
  }
  return 'pending'
}

/** 只读取 todowrite 的参数，不执行工具，也不写入宿主状态。 */
function todoSnapshotFromTool(toolName, args) {
  const name = String(toolName || '').trim().toLowerCase()
  if (name !== 'todowrite' && name !== 'todo_write' && name !== 'todo-write') return null
  const source = args && typeof args === 'object' ? args : {}
  const list = Array.isArray(source.todos) ? source.todos : null
  if (!list) return null
  const items = list.slice(0, 50).map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const text = String(item.content ?? item.text ?? item.step ?? '')
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
    if (!text) return null
    return { text, status: normalizeTodoStatus(item.status) }
  }).filter(Boolean)
  return {
    command: 'todo_snapshot',
    source: 'opencode-todo',
    cwd: '',
    items,
  }
}

/** 只按工具名分类，不读取参数内容；具体台词由 Uta 渲染层决定 */
function classifyToolIntent(toolName) {
  const name = String(toolName || '').toLowerCase()
  if (!name) return null
  if (name.includes('url') || name.includes('web') || name.includes('fetch') || name.includes('http')) {
    return 'researching'
  }
  if (name.includes('grep') || name.includes('glob') || name.includes('search') || name.includes('find')) {
    return 'searching'
  }
  if (
    name.includes('write') ||
    name.includes('edit') ||
    name.includes('patch') ||
    name.includes('replace') ||
    name.includes('create')
  ) {
    return 'editing'
  }
  if (name.includes('test') || name.includes('pytest') || name.includes('lint')) return 'testing'
  if (
    name === 'bash' ||
    name === 'shell' ||
    name === 'exec' ||
    name === 'terminal' ||
    name.includes('command')
  ) {
    return 'running'
  }
  if (name.includes('read') || name.includes('cat') || name.includes('view') || name.includes('list')) {
    return 'looking'
  }
  return 'running'
}

async function sendNarration(sessionID, intent, toolName = '', options = {}) {
  if (!sessionID || !intent) return
  const safeTool = String(toolName || '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 32)
  await sendCommand({
    command: 'agent_narrate',
    intent,
    ...(safeTool ? { toolName: safeTool } : {}),
    ...(options.reasoning ? { reasoning: true } : {}),
  }, sessionID)
}

/** 从推理文本推断视觉意图；只做关键词分类，不展示或记录思考内容 */
export function inferReasoningIntent(text) {
  const value = String(text || '').toLowerCase()
  if (!value) return 'thinking'
  if (/error|fail|exception|bug|报错|失败|异常|崩溃|错误/.test(value)) return 'error'
  if (/test|pytest|测试|验证|校验/.test(value)) return 'testing'
  if (/edit|write|modify|fix|patch|修改|改写|写入|编辑|补丁/.test(value)) return 'editing'
  if (/wait|approval|等待|审批|确认/.test(value)) return 'waiting'
  if (/found|root cause|原因|找到了|定位到|发现/.test(value)) return 'found'
  if (/search|grep|find|look|read|log|查找|搜索|日志|读取/.test(value)) return 'looking'
  return 'thinking'
}

function summarizeReply(text) {
  return summarizeCommentary(text, MAX_REPLY_SUMMARY_CHARS)
}

/** 让用户选方案/回答问题的工具不是权限审批 */
function isUserChoiceTool(name) {
  const value = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
  if (!value) return false
  return (
    value === 'question' ||
    value.includes('askquestion') ||
    value.includes('askuser') ||
    value.includes('askfollowupquestion') ||
    value.includes('requestuserinput') ||
    value.includes('requestuserselection') ||
    value.includes('userchoice') ||
    value.includes('chooseoption') ||
    value.includes('selectoption') ||
    value.includes('presentoptions')
  )
}

function isUserChoicePermission(permission) {
  return [
    permission?.action,
    permission?.type,
    permission?.title,
    permission?.pattern,
  ].some((value) => isUserChoiceTool(Array.isArray(value) ? value.join(' ') : value))
}

/** 工作中汇报：只保留一两句，去掉表格/代码与表情标签 */
export function summarizeCommentary(text, maxChars = MAX_COMMENTARY_TEXT_CHARS) {
  if (typeof text !== 'string' || !text.trim()) return ''
  const normalized = text.replace(/\r\n?/g, '\n')
  const withoutCode = normalized.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]+)`/g, '$1')
  const withoutTables = withoutCode
    .split('\n')
    .filter((line) => !/^\s*\|.*\|\s*$/.test(line))
    .join('\n')
  const prose = withoutTables
    .replace(/\[(?:uta|emotion|preset)\s*:[^\]]*\]/gi, '')
    .replace(/<uta\s[^>]*\/?>/gi, '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!prose) return ''
  if (prose.length <= maxChars) return prose
  const sentences = prose.match(/[^。！？!?]+[。！？!?]?/g) ?? [prose]
  let summary = (sentences[0] || prose).trim()
  if (summary.length < 24 && sentences[1]) summary = `${summary} ${sentences[1].trim()}`.trim()
  if (summary.length > maxChars) {
    const cut = summary.slice(0, maxChars)
    const punctuation = Math.max(
      cut.lastIndexOf('。'),
      cut.lastIndexOf('！'),
      cut.lastIndexOf('？'),
      cut.lastIndexOf('；'),
      cut.lastIndexOf('.'),
    )
    summary = (punctuation >= 12 ? cut.slice(0, punctuation + 1) : cut).trimEnd() + '…'
  } else if (prose.length > summary.length) {
    summary = `${summary.replace(/[。！？!?]$/, '')}…`
  }
  return summary.slice(0, maxChars + 1)
}

function hashReply(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex')
}

function tailSessionID(sessionID) {
  return typeof sessionID === 'string' && sessionID ? sessionID.slice(-8) : undefined
}

function summarizePermission(permission) {
  const action =
    (typeof permission?.action === 'string' && permission.action.trim()) ||
    (typeof permission?.type === 'string' && permission.type.trim()) ||
    (typeof permission?.title === 'string' && permission.title.trim()) ||
    'permission'
  const resources = Array.isArray(permission?.resources)
    ? permission.resources
    : Array.isArray(permission?.pattern)
      ? permission.pattern
      : [permission?.pattern]
  const detail = resources.filter((item) => typeof item === 'string').join(' ').trim()
  if (detail) {
    return `${HOST_LABEL} 请求执行 ${action}：${detail.slice(0, 300)}`
  }
  return `${HOST_LABEL} 请求执行 ${action}`
}

function sessionKey(sessionID) {
  return String(sessionID || 'anon')
    .replace(/[^A-Za-z0-9_.:-]/g, '_')
    .slice(-24)
}

async function askDeskpetApproval(permission) {
  const requestId = permission?.utaRequestId || `${HOST_ID}-${sessionKey(permission?.sessionID)}-${crypto.randomUUID()}`
  const reason = summarizePermission(permission)
  try {
    const result = await callRuntime(
      'POST',
      '/approval/ask',
      {
        requestId,
        toolName: String(permission?.action || permission?.type || 'permission').slice(0, 80),
        reason,
        displayReason: reason,
        host: HOST_ID,
        ...(permission?.sessionID ? { sessionId: permission.sessionID } : {}),
        timeoutMs: APPROVAL_TIMEOUT_MS,
      },
      APPROVAL_TIMEOUT_MS + 3000,
    )
    return result?.outcome
  } catch {
    return 'unavailable'
  }
}

/** 2.0.32 事件形如 { type, data }；旧版兼容回退到 properties */
function eventPayload(event) {
  if (event?.data && typeof event.data === 'object') return event.data
  if (event?.properties && typeof event.properties === 'object') return event.properties
  return {}
}

function pickSessionID(data) {
  const candidates = [
    data?.sessionID,
    data?.info?.sessionID,
    data?.info?.id,
    data?.part?.sessionID,
    data?.message?.sessionID,
  ]
  return candidates.find((value) => typeof value === 'string' && value) || ''
}

const createUtaRuntime = async (ctx = {}) => {
  logEvent('PluginLoaded')
  /** sessionID -> 运行期状态（只存在内存里，不落盘） */
  const sessions = new Map()
  /** callID -> 工具名：session.tool.success/failed 只带 id，不带 name */
  const toolByCall = new Map()
  const pendingTodos = new Map()
  /** sessionID -> idle 后延迟收尾的定时器 */
  const finishTimers = new Map()
  const disposers = []
  let disposeNative = null
  const nativeBridgeId = crypto.randomUUID()
  let nativeReady = false

  if (typeof ctx?.session?.get === 'function' && typeof ctx?.session?.prompt === 'function') {
    const file = path.join(runtimeDirectory(), 'hooks', 'opencode-native-bridge.json')
    const scopedFile = path.join(runtimeDirectory(), 'hooks/native-bridges/opencode', `${nativeBridgeId}.json`)
    const token = crypto.randomBytes(24).toString('hex')
    const server = http.createServer(async (req, res) => {
      const send = (status, body) => { if (!res.writableEnded) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) } }
      if (req.method !== 'POST' || req.url !== '/message') return send(404, { ok: false, error: 'not-found' })
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { ok: false, error: 'unauthorized' })
      let submitted = false
      try {
        let raw = ''
        for await (const chunk of req) {
          raw += chunk.toString('utf8')
          if (Buffer.byteLength(raw) > 16_384) return send(413, { ok: false, error: 'request-too-large' })
        }
        const body = JSON.parse(raw)
        const sessionID = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (!sessionID || sessionID.length > 200 || !text || text.length > 1000) return send(400, { ok: false, error: 'invalid-input' })
        let session
        try { session = await ctx.session.get({ sessionID }) } catch { return send(409, { ok: false, error: 'session-not-found' }) }
        if (!session || session.id !== sessionID) return send(409, { ok: false, error: 'session-mismatch' })
        const directory = session.directory || session.location?.directory || ''
        const normalizeDirectory = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
        if (body.cwd && (!directory || normalizeDirectory(body.cwd) !== normalizeDirectory(directory))) {
          return send(409, { ok: false, error: 'session-mismatch' })
        }
        submitted = true
        const receipt = await ctx.session.prompt({ sessionID, text, delivery: 'queue', metadata: { source: 'uta', ...(typeof body.messageId === 'string' ? { utaMessageId: body.messageId.slice(0, 128) } : {}) } })
        if (receipt?.sessionID && receipt.sessionID !== sessionID) return send(500, { ok: false, error: 'delivery-unknown' })
        send(200, { ok: true, accepted: true, delivery: receipt?.delivery === 'accepted' ? 'accepted' : 'queued', sessionId: sessionID, ...(typeof receipt?.id === 'string' ? { hostMessageId: receipt.id } : {}) })
      } catch { send(submitted ? 500 : 400, { ok: false, error: submitted ? 'delivery-unknown' : 'invalid-input' }) }
    })
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      server.unref?.()
      fs.mkdirSync(path.dirname(scopedFile), { recursive: true })
      const metadata = JSON.stringify({ version: 1, pid: process.pid, port: server.address().port, token,
        delivery: ctx.nativeDelivery === 'accepted' ? 'accepted' : 'queued' })
      fs.writeFileSync(scopedFile, metadata, { encoding: 'utf8', mode: 0o600 })
      fs.writeFileSync(file, metadata, { encoding: 'utf8', mode: 0o600 })
      nativeReady = true
      disposeNative = () => {
        server.close()
        for (const target of [file, scopedFile]) {
          try { const current = JSON.parse(fs.readFileSync(target, 'utf8')); if (current.token === token) fs.rmSync(target, { force: true }) } catch {}
        }
      }
    } catch { server.close() }
  }

  function track(registration) {
    if (!registration) return
    if (typeof registration.dispose === 'function') disposers.push(registration)
    else if (typeof registration === 'function') disposers.push({ dispose: registration })
  }

  function stateFor(sessionID) {
    const key = String(sessionID || '')
    let state = sessions.get(key)
    if (!state) {
      state = {
        announced: false,
        lastState: '',
        lastAssistantMessageID: '',
        lastText: '',
        petSpokeThisTurn: false,
        reasoningText: '',
        lastReasoningIntent: '',
        lastReasoningAt: 0,
        lastCompletedAt: 0,
        lastCompletedHash: '',
        turnActive: false,
        toolRunning: false,
        cwd: '',
        lastMetadataAt: 0,
      }
      sessions.set(key, state)
    }
    return state
  }

  function clearFinishTimer(sessionID) {
    const key = String(sessionID || '')
    const timer = finishTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      finishTimers.delete(key)
    }
  }

  async function announce(sessionID) {
    const state = stateFor(sessionID)
    if (state.announced) return
    state.announced = true
    await sendCommand({ command: 'agent_state', state: 'idle' }, sessionID)
    await sendCommand({ command: 'summon' }, sessionID)
    await sendNarration(sessionID, 'session_start')
  }

  async function setState(sessionID, nextState, label = '', toolName = '') {
    const state = stateFor(sessionID)
    const key = `${nextState}|${label}|${toolName}`
    if (state.lastState === key) return
    state.lastState = key
    await sendCommand({
      command: 'agent_state',
      state: nextState,
      ...(label ? { label } : {}),
      ...(toolName ? { toolName } : {}),
    }, sessionID)
  }

  async function refreshMetadata(sessionID) {
    const state = stateFor(sessionID)
    if (Date.now() - state.lastMetadataAt >= 2000 && typeof ctx?.session?.get === 'function') {
      state.lastMetadataAt = Date.now()
      try {
        const info = await ctx.session.get({ sessionID })
        if (info?.id === sessionID) {
          state.cwd = info.directory || info.location?.directory || ''
          reportHostSession(sessionID, process.env, state.cwd, nativeReady ? nativeBridgeId : '')
          const title = typeof info.title === 'string' ? info.title.trim().slice(0, 80) : ''
          await sendCommand({ command: 'session_bind', label: title || HOST_LABEL, ...(state.cwd ? { cwd: state.cwd } : {}) }, sessionID)
        }
      } catch { /* Missing session metadata never borrows the plugin instance's directory. */ }
    }
    return state.cwd
  }

  async function beginTurn(sessionID) {
    const state = stateFor(sessionID)
    await refreshMetadata(sessionID)
    await announce(sessionID)
    if (state.turnActive) return
    state.turnActive = true
    state.lastAssistantMessageID = ''
    state.lastText = ''
    state.petSpokeThisTurn = false
    state.reasoningText = ''
    state.lastReasoningIntent = ''
    state.lastReasoningAt = 0
    await sendNarration(sessionID, 'thinking')
  }

  function rememberAssistantText(sessionID, messageID, text) {
    if (!sessionID || typeof text !== 'string') return
    const state = stateFor(sessionID)
    if (messageID && state.lastAssistantMessageID !== messageID) {
      state.lastAssistantMessageID = messageID
      state.lastText = ''
    }
    state.lastText = text
  }

  function appendAssistantText(sessionID, messageID, delta) {
    if (!sessionID || typeof delta !== 'string' || !delta) return
    const state = stateFor(sessionID)
    if (messageID && state.lastAssistantMessageID !== messageID) {
      state.lastAssistantMessageID = messageID
      state.lastText = ''
    }
    state.lastText += delta
  }

  /** 推理流只用于视觉意图；不展示或记录思考内容 */
  async function appendReasoningText(sessionID, delta) {
    if (!sessionID || typeof delta !== 'string' || !delta) return
    const state = stateFor(sessionID)
    state.reasoningText = `${state.reasoningText || ''}${delta}`.slice(-1200)
    const now = Date.now()
    const intent = inferReasoningIntent(state.reasoningText)
    if (
      intent &&
      (intent !== state.lastReasoningIntent || now - state.lastReasoningAt >= 2500)
    ) {
      state.lastReasoningIntent = intent
      state.lastReasoningAt = now
      await sendNarration(sessionID, intent, '', { reasoning: true })
    }
  }

  async function finishSession(sessionID) {
    clearFinishTimer(sessionID)
    const state = stateFor(sessionID)
    if (!state.turnActive) return
    state.turnActive = false
    clearSessionTools(sessionID)

    const text = state.lastText
    const hash = hashReply(text)
    const now = Date.now()
    if (
      state.lastCompletedHash === hash &&
      now - state.lastCompletedAt >= 0 &&
      now - state.lastCompletedAt < STOP_DEDUP_MS
    ) {
      return
    }
    state.lastCompletedHash = hash
    state.lastCompletedAt = now

    const summary = state.petSpokeThisTurn ? '' : summarizeReply(text)
    let delivered = false
    if (summary) delivered = await sendCommand({ command: 'rp_reply', text: summary }, sessionID)
    const stateDelivered = await sendCommand({
      command: 'agent_state',
      state: 'completed',
      label: '回复完成',
    }, sessionID)
    logEvent('ReplySent', { session: tailSessionID(sessionID), delivered, stateDelivered, chars: text.length })
  }

  function clearSessionTools(sessionID) {
    for (const map of [toolByCall, pendingTodos]) {
      for (const key of map.keys()) if (key.startsWith(`${sessionID}:`)) map.delete(key)
    }
  }

  function scheduleFinish(sessionID) {
    clearFinishTimer(sessionID)
    const key = String(sessionID || '')
    const timer = setTimeout(() => {
      finishTimers.delete(key)
      finishSession(key).catch(() => {})
    }, FINISH_DELAY_MS)
    finishTimers.set(key, timer)
  }

  async function onEvent(event) {
    const type = event?.type
    if (!type) return
    const data = eventPayload(event)
    const sessionID = pickSessionID(data)
    if (!QUIET_EVENTS.has(type)) {
      logEvent(type, { session: tailSessionID(sessionID) })
    }
    if (type === 'todo.updated' && sessionID) {
      const snapshot = todoSnapshotFromTool('todowrite', { todos: data.todos })
      if (snapshot) await sendTodoSnapshot(sessionID, { ...snapshot, cwd: await refreshMetadata(sessionID) })
      return
    }

    if (type === 'session.created') {
      if (!sessionID) return
      await refreshMetadata(sessionID)
      await announce(sessionID)
      return
    }

    if (type === 'session.status') {
      const status = data.status
      clearFinishTimer(sessionID)
      if (status?.type === 'busy') {
        await beginTurn(sessionID)
        const state = stateFor(sessionID)
        if (!state.toolRunning) await setState(sessionID, 'thinking', '思考中...')
      } else if (status?.type === 'retry') {
        await setState(sessionID, 'thinking', '处理报错，重试中...')
        await sendNarration(sessionID, 'retry')
      } else if (status?.type === 'idle') {
        const state = stateFor(sessionID)
        state.toolRunning = false
        scheduleFinish(sessionID)
      }
      return
    }

    if (type === 'session.idle') {
      const state = stateFor(sessionID)
      state.toolRunning = false
      scheduleFinish(sessionID)
      return
    }

    if (type === 'session.execution.started') {
      clearFinishTimer(sessionID)
      await beginTurn(sessionID)
      await setState(sessionID, 'thinking', '思考中...')
      return
    }

    if (type === 'session.execution.succeeded') {
      scheduleFinish(sessionID)
      return
    }

    if (type === 'session.execution.interrupted') {
      // 用户主动取消：不播报成功，也不把半截回复当完成
      clearFinishTimer(sessionID)
      const state = stateFor(sessionID)
      state.turnActive = false
      state.toolRunning = false
      clearSessionTools(sessionID)
      await setState(sessionID, 'idle', '已取消')
      await sendNarration(sessionID, 'retry')
      return
    }

    if (type === 'session.execution.failed' || type === 'session.error') {
      stateFor(sessionID).turnActive = false
      clearFinishTimer(sessionID)
      clearSessionTools(sessionID)
      await setState(sessionID, 'error', '处理出错')
      await sendNarration(sessionID, 'error')
      return
    }

    if (type === 'session.tool.success') {
      const key = `${sessionID}:${data.id || data.callID || ''}`
      const snapshot = pendingTodos.get(key)
      pendingTodos.delete(key)
      if (snapshot) await sendTodoSnapshot(sessionID, snapshot)
      const toolName = toolByCall.get(key) || data.name || data.tool || ''
      toolByCall.delete(key)
      const intent = classifyToolIntent(toolName)
      await sendNarration(
        sessionID,
        intent === 'looking' || intent === 'searching' || intent === 'researching'
          ? 'found'
          : 'progress',
        toolName,
      )
      return
    }

    if (type === 'session.tool.failed') {
      const key = `${sessionID}:${data.id || data.callID || ''}`
      pendingTodos.delete(key)
      const toolName = toolByCall.get(key) || data.name || data.tool || ''
      toolByCall.delete(key)
      await sendNarration(sessionID, 'error', toolName)
      return
    }

    if (type === 'session.reasoning.delta' && typeof data.delta === 'string') {
      await appendReasoningText(sessionID, data.delta)
      return
    }

    if (type === 'message.part.delta' && data.field === 'reasoning') {
      await appendReasoningText(data.sessionID, data.delta)
      return
    }

    if (type === 'session.text.started') {
      const assistantMessageID = data.assistantMessageID
      const state = stateFor(sessionID)
      state.lastAssistantMessageID = typeof assistantMessageID === 'string' ? assistantMessageID : ''
      state.lastText = ''
      return
    }

    if (type === 'session.text.delta') {
      appendAssistantText(sessionID, data.assistantMessageID, data.delta)
      return
    }

    if (type === 'session.text.ended' && typeof data.text === 'string') {
      rememberAssistantText(sessionID, data.assistantMessageID, data.text)
      return
    }

    if (type === 'message.updated') {
      const info = data.info
      if (info?.role === 'assistant' && info.sessionID) {
        stateFor(info.sessionID).lastAssistantMessageID = info.id || ''
      }
      return
    }

    if (type === 'message.part.updated') {
      const part = data.part
      if (part?.type === 'text' && typeof part.text === 'string' && part.sessionID) {
        rememberAssistantText(part.sessionID, part.messageID, part.text)
      }
      return
    }

    if (type === 'message.part.delta' && data.field === 'text') {
      appendAssistantText(data.sessionID, data.messageID, data.delta)
    }
  }

  async function onToolBefore(input) {
    if (!input?.sessionID) return
    logEvent('tool.execute.before', {
      session: tailSessionID(input.sessionID),
      tool: typeof input.tool === 'string' ? input.tool : undefined,
    })
    clearFinishTimer(input.sessionID)
    await beginTurn(input.sessionID)
    const state = stateFor(input.sessionID)
    state.toolRunning = true
    if (input.callID) toolByCall.set(`${input.sessionID}:${input.callID}`, input.tool)
    const toolArgs = input.args || input.arguments || input.input || {}
    const todoSnapshot = todoSnapshotFromTool(input.tool, toolArgs)
    if (todoSnapshot && input.callID) {
      pendingTodos.set(`${input.sessionID}:${input.callID}`, { ...todoSnapshot, cwd: state.cwd })
    }
    if (isPetSpeechCall(input.tool, toolArgs)) state.petSpokeThisTurn = true
    const toolName = String(input.tool || '')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 32)
    await setState(input.sessionID, 'tool_running', '', toolName)
    await sendNarration(input.sessionID, classifyToolIntent(input.tool), input.tool)
  }

  async function onToolAfter(input) {
    if (!input?.sessionID) return
    logEvent('tool.execute.after', {
      session: tailSessionID(input.sessionID),
      tool: typeof input.tool === 'string' ? input.tool : undefined,
    })
    const state = stateFor(input.sessionID)
    state.toolRunning = false
    await setState(input.sessionID, 'thinking', '处理结果...')
  }

  async function onPermission(request) {
    logEvent('permission.ask', {
      session: tailSessionID(request?.sessionID),
      tool: typeof request?.action === 'string' ? request.action : undefined,
    })
    if (isUserChoicePermission(request)) {
      // 选方案不是审批：桌宠只提示，交互留在 OpenCode 自己的窗口。
      try {
        await sendCommand({
          command: 'agent_state',
          state: 'tool_running',
          label: '等待你在宿主里选择方案',
        }, request?.sessionID)
        await sendCommand({
          command: 'choice_hint',
          text: 'OpenCode 在等你选择方案，请回宿主窗口处理。',
        }, request?.sessionID)
      } catch {
        /* 桌宠离线时不影响 OpenCode 自己的选择界面 */
      }
      return
    }
    await sendNarration(
      request?.sessionID,
      'waiting',
      request?.action || request?.type || 'permission',
    )
    const outcome = await askDeskpetApproval(request)
    if (outcome === 'allowed-once' || outcome === 'approved') {
      request.effect = 'allow'
    } else if (outcome === 'rejected') {
      request.effect = 'deny'
    }
    // 其他结果保持宿主原值（ask），让 OpenCode 显示自己的审批弹窗
  }

  const registration = { event: false, tool: false, permission: false }
  const eventAbort = new AbortController()

  if (typeof ctx?.event?.subscribe === 'function') {
    try {
      // 2.0.32 的 ctx.event.subscribe 返回异步迭代器，而不是回调注册函数
      const events = ctx.event.subscribe({ signal: eventAbort.signal })
      const pump = async () => {
        for await (const event of events) {
          try {
            await onEvent(event)
          } catch {
            /* 单个事件处理失败不影响后续事件 */
          }
        }
      }
      pump().catch(() => {})
      registration.event = true
    } catch {
      /* 注册失败时保持静默，不影响宿主 */
    }
  }

  if (typeof ctx?.tool?.hook === 'function') {
    try {
      track(
        ctx.tool.hook('execute.before', (input) => {
          return onToolBefore(input).catch(() => {})
        }),
      )
      track(
        ctx.tool.hook('execute.after', (input) => {
          return onToolAfter(input).catch(() => {})
        }),
      )
      registration.tool = true
    } catch {
      /* 注册失败时保持静默 */
    }
  }

  if (typeof ctx?.permission?.hook === 'function') {
    try {
      track(ctx.permission.hook('evaluate', (request) => onPermission(request)))
      registration.permission = true
    } catch {
      /* 注册失败时保持静默 */
    }
  }

  logEvent('HooksRegistered', {
    eventHook: registration.event,
    toolHook: registration.tool,
    permissionHook: registration.permission,
  })

  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    disposeNative?.()
    eventAbort.abort()
    toolByCall.clear()
    pendingTodos.clear()
    for (const timer of finishTimers.values()) clearTimeout(timer)
    finishTimers.clear()
    for (const disposable of disposers) {
      try {
        disposable.dispose()
      } catch {
        /* 清理失败不影响退出 */
      }
    }
    logEvent('PluginDisposed')
  }
  return { dispose, onEvent, onToolBefore, onToolAfter, onPermission, beginTurn }
}

export const UtaPlugin = async (ctx = {}) => {
  const runtime = await createUtaRuntime(ctx)
  const mcp = bundledMcp()
  if (mcp && typeof ctx.mcp?.transform === 'function') {
    try {
      await ctx.mcp.transform(editor => {
        if (!editor.get(MCP_NAME)) editor.set(MCP_NAME, { ...mcp, codemode: false })
      })
    } catch { /* Existing host event and permission hooks remain usable. */ }
  }
  return runtime.dispose
}

/** OpenCode 1.14.31: SDK methods use path/query/body and return { data, error, response }. */
async function legacyServer(input = {}) {
  const client = input.client
  const query = { directory: input.directory }
  const unwrap = result => {
    if (!result || result.error || result.response?.ok === false) throw Error('OpenCode SDK request failed')
    return result.data
  }
  const session = typeof client?.session?.get === 'function' && typeof client?.session?.promptAsync === 'function' ? {
    get: async ({ sessionID }) => unwrap(await client.session.get({ path: { id: sessionID }, query })),
    prompt: async ({ sessionID, text }) => {
      unwrap(await client.session.promptAsync({
        path: { id: sessionID }, query, body: { parts: [{ type: 'text', text }] },
      }))
      // HTTP 204 confirms asynchronous admission, not a completed turn or a queue receipt.
      return { sessionID, delivery: 'accepted' }
    },
  } : undefined
  const runtime = await createUtaRuntime({ session, nativeDelivery: 'accepted' })
  const pendingPermissions = new Map()
  const assistantMessages = new Map()
  let disposed = false
  const dispose = () => { disposed = true; pendingPermissions.clear(); assistantMessages.clear(); runtime.dispose() }
  const onLegacyEvent = async ({ event }) => {
      if (disposed) return
      if (event?.type === 'server.instance.disposed') { dispose(); return }
      const data = eventPayload(event)
      if (event?.type === 'message.updated' && data.info?.role === 'assistant') {
        assistantMessages.set(data.info.sessionID, data.info.id)
      }
      if (event?.type === 'session.deleted') { assistantMessages.delete(data.info?.id); return }
      if ((event?.type === 'message.part.updated' && ['text', 'reasoning'].includes(data.part?.type)) ||
          (event?.type === 'message.part.delta' && ['text', 'reasoning'].includes(data.field))) {
        const part = data.part || data
        // User text and history replays must never be announced as an assistant reply.
        if (!part.messageID || assistantMessages.get(part.sessionID) !== part.messageID) return
      }
      if (event?.type === 'question.asked') {
        await runtime.onPermission({ sessionID: data.sessionID, action: 'question' })
        return
      }
      if (event?.type === 'permission.replied') {
        const ticket = pendingPermissions.get(data.requestID)
        pendingPermissions.delete(data.requestID)
        if (ticket) await callRuntime('POST', '/approval/cancel', {
          requestId: ticket.requestId, host: HOST_ID, sessionId: data.sessionID,
        }, SEND_TIMEOUT_MS).catch(() => {})
        return
      }
      if (event?.type === 'permission.asked') {
        if (!data.id || !data.sessionID || typeof client?.postSessionIdPermissionsPermissionId !== 'function') return
        const ticket = { requestId: `${HOST_ID}-${crypto.randomUUID()}` }
        pendingPermissions.set(data.id, ticket)
        const request = { ...data, action: data.permission, resources: data.patterns, effect: 'ask', utaRequestId: ticket.requestId }
        try {
          await runtime.onPermission(request)
          if (disposed || pendingPermissions.get(data.id) !== ticket) return
          if (request.effect === 'allow' || request.effect === 'deny') {
            unwrap(await client.postSessionIdPermissionsPermissionId({
              path: { id: data.sessionID, permissionID: data.id }, query,
              body: { response: request.effect === 'allow' ? 'once' : 'reject' },
            }))
          }
        } finally { if (pendingPermissions.get(data.id) === ticket) pendingPermissions.delete(data.id) }
        return
      }
      await runtime.onEvent(event)
  }
  return {
    config: async config => {
      const mcp = bundledMcp()
      if (mcp) (config.mcp ??= {})[MCP_NAME] ??= mcp
    },
    event: value => onLegacyEvent(value).catch(() => {}),
    'chat.message': async ({ sessionID }) => { if (!disposed && sessionID) await runtime.beginTurn(sessionID) },
    'tool.execute.before': async (value, output) => {
      if (!disposed) await runtime.onToolBefore({ ...value, args: output.args })
    },
    'tool.execute.after': async value => { if (!disposed) await runtime.onToolAfter(value) },
    // Older hosts that still trigger this hook retain their native ask state on timeout/offline.
    'permission.ask': async (value, output) => {
      if (disposed) return
      const request = { ...value, effect: output.status }
      await runtime.onPermission(request)
      if (request.effect === 'allow' || request.effect === 'deny') output.status = request.effect
    },
  }
}

export default {
  id: 'uta-deskpet-opencode',
  server: legacyServer,
  setup: async (ctx) => UtaPlugin(ctx),
}
